/**
 * REQ-715 — demo-loop cycle 5 (run r37f88707), issues m31 "No per-client
 * language", c2-M29 "Customer has no language setting", c3-m43 "A client has
 * no language preference" and c4-M34 "No per-client language preference;
 * assistant doesn't remember it". Pair 6: "¿cómo le digo que Carmen habla
 * español? No veo campo de idioma del cliente."
 *
 * A customer now carries the language they read (Customer.language, en | es):
 *  - resolveCommsLanguage takes it between the per-send pick and the
 *    account's stored default, so every outbound — invoice sends, reminders,
 *    receipts, texts — follows it (shared/quote-flow/comms-language.ts);
 *  - a pick that is just the customer's own language is never adopted as the
 *    ACCOUNT default (commsLanguageToAdopt);
 *  - /i reads it first as the document's language (invoiceDocLang), and /q
 *    opens in it when the visitor chose no language (contractLangOnLoad);
 *  - the send dialog's "Sends in" starts on it (front-end/lib/send-dialog.ts);
 *  - the New customer form, the card and the New invoice modal's inline new
 *    client set it (shared/quote-flow/customer-contact.ts + the islands).
 */
import * as fs from "fs";
import * as path from "path";

// Lazy accessors so a missing export reds only the tests that use it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const comms = () => require("../../shared/quote-flow/comms-language");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const share = () => require("../../shared/quote-flow/share-link");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const contact = () => require("../../shared/quote-flow/customer-contact");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dialog = () => require("../../front-end/lib/send-dialog");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const publicLang = () => require("../../shared/quote-flow/public-lang");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-715 (cycle 5, m31) resolveCommsLanguage — the customer's language sits between the pick and the account default", () => {
  it("REQ-715 the per-send pick still wins over the customer's language", () => {
    const { resolveCommsLanguage } = comms();
    expect(resolveCommsLanguage({
      override: "en",
      customerLanguage: "es",
      identityCommsLanguage: "es",
    })).toBe("en");
  });

  it("REQ-715 with no pick, a Spanish-speaking customer gets Spanish over an English account default", () => {
    const { resolveCommsLanguage } = comms();
    expect(resolveCommsLanguage({
      customerLanguage: "es",
      identityCommsLanguage: "en",
    })).toBe("es");
    expect(resolveCommsLanguage({
      override: null,
      customerLanguage: " ES ",
    })).toBe("es");
    expect(resolveCommsLanguage({
      customerLanguage: "en",
      identityCommsLanguage: "es",
    })).toBe("en");
  });

  it("REQ-715 an unset or unknown customer language falls through to the account default, then en", () => {
    const { resolveCommsLanguage } = comms();
    expect(resolveCommsLanguage({
      customerLanguage: "",
      identityCommsLanguage: "es",
    })).toBe("es");
    expect(resolveCommsLanguage({
      customerLanguage: "fr",
      identityCommsLanguage: "es",
    })).toBe("es");
    expect(resolveCommsLanguage({ customerLanguage: undefined })).toBe("en");
  });
});

describe("REQ-715 commsLanguageToAdopt — a pick becomes the account default only when it is the contractor's, not the customer's", () => {
  it("REQ-715 a pick equal to the customer's own language is not adopted", () => {
    const { commsLanguageToAdopt } = comms();
    expect(commsLanguageToAdopt({ override: "es", customerLanguage: "es" }))
      .toBeUndefined();
  });

  it("REQ-715 UX-28 still adopts any other valid pick while nothing is stored", () => {
    const { commsLanguageToAdopt } = comms();
    expect(commsLanguageToAdopt({ override: "es" })).toBe("es");
    expect(commsLanguageToAdopt({ override: "en", customerLanguage: "es" }))
      .toBe("en");
  });

  it("REQ-715 nothing is adopted over a stored default, or without a valid pick", () => {
    const { commsLanguageToAdopt } = comms();
    expect(
      commsLanguageToAdopt({ override: "es", identityCommsLanguage: "en" }),
    ).toBeUndefined();
    expect(commsLanguageToAdopt({})).toBeUndefined();
    expect(commsLanguageToAdopt({ override: "fr" })).toBeUndefined();
  });
});

describe("REQ-715 invoiceDocLang — /i reads the customer's language first", () => {
  it("REQ-715 the customer's language beats the invoice's typed language and its quote's send language", () => {
    const { invoiceDocLang } = share();
    expect(invoiceDocLang({ lang: "en" }, undefined, { language: "es" }))
      .toBe("es");
    expect(
      invoiceDocLang({}, { lastDelivery: { lang: "en" } }, { language: "es" }),
    ).toBe("es");
  });

  it("REQ-715 no customer language keeps REQ-586's order", () => {
    const { invoiceDocLang } = share();
    expect(invoiceDocLang({ lang: "en" }, undefined, { language: "" }))
      .toBe("en");
    expect(invoiceDocLang({}, { lastDelivery: { lang: "es" } }, null))
      .toBe("es");
    expect(invoiceDocLang({}, null, undefined)).toBeUndefined();
  });
});

describe("REQ-715 /q — no ?lang= and no pm_lang pick: the contract opens in the customer's language", () => {
  it("REQ-715 contractLangChosen: a ?lang= on the link or a pm_lang pick is the visitor's choice", () => {
    const { contractLangChosen } = publicLang();
    expect(contractLangChosen({})).toBe(false);
    expect(contractLangChosen({ query: "fr", cookie: "pm_session=abc" }))
      .toBe(false);
    expect(contractLangChosen({ query: "es" })).toBe(true);
    expect(contractLangChosen({ cookie: "pm_session=abc; pm_lang=en" }))
      .toBe(true);
  });

  it("REQ-715 contractLangOnLoad: the customer's language unless the visitor chose; English (REQ-048) when there is none", () => {
    const { contractLangOnLoad } = publicLang();
    expect(contractLangOnLoad({ opened: "en", chosen: false, docLang: "es" }))
      .toBe("es");
    expect(contractLangOnLoad({ opened: "en", chosen: true, docLang: "es" }))
      .toBe("en");
    expect(contractLangOnLoad({ opened: "es", chosen: true, docLang: "en" }))
      .toBe("es");
    expect(contractLangOnLoad({ opened: "en", chosen: false })).toBe("en");
    expect(contractLangOnLoad({ opened: "en", chosen: false, docLang: "fr" }))
      .toBe("en");
  });
});

describe("REQ-715 the send dialog's 'Sends in' starts on the customer's language", () => {
  it("REQ-715 defaultSendLang: the customer's language, else the app language", () => {
    const { defaultSendLang } = dialog();
    expect(defaultSendLang({ language: "es" }, "en")).toBe("es");
    expect(defaultSendLang({ language: "en" }, "es")).toBe("en");
    expect(defaultSendLang({}, "es")).toBe("es");
    expect(defaultSendLang(null, "en")).toBe("en");
    expect(defaultSendLang({ language: "fr" }, "en")).toBe("en");
  });

  it("REQ-715 sendLangChoices: app language first, the send languages, and the customer's language when it is missing", () => {
    const { sendLangChoices } = dialog();
    expect(sendLangChoices("en", ["en"], "es")).toEqual(["en", "es"]);
    expect(sendLangChoices("en", ["en", "es"], "es")).toEqual(["en", "es"]);
    expect(sendLangChoices("es", ["en"], undefined)).toEqual(["es", "en"]);
    expect(sendLangChoices("en", [], undefined)).toEqual(["en"]);
    expect(sendLangChoices("en", ["fr"], "xx")).toEqual(["en"]);
  });
});

describe("REQ-715 the New customer form records the language", () => {
  it("REQ-715 newCustomerPayload carries a picked language and leaves 'Not set' out", () => {
    const { newCustomerPayload } = contact();
    const base = {
      name: " Carmen ",
      businessName: "",
      phoneNumber: "",
      email: "",
    };
    expect(newCustomerPayload({ ...base, language: "es" })).toEqual({
      name: "Carmen",
      language: "es",
    });
    expect(newCustomerPayload({ ...base, language: "" })).toEqual({
      name: "Carmen",
    });
    expect(newCustomerPayload({ ...base, language: "fr" })).toEqual({
      name: "Carmen",
    });
  });

  it("REQ-715 a draft with only a language picked is a draft (REQ-300: a stray click keeps it)", () => {
    const { customerDraftDirty } = contact();
    expect(customerDraftDirty({
      name: "",
      businessName: "",
      phoneNumber: "",
      email: "",
      language: "es",
    })).toBe(true);
    expect(customerDraftDirty({
      name: "",
      businessName: "",
      phoneNumber: "",
      email: "",
      language: "",
    })).toBe(false);
  });
});

describe("REQ-715 copy — en and es in sync", () => {
  const KEYS = [
    "customer.language.label",
    "customer.language.hint",
    "customer.language.unset",
    "customer.language.en",
    "customer.language.es",
    "prompts.tools.createQuote.customerLanguage",
  ];
  it("REQ-715 every new key exists in both dictionaries", () => {
    for (const k of KEYS) {
      expect([k, typeof en[k]]).toEqual([k, "string"]);
      expect([k, typeof es[k]]).toEqual([k, "string"]);
    }
  });
  it("REQ-715 the field reads 'Idioma del cliente' in Spanish, and the languages by their own names", () => {
    expect(en["customer.language.label"]).toBe("Customer's language");
    expect(es["customer.language.label"]).toBe("Idioma del cliente");
    expect(en["customer.language.es"]).toBe("Español");
    expect(es["customer.language.es"]).toBe("Español");
    expect(en["customer.language.en"]).toBe("English");
    expect(es["customer.language.en"]).toBe("English");
  });
});

describe("REQ-715 wiring — every place a customer is made or edited, and every send dialog", () => {
  // read when a test runs, so a missing file reds only that test
  const src = (rel: string) => () =>
    fs.existsSync(path.join(ROOT, rel)) ? read(rel) : "";
  const select = src("front-end/components/CustomerLanguageSelect.tsx");
  // REQ-715 AMENDMENT — reconciled with develop on demo-fixes: the New
  // customer form is develop's shared CustomerFormDialog (REQ-625)
  const page = src("front-end/components/CustomerForm.tsx");
  const board = src("front-end/islands/ClientsBoard.tsx");
  const invoices = src("front-end/islands/InvoicesPage.tsx");
  const sendDialog = src("front-end/components/QuoteSendDialog.tsx");
  const chat = src("front-end/islands/AsstChat.tsx");
  const client = src("front-end/clients/clients.ts");

  it("REQ-715 one select offers Not set / English / Español", () => {
    expect(select()).toMatch(/customer\.language\.unset/);
    expect(select()).toMatch(/customer\.language\.en/);
    expect(select()).toMatch(/customer\.language\.es/);
  });

  it("REQ-715 the New customer form sends the picked language", () => {
    expect(page()).toMatch(/<CustomerLanguageSelect/);
    expect(page()).toMatch(/data-cy="cf-language"/);
    expect(page()).toMatch(/customerCreatePayload\(values, language\)/);
  });

  it("REQ-715 the card shows the language and saves a change through PUT /customers/:id", () => {
    expect(board()).toMatch(/ccard2-row-language/);
    expect(board()).toMatch(/<CustomerLanguageSelect/);
    expect(board()).toMatch(/clientsClient\.update\([^)]*\{\s*language/);
  });

  it("REQ-715 the New invoice modal's new client carries the language", () => {
    expect(invoices()).toMatch(/<CustomerLanguageSelect/);
    // REQ-715 AMENDMENT (reconciled with develop's REQ-625 shared form)
    expect(invoices()).toMatch(/customerCreatePayload\(newClient, newLanguage\)/);
  });

  it("REQ-715 both send dialogs start 'Sends in' on the customer's language", () => {
    expect(sendDialog()).toMatch(/defaultSendLang\(customer,\s*lang\)/);
    expect(chat()).toMatch(/defaultSendLang\(customer,\s*lang\)/);
    expect(chat()).toMatch(/sendLangChoices\(/);
  });

  it("REQ-715 /q hands the island whether the visitor chose, and the island opens in the quote's docLang otherwise", () => {
    const route = src("front-end/routes/q/[id].tsx")();
    const view = src("front-end/islands/PublicQuoteView.tsx")();
    const doc = src("front-end/components/quote-doc.tsx")();
    expect(route).toMatch(/contractLangChosen\(/);
    expect(route).toMatch(/chosen=\{/);
    expect(view).toMatch(/contractLangOnLoad\(/);
    expect(doc).toMatch(/docLang\?:/);
  });

  it("REQ-715 the customer types carry the language", () => {
    expect(client()).toMatch(/language\?:\s*"en"\s*\|\s*"es"/);
  });
});
