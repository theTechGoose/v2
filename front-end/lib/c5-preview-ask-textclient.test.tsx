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
