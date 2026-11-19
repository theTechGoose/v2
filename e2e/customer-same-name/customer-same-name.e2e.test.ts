/**
 * REQ-1149 (LOOP-007 cycle 3, q3-80; amends REQ-924(a), extends REQ-331 to /customers).
 *
 * QA: "two identical rows 'LG Lupe Garza Sin facturar' … no duplicate warning on create". The
 * sidebar row kept only initials, name and status line, so two never-billed customers with the
 * same name were the same row; and the /customers New customer form created the second one
 * silently. Now: same-name rows show a tag (the customer number) so their text differs, and the
 * form's second "Lupe Garza" shows the REQ-331 duplicate notice (`cf-duplicate`) with
 * "Create anyway" (`cf-create-anyway`) before anything is saved. Facts are read in one evaluate.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
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
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Same Name Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
}

/** an island may still be hydrating when its button appears: click until the effect lands */
async function clickUntil(page: StoryTools["page"], selector: string, done: () => Promise<boolean>) {
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
  (await page.locator(sel).count()) > 0 && await page.locator(sel).first().isVisible();

/** every sidebar customer row's id, visible text and accessible name, in one evaluate */
const navRows = (page: StoryTools["page"]) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-cy='nav-customer-row']")].map((a) => ({
      id: a.dataset.id,
      text: a.innerText.replace(/\s+/g, " ").trim(),
      label: a.getAttribute("aria-label") ?? a.getAttribute("title") ?? "",
    }))
  );

Deno.test("REQ-1149 (LOOP-007 q3, q3-80): two never-billed customers named Lupe Garza get sidebar rows whose text and accessible names differ", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const ids: string[] = [];
    for (const body of [{ name: "Lupe Garza" }, { name: "Lupe Garza", allowDuplicate: true }]) {
      const r = await http("/api/customers", { method: "POST", headers: auth, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(`POST /api/customers → ${r.status} ${JSON.stringify(j)}`);
      ids.push(j.id);
    }
    await page.goto("/customers");
    for (const id of ids) {
      await page.locator(`[data-cy='nav-customer-row'][data-id='${id}']`).waitFor({ timeout: 20_000 });
    }
    const rows = (await navRows(page)).filter((r) => ids.includes(r.id!));
    expect.eq(rows.length, 2, "both Lupe Garzas are in the sidebar");
    expect(
      rows[0].text !== rows[1].text,
      `the two rows read differently (got "${rows[0].text}" and "${rows[1].text}")`,
    );
    expect(
      rows[0].label !== rows[1].label,
      `the two rows' accessible names differ (got "${rows[0].label}" and "${rows[1].label}")`,
    );
  }));

Deno.test("REQ-1149 (LOOP-007 q3, q3-80): New customer 'Lupe Garza' twice on /customers — the second save warns before saving; Create anyway makes her and the two rows differ", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.goto("/customers");
    await page.locator(".ph2__cta").waitFor({ timeout: 20_000 });

    async function saveLupe() {
      await clickUntil(page, ".ph2__cta", visible(page, "[data-cy='customer-form']"));
      const form = page.locator("[data-cy='customer-form']");
      await form.locator("[data-cy='cf-name']").fill("Lupe Garza");
      const created = page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/customers"),
        { timeout: 15_000 },
      ).catch(() => null);
      await form.locator("[data-cy='cf-save']").click();
      return created;
    }

    // first: saved, the form closes
    const first = await saveLupe();
    expect(first !== null && first.ok(), "the first Lupe Garza is created");
    await page.locator("[data-cy='customer-form']").waitFor({ state: "detached", timeout: 15_000 });

    // second: the inline duplicate notice, nothing saved yet
    await saveLupe();
    const warned = await page.locator("[data-cy='cf-duplicate']").waitFor({ timeout: 10_000 })
      .then(() => true, () => false);
    const listed = await (await http("/api/customers", { headers: auth })).json() as { id: string }[];
    expect(warned, `the second save shows the duplicate notice (cf-duplicate); customers now: ${listed.length}`);
    expect.eq(listed.length, 1, "nothing is saved until she chooses");
    expect(
      ((await page.locator("[data-cy='cf-duplicate']").textContent()) ?? "").includes("Lupe Garza"),
      "the notice names the customer she already has",
    );

    // Create anyway: the second is made, and the sidebar tells them apart
    await page.locator("[data-cy='cf-create-anyway']").click();
    await page.locator("[data-cy='customer-form']").waitFor({ state: "detached", timeout: 15_000 });
    const all = await (await http("/api/customers", { headers: auth })).json() as { id: string }[];
    expect.eq(all.length, 2, "Create anyway made the second Lupe Garza");
    for (const c of all) {
      await page.locator(`[data-cy='nav-customer-row'][data-id='${c.id}']`).waitFor({ timeout: 20_000 });
    }
    const rows = (await navRows(page)).filter((r) => all.some((c) => c.id === r.id));
    expect.eq(rows.length, 2, "both Lupe Garzas are in the sidebar");
    expect(rows[0].text !== rows[1].text, `the two rows read differently (got "${rows[0].text}" and "${rows[1].text}")`);
  }));
