/**
 * REQ-512 — demo-loop cycle 3, issue p8-pair1-f: "Email shown truncated in Settings". At a
 * 1280-wide desktop the EditCard put name and email in one narrow `minmax(180px, 1fr)` track
 * each, so "maria@castropainting.com" overflowed its input and read "maria@castropainting.cor".
 * In a browser: the email input shows the whole address (no horizontal overflow) and is as wide
 * as the business-name input that already spans the row.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const EMAIL = `maria${digits()}@castropainting.com`;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
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
    body: JSON.stringify({
      language: "en",
      name: "Maria Castro",
      email: EMAIL,
    }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
}

Deno.test("REQ-512 (demo cycle 3, p8-pair1-f): at 1280 wide the Settings email input shows the whole address, as wide as the business-name row", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(http, page, baseUrl);
    await page.goto("/settings");
    const email = page.locator("input.settings-edit__input[type='email']")
      .first();
    await email.waitFor({ timeout: 20_000 });
    await page.waitForFunction(
      (want) =>
        (document.querySelector(
          "input.settings-edit__input[type='email']",
        ) as HTMLInputElement | null)?.value === want,
      EMAIL,
      { timeout: 15_000 },
    );

    const m = await page.evaluate(() => {
      const inputs = [
        ...document.querySelectorAll<HTMLInputElement>(
          "input.settings-edit__input",
        ),
      ];
      const em = inputs.find((i) => i.type === "email")!;
      const biz = inputs.find((i) =>
        i.closest("label")?.style.gridColumn.replace(/\s/g, "") === "1/-1" &&
        i.type === "text"
      );
      return {
        scroll: em.scrollWidth,
        client: em.clientWidth,
        width: em.getBoundingClientRect().width,
        bizWidth: biz?.getBoundingClientRect().width ?? -1,
      };
    });
    expect(
      m.scroll <= m.client,
      `email overflows its input: scrollWidth ${m.scroll} > clientWidth ${m.client} (width ${m.width}px)`,
    );
    expect(
      Math.abs(m.width - m.bizWidth) < 2,
      `email input ${m.width}px is not the full row (business name ${m.bizWidth}px)`,
    );
  }));
