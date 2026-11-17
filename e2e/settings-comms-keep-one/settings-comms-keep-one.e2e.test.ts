/**
 * REQ-500 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue M34: Settings → "Languages you send in" let
 * both boxes be unticked with no warning; after a reload Spanish was ticked
 * again (the second untick was silently dropped, the DOM box stayed off).
 *
 * In a browser: an account sending in English and Spanish opens /settings,
 * unticks English (saved: [es]); Spanish is now the last one — its box is
 * disabled, still ticked, and the keep-one hint shows. A forced click changes
 * nothing; a reload shows Spanish alone, ticked; the profile holds ["es"].
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Keep One Story" }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "Keep One Roofing",
      commsLanguages: ["en", "es"],
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
  return auth;
}

/** Click until `done` holds — a click before hydration is a no-op, so retry it (house clickUntil). */
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
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

// by label text, so the story reads the same page before and after the fix
const box = (page: StoryTools["page"], label: string) =>
  page.locator("label", { hasText: label }).locator("input[type='checkbox']");
const HINT = "[data-cy='settings-comms-keep-one']";

Deno.test("REQ-500: Settings never lets both send-in languages be unticked — the last one is disabled with the keep-one hint (demo cycle 3, M34)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.goto("/settings");
    const en = box(page, "English");
    const es = box(page, "Spanish");
    await es.waitFor({ timeout: 30_000 });

    expect.eq(await en.isChecked(), true, "English starts ticked");
    expect.eq(await es.isChecked(), true, "Spanish starts ticked");
    expect.eq(await page.locator(HINT).count(), 0, "no hint with two ticked");

    // untick English — saved, Spanish is now the last one
    await clickUntil(
      page,
      "label:has-text('English') input[type='checkbox']",
      async () => !(await en.isChecked()),
    );
    await page.waitForTimeout(800);

    // the demo's second step: untick Spanish too — it must stay ticked
    await es.click({ force: true, timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(500);
    expect.eq(
      await es.isChecked(),
      true,
      "Spanish stays ticked — never both off",
    );
    expect.eq(await en.isChecked(), false, "English stays off");

    // like the wizard: the last box is locked and says why
    expect.eq(await es.isDisabled(), true, "the last box is disabled");
    await page.locator(HINT).waitFor({ timeout: 10_000 });
    await expect.see("At least one language stays on");

    const snap = await (await http("/api/profile", { headers: auth }))
      .json() as {
        identity?: { commsLanguages?: string[] };
      };
    expect.eq(
      JSON.stringify(snap.identity?.commsLanguages),
      JSON.stringify(["es"]),
      "the profile sends in Spanish alone",
    );

    // after a reload the page shows what is saved
    await page.reload();
    await es.waitFor({ timeout: 30_000 });
    expect.eq(await es.isChecked(), true, "Spanish ticked after reload");
    expect.eq(await en.isChecked(), false, "English off after reload");
    expect.eq(await es.isDisabled(), true, "Spanish still the locked last one");
  }));
