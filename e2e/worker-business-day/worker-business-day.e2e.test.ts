/**
 * REQ-940 (LOOP-007 q1, q1-11) — "Worker can't complete a visit shown under 'Today'". The
 * business's Time zone (REQ-172/255) is a zone whose date differs from New York's right now; the
 * worker's phone runs in that same zone. /worker's Today shows that day's visit and offers Done —
 * Done must save (POST /complete 200), not toast "that day can no longer be edited" (409), and the
 * server's own default round (GET /api/field/worker/tasks, no date) must be that same day.
 *
 * The zone is picked at run time: Pacific/Kiritimati (a day ahead of New York from 05:00 NY on —
 * the 409 the QA tester hit), else Pacific/Honolulu (a day behind before 05:00 NY).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const dayIn = (tz: string, d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
function zoneOffNewYork(): string {
  const ny = dayIn("America/New_York");
  return dayIn("Pacific/Kiritimati") !== ny ? "Pacific/Kiritimati" : "Pacific/Honolulu";
}

async function owner(http: StoryTools["http"]) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  if (!cookie) throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Zone Story" }),
  });
  await me.body?.cancel();
  return auth;
}

Deno.test("REQ-940 (q1-11): /worker in the business's time zone — Today's visit saves on Done (no 409) and the server's default day is that day", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const tz = zoneOffNewYork();
    const bizDay = dayIn(tz);
    const nyDay = dayIn("America/New_York");
    expect(bizDay !== nyDay, `precondition: ${tz} ${bizDay} vs New York ${nyDay}`);

    const auth = await owner(http);
    const send = async (method: string, p: string, b: unknown) => {
      const r = await http(p, { method, headers: auth, body: JSON.stringify(b) });
      return { status: r.status, body: await r.json() };
    };
    const ident = await send("PUT", "/api/profile/identity", { businessName: "Zone Lawn", timezone: tz });
    expect.eq(ident.body?.timezone, tz, "the business zone is saved");
    const customer = (await send("POST", "/api/customers", {
      name: "Ana Torres",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      email: "ana.torres@blackhole.postmarkapp.com",
    })).body;
    const cell = `843${digits()}`;
    const worker = (await send("POST", "/api/field/workers", {
      name: "Miguel",
      phoneNumber: cell,
      pin: "1234",
      language: "en",
    })).body;
    const sub = (await send("POST", "/api/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: bizDay,
      items: [{ taskTypeName: "Lawn cut", priceCents: 6500 }],
    })).body;
    await send("PUT", `/api/field/regions/${sub.region.id}/worker`, { workerId: worker.id });

    // the worker's phone is in the business's zone
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTimezoneOverride", { timezoneId: tz });
    const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
    await page.context().addCookies(
      [...hosts].map((domain) => ({ name: "pm_lang", value: "en", domain, path: "/" })),
    );

    await page.goto("/worker");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.getByText("Hey, Miguel").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
      tz,
      "the browser runs in the business zone",
    );

    // Today shows the visit; Done saves
    await page.locator("[data-cy='w-visit']").first().waitFor({ timeout: 15_000 });
    await expect.see("Lawn cut");
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && /\/complete$/.test(new URL(r.url()).pathname),
        { timeout: 15_000 },
      ),
      page.locator("[data-cy='w-check']").first().click(),
    ]);
    const answer = await res.text();
    expect.eq(res.status(), 200, `Done on Today's visit saves (got ${res.status()} ${answer})`);
    await page.locator("[data-cy='w-check'][aria-pressed='true']").first().waitFor({ timeout: 15_000 });
    expect.eq(
      await page.getByText("that day can no longer be edited").count(),
      0,
      "no 'can no longer be edited' toast",
    );
    // the server's "today" for this worker is the business day
    const serverDays = await page.evaluate(async () => {
      const r = await fetch("/api/field/worker/tasks", { credentials: "include" });
      const rows = await r.json();
      return Array.isArray(rows) ? rows.map((x: { date: string }) => x.date) : rows;
    });
    expect.eq(
      JSON.stringify(serverDays),
      JSON.stringify([bizDay]),
      `GET /api/field/worker/tasks defaults to the business day ${bizDay} (${tz}), not New York's ${nyDay}`,
    );
  }));
