/**
 * REQ-975 — LOOP-007 cycle 1, issue q1-55: "Danger zone: the account-wipe block has no heading;
 * the confirm placeholder looks pre-filled". On /settings the irreversible wipe text sat right
 * under the Reset button with no title of its own, so it read as part of the Reset block; and the
 * empty confirm fields showed the literal keyword ("ELIMINAR"/"DELETE", "REINICIAR"/"RESET") as
 * their placeholder, which looks as if it were already typed. In a browser, in ES and in EN: the
 * [data-cy=settings-wipe] block carries its own heading, and neither confirm input's placeholder
 * is its keyword.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  await (await http("/api/me", {
    method: "PUT",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify({ language: lang, name: "Wipe Heading Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
}

async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).click({ timeout: 2_000 });
    } catch {
      // not clickable yet (hydration): the polls below say whether the click landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

const CASES = [
  {
    lang: "es" as const,
    heading: "Eliminar cuenta",
    wipeKeyword: "ELIMINAR",
    resetKeyword: "REINICIAR",
  },
  {
    lang: "en" as const,
    heading: "Delete account",
    wipeKeyword: "DELETE",
    resetKeyword: "RESET",
  },
];

for (const c of CASES) {
  Deno.test(`REQ-975 (LOOP-007 q1-55): /settings?lang=${c.lang} — the wipe block is headed '${c.heading}' and no confirm field shows its keyword '${c.wipeKeyword}'/'${c.resetKeyword}' as a placeholder`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await signIn(http, page, baseUrl, c.lang);
      await page.goto(`/settings?lang=${c.lang}`);
      await page.locator("[data-cy='settings-reset-open']").waitFor({
        timeout: 20_000,
      });

      const wipe = await page.evaluate(() => {
        const block = document.querySelector("[data-cy='settings-wipe']");
        const input = document.querySelector<HTMLInputElement>(
          "[data-cy='settings-wipe-confirm-input']",
        );
        return {
          found: !!block,
          text: (block as HTMLElement | null)?.innerText ?? "",
          inputInBlock: !!(block && input && block.contains(input)),
          placeholder: input?.getAttribute("placeholder") ?? null,
        };
      });
      expect(
        wipe.found,
        "there is no [data-cy=settings-wipe] block — the wipe content has no sub-block of its own",
      );
      expect(
        wipe.text.trim().startsWith(c.heading),
        `the wipe block does not open with the heading '${c.heading}' (it reads: ${
          JSON.stringify(wipe.text.slice(0, 80))
        })`,
      );
      expect(
        wipe.inputInBlock,
        "the [data-cy=settings-wipe-confirm-input] field is not inside the wipe block",
      );
      expect(
        (wipe.placeholder ?? "").trim().toUpperCase() !== c.wipeKeyword,
        `the wipe confirm field's placeholder is the keyword itself (${
          JSON.stringify(wipe.placeholder)
        }) — it looks already typed`,
      );

      await clickUntil(
        page,
        "[data-cy='settings-reset-open']",
        async () =>
          await page.locator("[data-cy='settings-reset-modal']").isVisible()
            .catch(() => false),
      );
      const resetPh = await page.locator(
        "[data-cy='settings-reset-confirm-input']",
      ).getAttribute("placeholder");
      expect(
        (resetPh ?? "").trim().toUpperCase() !== c.resetKeyword,
        `the reset confirm field's placeholder is the keyword itself (${
          JSON.stringify(resetPh)
        }) — it looks already typed`,
      );
    }));
}
