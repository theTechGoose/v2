/**
 * REQ-744 — demo-loop cycle 5, demo issue p18-8a: the worker view's day summary said
 * "1 de 1 tareas listas" / "0 de 0 tareas listas". With one task it is singular
 * ("0 of 1 task done"); with none it says "No tasks today".
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
    body: JSON.stringify({ language: "en", name: "Today Count Story" }),
  });
  await me.body?.cancel();
  return auth;
}

Deno.test("REQ-744 (demo p18-8a, cycle 5): /worker's day summary says '0 of 1 task done' for one task and 'No tasks today' for none", (t) =>
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
      name: "Rosa Diaz",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      email: "rosa.diaz@blackhole.postmarkapp.com",
    });
    const cell = `843${digits()}`;
    const worker = await post("/api/field/workers", {
      name: "Luis",
      phoneNumber: cell,
      pin: "1234",
      language: "en",
    });
    const idle = `843${digits()}`;
    await post("/api/field/workers", {
      name: "Pedro",
      phoneNumber: idle,
      pin: "1234",
      language: "en",
    });
    const sub = await post("/api/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: todayIso(),
      items: [{ taskTypeName: "Lawn mowing", priceCents: 5000 }],
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

    const signIn = async (phone: string, name: string) => {
      await page.goto("/worker");
      await page.locator("[data-cy='w-cell']").fill(phone);
      await page.locator("[data-cy='w-pin']").fill("1234");
      await page.locator("[data-cy='w-login']").click();
      await page.getByText(`Hey, ${name}`).waitFor({ timeout: 15_000 });
    };
    const summary = async () =>
      (await page.locator(".greet small").textContent())?.trim() ?? "";

    // one task today: singular
    await signIn(cell, "Luis");
    await page.locator("[data-cy='w-visit']").first().waitFor({
      timeout: 15_000,
    });
    const one = await summary();
    expect(
      one.endsWith("0 of 1 task done"),
      `one task reads "0 of 1 task done" (got "${one}")`,
    );
    expect(!one.includes("tasks done"), `no plural for one task ("${one}")`);

    // no tasks today: no "0 of 0"
    await page.context().clearCookies();
    await page.context().addCookies(
      [...hosts].map((domain) => ({
        name: "pm_lang",
        value: "en",
        domain,
        path: "/",
      })),
    );
    await signIn(idle, "Pedro");
    const none = await summary();
    expect(
      none.endsWith("No tasks today"),
      `an empty day reads "No tasks today" (got "${none}")`,
    );
    expect(!none.includes("0 of 0"), `no "0 of 0" line ("${none}")`);
  }));
