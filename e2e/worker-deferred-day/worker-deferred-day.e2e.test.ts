/**
 * REQ-1011 — LOOP-007 cycle 1, QA issue q1-97: a Spanish-speaking worker defers today's only
 * visit. On today the screen must not say "Sin tareas hoy · Nada programado." while it still
 * draws that visit's card with a "0/0" chip; on tomorrow the moved task's label reads
 * "aplazada de <fmtDay>" ("mié, 18 nov"), never the raw "11-18".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const nyIso = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const todayIso = () => nyIso(new Date());

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
    body: JSON.stringify({ language: "es", name: "Deferred Day Story" }),
  });
  await me.body?.cancel();
  return auth;
}

Deno.test("REQ-1011 (LOOP-007 q1-97): a deferred-only day does not show a 0/0 card under 'Nada programado'; tomorrow's label reads 'aplazada de <fmtDay>'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await owner(http);
    const post = async (p: string, b: unknown) => {
      const r = await http(p, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(b),
      });
      return r.json();
    };
    const today = todayIso();
    const customer = await post("/api/customers", {
      name: "Rosa Vega",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    });
    const cell = `843${digits()}`;
    const worker = await post("/api/field/workers", {
      name: "Miguel",
      phoneNumber: cell,
      pin: "1234",
      language: "es",
    });
    const made = await post("/api/field/tasks", {
      customerId: customer.id,
      date: today,
      taskTypeName: "Leaf cleanup",
      priceCents: 500,
      workerId: worker.id,
    });
    if (!made?.id) throw new Error(`one-off: ${JSON.stringify(made)}`);

    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].map((domain) => ({
        name: "pm_lang",
        value: "es",
        domain,
        path: "/",
      })),
    );

    await page.goto("/worker");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    const visit = page.locator("[data-cy='w-visit']").first();
    await visit.waitFor({ timeout: 15_000 });
    await expect.see("Leaf cleanup");

    // the worker defers the visit to tomorrow, through the UI
    await page.locator("[data-cy='w-defer-visit']").first().click();
    const deferred = page.waitForResponse((r) =>
      r.request().method() === "POST" &&
      /\/tasks\/[^/]+\/defer$/.test(new URL(r.url()).pathname)
    );
    await page.locator("[data-cy='w-defer-go']").click();
    expect.eq((await deferred).status(), 200, "the defer POST succeeds");
    // the deferred hint is the durable signal that the reload landed
    await page.getByText("aplazada → mañana").first().waitFor({
      timeout: 15_000,
    });

    // read the whole day in one evaluate — summary + cards are one render
    const day = await page.evaluate(() => {
      const txt = (sel: string) =>
        [...document.querySelectorAll(sel)].map((e) =>
          (e.textContent ?? "").replace(/\s+/g, " ").trim()
        );
      return {
        cards: document.querySelectorAll("[data-cy='w-visit']").length,
        states: txt("[data-cy='w-visit-state']"),
        summary: txt("[data-cy='w-summary']").join(" "),
      };
    });
    // every half is checked before failing, so one run shows each fault
    const faults: string[] = [];
    const check = (ok: boolean, msg: string) => {
      if (!ok) faults.push(msg);
    };
    check(
      !day.states.includes("0/0"),
      `no visit chip reads "0/0" on the deferred day (got ${
        JSON.stringify(day.states)
      })`,
    );
    check(
      !(day.cards > 0 && day.summary.includes("Nada programado")),
      `the summary does not say "Nada programado" while ${day.cards} card(s) are drawn (summary "${day.summary}")`,
    );

    // tomorrow: the moved task names the day it came from, localized
    const next = page.locator("[data-cy='w-day-next']");
    await next.click();
    await page.waitForURL(/\/worker\?date=\d{4}-\d{2}-\d{2}/, {
      timeout: 15_000,
    });
    await page.getByText("Leaf cleanup").first().waitFor({ timeout: 15_000 });
    const label = page.locator(".svc__extra", { hasText: "aplazada de" })
      .first();
    await label.waitFor({ timeout: 15_000 });
    const text = ((await label.textContent()) ?? "").replace(/\s+/g, " ")
      .trim();
    const want = new Date(`${today}T00:00:00`).toLocaleDateString("es-MX", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    check(
      !text.includes(today.slice(5)),
      `no raw MM-DD date in the label (got "${text}")`,
    );
    // fmtDay may run on the server (Deno ICU) or in the browser (Chromium ICU) — either spelling
    const wantPage = await page.evaluate(
      (iso) =>
        new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
      today,
    );
    check(
      text === `aplazada de ${want}` || text === `aplazada de ${wantPage}`,
      `the label reads "aplazada de ${wantPage}" (got "${text}")`,
    );
    expect(faults.length === 0, faults.join(" | "));
  }));
