/**
 * REQ-630 — every way the business gets paid, one tap away: the pure rules of
 * `shared/payments/pay-links.ts` (deep links with the amount prefilled, https-only custom
 * payment links, the public projection, the button order) and the wiring of the invoice page,
 * the claim island and the settings card.
 */
import * as fs from "fs";
import * as path from "path";
import {
  cashAppPayUrl,
  cashtagOf,
  checkPayLinks,
  hasAnyPayWay,
  MAX_PAY_LINKS,
  payButtons,
  paypalMeHandle,
  paypalPayUrl,
  payWayNames,
  projectPayMethods,
  safeHttpsUrl,
  venmoPayUrl,
  venmoUsername,
} from "../../shared/payments/pay-links.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-630 deep links — the amount prefilled where the platform allows", () => {
  test("Venmo: venmo.com/<user>?txn=pay&amount=&note=, from '@user' or 'user'", () => {
    expect(venmoUsername("@Hans-Hansen")).toBe("Hans-Hansen");
    expect(venmoUsername("  hans_h ")).toBe("hans_h");
    expect(venmoUsername("venmo.com/u/hans")).toBe("hans");
    expect(venmoUsername("https://venmo.com/hans")).toBe("hans");
    expect(venmoUsername("not a handle!")).toBeNull();
    expect(venmoUsername("")).toBeNull();
    expect(venmoPayUrl("@hans", 12345, "Invoice INV-0007")).toBe(
      "https://venmo.com/hans?txn=pay&amount=123.45&note=Invoice%20INV-0007",
    );
    expect(venmoPayUrl("hans", 6500)).toBe(
      "https://venmo.com/hans?txn=pay&amount=65.00",
    );
    expect(venmoPayUrl("hans")).toBe("https://venmo.com/hans?txn=pay");
    expect(venmoPayUrl("bad handle")).toBeNull();
  });

  test("Cash App: cash.app/$tag/<amount>, from '$tag' or 'tag'", () => {
    expect(cashtagOf("$AcmeRoof")).toBe("AcmeRoof");
    expect(cashtagOf("acme_roof")).toBe("acme_roof");
    expect(cashtagOf("https://cash.app/$acme")).toBe("acme");
    expect(cashtagOf("$1abc")).toBeNull(); // a cashtag starts with a letter
    expect(cashtagOf("$")).toBeNull();
    expect(cashAppPayUrl("$acme", 6500)).toBe("https://cash.app/$acme/65.00");
    expect(cashAppPayUrl("acme")).toBe("https://cash.app/$acme");
    expect(cashAppPayUrl("$ bad")).toBeNull();
  });

  test("PayPal: paypal.me/<handle>/<amount>USD; an email has no link", () => {
    expect(paypalMeHandle("acmeroof")).toBe("acmeroof");
    expect(paypalMeHandle("@acmeroof")).toBe("acmeroof");
    expect(paypalMeHandle("paypal.me/acmeroof")).toBe("acmeroof");
    expect(paypalMeHandle("https://www.paypal.me/AcmeRoof")).toBe("AcmeRoof");
    expect(paypalMeHandle("pay@acme.test")).toBeNull();
    expect(paypalPayUrl("acmeroof", 6500)).toBe(
      "https://paypal.me/acmeroof/65.00USD",
    );
    expect(paypalPayUrl("acmeroof")).toBe("https://paypal.me/acmeroof");
    expect(paypalPayUrl("pay@acme.test", 6500)).toBeNull();
  });
});

describe("REQ-630 custom payment links — https only", () => {
  test("safeHttpsUrl keeps https URLs and refuses everything else", () => {
    expect(safeHttpsUrl("https://extrapay.example/acme")).toBe(
      "https://extrapay.example/acme",
    );
    expect(safeHttpsUrl("  https://square.link/u/AbC?x=1  ")).toBe(
      "https://square.link/u/AbC?x=1",
    );
    expect(safeHttpsUrl("http://extrapay.example/acme")).toBeNull();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("data:text/html,hi")).toBeNull();
    expect(safeHttpsUrl("ftp://x.example/")).toBeNull();
    expect(safeHttpsUrl("https://user:pw@evil.example/")).toBeNull();
    expect(safeHttpsUrl("https://localhost/")).toBeNull();
    expect(safeHttpsUrl("extrapay.example/acme")).toBeNull();
    expect(safeHttpsUrl("")).toBeNull();
    expect(safeHttpsUrl(42)).toBeNull();
    expect(safeHttpsUrl(`https://a.example/${"x".repeat(2100)}`)).toBeNull();
  });

  test("checkPayLinks: a name and an https URL each, at most MAX_PAY_LINKS; ids are kept or minted", () => {
    const ok = checkPayLinks([
      { id: "l1", name: " Extra Pay ", url: "https://extrapay.example/acme" },
      { name: "Square", url: "https://square.link/u/acme" },
    ]);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.links[0]).toEqual({
      id: "l1",
      name: "Extra Pay",
      url: "https://extrapay.example/acme",
      enabled: true,
    });
    expect(ok.links[1].id).toMatch(/^[a-z0-9-]{4,}$/);
    expect(ok.links[1].id).not.toBe("l1");
    expect(checkPayLinks("nope")).toEqual({ ok: false, reason: "not_list" });
    expect(checkPayLinks([{ name: "", url: "https://a.example" }])).toEqual({
      ok: false,
      reason: "name_missing",
      index: 0,
    });
    expect(
      checkPayLinks([{ name: "x".repeat(41), url: "https://a.example" }]),
    ).toEqual({ ok: false, reason: "name_too_long", index: 0 });
    expect(checkPayLinks([{ name: "A", url: "http://a.example" }])).toEqual({
      ok: false,
      reason: "url_not_https",
      index: 0,
    });
    expect(checkPayLinks([{ name: "A", url: "javascript:alert(1)" }])).toEqual(
      { ok: false, reason: "url_invalid", index: 0 },
    );
    const many = Array.from({ length: MAX_PAY_LINKS + 1 }, (_, i) => ({
      name: `L${i}`,
      url: `https://l${i}.example`,
    }));
    expect(checkPayLinks(many)).toEqual({ ok: false, reason: "too_many" });
  });
});

describe("REQ-630 the public projection and the buttons", () => {
  const apm = {
    check: { enabled: true, mailTo: "1 Main St" },
    venmo: { enabled: true, handle: "@acme-roof" },
    zelle: { enabled: true, handle: "pay@acme.test" },
    cashapp: { enabled: true, cashtag: "$acmeroof" },
    paypal: { enabled: false, handle: "acme" },
    card: { enabled: true, instructions: "Call us" },
    links: [
      {
        id: "xp",
        name: "Extra Pay",
        url: "https://extrapay.example/acme",
        enabled: true,
      },
      { id: "off", name: "Off", url: "https://off.example", enabled: false },
      { id: "bad", name: "Bad", url: "http://bad.example", enabled: true },
    ],
  };

  test("projectPayMethods keeps the old rows as they were and appends the enabled, safe links", () => {
    expect(projectPayMethods(apm)).toEqual([
      { method: "check", handle: "1 Main St" },
      { method: "venmo", handle: "@acme-roof" },
      { method: "zelle", handle: "pay@acme.test" },
      { method: "cashapp", handle: "$acmeroof" },
      { method: "card", handle: "Call us" },
      {
        method: "link",
        id: "xp",
        name: "Extra Pay",
        url: "https://extrapay.example/acme",
      },
    ]);
    expect(projectPayMethods(undefined)).toEqual([]);
  });

  test("payButtons: the app links with the amount, then the custom links, then Zelle to copy", () => {
    const buttons = payButtons(projectPayMethods(apm), {
      amountCents: 6500,
      note: "INV-0007",
    });
    expect(buttons).toEqual([
      {
        kind: "link",
        key: "venmo",
        method: "venmo",
        label: "Venmo",
        href: "https://venmo.com/acme-roof?txn=pay&amount=65.00&note=INV-0007",
        detail: "@acme-roof",
      },
      {
        kind: "link",
        key: "cashapp",
        method: "cashapp",
        label: "Cash App",
        href: "https://cash.app/$acmeroof/65.00",
        detail: "$acmeroof",
      },
      {
        kind: "link",
        key: "link-xp",
        method: "link",
        label: "Extra Pay",
        href: "https://extrapay.example/acme",
      },
      {
        kind: "copy",
        key: "zelle",
        method: "zelle",
        label: "Zelle",
        value: "pay@acme.test",
      },
    ]);
  });

  test("a PayPal email is a copy button, not a link; a handle that makes no link is a copy button too", () => {
    const b = payButtons([
      { method: "paypal", handle: "pay@acme.test" },
      { method: "venmo", handle: "not a handle!" },
    ], { amountCents: 100 });
    expect(b.map((x) => [x.kind, x.method])).toEqual([
      ["copy", "venmo"],
      ["copy", "paypal"],
    ]);
  });

  test("payWayNames names the online ways: card first when Stripe is on, then apps, Zelle, links", () => {
    expect(payWayNames(projectPayMethods(apm), { card: true })).toEqual([
      "card",
      "Venmo",
      "Cash App",
      "Zelle",
      "Extra Pay",
    ]);
    expect(payWayNames([], { card: false })).toEqual([]);
  });
});

describe("REQ-630 wiring", () => {
  test("the claim island renders the pay buttons above the manual claim, outlined, with the amount", () => {
    const island = read("front-end/islands/PublicInvoiceClaim.tsx");
    expect(island).toMatch(/payButtons\(/);
    expect(island).toMatch(/data-cy=\{`pay-\$\{b\.key\}`\}/);
    expect(island).toMatch(/data-cy="pay-buttons"/);
    expect(island).toMatch(/navigator\.clipboard/);
    expect(island).toMatch(/rel="noopener noreferrer"/);
    // the buttons come before the "I sent it" chips
    expect(island.indexOf('data-cy="pay-buttons"')).toBeLessThan(
      island.indexOf("claim-method-"),
    );
  });

  test("the invoice page puts the card first, the claim island (buttons + I sent it) after", () => {
    const page = read("front-end/routes/i/[id].tsx");
    // REQ-782: the card is a "Pay by card" link to a separate portal
    expect(page.indexOf("<PayByCard")).toBeLessThan(
      page.indexOf("<PublicInvoiceClaim"),
    );
    expect(page).toMatch(/hasCard=\{!!cardWay\}/);
  });

  test("settings carries the payment-links card", () => {
    const settings = read("front-end/islands/SettingsPage.tsx");
    expect(settings).toMatch(/function PayLinksCard/);
    // REQ-808 amendment: mounted inside the Custom button tab
    expect(settings).toMatch(/<PayLinksCard\b[^>]*embedded/);
    expect(settings).toMatch(/checkPayLinks\(/);
    expect(settings).toMatch(/dataCy="pay-links-card"/);
  });

  test("both languages carry every REQ-630 key", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    const keys = Object.keys(en).filter((k) =>
      k.startsWith("payLinks.") || k.startsWith("settings.payLinks")
    );
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) expect(typeof es[k]).toBe("string");
  });
});

describe("REQ-630 AMENDMENT a business paid only through its own links counts as payments set up", () => {
  it("hasAnyPayWay: a switched-on method, or an enabled safe link", () => {
    expect(hasAnyPayWay(undefined)).toBe(false);
    expect(hasAnyPayWay({})).toBe(false);
    expect(hasAnyPayWay({ zelle: { enabled: false } })).toBe(false);
    expect(hasAnyPayWay({ zelle: { enabled: true } })).toBe(true);
    expect(hasAnyPayWay({ links: [{ id: "a", name: "Extra Pay", url: "https://pay.example.com/a2z", enabled: true }] })).toBe(true);
    expect(hasAnyPayWay({ links: [{ id: "a", name: "Extra Pay", url: "https://pay.example.com/a2z", enabled: false }] })).toBe(false);
    expect(hasAnyPayWay({ links: [{ id: "a", name: "Bad", url: "http://pay.example.com", enabled: true }] })).toBe(false);
  });
  it("every 'is payment set up?' check uses it", () => {
    for (const f of [
      "shared/quote-flow/onboarding-questions.ts",
      "front-end/islands/SetupChecklist.tsx",
      "backend/src/agents/domain/coordinators/handle-chat-message/mod.ts",
    ]) expect(read(f)).toMatch(/hasAnyPayWay\(/);
  });
});
