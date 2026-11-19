/**
 * REQ-1010 (LOOP-007 cycle 1, q1-96) — a work order assigned to a worker shows on that worker's
 * /worker day. Amends REQ-210 / REQ-609. QA created WO-001 on /work-orders, typed "Mike Carter"
 * into a free-text Assignee for Nov 24, then /worker?date=2026-11-24 as Mike said "No tasks this day."
 *
 * The owner opens New work order, picks Mike from the Assignee picker (the account's workers),
 * schedules it for day D and saves. Mike signs in on /worker?date=D and sees the job.
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

Deno.test("REQ-1010 (LOOP-007 q1-96): a work order assigned to worker Mike for day D on /work-orders shows on Mike's /worker?date=D instead of 'No tasks this day.'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const post = async (p: string, b: unknown) => (await http(p, { method: "POST", headers: auth, body: JSON.stringify(b) })).json();
    const cell = `843${digits()}`;
    const mike = await post("/api/field/workers", { name: "Mike Carter", phoneNumber: cell, pin: "1234", language: "en" });
    const D = nyIso(new Date(Date.now() + 3 * 86_400_000));
    const job = `Replace back gate ${digits()}`;

    await page.goto("/work-orders");
    const modal = page.locator("[data-cy='wo-new-modal']");
    for (let i = 0; i < 10 && !(await modal.isVisible()); i++) {
      await page.locator("[data-cy='wo-new']").click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await modal.waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='wo-new-description']").fill(job);
    await page.locator("[data-cy='wo-new-scheduled']").fill(D);
    // the Assignee is a picker over the account's workers (was a free-text box)
    await page.locator("[data-cy='wo-new-assignee']").selectOption(mike.id, { timeout: 5_000 });
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/work-orders");
    await page.locator("[data-cy='wo-new-submit']").click();
    const res = await saved;
    expect.eq(res.status(), 200, "the work order saved");
    const wo = await res.json();
    expect.eq(wo.assigneeWorkerId, mike.id, "the work order carries Mike's worker id");

    await page.goto(`/worker?date=${D}`);
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.getByText("Hey, Mike").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='w-visit']").first().waitFor({ timeout: 15_000 });
    await expect.see(job);
  }));
