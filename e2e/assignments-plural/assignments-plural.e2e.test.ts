/**
 * REQ-997 (LOOP-007 cycle 1, q1-84) — /field/assignments with one customer, one repeat visit,
 * one zone and one worker read "Assignments · 1 zones" and "1 ZONES · 1 SUBSCRIPTIONS", and with
 * the zone unstaffed "1 zones with no worker". It must read "Assignments · 1 zone",
 * "1 zone · 1 repeat visit" and "1 zone with no worker", and never say "subscription".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
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
    body: JSON.stringify({ language: "en", name: "Plural Story" }),
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
  return { auth };
}

Deno.test("REQ-997 (LOOP-007 q1-84): one zone, one repeat visit, one worker → /field/assignments says 'Assignments · 1 zone' and '1 zone · 1 repeat visit'; unstaffed it says '1 zone with no worker'; never 'subscription'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await http(path, {
        method,
        headers: auth,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      return text ? JSON.parse(text) : null;
    };
    const customer = await call("POST", "/api/customers", {
      name: "Ana Torres",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    });
    const worker = await call("POST", "/api/field/workers", {
      name: "Luis Herrera",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    });
    const sub = await call("POST", "/api/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: todayIso(),
      items: [{ taskTypeName: "Lawn cut", priceCents: 6500 }],
    });
    await call("PUT", `/api/field/regions/${sub.region.id}/worker`, {
      workerId: worker.id,
    });
    const regions = await call("GET", "/api/field/regions");
    expect.eq(regions.length, 1, "one zone");

    const readPage = () =>
      page.evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        const chip = [...document.querySelectorAll(".workload .chip")]
          .find((c) => c.textContent?.includes("Luis Herrera"));
        return {
          text: main.textContent ?? "",
          chip: chip?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          unstaffed: document.querySelector("[data-cy='asg-unstaffed-count']")
            ?.textContent?.trim() ?? "",
        };
      });

    await page.goto("/field/assignments");
    await page.locator(".workload .chip", { hasText: "Luis Herrera" })
      .waitFor({ timeout: 20_000 });
    const staffed = await readPage();
    expect.eq(
      staffed.chip,
      "Luis Herrera 1 zone · 1 repeat visit",
      "the worker chip is singular and says repeat visit",
    );
    expect.eq(
      /Assignments · 1 zone(?!s)/.test(staffed.text),
      true,
      `the eyebrow says 'Assignments · 1 zone' (page: ${
        staffed.text.match(/Assignments · \d+ \w+/)?.[0]
      })`,
    );
    expect.eq(
      /\b1 zones\b/i.test(staffed.text),
      false,
      "no '1 zones' anywhere on the page",
    );
    expect.eq(
      staffed.text.match(/subscri\w*/i)?.[0] ?? null,
      null,
      "the page never says subscription",
    );

    // the zone loses its worker: the alert counts one zone, singular
    await call("PUT", `/api/field/regions/${sub.region.id}/worker`, {
      workerId: null,
    });
    await page.goto("/field/assignments");
    await page.locator("[data-cy='asg-unstaffed-count']").waitFor({
      timeout: 20_000,
    });
    const unstaffed = await readPage();
    expect.eq(
      unstaffed.unstaffed,
      "1 zone with no worker",
      "the unstaffed alert is singular",
    );
  }));
