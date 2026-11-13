/**
 * REQ-362 — demo-loop cycle 1, demo issue M35: "Worker view can't look ahead: only '← Ayer', no
 * tomorrow". A worker with a visit tomorrow opens /worker: next to "← Yesterday" there is a
 * "Tomorrow →" link; it opens tomorrow's round read-only — the visit and its service are there, the
 * check button is locked, a hint says it can be checked off on the day, and nothing is POSTed.
 * From tomorrow the navigator reads "← Previous day · Today · Next day →".
 *
 * REQ-528 — demo-loop cycle 3, demo issue m51: the links keep one label on every day ("← Previous
 * day" / "Next day →", never "Yesterday"/"Tomorrow" that rename after a tap), the viewed day reads
 * "Viewing Fri, Nov 13" (fmtDay) instead of the raw ISO date, and a native date input jumps to any
 * day (/worker?date=).
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
const tomorrowIso = () => nyIso(new Date(Date.now() + 86_400_000));

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
    body: JSON.stringify({ language: "en", name: "Tomorrow Story" }),
  });
  await me.body?.cancel();
  return auth;
}

Deno.test("REQ-362 (demo M35) + REQ-528 (demo m51): /worker offers Next day →; tomorrow's visit shows read-only with a preview hint and no check-off", (t) =>
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
    const customer = await post("/api/customers", {
      name: "Ana Torres",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      email: "ana.torres@blackhole.postmarkapp.com",
    });
    const cell = `843${digits()}`;
    const worker = await post("/api/field/workers", {
      name: "Miguel",
      phoneNumber: cell,
      pin: "1234",
      language: "en",
    });
    const sub = await post("/api/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: tomorrowIso(),
      items: [{ taskTypeName: "Fence repair", priceCents: 9000 }],
    });
    const z = await http(`/api/field/regions/${sub.region.id}/worker`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ workerId: worker.id }),
    });
    await z.body?.cancel();

    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].map((domain) => ({
        name: "pm_lang",
        value: "en",
        domain,
        path: "/",
      })),
    );
    const completes: string[] = [];
    page.on("request", (r) => {
      if (
        r.method() === "POST" && /\/complete$/.test(new URL(r.url()).pathname)
      ) {
        completes.push(r.url());
      }
    });

    await page.goto("/worker");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.getByText("Hey, Miguel").waitFor({ timeout: 15_000 });

    // today: both directions — REQ-362 AMENDMENT (reconciled with develop):
    // develop's REQ-194 strip, Yesterday | Today | Tomorrow, on every day
    const prev = page.locator("[data-cy='w-day-prev']");
    const next = page.locator("[data-cy='w-day-next']");
    await next.waitFor({ timeout: 15_000 });
    expect(
      ((await prev.textContent()) ?? "").includes("Yesterday"),
      "the back button",
    );
    expect(
      ((await next.textContent()) ?? "").includes("Tomorrow"),
      "the forward button",
    );

    // tomorrow: the visit, read-only
    await next.click();
    await page.waitForURL(/\/worker\?date=\d{4}-\d{2}-\d{2}/, {
      timeout: 15_000,
    });
    await page.locator("[data-cy='w-visit']").first().waitFor({
      timeout: 15_000,
    });
    await expect.see("Ana Torres");
    await expect.see("Fence repair");
    await page.locator("[data-cy='w-preview']").waitFor({ timeout: 15_000 });
    await expect.see("Preview — you can check these off on the day.");
    const check = page.locator("[data-cy='w-check']").first();
    expect(
      await check.isDisabled(),
      "the check button is locked on a future day",
    );
    await check.click({ force: true });
    await page.waitForTimeout(500);
    expect.eq(completes.length, 0, "no complete POST for tomorrow");
    expect.eq(
      await page.locator("[data-cy='w-note-btn']").count(),
      0,
      "no note/services/defer actions on a preview",
    );

    // the strip from tomorrow: still Yesterday | Today | Tomorrow, tomorrow selected
    expect(
      ((await page.locator("[data-cy='w-day-today']").textContent()) ?? "")
        .includes("Today"),
      "back to today",
    );
    expect.eq(
      await page.locator("[data-cy='w-day-next']").getAttribute(
        "aria-selected",
      ),
      "true",
      "tomorrow is the selected day",
    );

    // REQ-528 — the viewed day is written out, not the ISO string
    const tmr = new URL(page.url()).searchParams.get("date") ?? "";
    const label = (await page.locator("[data-cy='w-day-label']").textContent())
      ?.trim() ?? "";
    const want = new Date(`${tmr}T00:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    expect(
      label.includes(`Viewing ${want}`),
      `the day label reads "Viewing ${want}" (got "${label}")`,
    );
    expect(!label.includes(tmr), `no raw ISO date in "${label}"`);

    // REQ-528 — the date picker jumps to any day
    const far = nyIso(new Date(Date.now() + 20 * 86_400_000));
    await page.locator("[data-cy='w-day-pick']").fill(far);
    await page.waitForURL(new RegExp(`/worker\\?date=${far}`), {
      timeout: 15_000,
    });
  }));
