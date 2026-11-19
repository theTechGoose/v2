/**
 * REQ-1022 (LOOP-007 cycle 2, q2-12) — amends REQ-842 / REQ-1010. WO-001 is assigned to Jake for
 * day D. The owner marks Jake out on D, covered by Miguel, from /field/workers. QA saw the Away
 * row say "COVERED BY MIGUEL TORRES" while /work-orders kept WO-001 on Jake and Miguel's /worker
 * day was empty ("Sin tareas este día").
 *
 * Here: the owner creates the WO for Jake (API — the WO form is REQ-1010's, covered there), marks
 * Jake out through the Mark out dialog, then /work-orders shows the WO covered by Miguel Torres
 * and Miguel's /worker?date=D shows the job.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const nyIso = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token: body.recoveryToken }) });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", { method: "PUT", headers: auth, body: JSON.stringify({ language: "en", name: "WO Owner" }) });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [{ name, value, domain, path: "/" }, { name: "pm_lang", value: "en", domain, path: "/" }]),
  );
  return auth;
}

Deno.test("REQ-1022 (LOOP-007 q2-12): Jake marked out on D covered by Miguel — /work-orders shows WO-001 covered by Miguel Torres and Miguel's /worker?date=D shows the job", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const post = async (p: string, b: unknown) => (await http(p, { method: "POST", headers: auth, body: JSON.stringify(b) })).json();
    const jake = await post("/api/field/workers", { name: "Jake Fowler", phoneNumber: `843${digits()}`, pin: "1234", language: "en" });
    const miguelCell = `843${digits()}`;
    const miguel = await post("/api/field/workers", { name: "Miguel Torres", phoneNumber: miguelCell, pin: "1234", language: "en" });
    const D = nyIso(new Date(Date.now() + 3 * 86_400_000));
    const job = `Fence walkthrough ${digits()}`;
    const wo = await post("/api/work-orders", { description: job, scheduledFor: D, assignee: "Jake Fowler", assigneeWorkerId: jake.id });
    expect.eq(wo.assigneeWorkerId, jake.id, "WO assigned to Jake");

    // Mark out Jake on D, covered by Miguel
    await page.goto("/field/workers");
    const row = page.locator("[data-cy='wk-row']", { hasText: "Jake Fowler" });
    const form = page.locator("[data-cy='away-form']");
    for (let i = 0; i < 10 && !(await form.isVisible()); i++) {
      await row.locator("[data-cy='wk-away']").click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await form.waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='away-from']").fill(D);
    await page.locator("[data-cy='away-to']").fill(D);
    await page.locator("[data-cy='away-disp-cover']").check();
    await page.locator("[data-cy='away-cover']").selectOption(`worker:${miguel.id}`);
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/field/absences");
    await page.locator("[data-cy='away-submit']").click();
    expect.eq((await saved).status(), 201, "Jake marked out");
    await page.locator("[data-cy='away-row']").first().waitFor({ timeout: 20_000 });
    await expect.see("covered by Miguel Torres");

    // /work-orders: the WO's row names the cover
    await page.goto("/work-orders");
    const woRow = page.locator("tr", { hasText: job });
    await woRow.waitFor({ timeout: 20_000 });
    const assigneeCell = (await woRow.locator("[data-cy='wo-row-assignee']").innerText()).trim();
    expect.eq(/covered by Miguel Torres/i.test(assigneeCell), true, `the WO row says it is covered by Miguel Torres (got "${assigneeCell}")`);

    // Miguel's /worker day D shows the work order
    await page.context().clearCookies();
    await page.goto(`/worker?date=${D}`);
    await page.locator("[data-cy='w-cell']").fill(miguelCell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.getByText("Hey, Miguel").waitFor({ timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    const cards = await page.locator("[data-cy='w-visit']").allInnerTexts();
    expect.eq(cards.some((c) => c.includes(job)), true, `Miguel's /worker day ${D} shows "${job}" (cards: ${JSON.stringify(cards)})`);
  }));
