/**
 * REQ-701 (demo-loop cycle 5, issue M21) — "A client's question can't be read
 * or answered from where the notice leads".
 *
 * Pair 9: the notice "Linda Morales hizo una pregunta" opened /quotes?open=…
 * — "Linda's question text is NOWHERE on that panel, no reply box. How do I
 * answer her?" The question is now stored; the quote panel lists it under
 * "Questions from the client" (#questions) with Text back / Email back /
 * Call; the dashboard feed row and the chat's answer link straight to it.
 *
 * Unit level: the contact-back reading shared by the panel and the backend
 * (`shared/quote-flow/inquiry-contact.ts`), the panel/feed helpers
 * (`front-end/lib/quote-inquiries.ts`), the chat link, the islands' wiring,
 * and the en/es copy.
 */
import * as fs from "fs";
import * as path from "path";
import {
  contactBackParts,
  inquiryReplyTargets,
} from "../../shared/quote-flow/inquiry-contact";
import {
  isInquiryNotification,
  notificationHref,
  QUESTIONS_ANCHOR,
  quoteQuestionsHref,
  replyOutcome,
} from "../../front-end/lib/quote-inquiries";
import { chatQuoteLink } from "../../front-end/lib/chat-quote-link";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-701 M21 the contact the client asked to be reached at", () => {
  it("REQ-701 reads a phone (E.164) and an email out of free text", () => {
    expect(contactBackParts("(512) 555-6301 después de las 5")).toEqual({
      phone: "+15125556301",
    });
    expect(contactBackParts("linda.morales@example.com")).toEqual({
      email: "linda.morales@example.com",
    });
    expect(
      contactBackParts("Call 512.555.6301 or email Linda@Example.com"),
    ).toEqual({ phone: "+15125556301", email: "linda@example.com" });
    expect(contactBackParts("+52 55 1234 5678")).toEqual({
      phone: "+525512345678",
    });
    expect(contactBackParts("mornings please")).toEqual({});
    expect(contactBackParts("555-1234")).toEqual({});
    expect(contactBackParts("")).toEqual({});
    expect(contactBackParts(undefined)).toEqual({});
  });

  it("REQ-701 the contact-back value wins over the customer's contact on file; the other channel falls back to the file", () => {
    expect(
      inquiryReplyTargets(
        { contactBack: "(512) 555-6301" },
        { phoneNumber: "+15125550000", email: "l@example.com" },
      ),
    ).toEqual({
      text: { to: "+15125556301", fromContactBack: true },
      email: { to: "l@example.com", fromContactBack: false },
      call: "tel:+15125556301",
      preferred: "text",
    });
    expect(
      inquiryReplyTargets(
        { contactBack: "linda@example.com" },
        { phoneNumber: "512-555-0148" },
      ),
    ).toEqual({
      text: { to: "+15125550148", fromContactBack: false },
      email: { to: "linda@example.com", fromContactBack: true },
      call: "tel:+15125550148",
      preferred: "email",
    });
    expect(inquiryReplyTargets({}, null)).toEqual({});
    expect(
      inquiryReplyTargets({ contactBack: "mañanas" }, { phoneNumber: "12" }),
    )
      .toEqual({});
  });
});

describe("REQ-701 M21 the notice leads to the question", () => {
  it("REQ-701 the questions anchor and the quote's questions link", () => {
    expect(QUESTIONS_ANCHOR).toBe("questions");
    expect(quoteQuestionsHref("q 1")).toBe("/quotes?open=q%201#questions");
  });

  it("REQ-701 an inquiry notification is known by its title key, or (older rows) a customer_replied row on a quote", () => {
    expect(
      isInquiryNotification({
        type: "customer_replied",
        titleKey: "notify.quote.inquiry",
        entityType: "quote",
        entityId: "q1",
      }),
    ).toBe(true);
    expect(
      isInquiryNotification({
        type: "customer_replied",
        entityType: "quote",
        entityId: "q1",
      }),
    ).toBe(true);
    expect(
      isInquiryNotification({
        type: "quote_accepted",
        titleKey: "notify.quote.accepted",
        entityType: "quote",
        entityId: "q1",
      }),
    ).toBe(false);
  });

  it("REQ-701 feed rows: an inquiry opens the quote's questions; other quote events open the quote; invoices go to /invoices", () => {
    expect(
      notificationHref({
        type: "customer_replied",
        titleKey: "notify.quote.inquiry",
        entityType: "quote",
        entityId: "q1",
      }),
    ).toBe("/quotes?open=q1#questions");
    expect(
      notificationHref({
        type: "quote_accepted",
        entityType: "quote",
        entityId: "q1",
      }),
    ).toBe("/quotes?open=q1");
    expect(notificationHref({ type: "invoice_paid", entityType: "invoice" }))
      .toBe("/invoices");
    expect(notificationHref({ type: "generic" })).toBeUndefined();
  });

  it("REQ-701 the dashboard feed uses notificationHref (no inline quote link left)", () => {
    const src = read("front-end/islands/DashboardPage.tsx");
    expect(src).toContain('from "../lib/quote-inquiries.ts"');
    expect(src).toContain("notificationHref(n)");
    expect(src).not.toContain(
      "`/quotes?open=${encodeURIComponent(n.entityId)}`",
    );
  });
});

describe("REQ-701 M21 a reply's outcome, in the contractor's words", () => {
  it("REQ-701 sent → the receipt line; failures → our own copy, never the raw reason", () => {
    expect(replyOutcome({ ok: true, channel: "text", to: "+15125556301" }))
      .toEqual({
        key: "quotesPage.open.receipt.textedTo",
        vars: { to: "+1 (512) 555-6301" },
        ok: true,
      });
    expect(
      replyOutcome({ ok: true, channel: "email", to: "linda@example.com" }),
    ).toEqual({
      key: "quotesPage.open.receipt.emailedTo",
      vars: { to: "linda@example.com" },
      ok: true,
    });
    const fail = (r: Record<string, unknown>) => replyOutcome(r as never).key;
    expect(fail({ ok: false, channel: "text", failureCode: "missing" }))
      .toBe("quotesPage.inquiries.fail.noPhone");
    expect(fail({ ok: false, channel: "email", failureCode: "missing" }))
      .toBe("quotesPage.inquiries.fail.noEmail");
    for (const code of ["invalid", "fictional", "notMobile", "optedOut"]) {
      expect(fail({ ok: false, channel: "text", failureCode: code }))
        .toBe("quotesPage.inquiries.fail.badPhone");
    }
    expect(fail({ ok: false, channel: "text", failureCode: "needsName" }))
      .toBe("quotesPage.inquiries.fail.needsName");
    expect(fail({ ok: false, channel: "email", failureCode: "empty" }))
      .toBe("quotesPage.inquiries.fail.empty");
    expect(
      fail({ ok: false, channel: "email", reason: "postmark 422 Bad Sender" }),
    ).toBe("quotesPage.inquiries.fail.other");
  });
});

describe("REQ-701 M21 the quote panel shows and answers the questions", () => {
  const page = read("front-end/islands/QuotesPage.tsx");
  const block = read("front-end/components/QuoteInquiries.tsx");
  const client = read("front-end/clients/quotes.ts");

  it("REQ-701 the panel reads the quote's questions with the rest and renders them", () => {
    expect(page).toContain("quotesClient.inquiries(openId)");
    expect(page).toContain('from "../components/QuoteInquiries.tsx"');
    expect(page).toContain("<QuoteInquiries");
  });

  it("REQ-701 a #questions link scrolls to the questions, and opening another quote drops the hash", () => {
    expect(page).toContain("QUESTIONS_ANCHOR");
    expect(page).toMatch(/url\.hash = ""/);
  });

  it("REQ-701 the block: the anchor, each question with its contact, Text back / Email back / Call, and a reply box that posts the answer", () => {
    expect(block).toContain("id={QUESTIONS_ANCHOR}");
    expect(block).toContain("inquiryReplyTargets(");
    expect(block).toContain('data-cy="quote-inquiry"');
    expect(block).toContain('data-cy="quote-inquiry-question"');
    expect(block).toContain('data-cy="quote-inquiry-text"');
    expect(block).toContain('data-cy="quote-inquiry-email"');
    expect(block).toContain('data-cy="quote-inquiry-call"');
    expect(block).toContain('data-cy="quote-inquiry-reply"');
    expect(block).toContain('data-cy="quote-inquiry-send"');
    expect(block).toContain("quotesClient.replyToInquiry(");
    expect(block).toContain("replyOutcome(");
  });

  it("REQ-701 the API client: list and reply paths", () => {
    expect(client).toContain("`/quotes/${id}/inquiries`");
    expect(client).toContain("`/quotes/${id}/inquiries/${inquiryId}/reply`");
  });
});

describe("REQ-701 M21 the chat's answer links to the quote's questions", () => {
  it("REQ-701 an inquiry answer is a link to the questions, labelled to answer", () => {
    expect(
      chatQuoteLink({
        inquiry: { kind: "open", quoteId: "q1", quoteNumber: "Q-001" },
      }),
    ).toEqual({
      quoteId: "q1",
      quoteNumber: "Q-001",
      publish: false,
      questions: true,
    });
    expect(chatQuoteLink({ inquiry: { kind: "none" } })).toBeUndefined();
  });

  it("REQ-701 AsstChat adds the #questions hash and the answer label", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toContain("/quotes?open=${");
    expect(src).toContain('ql.questions ? "#questions" : ""');
    expect(src).toContain('"asstChat.openQuoteQuestions"');
  });
});

describe("REQ-701 M21 the public form says which language the client asked in", () => {
  it("REQ-701 the inquiry body carries the page language", () => {
    const src = read("front-end/islands/PublicQuoteActions.tsx");
    const at = src.indexOf("/inquiry`");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 600)).toContain("lang,");
  });
});

describe("REQ-701 M21 every new string is in en and es", () => {
  const en = JSON.parse(read("lang/en.json"));
  const es = JSON.parse(read("lang/es.json"));
  const keys = [
    "quotesPage.inquiries.title",
    "quotesPage.inquiries.waiting",
    "quotesPage.inquiries.someone",
    "quotesPage.inquiries.textBack",
    "quotesPage.inquiries.emailBack",
    "quotesPage.inquiries.call",
    "quotesPage.inquiries.replyTo",
    "quotesPage.inquiries.replyPlaceholder",
    "quotesPage.inquiries.send",
    "quotesPage.inquiries.sending",
    "quotesPage.inquiries.answeredText",
    "quotesPage.inquiries.answeredEmail",
    "quotesPage.inquiries.noContact",
    "quotesPage.inquiries.fail.noPhone",
    "quotesPage.inquiries.fail.noEmail",
    "quotesPage.inquiries.fail.badPhone",
    "quotesPage.inquiries.fail.needsName",
    "quotesPage.inquiries.fail.other",
    "quotesPage.inquiries.fail.empty",
    "chatCoordinator.inquiries.one",
    "chatCoordinator.inquiries.oneNoJob",
    "chatCoordinator.inquiries.count",
    "chatCoordinator.inquiries.more",
    "chatCoordinator.inquiries.where",
    "chatCoordinator.inquiries.whereEach",
    "chatCoordinator.inquiries.none",
    "inquiryReply.email.subject",
    "inquiryReply.email.subjectNoJob",
    "inquiryReply.email.headline",
    "inquiryReply.email.yourQuestion",
    "inquiryReply.email.cta",
    "inquiryReply.email.replyHint",
    "asstChat.openQuoteQuestions",
  ];

  it.each(keys)("REQ-701 %s exists in en and es, translated", (k) => {
    expect(typeof en[k]).toBe("string");
    expect(typeof es[k]).toBe("string");
    expect(en[k].trim()).not.toBe("");
    expect(es[k].trim()).not.toBe("");
    expect(es[k]).not.toBe(en[k]);
  });

  it("REQ-701 the panel title the chat names is the panel's own title", () => {
    expect(en["quotesPage.inquiries.title"]).toBe("Questions from the client");
    expect(es["quotesPage.inquiries.title"]).toBe("Preguntas del cliente");
  });
});
