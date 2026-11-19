/**
 * REQ-1144 (LOOP-007 cycle 3, q3-74) — "Two tabs editing the same customer:
 * the last save silently wins (version not enforced)". In a browser: two tabs
 * on /customers/<id>, Edit open in both. Tab A changes the phone and saves;
 * tab B (still holding the form it loaded) changes the notes and saves. Tab
 * A's phone must survive, and tab B is told the customer was edited
 * somewhere else (`[data-cy='cf-conflict']`) instead of silently overwriting.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
// the last ten digits — the phone is stored as typed, with or without the +1
const onlyDigits = (s: unknown) =>
  String(s ?? "").replace(/\D/g, "").slice(-10);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
  // the backend can still be booting when vite answers (host under load)
  let r!: Response;
  let body: Record<string, unknown> = {};
  for (let i = 0; i < 300; i++) {
    r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
    });
    body = await r.json();
    if (body.error !== "backend_unreachable") break;
    await new Promise((res) => setTimeout(res, 1_000));
  }
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
    body: JSON.stringify({ language: "en", name: "Edit Conflict Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

/** an island may still be hydrating when its button appears: click until the effect lands */
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
      // not clickable yet — the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

const visible = (page: StoryTools["page"], sel: string) => async () =>
  (await page.locator(sel).count()) > 0 &&
  await page.locator(sel).first().isVisible();

async function openEdit(
  page: StoryTools["page"],
  baseUrl: string,
  id: string,
) {
  // absolute: a second tab from context().newPage() has no baseURL
  await page.goto(new URL(`/customers/${id}`, baseUrl).href);
  await page.locator(`[data-cy='customer-workspace'][data-customer='${id}']`)
    .waitFor({ timeout: 20_000 });
  await page.locator("[data-cy='cws-more']").waitFor({ timeout: 20_000 });
  await clickUntil(
    page,
    "[data-cy='cws-more']",
    visible(page, "[data-cy='cws-menu']"),
  );
  await clickUntil(
    page,
    "[data-cy='cws-menu'] [data-cy='cws-edit']",
    visible(page, "[data-cy='customer-form'][data-mode='edit']"),
  );
  return page.locator("[data-cy='customer-form'][data-mode='edit']");
}

Deno.test("REQ-1144 (LOOP-007 q3, q3-74): two tabs edit the same customer — tab B's stale save does not put back the old phone tab A changed, and tab B is told it was edited elsewhere", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const name = `Two Tabs ${digits()}`;
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name,
        phoneNumber: "+18435550111",
        notes: "original note",
      }),
    });
    const c = await r.json();
    if (!r.ok) {
      throw new Error(`create customer → ${r.status} ${JSON.stringify(c)}`);
    }

    // both tabs open Edit on the same version
    const pageB = await page.context().newPage();
    const formA = await openEdit(page, baseUrl, c.id);
    const formB = await openEdit(pageB, baseUrl, c.id);

    // tab A: new phone, save
    await formA.locator("[data-cy='cf-phone']").fill("(843) 555-0199");
    await formA.locator("[data-cy='cf-save']").click();
    await formA.waitFor({ state: "detached", timeout: 15_000 });
    const afterA =
      await (await http(`/api/customers/${c.id}`, { headers: auth })).json();
    expect.eq(
      onlyDigits(afterA.phoneNumber),
      "8435550199",
      "tab A's phone is saved",
    );

    // tab B: still the form it loaded (old phone) — change notes, save
    await formB.locator("[data-cy='cf-notes']").fill("tab B note");
    await formB.locator("[data-cy='cf-save']").click();
    // let tab B's PUT land either way
    await pageB.waitForResponse(
      (res) =>
        res.request().method() === "PUT" &&
        res.url().includes(`/customers/${c.id}`),
      { timeout: 15_000 },
    ).catch(() => null);
    await pageB.waitForTimeout(500);

    const final =
      await (await http(`/api/customers/${c.id}`, { headers: auth })).json();
    expect.eq(
      onlyDigits(final.phoneNumber),
      "8435550199",
      `tab B's stale save must not put back the old phone (stored ${final.phoneNumber}, notes ${
        JSON.stringify(final.notes)
      })`,
    );
    expect(
      await visible(pageB, "[data-cy='cf-conflict']")(),
      "tab B shows the 'edited somewhere else' notice (cf-conflict)",
    );
    await pageB.close();
  }));
