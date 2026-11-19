/**
 * REQ-1163 (LOOP-007 cycle 3, q3-96) — AMENDMENT of REQ-1022. WO-001 "Replace pool pump seal" is
 * assigned to Luis for day D. The owner marks Luis out on D from /field/workers and picks
 * "Deferred to the day they are back". QA saw the Away row say "WO-001 on … still needs
 * rescheduling — nobody has it" (red text, no link) while Luis's /worker?date=D still listed WO-001
 * as an ordinary to-do ("1 por hacer").
 *
 * Here: the Away row says WO-001 moves to D+1 (never "nobody has it") and links to the WO; Luis's
 * /worker?date=D does not list the job, and /worker?date=D+1 lists it with "deferred from …".
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

Deno.test("REQ-1163 (LOOP-007 q3-96): Luis marked out on D with 'Deferred to the day they are back' — the Away row says WO-001 moves to D+1 and links to it; Luis's /worker day D no longer lists it, D+1 lists it 'deferred from'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const post = async (p: string, b: unknown) => (await http(p, { method: "POST", headers: auth, body: JSON.stringify(b) })).json();
    const luisCell = `843${digits()}`;
    const luis = await post("/api/field/workers", { name: "Luis Ortega", phoneNumber: luisCell, pin: "1234", language: "en" });
    const D = nyIso(new Date(Date.now() + 3 * 86_400_000));
    const D1 = nyIso(new Date(Date.now() + 4 * 86_400_000));
    const job = `Replace pool pump seal ${digits()}`;
    const wo = await post("/api/work-orders", { description: job, scheduledFor: D, assignee: "Luis Ortega", assigneeWorkerId: luis.id });
    expect.eq(wo.assigneeWorkerId, luis.id, "WO assigned to Luis");

    // Mark out Luis on D, "Deferred to the day they are back"
    await page.goto("/field/workers");
    const row = page.locator("[data-cy='wk-row']", { hasText: "Luis Ortega" });
    const form = page.locator("[data-cy='away-form']");
    for (let i = 0; i < 10 && !(await form.isVisible()); i++) {
      await row.locator("[data-cy='wk-away']").click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await form.waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='away-from']").fill(D);
    await page.locator("[data-cy='away-to']").fill(D);
    await page.locator("[data-cy='away-disp-defer']").check();
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/field/absences");
    await page.locator("[data-cy='away-submit']").click();
    expect.eq((await saved).status(), 201, "Luis marked out");
    const woLine = page.locator("[data-cy='away-row-wo']").first();
    await woLine.waitFor({ timeout: 20_000 });
    const away = await woLine.evaluate((el) => ({
      text: (el as HTMLElement).innerText.trim(),
      href: (el.closest("a") ?? el.querySelector("a"))?.getAttribute("href") ?? null,
    }));
    expect.eq(/nobody has it/i.test(away.text), false, `the Away row does not say nobody has ${wo.number} (got "${away.text}")`);
    expect.eq(/moves to/i.test(away.text), true, `the Away row says ${wo.number} moves to the day Luis is back (got "${away.text}")`);
    expect.eq(away.href, `/work-orders/${wo.id}`, "the Away row's WO line links to the work order");

    // Luis's /worker: not on D, on D+1 with "deferred from"
    await page.context().clearCookies();
    await page.goto(`/worker?date=${D}`);
    await page.locator("[data-cy='w-cell']").fill(luisCell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.getByText("Hey, Luis").waitFor({ timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    const dayOff = await page.locator("[data-cy='w-visit']").allInnerTexts();
    expect.eq(dayOff.some((c) => c.includes(job)), false, `Luis's /worker day ${D} (his day off) does not list "${job}" (cards: ${JSON.stringify(dayOff)})`);

    await page.goto(`/worker?date=${D1}`);
    await page.getByText("Hey, Luis").waitFor({ timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    const dayBack = await page.locator("[data-cy='w-visit']").allInnerTexts();
    const card = dayBack.find((c) => c.includes(job));
    expect.eq(!!card, true, `Luis's /worker day ${D1} (first day back) lists "${job}" (cards: ${JSON.stringify(dayBack)})`);
    expect.eq(/deferred from/i.test(card ?? ""), true, `the card says it was deferred from ${D} (got ${JSON.stringify(card)})`);
  }));
