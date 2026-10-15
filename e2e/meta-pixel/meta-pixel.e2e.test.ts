/**
 * REQ-080 — Raphael, 2026-10-15: "i want to do facebook adverts here, need a tracking pixel to
 * track conversions, what do i need to do?" … "okay can you build this in and how do i e2e test
 * it so i can do it as a customer and make sure i see the result i expect in meta".
 *
 * The pixel: shared/meta-pixel/pixel.ts (which pages, which loader, the three conversions),
 * front-end/components/MetaPixel.tsx (the snippet in the app shell's head, the event a page
 * fires), front-end/static/meta-pixel-fake.js (the fake loader the gate runs on).
 *
 * These stories read the pixel's events two ways, so the same stories answer on the gate AND on
 * the user's own headed run against the real services:
 *  - on fakes (DENO_DEPLOY unset) the fake loader records every `fbq` call on `window.__pmPixel`;
 *  - on the real deploy Meta's loader sends each event to `https://www.facebook.com/tr?…`, and
 *    the story reads the requests the page made (`ev`, `eid`, `cd[value]`…).
 * Either way a conversion is "an event of that name, once, with that id".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

interface PixelCall {
  name: string;
  id?: string;
  eventId?: string;
  params: Record<string, string>;
}

/** the pixel's events since the last drain — the fake's record or the real loader's requests */
function watchPixel(page: StoryTools["page"]) {
  const real: PixelCall[] = [];
  page.on("request", (req: { url(): string }) => {
    const u = new URL(req.url());
    if (u.hostname !== "www.facebook.com" || !u.pathname.startsWith("/tr")) {
      return;
    }
    const params: Record<string, string> = {};
    for (const [k, v] of u.searchParams) {
      const m = /^cd\[(.+)\]$/.exec(k);
      if (m) params[m[1]] = v;
    }
    real.push({
      name: u.searchParams.get("ev") ?? "",
      id: u.searchParams.get("id") ?? undefined,
      eventId: u.searchParams.get("eid") ?? undefined,
      params,
    });
  });
  return async function drain(): Promise<PixelCall[]> {
    const fake = await page.evaluate(() => {
      // deno-lint-ignore no-explicit-any
      const w = globalThis as any;
      if (!Array.isArray(w.__pmPixel)) return null;
      const out = w.__pmPixel.slice();
      w.__pmPixel.length = 0;
      return out as unknown[][];
    }).catch(() => null);
    if (fake) {
      return fake.map((args: unknown[]): PixelCall => {
        const [verb, a, b, c] = args as [
          string,
          string,
          Record<string, string>?,
          { eventID?: string }?,
        ];
        if (verb === "init") return { name: "init", id: a, params: {} };
        return {
          name: a,
          params: Object.fromEntries(
            Object.entries(b ?? {}).map(([k, v]) => [k, String(v)]),
          ),
          eventId: c?.eventID,
        };
      });
    }
    const out = real.slice();
    real.length = 0;
    return out;
  };
}

/** the pixel id the page booted with: the fake's init call, or the real loader's request */
function pixelIdOf(calls: PixelCall[]): string | undefined {
  return calls.find((c) => c.name === "init")?.id ??
    calls.find((c) => c.name === "PageView")?.id;
}

const named = (calls: PixelCall[], name: string) =>
  calls.filter((c) => c.name === name);

/** a frame for the judge AFTER the page settled: the fake loader's ribbon (top left) names every
 *  event the pixel was told, and a key press on the body is the one harmless action that takes a frame */
const frame = (page: StoryTools["page"]) => page.locator("body").press("Shift");

/** on fakes the ribbon must read what the record says; on the real loader there is no ribbon */
async function ribbonSays(
  page: StoryTools["page"],
  expect: StoryTools["expect"],
  text: string,
) {
  const ribbon = await page.locator("#pm-pixel-fake").textContent({
    timeout: 5_000,
  }).catch(() => null);
  if (ribbon !== null) {
    expect(
      ribbon.includes(text),
      `the ribbon names it: "${ribbon}" has "${text}"`,
    );
  }
}

/** English on this browser: the public pages are Spanish-first (REQ-002) */
async function english(page: StoryTools["page"], baseUrl: string) {
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].map((domain) => ({
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    })),
  );
}

/** A fresh account (a new phone each run) signed in on the page's browser context. */
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  profile: Record<string, string>,
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
    body: JSON.stringify({ language: "en", ...profile }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  // the served app answers as 127.0.0.1 (the gate's BASE_URL) AND as localhost (APP_URL, the host
  // the fake's pay page and the return address are minted on, REQ-057/059): one app, both names
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return { auth, phone, userId: body.userId as string };
}

/** a wizard text step: the island may still be hydrating when the input appears (a value typed
 *  before that leaves Continue disabled), so the fill is repeated until Continue takes it */
async function fillStep(
  page: StoryTools["page"],
  selector: string,
  value: string,
): Promise<void> {
  const input = page.locator(selector);
  await input.waitFor({ timeout: 60_000 });
  for (let attempt = 0; attempt < 8; attempt++) {
    await input.fill(value);
    try {
      await page.locator("[data-cy='welcome-continue']:not([disabled])")
        .waitFor({ timeout: 1500 });
      return;
    } catch { /* not hydrated yet — fill again */ }
  }
  throw new Error(`the wizard never took "${value}" at ${selector}`);
}

/** REQ-059 — a paid pick goes to the pay page in this tab; pay there (the test card) and follow
 *  the receipt's "Back to DocuMonster" */
async function pickPayAndGoBack(
  page: StoryTools["page"],
  expect: StoryTools["expect"],
  card: string,
): Promise<void> {
  await page.locator(`[data-cy='${card}']`).click();
  await page.waitForURL(
    (u: URL) => u.pathname === "/pay/fake" && u.searchParams.has("due"),
    { timeout: 60_000 },
  );
  await expect.see("Test pay page");
  await page.locator("[data-cy='fake-pay']").click();
  await expect.see("Paid.");
  await page.locator("[data-cy='fake-pay-back']").click();
}

Deno.test("REQ-080: the pixel is on the ad funnel's pages — the landing page inits it and tracks PageView — and not on the app's own pages or the customers' documents", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const drain = watchPixel(page);
    await english(page, baseUrl);
    await page.goto("/");
    await expect.see("DocuMonster");
    await frame(page);
    await ribbonSays(page, expect, "PageView");
    let calls = await drain();
    const id = pixelIdOf(calls);
    expect(/^\d{15}$/.test(id ?? ""), `the pixel booted with an id (${id})`);
    expect.eq(
      named(calls, "PageView").length,
      1,
      "one PageView on the landing page",
    );
    expect(
      named(calls, "Lead").length === 0 &&
        named(calls, "CompleteRegistration").length === 0,
      "no conversion for just looking",
    );
    // the other website too
    await page.goto("/landing");
    await expect.see("DocuMonster");
    calls = await drain();
    expect.eq(named(calls, "PageView").length, 1, "one PageView on /landing");
    // the app's own pages: no pixel at all — no fbq, no event
    await signIn(http, page, baseUrl, { name: "Pixel Reader" });
    for (const path of ["/dashboard", "/terms"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const hasFbq = await page.evaluate(() =>
        typeof (globalThis as unknown as { fbq?: unknown }).fbq !== "undefined"
      );
      expect(!hasFbq, `${path}: no pixel loaded`);
      calls = await drain();
      expect.eq(calls.length, 0, `${path}: nothing sent to the pixel`);
    }
  }));

Deno.test("REQ-080: Lead fires once when the OTP is sent from the landing page — on the code page, and not again on a reload", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    const drain = watchPixel(page);
    await english(page, baseUrl);
    await page.goto("/");
    await drain();
    const phone = `512${digits()}`;
    await page.locator("#f-phone").fill(phone);
    // the submit itself is not a wrapped action: a frame taken mid-navigation hung on the
    // landing's web fonts; the frame after the code page settles (below) shows the Lead
    await page.locator("#contact-form").evaluate((f: HTMLFormElement) =>
      f.requestSubmit()
    );
    await page.waitForURL(
      (u: URL) =>
        u.pathname === "/verify" && u.searchParams.get("px") === "lead",
      { timeout: 60_000 },
    );
    await expect.see("code");
    await frame(page);
    await ribbonSays(page, expect, "Lead");
    let calls = await drain();
    const leads = named(calls, "Lead");
    expect.eq(leads.length, 1, "one Lead on the code page");
    expect(
      /^lead:[0-9a-f]{8}$/.test(leads[0].eventId ?? ""),
      `the Lead carries its id (${leads[0].eventId})`,
    );
    expect(
      !(leads[0].eventId ?? "").includes(phone),
      "the id is not the phone",
    );
    expect.eq(
      named(calls, "PageView").length,
      1,
      "and the code page's PageView",
    );
    // a reload of the code page is not a second lead
    await page.goto(page.url());
    await expect.see("code");
    calls = await drain();
    expect.eq(named(calls, "Lead").length, 0, "no Lead on the reload");
    expect.eq(named(calls, "PageView").length, 1, "the reload is a PageView");
  }));

Deno.test("REQ-080: CompleteRegistration fires once when a new account reaches /welcome, and not again on a reload or a later visit", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const drain = watchPixel(page);
    const { userId } = await signIn(http, page, baseUrl, {});
    await page.goto("/welcome");
    await page.locator("[data-cy='welcome-continue']").waitFor({
      timeout: 60_000,
    });
    await frame(page);
    await ribbonSays(page, expect, "CompleteRegistration");
    let calls = await drain();
    const regs = named(calls, "CompleteRegistration");
    expect.eq(regs.length, 1, "one CompleteRegistration on the wizard");
    expect.eq(regs[0].eventId, `reg:${userId}`, "keyed by the account");
    await page.goto(page.url());
    await page.locator("[data-cy='welcome-continue']").waitFor({
      timeout: 60_000,
    });
    calls = await drain();
    expect.eq(
      named(calls, "CompleteRegistration").length,
      0,
      "not on the reload",
    );
    await page.goto("/");
    await page.goto("/welcome");
    await page.locator("[data-cy='welcome-continue']").waitFor({
      timeout: 60_000,
    });
    calls = await drain();
    expect.eq(
      named(calls, "CompleteRegistration").length,
      0,
      "not on a later visit",
    );
  }));

Deno.test("REQ-080: Subscribe fires with the plan's price when the receipt brings the person back with the plan active — from onboarding and from settings", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const drain = watchPixel(page);
    // onboarding: the paid pick, the pay page, the receipt back to the wizard
    const first = await signIn(http, page, baseUrl, {
      name: "Sub Story",
      email: `sub-${digits()}@blackhole.postmarkapp.com`,
    });
    await page.goto("/welcome");
    await fillStep(page, "input.welcome__input", "Sub Story Builders");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("best email");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("Pick your plan");
    await drain();
    await pickPayAndGoBack(page, expect, "plan-pick-monster");
    await page.waitForURL(
      (u: URL) =>
        u.pathname === "/welcome" &&
        (u.searchParams.get("px") ?? "").startsWith("sub:monster:"),
      { timeout: 60_000 },
    );
    await expect.see("Which state");
    await frame(page);
    await ribbonSays(page, expect, "Subscribe $99");
    let calls = await drain();
    let subs = named(calls, "Subscribe");
    expect.eq(subs.length, 1, "one Subscribe when the receipt lands");
    expect.eq(subs[0].params.value, "99", "Monster's price");
    expect.eq(subs[0].params.currency, "USD", "in dollars");
    const plan = await (await http("/api/me/plan", { headers: first.auth }))
      .json();
    expect.eq(
      subs[0].eventId,
      `sub:monster:${plan.dueId}`,
      "keyed by the due that was paid",
    );
    await page.goto(page.url());
    await expect.see("Which state");
    calls = await drain();
    expect.eq(named(calls, "Subscribe").length, 0, "not again on a reload");
    expect.eq(
      named(calls, "CompleteRegistration").length,
      0,
      "and the registration was counted on the first visit, not here",
    );

    // settings: free in onboarding, the upgrade later, the receipt back to settings
    await signIn(http, page, baseUrl, {
      name: "Upgrade Story",
      email: `up-${digits()}@blackhole.postmarkapp.com`,
    });
    await page.goto("/welcome");
    await page.locator("[data-cy='welcome-skip']").waitFor({ timeout: 60_000 });
    await page.locator("[data-cy='welcome-skip']").click();
    await expect.see("best email");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("Pick your plan");
    await page.locator("[data-cy='plan-pick-free']").click();
    await expect.see("Which state");
    calls = await drain();
    expect.eq(
      named(calls, "Subscribe").length,
      0,
      "free is not a subscription",
    );
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await drain();
    await pickPayAndGoBack(page, expect, "plan-pick-assist");
    await page.waitForURL(
      (u: URL) =>
        u.pathname === "/settings" &&
        (u.searchParams.get("px") ?? "").startsWith("sub:assist:"),
      { timeout: 60_000 },
    );
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Monster Assist is active");
    await frame(page);
    await ribbonSays(page, expect, "Subscribe $199");
    calls = await drain();
    subs = named(calls, "Subscribe");
    expect.eq(subs.length, 1, "one Subscribe on settings");
    expect.eq(subs[0].params.value, "199", "Monster Assist's price");
  }));
