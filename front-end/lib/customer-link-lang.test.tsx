/**
 * REQ-586 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M11: the customer /q and /i links the
 * owner opens or copies inside the app had no ?lang=, so a logged-out
 * customer (no pm_lang cookie) opened a quote sent in Spanish in English.
 * REQ-342 put ?lang=<send language> only on the links inside the outbound
 * SMS / email.
 *
 * Every in-app customer link now carries the language the document went out
 * in: the send divider's `lang`, the quote's `lastDelivery.lang`, an
 * invoice's own `lang`. /i uses the invoice's document language ahead of
 * the contractor's default.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import {
  customerLinkPath,
  customerLinkUrl,
  invoiceLinkPath,
} from "./customer-link.ts";
import { CustomerLinkRow } from "../components/CustomerLinkRow.tsx";
import {
  invoiceDocLang,
  quoteSendLang,
} from "../../shared/quote-flow/share-link.ts";

const ID = "f4c5559b-5b1c-4a8e-9f00-1234567890ab";
const read = (rel: string) => Deno.readTextFile(new URL(rel, import.meta.url));

Deno.test("REQ-586 customerLinkPath/Url carry the send language as ?lang=", () => {
  assertEquals(customerLinkPath(ID, "es"), `/q/${ID}?lang=es`);
  assertEquals(customerLinkPath(ID, "en"), `/q/${ID}?lang=en`);
  assertEquals(customerLinkPath(ID), `/q/${ID}`, "no language → unchanged");
  assertEquals(customerLinkPath(ID, "fr"), `/q/${ID}`);
  assertEquals(
    customerLinkUrl("https://documonster.com", ID, "es"),
    `https://documonster.com/q/${ID}?lang=es`,
  );
  assertEquals(invoiceLinkPath(ID, "es"), `/i/${ID}?lang=es`);
  assertEquals(invoiceLinkPath(ID, null), `/i/${ID}`);
});

Deno.test("REQ-586 quoteSendLang: the language the quote last went out in", () => {
  assertEquals(quoteSendLang({ lastDelivery: { lang: "es" } }), "es");
  assertEquals(quoteSendLang({ lastDelivery: { lang: "en" } }), "en");
  assertEquals(quoteSendLang({ lastDelivery: {} }), undefined);
  assertEquals(quoteSendLang({}), undefined);
  assertEquals(quoteSendLang(null), undefined);
});

Deno.test("REQ-586 invoiceDocLang: the invoice's own lang, else its quote's send language, else the quote's base language", () => {
  assertEquals(invoiceDocLang({ lang: "es" }), "es");
  assertEquals(
    invoiceDocLang({ lang: "en" }, { lastDelivery: { lang: "es" } }),
    "en",
  );
  assertEquals(invoiceDocLang({}, { lastDelivery: { lang: "es" } }), "es");
  assertEquals(invoiceDocLang({}, { lang: "es" }), "es");
  assertEquals(invoiceDocLang({}, null), undefined);
  assertEquals(invoiceDocLang({ lang: "xx" }), undefined);
});

Deno.test("REQ-586 CustomerLinkRow: Open as customer and Copy both use the send language", async () => {
  const html = renderToString(
    <CustomerLinkRow
      quoteId={ID}
      quoteNumber="Q-001"
      sendLang="es"
      lang="es"
      onCopy={() => {}}
    />,
  );
  const doc = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    "text/html",
  )!;
  assertEquals(
    doc.querySelector('[data-cy="customer-link-open"]')!.getAttribute("href"),
    `/q/${ID}?lang=es`,
  );
  // The island renders with the precompile JSX transform, so the click
  // handler is pinned on the source: Copy hands the send language to onCopy.
  const row = await read("../components/CustomerLinkRow.tsx");
  assert(
    /onClick=\{\(\) => onCopy\(quoteId, sendLang\)\}/.test(row),
    "Copy passes the send language",
  );
});

Deno.test("REQ-586 AsstChat: both customer-link rows pass the send language, and Copy builds the url with it", async () => {
  const chat = await read("../islands/AsstChat.tsx");
  const calls = chat.split("<CustomerLinkRow").slice(1).map((s) =>
    s.slice(0, s.indexOf("/>"))
  );
  assertEquals(calls.length, 2);
  for (const c of calls) assert(/sendLang=\{/.test(c), c);
  assert(
    /customerLinkUrl\(\s*globalThis\.location\.origin,\s*quoteId,\s*sendLang/
      .test(chat),
    "copyLinkFor builds the url with the send language",
  );
  assert(!/`\/q\/\$\{r\.quoteId\}`/.test(chat), "sample link is bare /q/");
});

Deno.test("REQ-586 /quotes: the open panel and the card copy/open the link with the send language", async () => {
  for (const f of ["../islands/QuotesPage.tsx", "../islands/QuoteCard.tsx"]) {
    const src = await read(f);
    assert(!/`\/q\/\$\{/.test(src), `${f} still builds a bare /q/ link`);
    assert(!/origin\}\/q\//.test(src), `${f} still copies a bare /q/ link`);
    assert(/customerLink(Path|Url)\(/.test(src), `${f} uses the helper`);
  }
});

Deno.test("REQ-586 /invoices Open and /i: the invoice's document language", async () => {
  const inv = await read("../islands/InvoicesPage.tsx");
  assert(!/`\/i\/\$\{inv\.id\}`/.test(inv), "Open is a bare /i/ link");
  assert(/invoiceLinkPath\(inv\.id,/.test(inv), "Open uses invoiceLinkPath");
  const route = await read("../routes/i/[id].tsx");
  assert(
    /docLang:\s*invoice\?\.docLang\s*\?\?\s*invoice\?\.contractor\?\.commsLanguage/
      .test(route),
    "/i puts the invoice's own language ahead of the contractor's default",
  );
});

Deno.test("REQ-586 a send divider's language reaches the chat's local quote (applySendOutcome)", async () => {
  const { deliveryFromDivider } = await import(
    "../../shared/quote-flow/delivery.ts"
  );
  const d = deliveryFromDivider({
    quoteId: ID,
    channel: "sms",
    smsFailureReason: "reserved test number",
    lang: "es",
  });
  assertEquals(d?.lang, "es");
  assertEquals(quoteSendLang({ lastDelivery: d }), "es");
});
