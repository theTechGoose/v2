/**
 * REQ-630 — the invoice email and text name the ways to pay: the text one line of names (card
 * first when Stripe is on), the email a block of tappable ways with the amount prefilled.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { payWaysEmailHtml, payWaysSmsLine } from "./mod.ts";

const apm = {
  venmo: { enabled: true, handle: "@acme-roof" },
  zelle: { enabled: true, handle: "pay@acme.test" },
  cashapp: { enabled: true, cashtag: "$acmeroof" },
  check: { enabled: true, mailTo: "1 Main St" },
  links: [
    {
      id: "xp",
      name: "Extra Pay",
      url: "https://extrapay.example/acme?a=1&b=2",
      enabled: true,
    },
    {
      id: "evil",
      name: "<b>Evil</b>",
      url: "https://evil.example/",
      enabled: true,
    },
    { id: "http", name: "Plain", url: "http://plain.example/", enabled: true },
  ],
};

Deno.test("REQ-630 payWaysSmsLine: card first when Stripe is on, then the apps, Zelle and the links, in the send language", () => {
  assertEquals(
    payWaysSmsLine(apm, { card: true, lang: "en" }),
    "Pay online by card, Venmo, Cash App, Zelle, Extra Pay or <b>Evil</b> — all at the link.",
  );
  assertEquals(
    payWaysSmsLine({ venmo: apm.venmo }, { card: false, lang: "es" }),
    "Paga en línea con Venmo — todo en el enlace.",
  );
  assertEquals(
    payWaysSmsLine({ venmo: apm.venmo, cashapp: apm.cashapp }, {
      card: false,
      lang: "es",
    }),
    "Paga en línea con Venmo o Cash App — todo en el enlace.",
  );
  assertEquals(
    payWaysSmsLine({ check: apm.check }, { card: false, lang: "en" }),
    null,
  );
  assertEquals(payWaysSmsLine(undefined, { card: false, lang: "en" }), null);
});

Deno.test("REQ-630 payWaysEmailHtml: one tappable row per way — card to the invoice page, the apps with the amount, Zelle to copy, the https links; names escaped", () => {
  const html = payWaysEmailHtml(apm, {
    card: true,
    lang: "en",
    amountCents: 6500,
    note: "INV-0007",
    payUrl: "https://documonster.com/i/inv-1",
  });
  assertStringIncludes(html, "data-pay-ways");
  assertStringIncludes(html, "Ways to pay");
  assertStringIncludes(
    html,
    `data-pay-way="card" href="https://documonster.com/i/inv-1"`,
  );
  assertStringIncludes(
    html,
    `data-pay-way="venmo" href="https://venmo.com/acme-roof?txn=pay&amp;amount=65.00&amp;note=INV-0007"`,
  );
  assertStringIncludes(
    html,
    `data-pay-way="cashapp" href="https://cash.app/$acmeroof/65.00"`,
  );
  assertStringIncludes(
    html,
    `href="https://extrapay.example/acme?a=1&amp;b=2"`,
  );
  assertStringIncludes(html, ">Extra Pay<");
  assertStringIncludes(html, "pay@acme.test");
  assertStringIncludes(html, "&lt;b&gt;Evil&lt;/b&gt;");
  assert(!html.includes("<b>Evil"), "a link name is escaped");
  assert(
    !html.includes("http://plain.example"),
    "an http link never reaches the email",
  );
  // the card row comes first
  assert(
    html.indexOf(`data-pay-way="card"`) < html.indexOf(`data-pay-way="venmo"`),
  );
});

Deno.test("REQ-630 payWaysEmailHtml: nothing online → no block; Spanish heading", () => {
  assertEquals(
    payWaysEmailHtml({ check: apm.check }, {
      card: false,
      lang: "en",
      payUrl: "https://x.example/i/1",
    }),
    "",
  );
  assertStringIncludes(
    payWaysEmailHtml({ venmo: apm.venmo }, {
      card: false,
      lang: "es",
      payUrl: "https://x.example/i/1",
    }),
    "Formas de pago",
  );
});
