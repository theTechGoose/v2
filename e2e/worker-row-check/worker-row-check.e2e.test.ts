/**
 * REQ-1001 — LOOP-007 cycle 1, QA issue q1-87: on /worker at phone size, tapping a service's
 * NAME ("Lawn mowing") checks it off, not only the small square "Done" button. A second tap on
 * the name un-checks it. A preview (tomorrow) row does not toggle from its name.
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
    body: JSON.stringify({ language: "en", name: "Row Check Story" }),
  });
  await me.body?.cancel();
  return auth;
}

Deno.test("REQ-1001 (LOOP-007 q1, q1-87): /worker at 390x844 — tapping the service name checks it off and a second tap un-checks it; a preview row doesn't toggle", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const auth = await owner(http);
    const post = async (p: string, b: unknown) => {
      const r = await http(p, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(b),
      });
      return r.json();
    };
    const cell = `843${digits()}`;
    const worker = await post("/api/field/workers", {
      name: "Luis",
      phoneNumber: cell,
      pin: "1234",
      language: "en",
    });
    const today = await post("/api/customers", {
      name: "Rosa Diaz",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      email: "rosa.diaz@blackhole.postmarkapp.com",
    });
    const later = await post("/api/customers", {
      name: "Ana Torres",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      email: "ana.torres@blackhole.postmarkapp.com",
    });
    const subs = [
      await post("/api/field/subscriptions", {
        customerId: today.id,
        address: "4601 Dick Pond Rd, Myrtle Beach, SC",
        startDate: todayIso(),
        items: [{ taskTypeName: "Lawn mowing", priceCents: 5000 }],
      }),
      await post("/api/field/subscriptions", {
        customerId: later.id,
        address: "4601 Dick Pond Rd, Myrtle Beach, SC",
        startDate: tomorrowIso(),
        items: [{ taskTypeName: "Fence repair", priceCents: 9000 }],
      }),
    ];
    for (const regionId of new Set(subs.map((s) => s.region.id))) {
      const z = await http(`/api/field/regions/${regionId}/worker`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({ workerId: worker.id }),
      });
      await z.body?.cancel();
    }

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
    const toggles: string[] = [];
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        /\/(un)?complete$/.test(new URL(r.url()).pathname)
      ) {
        toggles.push(new URL(r.url()).pathname);
      }
    });

    await page.goto("/worker");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.getByText("Hey, Luis").waitFor({ timeout: 15_000 });
    const visit = page.locator("[data-cy='w-visit']", {
      hasText: "Rosa Diaz",
    });
    await visit.waitFor({ timeout: 15_000 });
    const row = visit.locator(".svc", { hasText: "Lawn mowing" });
    const name = row.locator(".svc__name");
    await name.waitFor({ timeout: 15_000 });

    const rowState = () =>
      page.evaluate(() => {
        const v = [...document.querySelectorAll("[data-cy='w-visit']")].find(
          (e) => e.textContent?.includes("Rosa Diaz"),
        );
        const r = [...(v?.querySelectorAll(".svc") ?? [])].find((e) =>
          e.textContent?.includes("Lawn mowing")
        );
        return {
          done: r?.classList.contains("svc--done") ?? false,
          chip: v?.querySelector("[data-cy='w-visit-state']")?.textContent
            ?.trim() ?? "",
          cursor: r?.querySelector(".svc__name")
            ? getComputedStyle(r.querySelector(".svc__name")!).cursor
            : "",
        };
      });

    const before = await rowState();
    expect(!before.done, `the row starts open (${JSON.stringify(before)})`);

    // tap the NAME, not the square
    const completed = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        /\/api\/field\/worker\/tasks\/[^/]+\/complete$/.test(
          new URL(r.url()).pathname,
        ),
      { timeout: 6_000 },
    ).catch(() => null);
    await name.click();
    const res = await completed;
    expect(
      res !== null,
      `tapping "Lawn mowing" posts /complete (requests seen: ${
        JSON.stringify(toggles)
      })`,
    );
    expect.eq(res?.status(), 200, "the complete POST succeeds");
    await row.and(page.locator(".svc--done")).waitFor({ timeout: 10_000 });
    const after = await rowState();
    expect(after.done, `the row is checked off (${JSON.stringify(after)})`);
    expect.eq(after.chip, "Done", "the visit chip reads Done");
    expect.eq(
      before.cursor,
      "pointer",
      "the service name shows it's tappable (cursor: pointer)",
    );

    // a second tap on the name un-checks it
    const uncompleted = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        /\/api\/field\/worker\/tasks\/[^/]+\/uncomplete$/.test(
          new URL(r.url()).pathname,
        ),
      { timeout: 6_000 },
    ).catch(() => null);
    await name.click();
    const res2 = await uncompleted;
    expect(res2 !== null, "a second tap on the name posts /uncomplete");
    await page.waitForFunction(() => {
      const v = [...document.querySelectorAll("[data-cy='w-visit']")].find(
        (e) => e.textContent?.includes("Rosa Diaz"),
      );
      return !!v && !v.querySelector(".svc--done");
    }, undefined, { timeout: 10_000 });

    // tomorrow is a preview: its name doesn't toggle
    await page.locator("[data-cy='w-day-next']").click();
    await page.waitForURL(/\/worker\?date=\d{4}-\d{2}-\d{2}/, {
      timeout: 15_000,
    });
    await page.locator("[data-cy='w-preview']").waitFor({ timeout: 15_000 });
    const n = toggles.length;
    const fence = page.locator(".svc__name", { hasText: "Fence repair" });
    await fence.waitFor({ timeout: 15_000 });
    await fence.click({ force: true });
    await page.waitForTimeout(600);
    expect.eq(toggles.length, n, "no complete POST from a preview row's name");
    expect.eq(
      await page.locator(".svc--done").count(),
      0,
      "the preview row stays open",
    );
  }));
