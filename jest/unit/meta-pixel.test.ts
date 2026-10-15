/**
 * REQ-080 — Raphael, 2026-10-15: "i want to do facebook adverts here, need a
 * tracking pixel to track conversions … can you build this in and how do i
 * e2e test it so i can do it as a customer and make sure i see the result i
 * expect in meta".
 *
 * The pure half: shared/meta-pixel/pixel.ts decides WHEN the pixel loads
 * (which pages, real loader vs the fake), WHAT the boot script says, and the
 * three conversion events — Lead (the OTP went out), CompleteRegistration (a
 * new account reached /welcome), Subscribe (the plan came back active, with
 * its price). The pages that carry them are pinned by reading their source.
 */
import * as fs from "fs";
import * as path from "path";
import {
  FAKE_PIXEL_ID,
  FAKE_PIXEL_LOADER,
  isPixelPage,
  leadEvent,
  pixelBootScript,
  pixelConfig,
  pixelEventScript,
  pixelNoscriptSrc,
  REAL_PIXEL_LOADER,
  registrationEvent,
  subscribeEventFrom,
  subscribeMarker,
} from "../../shared/meta-pixel/pixel";
import { PRIVACY_POLICY } from "../../shared/legal/terms";
import { PRIVACY_POLICY_ES } from "../../shared/legal/terms.es";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-080 a Meta Pixel on the ad funnel, behind META_PIXEL_ID", () => {
  it("REQ-080 the real loader only on the real deploy with the id set; the fake on the gate and a dev box; nothing on the real deploy without an id", () => {
    const real = pixelConfig({
      META_PIXEL_ID: "123456789012345",
      DENO_DEPLOY: "true",
    });
    expect(real).toEqual({
      mode: "real",
      id: "123456789012345",
      loader: REAL_PIXEL_LOADER,
    });
    expect(REAL_PIXEL_LOADER).toBe(
      "https://connect.facebook.net/en_US/fbevents.js",
    );
    // no id on the real deploy: the site runs, nothing is loaded — ads tracking never takes the site down
    expect(pixelConfig({ DENO_DEPLOY: "true" })).toBeNull();
    expect(pixelConfig({ META_PIXEL_ID: "   ", DENO_DEPLOY: "true" }))
      .toBeNull();
    // DENO_DEPLOY unset (REQ-318: the fakes): the fake loader, whatever the id says
    expect(pixelConfig({})).toEqual({
      mode: "fake",
      id: FAKE_PIXEL_ID,
      loader: FAKE_PIXEL_LOADER,
    });
    expect(pixelConfig({ META_PIXEL_ID: "123456789012345" })).toEqual({
      mode: "fake",
      id: FAKE_PIXEL_ID,
      loader: FAKE_PIXEL_LOADER,
    });
    expect(FAKE_PIXEL_LOADER).toBe("/meta-pixel-fake.js");
    expect(
      fs.existsSync(path.join(ROOT, "front-end/static/meta-pixel-fake.js")),
    ).toBe(true);
    const fake = read("front-end/static/meta-pixel-fake.js");
    expect(fake).toMatch(/__pmPixel/);
    expect(fake).not.toMatch(/facebook/);
  });

  it("REQ-080 the pixel's pages are the ad funnel: the two landings, the code page, the welcome wizard, the plan pages and settings — never the dashboard, the assistant, or a customer's document", () => {
    for (
      const p of [
        "/",
        "/landing",
        "/verify",
        "/welcome",
        "/plan/pick",
        "/plan/return",
        "/pay/fake",
        "/settings",
        "/login",
      ]
    ) {
      expect([p, isPixelPage(p)]).toEqual([p, true]);
    }
    for (
      const p of [
        "/dashboard",
        "/assistant",
        "/quotes",
        "/invoices",
        "/q/abc",
        "/i/abc",
        "/co/abc",
        "/s/abc",
        "/terms",
        "/privacy",
        "/contact",
        "/admin",
        "/api/me",
      ]
    ) {
      expect([p, isPixelPage(p)]).toEqual([p, false]);
    }
  });

  it("REQ-080 the boot script is Meta's snippet with the loader swapped, init with the id, then PageView; the noscript image names the id", () => {
    const s = pixelBootScript({
      mode: "real",
      id: "123456789012345",
      loader: REAL_PIXEL_LOADER,
    });
    expect(s).toContain("https://connect.facebook.net/en_US/fbevents.js");
    expect(s).toMatch(/n\.queue=\[\]/);
    expect(s).toMatch(/fbq\('init', ?'123456789012345'\)/);
    expect(s).toMatch(/fbq\('track', ?'PageView'\)/);
    const f = pixelBootScript({
      mode: "fake",
      id: FAKE_PIXEL_ID,
      loader: FAKE_PIXEL_LOADER,
    });
    expect(f).toContain("'/meta-pixel-fake.js'");
    expect(f).not.toContain("facebook");
    expect(pixelNoscriptSrc("123456789012345")).toBe(
      "https://www.facebook.com/tr?id=123456789012345&ev=PageView&noscript=1",
    );
  });

  it("REQ-080 the three conversions: Lead keyed by the phone, CompleteRegistration by the account, Subscribe by the due with the plan's price — each a stable event id so a reload or a server-side copy deduplicates", () => {
    const lead = leadEvent("+15125550100");
    expect(lead.name).toBe("Lead");
    expect(lead.eventId).toMatch(/^lead:[0-9a-f]{8}$/);
    expect(lead.eventId).toBe(leadEvent("+15125550100").eventId);
    expect(lead.eventId).not.toBe(leadEvent("+15125550101").eventId);
    expect(lead.eventId).not.toContain("5550100"); // never the phone itself

    const reg = registrationEvent("user_42");
    expect(reg).toEqual({
      name: "CompleteRegistration",
      eventId: "reg:user_42",
    });

    // the receipt's way back carries one marker; the page it lands on turns it into the event
    const marker = subscribeMarker({
      planId: "monster",
      status: "active",
      dueId: "due_7",
    });
    expect(marker).toBe("sub:monster:due_7");
    expect(subscribeEventFrom(marker)).toEqual({
      name: "Subscribe",
      eventId: "sub:monster:due_7",
      params: {
        value: 99,
        currency: "USD",
        predicted_ltv: 99 * 12,
        content_name: "monster",
      },
    });
    expect(subscribeEventFrom("sub:assist:due_8")?.params).toMatchObject({
      value: 199,
    });
    expect(
      subscribeMarker({ planId: "monster", status: "pending", dueId: "due_7" }),
    ).toBeNull();
    expect(subscribeMarker({ planId: "free", status: "free" })).toBeNull();
    expect(subscribeEventFrom(null)).toBeNull();
    expect(subscribeEventFrom("sub:nope:due_1")).toBeNull();
    expect(subscribeEventFrom("garbage")).toBeNull();
  });

  it("REQ-080 an event script tracks once per browser: a localStorage key by event id, the eventID passed to fbq", () => {
    const s = pixelEventScript({ name: "Lead", eventId: "lead:abcd1234" });
    expect(s).toContain('"pm:px:lead:abcd1234"');
    expect(s).toMatch(/localStorage\.getItem/);
    expect(s).toMatch(/localStorage\.setItem/);
    expect(s).toMatch(/fbq\("track","Lead",\{\},\{eventID:"lead:abcd1234"\}\)/);
    const sub = pixelEventScript(subscribeEventFrom("sub:monster:due_7")!);
    expect(sub).toMatch(
      /fbq\("track","Subscribe",\{"value":99,"currency":"USD","predicted_ltv":1188,"content_name":"monster"\},\{eventID:"sub:monster:due_7"\}\)/,
    );
  });

  it("REQ-080 the pages carry it: _app boots the pixel on its pages, /verify fires Lead when it was reached by sending the code, /welcome fires CompleteRegistration and the Subscribe marker, /settings the marker, and /plan/return sets the marker when the plan is active", () => {
    const app = read("front-end/routes/_app.tsx");
    expect(app).toMatch(
      /import MetaPixel from "\.\.\/components\/MetaPixel\.tsx"/,
    );
    expect(app).toMatch(/<MetaPixel path=\{url\.pathname\} \/>/);
    const verify = read("front-end/routes/verify.tsx");
    expect(verify).toMatch(/searchParams\.get\("px"\) === "lead"/);
    expect(verify).toMatch(/<MetaPixelEvent event=\{leadEvent\(phone\)\} \/>/);
    const welcome = read("front-end/routes/welcome.tsx");
    expect(welcome).toMatch(
      /<MetaPixelEvent event=\{registrationEvent\(user\.id\)\} \/>/,
    );
    expect(welcome).toMatch(
      /subscribeEventFrom\(ctx\.url\.searchParams\.get\("px"\)\)/,
    );
    const settings = read("front-end/routes/settings/index.tsx");
    expect(settings).toMatch(
      /subscribeEventFrom\(ctx\.url\.searchParams\.get\("px"\)\)/,
    );
    const ret = read("front-end/routes/plan/return.tsx");
    expect(ret).toMatch(/subscribeMarker\(/);
    expect(ret).toMatch(/searchParams\.set\("px", marker\)/);
    // both landings send the code and hand the person to /verify as a lead
    expect(read("front-end/static/landing-scripts.js")).toMatch(
      /\/verify\?phone=[^;]*&px=lead/,
    );
    expect(read("front-end/islands/TrialSignup.tsx")).toMatch(/&px=lead/);
    // the login page sends a code too, and it is NOT a lead
    expect(read("front-end/islands/LoginForm.tsx")).not.toMatch(/px=lead/);
    // the component renders the base snippet only on the pixel's pages, with the noscript image on the real loader only
    const cmp = read("front-end/components/MetaPixel.tsx");
    expect(cmp).toMatch(/isPixelPage\(/);
    expect(cmp).toMatch(/pixelConfig\(/);
    expect(cmp).toMatch(/<noscript>/);
    expect(cmp).toMatch(/mode === "real"/);
  });

  it("REQ-080 the key is documented: META_PIXEL_ID in .env.example", () => {
    expect(read(".env.example")).toMatch(/^META_PIXEL_ID=/m);
  });

  it("REQ-080 the privacy policy's Cookies and Analytics section names the Meta Pixel, in English and in Spanish", () => {
    const en = PRIVACY_POLICY.sections.find((s) =>
      s.heading === "Cookies and Analytics"
    )!;
    const enText = en.blocks.map((
      b,
    ) => (b.kind === "list" ? b.items.join(" ") : b.text)).join(" ");
    expect(enText).toMatch(/Meta Pixel/);
    expect(enText).toMatch(/_fbp/);
    expect(enText).toMatch(/Meta Platforms/);
    const es = PRIVACY_POLICY_ES.sections.find((s) =>
      s.heading === "Cookies y análisis"
    )!;
    const esText = es.blocks.map((
      b,
    ) => (b.kind === "list" ? b.items.join(" ") : b.text)).join(" ");
    expect(esText).toMatch(/Meta Pixel/);
    expect(esText).toMatch(/_fbp/);
  });

  it("REQ-080 the stories read the pixel's events from the fake on the gate and from the real pixel's requests on the user's own headed prod run", () => {
    const story = read("e2e/meta-pixel/meta-pixel.e2e.test.ts");
    expect(story).toMatch(/__pmPixel/);
    expect(story).toMatch(/www\.facebook\.com\/tr/);
    expect(story).toMatch(/page\.on\("request"/);
  });
});
