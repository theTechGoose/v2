/**
 * REQ-365 — demo cycle 1, issue p15-17: a one-off task for a customer with no
 * subscription (so no zone) was grouped on /field/tasks under "Miguel Torres · —".
 * The group is titled with the worker alone, and the card's hint carries no dash.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Field Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

Deno.test("REQ-365: a one-off task with no zone is grouped under the worker alone — no '· —'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const post = async (path: string, body: unknown) => {
      const r = await http(path, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      });
      return r.json();
    };
    const customer = await post("/api/customers", { name: "Nobody Zoned" });
    const worker = await post("/api/field/workers", {
      name: "Miguel Torres",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    });
    const made = await post("/api/field/tasks", {
      customerId: customer.id,
      date: todayIso(),
      taskTypeName: "Mulch",
      priceCents: 500,
      workerId: worker.id,
    });
    expect.eq(made.regionName, "", "the API answers no zone name");
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 15_000,
    });
    const title = page.locator(".panel", {
      has: page.locator("[data-cy='tk-task']"),
    }).locator(".panel__title").first();
    const text = (await title.innerText()).replace(/\s+/g, " ").trim();
    expect.eq(
      text.replace(/\s*\d+\/\d+$/, ""),
      "Miguel Torres",
      "the group title is the worker alone",
    );
    expect.eq(
      (await page.locator("body").innerText()).includes("· —"),
      false,
      "no '· —' anywhere on the page",
    );
  }));
