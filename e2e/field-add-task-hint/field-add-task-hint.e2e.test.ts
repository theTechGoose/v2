/**
 * REQ-1059 — AMENDMENT of REQ-743 (LOOP-007 cycle 2, q2-48): "One-off task form still says
 * 'subscription'". QA opened /field/tasks → Add task and read "One customer, one day or several
 * days in a row — not part of any subscription." Everywhere else in Field it is "repeat visit".
 * The walk, in a real browser: sign in, open /field/tasks, open Add task, read the panel hint.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Fence Owner" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-1059 (LOOP-007 q2-48): /field/tasks → Add task — the panel hint says repeat visit, never subscription", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/field/tasks");
    const form = page.locator("[data-cy='tk-add-form']");
    await clickUntil(page, "[data-cy='tk-add']", () => form.isVisible());
    const hint = ((await form.locator("p.hint").first().textContent()) ?? "")
      .trim();
    expect(
      !/subscri/i.test(hint),
      `the Add task hint does not say "subscription" (got "${hint}")`,
    );
    expect(
      /repeat visit/i.test(hint),
      `the Add task hint says "repeat visit" (got "${hint}")`,
    );
    expect(
      /several days/i.test(hint),
      `the Add task hint still says a job can run several days (got "${hint}")`,
    );
  }));
