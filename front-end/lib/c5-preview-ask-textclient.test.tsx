/**
 * REQ-691 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue p15: "'Hacer una pregunta'
 * looks enabled in owner preview; 'Enviar SMS' offered with no phone".
 *
 * (1) In the owner's preview, Ask a question and Decline are BOTH disabled,
 *     but Ask kept its active dark-teal text, so only Decline looked off.
 *     Both now wear the same muted grey text and border.
 * (2) The invoice card's back face offered "Text client" to a customer with
 *     no phone (or one that can't take a text). It now shows only when the
 *     phone the backend would text is present and textable; otherwise an
 *     "Add a phone" link opens the customer's card.
 * The browser proof is e2e/c5-preview-ask-textclient.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import PublicQuoteActions from "../islands/PublicQuoteActions.tsx";
import { canTextClient, invoiceTextPhone } from "./invoice-text-client.ts";

function buttons(preview: boolean) {
  const doc = new DOMParser().parseFromString(
    `<html><body>${
      renderToString(
        <PublicQuoteActions
          quoteId="q-691"
          customerName="Jorge"
          lang="es"
          preview={preview}
        />,
      )
    }</body></html>`,
    "text/html",
  )!;
  const ask = doc.querySelector("[data-cy='quote-ask']")!;
  const decline = doc.querySelector("[data-cy='quote-decline']")!;
  return {
    ask: ask.getAttribute("style") ?? "",
    decline: decline.getAttribute("style") ?? "",
  };
}

function prop(style: string, name: string): string | undefined {
  // the LAST declaration wins in CSS, so read the last one
  const all = [
    ...style.matchAll(new RegExp(`(?:^|;)\\s*${name}\\s*:([^;]+)`, "g")),
  ];
  return all.at(-1)?.[1].trim();
}

Deno.test("REQ-691 (demo p15, cycle 5): in the owner's preview Ask a question is as muted as Decline — grey text and border", () => {
  const { ask, decline } = buttons(true);
  assertEquals(prop(ask, "color"), prop(decline, "color"), `ask: ${ask}`);
  assertEquals(prop(ask, "color"), "#6b7a7e", `ask text is grey: ${ask}`);
  assertEquals(prop(ask, "border"), prop(decline, "border"));
  assert(
    prop(ask, "border") !== "1px solid #d8e0db",
    `the disabled border is muted, not the live one: ${ask}`,
  );
  assertEquals(prop(ask, "cursor"), "not-allowed");
});

Deno.test("REQ-691 (demo p15, cycle 5): the customer's own view keeps Ask in its active teal", () => {
  const { ask } = buttons(false);
  assertEquals(prop(ask, "color"), "#144852");
  assertEquals(prop(ask, "cursor"), "pointer");
});

Deno.test("REQ-691 (demo p15, cycle 5): the phone a card would text is the one the backend texts — the customer's, else the bill-to", () => {
  assertEquals(
    invoiceTextPhone({ billTo: { phoneNumber: "512 555 9999" } }, {
      phoneNumber: "+15125551234",
    }),
    "+15125551234",
  );
  assertEquals(
    invoiceTextPhone({ billTo: { phoneNumber: "(512) 867-5309" } }, {}),
    "(512) 867-5309",
  );
  assertEquals(invoiceTextPhone({}, undefined), null);
  assertEquals(invoiceTextPhone({ billTo: { phoneNumber: "  " } }, {}), null);
});

Deno.test("REQ-691 (demo p15, cycle 5): Text client only for a present, textable phone", () => {
  assertEquals(canTextClient(null), false, "no phone");
  assertEquals(canTextClient(""), false, "blank");
  assertEquals(canTextClient("12"), false, "malformed");
  assertEquals(canTextClient("+15555550123"), false, "fictional 555");
  assertEquals(canTextClient("(512) 867-5309"), true);
  assertEquals(canTextClient("+15125551234"), true);
});

Deno.test("REQ-691 (demo p15, cycle 5): the invoice card gates Text client on canTextClient and offers Add a phone otherwise", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/InvoicesPage.tsx", import.meta.url),
  );
  const at = src.indexOf('tFor(lang, "invoicesPage.back.textClient")');
  assert(at > 0, "the Text client button is still on the card back");
  const before = src.slice(Math.max(0, at - 900), at);
  assert(
    /canTextClient\(/.test(before),
    "the Text client button is gated on canTextClient",
  );
  assert(
    src.includes('data-cy="invoice-add-phone"') &&
      src.includes("customerFixHref("),
    "the no-phone branch links to the customer's card",
  );
});

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-691 (demo p15, cycle 5) [${lang}]: the Add a phone label exists`, async () => {
    const dict = JSON.parse(
      await Deno.readTextFile(
        new URL(`../../lang/${lang}.json`, import.meta.url),
      ),
    );
    const v = dict["invoicesPage.back.addPhone"];
    assert(typeof v === "string" && v.length > 0, `${lang} addPhone: ${v}`);
  });
}

/**
 * REQ-982 (LOOP-007 cycle 1, q1-65; AMENDMENT to REQ-691): a customer whose
 * phone is on file but can't take a text (Dana, (843) 555-0142, the reserved
 * 555-01XX block) is told "Add a phone" — as if she had none. The card must
 * tell the three reasons apart: missing, invalid, can't receive texts.
 */
type TextClientState = "ok" | "missing" | "invalid" | "cantText";
async function textClientStateFn(): Promise<
  (phone: string | null | undefined) => TextClientState
> {
  const mod = await import("./invoice-text-client.ts") as Record<
    string,
    unknown
  >;
  const fn = mod.textClientState;
  assert(
    typeof fn === "function",
    "invoice-text-client.ts exports textClientState(phone) — the reason Text client is or isn't offered",
  );
  return fn as (phone: string | null | undefined) => TextClientState;
}

Deno.test("REQ-982 (LOOP-007 q1-65): textClientState tells a missing phone from one that can't receive texts", async () => {
  const textClientState = await textClientStateFn();
  assertEquals(
    textClientState("(843) 555-0142"),
    "cantText",
    "Dana's 555-01XX",
  );
  assertEquals(textClientState("+15555550123"), "cantText", "area code 555");
  assertEquals(textClientState(""), "missing", "blank");
  assertEquals(textClientState(null), "missing", "none");
  assertEquals(textClientState("   "), "missing", "whitespace");
  assertEquals(textClientState("12"), "invalid", "malformed");
  assertEquals(textClientState("(512) 867-5309"), "ok");
  assertEquals(textClientState("+15125551234"), "ok");
});

const CANT_TEXT_KEYS = [
  "invoicesPage.back.cantText",
  "asstChat.send.cantText",
  "sms.fictionalNumber",
];

async function cardFallbackSource(): Promise<string> {
  const src = await Deno.readTextFile(
    new URL("../islands/InvoicesPage.tsx", import.meta.url),
  );
  const at = src.indexOf('tFor(lang, "invoicesPage.back.textClient")');
  assert(at > 0, "the Text client button is still on the card back");
  // the branch that decides Text client, and the fallbacks after it
  return src.slice(Math.max(0, at - 900), at + 2500);
}

Deno.test("REQ-982 (LOOP-007 q1-65): a phone that can't receive texts gets a can't-text note on the invoice card, not Add a phone", async () => {
  const around = await cardFallbackSource();
  assert(
    /textClientState\(|phoneCantReceiveTexts\(/.test(around),
    "the card back tells a can't-text phone apart from a missing one (textClientState / phoneCantReceiveTexts) — today it only asks canTextClient()",
  );
  const used = CANT_TEXT_KEYS.filter((k) => around.includes(`"${k}"`));
  assert(
    used.length > 0,
    `the card back renders a can't-text label (one of ${
      CANT_TEXT_KEYS.join(", ")
    }) — today its only fallback is invoicesPage.back.addPhone`,
  );
});

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-982 (LOOP-007 q1-65) [${lang}]: the card's can't-text label exists and is not "Add a phone"`, async () => {
    const dict = JSON.parse(
      await Deno.readTextFile(
        new URL(`../../lang/${lang}.json`, import.meta.url),
      ),
    );
    const around = await cardFallbackSource();
    const key = CANT_TEXT_KEYS.find((k) => around.includes(`"${k}"`));
    assert(key, "the card back names a can't-text label key");
    const v = dict[key];
    assert(typeof v === "string" && v.length > 0, `${lang} ${key}: ${v}`);
    assert(
      v !== dict["invoicesPage.back.addPhone"],
      `${lang} ${key} differs from Add a phone`,
    );
  });
}

/**
 * REQ-1123 (LOOP-007 cycle 3, q3-51; AMENDMENT to REQ-982 / REQ-691): the
 * /payments card back ("Payment trail") still offers "Text client" for a
 * customer whose phone can't take a text — Marisol, (843) 555-0123, the
 * reserved 555-01XX block that the send sheet and the /invoices card already
 * flag. PaymentsPage keeps only a customerId → name map, so the phone never
 * reaches the card and the REQ-691/982 gate (textClientState) is never asked.
 * The /payments card must ask the same shared rule as the /invoices card.
 * The browser proof is e2e/c5-preview-ask-textclient (REQ-1123 story).
 */
async function paymentsFootSource(): Promise<{ src: string; around: string }> {
  const src = await Deno.readTextFile(
    new URL("../islands/PaymentsPage.tsx", import.meta.url),
  );
  const at = src.indexOf('"paymentsPage.card.textClient"');
  assert(at > 0, "the /payments card back still has its Text client link");
  // the branch that decides Text client on the card back, and its fallbacks
  return { src, around: src.slice(Math.max(0, at - 900), at + 2000) };
}

Deno.test("REQ-1123 (LOOP-007 q3, q3-51): the /payments card back gates Text client on the shared text rule (textClientState / canTextClient)", async () => {
  const { src, around } = await paymentsFootSource();
  assert(
    /\b(textClientState|canTextClient)\s*\(|\btextState\b/.test(around),
    "the /payments card back's Text client is gated on textClientState / canTextClient — today pay-card-text renders unconditionally",
  );
  assert(
    /\binvoiceTextPhone\s*\(/.test(src),
    "PaymentsPage resolves the phone the backend would text (invoiceTextPhone) — today it keeps only customer names",
  );
});

Deno.test("REQ-1123 (LOOP-007 q3, q3-51): a payment whose client can't receive texts shows a can't-text note (pay-card-cant-text) instead of Text client", async () => {
  const { around } = await paymentsFootSource();
  assert(
    around.includes('data-cy="pay-card-cant-text"'),
    "the /payments card back has a can't-text fallback (data-cy pay-card-cant-text)",
  );
});

const PAY_CANT_TEXT_KEYS = [
  "paymentsPage.card.cantText",
  "invoicesPage.back.cantText",
  "asstChat.send.cantText",
  "sms.fictionalNumber",
];

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1123 (LOOP-007 q3, q3-51) [${lang}]: the /payments card's can't-text label exists and is not "Text client"`, async () => {
    const dict = JSON.parse(
      await Deno.readTextFile(
        new URL(`../../lang/${lang}.json`, import.meta.url),
      ),
    );
    const { around } = await paymentsFootSource();
    const key = PAY_CANT_TEXT_KEYS.find((k) => around.includes(`"${k}"`));
    assert(
      key,
      `the /payments card back names a can't-text label key (one of ${
        PAY_CANT_TEXT_KEYS.join(", ")
      }) — today its only label is paymentsPage.card.textClient`,
    );
    const v = dict[key];
    assert(typeof v === "string" && v.length > 0, `${lang} ${key}: ${v}`);
    assert(
      v !== dict["paymentsPage.card.textClient"],
      `${lang} ${key} differs from Text client`,
    );
  });
}
