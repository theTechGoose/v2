/**
 * REQ-236 (demo M8) — "A failed send is shown as sent everywhere."
 *
 * After a send that reached nobody the app said "Quote sent", "Out for
 * signature", "JUST SENT" and "OUT FOR RESPONSE", told the contractor a
 * texted quote "could be in spam", drew a ✓-in-a-box on the failure card,
 * and kept the OLD failure card (with its recovery form) after a good resend.
 *
 * Targets:
 *   shared/quote-flow/delivery.ts        — the stored delivery outcome
 *   shared/quote-flow/pipeline-stats.ts  — undelivered is not "awaiting"
 *   front-end/lib/send-delivery.ts       — divider outcome, recovery scan,
 *                                          header status, local quote patch
 *   front-end/lib/quotes-seed.ts         — the "undelivered" stage + reading
 *   front-end/lib/dash-icons.tsx, AsstChat.tsx, AsstThreads.tsx (wiring)
 */
import * as fs from "fs";
import * as path from "path";
import {
  deliveryFromDivider,
  isUndelivered,
} from "../../shared/quote-flow/delivery.ts";
import {
  aggregatePipeline,
  classifyQuoteForPipeline,
} from "../../shared/quote-flow/pipeline-stats.ts";
import {
  applySendOutcome,
  headerStatusKey,
  lastRecoveryDividerId,
  sendDividerFailed,
} from "../../front-end/lib/send-delivery.ts";
import {
  DRAFT_TRACK_STAGES,
  moodForQuote,
  OUT_STAGES,
  type Quote,
  readingFor,
  stageLabelFor,
} from "../../front-end/lib/quotes-seed.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const FAILED_SMS = {
  quoteId: "q1",
  phase: 3,
  channel: "sms" as const,
  smsFailureReason: "Twilio 21211: Invalid 'To' Phone Number",
};
const GOOD_SMS = {
  quoteId: "q1",
  phase: 3,
  channel: "sms" as const,
  textedTo: "+15125550123",
};

const divider = (id: string, payload: Record<string, unknown>) => ({
  id,
  kind: "phase_divider",
  payload,
});

describe("REQ-236: the delivery outcome is the truth about 'sent'", () => {
  test("a failed last delivery with no earlier delivery is undelivered", () => {
    expect(
      isUndelivered({
        lastDelivery: { at: "t", channel: "sms", smsFailureReason: "x" },
      }),
    ).toBe(true);
    expect(
      isUndelivered({
        lastDelivery: { at: "t", channel: "sms", smsFailureReason: "x" },
        deliveredAt: "earlier",
      }),
    ).toBe(false);
    expect(
      isUndelivered({
        lastDelivery: { at: "t", channel: "sms", textedTo: "+1" },
      }),
    ).toBe(false);
    expect(isUndelivered({})).toBe(false);
  });

  test("deliveryFromDivider lifts the outcome off a send divider", () => {
    expect(deliveryFromDivider(FAILED_SMS)?.smsFailureReason).toMatch(/21211/);
    expect(deliveryFromDivider(GOOD_SMS)?.textedTo).toBe("+15125550123");
    expect(deliveryFromDivider({ phase: 2 })).toBeUndefined();
  });

  test("an undelivered quote is not awaiting the customer (pipeline counts)", () => {
    const q = {
      id: "q1",
      status: "sent",
      sentAt: "2026-11-10T00:00:00Z",
      estimatedTotal: 35_000,
      lastDelivery: { at: "t", channel: "sms", smsFailureReason: "x" },
    };
    expect(classifyQuoteForPipeline(q)).toBe("draft");
    const agg = aggregatePipeline([q]);
    expect(agg.awaitingCount).toBe(0);
    expect(agg.awaitingCents).toBe(0);
  });
});

describe("REQ-236: the chat reads a failed send as failed", () => {
  test("sendDividerFailed: a send divider with no channel delivered", () => {
    expect(sendDividerFailed(FAILED_SMS)).toBe(true);
    expect(sendDividerFailed(GOOD_SMS)).toBe(false);
    expect(
      sendDividerFailed({
        quoteId: "q1",
        channel: "both",
        emailedTo: "a@b.c",
        smsFailureReason: "x",
      }),
    ).toBe(false);
    expect(sendDividerFailed({ phase: 2 })).toBe(false);
  });

  test("the header never says 'Out for signature' / 'Quote sent' after a failed send", () => {
    const key = headerStatusKey({
      quoteAccepted: false,
      quote: { status: "sent" }, // LockQuote already flipped it
      lastDividerPayload: FAILED_SMS,
      lastCardStatus: "sent",
      hasQuoteCard: true,
    });
    expect(key).toBe("asstChat.header.notDelivered");
    // Stored outcome alone (no divider in this page of messages):
    expect(
      headerStatusKey({
        quoteAccepted: false,
        quote: {
          status: "sent",
          lastDelivery: { at: "t", channel: "email", emailFailureReason: "x" },
        },
        lastDividerPayload: undefined,
        lastCardStatus: "sent",
        hasQuoteCard: true,
      }),
    ).toBe("asstChat.header.notDelivered");
  });

  test("the header still reads out-for-signature / accepted once delivered", () => {
    expect(
      headerStatusKey({
        quoteAccepted: false,
        quote: { status: "sent" },
        lastDividerPayload: GOOD_SMS,
        lastCardStatus: "sent",
        hasQuoteCard: true,
      }),
    ).toBe("asstChat.header.outForSignature");
    expect(
      headerStatusKey({
        quoteAccepted: true,
        quote: { status: "accepted" },
        lastDividerPayload: FAILED_SMS,
        lastCardStatus: "sent",
        hasQuoteCard: true,
      }),
    ).toBe("asstChat.header.quoteAccepted");
    expect(
      headerStatusKey({
        quoteAccepted: false,
        quote: undefined,
        lastDividerPayload: { phase: 2 },
        lastCardStatus: undefined,
        hasQuoteCard: true,
      }),
    ).toBe("asstChat.header.gatheringInfo");
  });

  test("applySendOutcome flips the local quote to 'sent' ONLY on a delivery", () => {
    const draft = { id: "q1", status: "draft" };
    const failed = applySendOutcome(draft, FAILED_SMS);
    expect(failed.status).toBe("draft");
    expect(failed.lastDelivery?.smsFailureReason).toMatch(/21211/);
    const good = applySendOutcome(draft, GOOD_SMS);
    expect(good.status).toBe("sent");
    expect(good.deliveredAt).toBeTruthy();
  });

  test("the recovery form rides only the NEWEST send divider — a good resend retires the old failure", () => {
    const customer = { id: "c1", phoneNumber: "+15125550123" };
    // Old failure (invalid number), then the phone was fixed and resent OK.
    const msgs = [divider("d1", FAILED_SMS), divider("d2", GOOD_SMS)];
    expect(lastRecoveryDividerId(msgs, customer)).toBeUndefined();
    // The newest divider failing still gets the form.
    const msgs2 = [divider("d1", GOOD_SMS), divider("d2", FAILED_SMS)];
    expect(lastRecoveryDividerId(msgs2, customer)).toBe("d2");
    // Non-send dividers (wizard phases) don't shadow the failure.
    const msgs3 = [divider("d1", FAILED_SMS), divider("d2", { phase: 2 })];
    expect(lastRecoveryDividerId(msgs3, customer)).toBe("d1");
  });
});

describe("REQ-236: /quotes never calls an undelivered quote 'Just sent'", () => {
  const base: Quote = {
    id: "Q-1",
    title: "Fence",
    client: "Maria Lopez",
    initials: "ML",
    stage: "undelivered",
    value: 350,
    daysIn: 0,
    opens: 0,
    sentDays: null,
    band: ["#000", "#000"],
    shadow: "x",
  };

  test("undelivered sits in the draft track, out of 'Out for response'", () => {
    expect(OUT_STAGES).not.toContain("undelivered");
    expect(DRAFT_TRACK_STAGES).toContain("undelivered");
    expect(DRAFT_TRACK_STAGES).toContain("draft");
  });

  test("it has its own label and mood in both languages", () => {
    expect(en["quotesSeed.stage.undelivered"]).toBeTruthy();
    expect(es["quotesSeed.stage.undelivered"]).toBeTruthy();
    expect(stageLabelFor("en", "undelivered")).not.toBe(
      stageLabelFor("en", "sent"),
    );
    expect(moodForQuote(base)).not.toEqual(
      moodForQuote({ ...base, stage: "sent" }),
    );
    expect(en["quoteCard.cta.fixContact"]).toBeTruthy();
    expect(es["quoteCard.cta.fixContact"]).toBeTruthy();
  });

  test("the story says it was not delivered — not 'sent, no opens, could be in spam'", () => {
    for (const lang of ["en", "es"] as const) {
      const r = readingFor(base, [], lang);
      expect(r.text).toBe(
        (lang === "en" ? en : es)["quotesSeed.reading.undelivered.text"],
      );
    }
  });

  test("a texted quote with no opens gets no email/spam wording", () => {
    const texted: Quote = { ...base, stage: "sent", channel: "sms" };
    for (const lang of ["en", "es"] as const) {
      const r = readingFor(texted, [], lang);
      const all = `${r.text} ${r.em ?? ""} ${r.tail ?? ""}`;
      expect(all).not.toMatch(/spam|e-?mail|correo/i);
    }
  });
});

describe("REQ-236: wiring — icons, list chip, header, send", () => {
  const chat = read("front-end/islands/AsstChat.tsx");
  const threads = read("front-end/islands/AsstThreads.tsx");
  const icons = read("front-end/lib/dash-icons.tsx");

  test("an alert icon exists and the failure divider/card use it (no check-in-a-box)", () => {
    expect(icons).toMatch(/\balert:\s*\(/);
    expect(chat).toMatch(/dispatchFailed[\s\S]{0,80}ICN\.alert/);
    expect(chat).toMatch(/sendDividerFailed\(dp\)\s*\?\s*ICN\.alert/);
  });

  test("the chat uses the shared helpers instead of re-deriving inline", () => {
    expect(chat).toContain("headerStatusKey(");
    expect(chat).toContain("lastRecoveryDividerId(");
    expect(chat).toContain("applySendOutcome(");
    expect(chat).not.toMatch(
      /setQuote\(\(q\) => \(q \? \{ \.\.\.q, status: "sent" \} : q\)\)/,
    );
  });

  test("the thread list shows 'Not delivered' for an undelivered conversation", () => {
    expect(threads).toMatch(/quoteStatus === "undelivered"/);
    expect(en["asstThreads.chip.notDelivered"]).toBeTruthy();
    expect(es["asstThreads.chip.notDelivered"]).toBeTruthy();
    expect(en["asstChat.header.notDelivered"]).toBeTruthy();
    expect(es["asstChat.header.notDelivered"]).toBeTruthy();
  });
});
