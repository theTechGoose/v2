/**
 * REQ-994 — LOOP-007 cycle 1, issue q1-83: in an English account the same zone
 * read "Zone A · no worker" on /field/subscriptions but "Zona A" (card) and
 * "Zona A · Mike Carter" (map) on /field/assignments, and "Mike Carter · Zona A"
 * on /field/tasks. The server stores the zone name in Spanish; only some screens
 * localized it. Every screen must read "Zone A" / "Zone B" and never "Zona".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
    body: JSON.stringify({ language: "en", name: "Zone Name Story" }),
  });
  await me.body?.cancel();
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

const squash = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

Deno.test("REQ-994 (LOOP-007 q1-83): an English account reads 'Zone A' on /field/subscriptions, /field/assignments and /field/tasks — never 'Zona'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const post = async (p: string, b: unknown) => {
      const r = await http(p, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(b),
      });
      return r.json();
    };
    const worker = await post("/api/field/workers", {
      name: "Mike Carter",
      phoneNumber: `843${digits()}`,
      pin: "1234",
      language: "en",
    });
    // zone A — staffed by Mike
    const rosa = await post("/api/customers", {
      name: "Rosa Diaz",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    });
    const subA = await post("/api/field/subscriptions", {
      customerId: rosa.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: todayIso(),
      items: [{ taskTypeName: "Lawn mowing", priceCents: 5000 }],
    });
    // zone B — ~12 km away on the ocean, left with no worker
    const ben = await post("/api/customers", {
      name: "Ben Ocean",
      address: "1200 N Ocean Blvd, Myrtle Beach, SC",
    });
    const subB = await post("/api/field/subscriptions", {
      customerId: ben.id,
      address: "1200 N Ocean Blvd, Myrtle Beach, SC",
      startDate: todayIso(),
      items: [{ taskTypeName: "Lawn mowing", priceCents: 5000 }],
    });
    expect.eq(subA.region?.name, "Zona A", "the server stores 'Zona A' (REQ-140)");
    expect.eq(subB.region?.name, "Zona B", "the second zone is 'Zona B'");
    const z = await http(`/api/field/regions/${subA.region.id}/worker`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ workerId: worker.id }),
    });
    await z.body?.cancel();

    // /field/subscriptions — the Repeat visits cards (already localized)
    await page.goto("/field/subscriptions");
    await page.locator("[data-cy='subs-card']").nth(1).waitFor({
      timeout: 20_000,
    });
    const chips = (await page.locator("[data-cy='subs-card'] .sub__client .chip")
      .allTextContents()).map(squash);
    expect(
      chips.some((c) => c.startsWith("Zone A")),
      `a subscription card reads "Zone A" (got ${JSON.stringify(chips)})`,
    );

    // /field/assignments — the zone cards, their aria-labels and the map labels
    await page.goto("/field/assignments");
    await page.locator("[data-cy='asg-region']").nth(1).waitFor({
      timeout: 20_000,
    });
    const names = (await page.locator("[data-cy='asg-region'] .region__name")
      .allTextContents()).map(squash).sort();
    expect.eq(
      JSON.stringify(names),
      JSON.stringify(["Zone A", "Zone B"]),
      "/field/assignments zone cards read Zone A, Zone B",
    );
    const arias = await page.locator("[data-cy='asg-region-worker']").evaluateAll(
      (els) => els.map((e) => e.getAttribute("aria-label") ?? "").sort(),
    );
    expect.eq(
      JSON.stringify(arias),
      JSON.stringify(["Zone A", "Zone B"]),
      "the zone worker pickers are labelled Zone A, Zone B",
    );
    const asgBody = await page.locator("body").innerText();
    expect.eq(
      asgBody.match(/zona/i) !== null,
      false,
      `no "Zona" anywhere on /field/assignments (map labels included): ${
        JSON.stringify(asgBody.match(/[^\n]*zona[^\n]*/gi))
      }`,
    );

    // /field/tasks — the group title and the unstaffed-zone chip
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 20_000,
    });
    const hints = (await page.locator("[data-cy='tk-task'] .hint")
      .allTextContents()).map(squash);
    expect(
      hints.includes("Mike Carter · Zone A"),
      `Mike's task reads "Mike Carter · Zone A" (got ${JSON.stringify(hints)})`,
    );
    const tasksBody = await page.locator("body").innerText();
    expect.eq(
      tasksBody.match(/zona/i) !== null,
      false,
      `no "Zona" anywhere on /field/tasks (unstaffed chip included): ${
        JSON.stringify(tasksBody.match(/[^\n]*zona[^\n]*/gi))
      }`,
    );
  }));
