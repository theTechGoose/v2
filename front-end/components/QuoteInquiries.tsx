/**
 * REQ-701 (demo-loop cycle 5, issue M21) — the quote panel's "Questions from
 * the client".
 *
 * Pair 9 clicked the notice "Linda Morales hizo una pregunta" and got the
 * quote panel with "Linda's question text NOWHERE on that panel, no reply
 * box. How do I answer her?" Every question a client sent from the public
 * page is listed here (anchor #questions — where the feed row, the alert and
 * the chat link): who asked and when, the question, how they asked to be
 * reached, and Text back / Email back / Call for the contacts there are
 * (`inquiryReplyTargets`: what the client typed first, the customer on file
 * otherwise). Text back / Email back open a reply box; Send goes through
 * POST /quotes/:id/inquiries/:inquiryId/reply and the row then reads
 * "Answered by text/email".
 *
 * Rendered by the QuotesPage island (hooks are fine here).
 */
import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { tFor } from "../lib/i18n.ts";
import { type QuoteInquiry, quotesClient } from "../clients/quotes.ts";
import {
  type InquiryReplyChannel,
  inquiryReplyTargets,
} from "../../shared/quote-flow/inquiry-contact.ts";
import {
  formatPhoneDisplay,
  relativeTime,
} from "../../shared/quote-flow/format-helpers.ts";
import {
  QUESTIONS_ANCHOR,
  type ReplyOutcome,
  replyOutcome,
} from "../lib/quote-inquiries.ts";

type Lang = "en" | "es";

/** The quote's customer, as far as the reply needs them. */
export interface InquiryCustomer {
  name?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
}

export default function QuoteInquiries(
  { lang, quoteId, inquiries, customer, customerName }: {
    lang: Lang;
    quoteId: string;
    /** newest first (GET /quotes/:id/inquiries) */
    inquiries: QuoteInquiry[];
    customer?: InquiryCustomer | null;
    customerName?: string | null;
  },
) {
  // An answered question is replaced in place from the reply's response; a
  // re-read of the panel hands a new list in.
  const [items, setItems] = useState(inquiries);
  useEffect(() => setItems(inquiries), [inquiries]);
  if (items.length === 0) return null;
  const waiting = items.filter((i) => !i.answeredAt).length;
  return (
    <section class="qinq" id={QUESTIONS_ANCHOR} data-cy="quote-inquiries">
      <div class="qinq__head">
        <h3 class="qinq__title">{tFor(lang, "quotesPage.inquiries.title")}</h3>
        {waiting > 0 && (
          <span class="qinq__count" data-cy="quote-inquiries-waiting">
            {tFor(lang, "quotesPage.inquiries.waiting", { n: waiting })}
          </span>
        )}
      </div>
      {items.map((inq) => (
        <InquiryRow
          key={inq.id}
          lang={lang}
          quoteId={quoteId}
          inq={inq}
          customer={customer}
          customerName={customerName}
          onAnswered={(answered) =>
            setItems((all) =>
              all.map((x) => x.id === answered.id ? answered : x)
            )}
        />
      ))}
    </section>
  );
}

function InquiryRow(
  { lang, quoteId, inq, customer, customerName, onAnswered }: {
    lang: Lang;
    quoteId: string;
    inq: QuoteInquiry;
    customer?: InquiryCustomer | null;
    customerName?: string | null;
    onAnswered: (answered: QuoteInquiry) => void;
  },
) {
  const [channel, setChannel] = useState<InquiryReplyChannel | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ReplyOutcome | null>(null);

  const targets = inquiryReplyTargets(inq, customer);
  const who = inq.name?.trim() || customerName?.trim() ||
    tFor(lang, "quotesPage.inquiries.someone");
  const target = channel === "text"
    ? targets.text
    : channel === "email"
    ? targets.email
    : undefined;
  // One solid primary: the channel the client asked to be reached on.
  const primary: InquiryReplyChannel = targets.preferred ??
    (targets.text ? "text" : "email");
  const btn = (ch: InquiryReplyChannel) =>
    `qopen__btn${primary === ch ? " qinq__btn--primary" : ""}`;

  function toggle(ch: InquiryReplyChannel) {
    setOutcome(null);
    setChannel((open) => open === ch ? null : ch);
  }

  async function send() {
    if (!channel || busy) return;
    const message = text.trim();
    if (!message) {
      setOutcome(replyOutcome({ ok: false, channel, failureCode: "empty" }));
      return;
    }
    setBusy(true);
    setOutcome(null);
    try {
      const res = await quotesClient.replyToInquiry(quoteId, inq.id, {
        channel,
        message,
      });
      setOutcome(replyOutcome(res));
      if (res.ok) {
        setChannel(null);
        setText("");
        if (res.inquiry) onAnswered(res.inquiry);
      }
    } catch {
      setOutcome(replyOutcome({ ok: false, channel }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      class={`qinq__item${inq.answeredAt ? " qinq__item--answered" : ""}`}
      data-cy="quote-inquiry"
    >
      <div class="qinq__meta">
        <strong class="qinq__who">{who}</strong>
        <span>{relativeTime(inq.createdAt, Date.now(), lang)}</span>
      </div>
      <blockquote class="qinq__q" data-cy="quote-inquiry-question">
        {inq.question}
      </blockquote>
      {inq.contactBack && (
        <div class="qinq__contact" data-cy="quote-inquiry-contact">
          {tFor(lang, "inquiryAlert.contactBack", {
            contact: inq.contactBack,
          })}
        </div>
      )}
      {inq.answer && (
        <div class="qinq__answered" data-cy="quote-inquiry-answered">
          {tFor(
            lang,
            inq.answer.channel === "email"
              ? "quotesPage.inquiries.answeredEmail"
              : "quotesPage.inquiries.answeredText",
            { when: relativeTime(inq.answer.at, Date.now(), lang) },
          )}
          <p class="qinq__answer">{inq.answer.message}</p>
        </div>
      )}
      {targets.text || targets.email
        ? (
          <div class="qinq__actions">
            {targets.text && (
              <button
                type="button"
                class={btn("text")}
                data-cy="quote-inquiry-text"
                aria-expanded={channel === "text" ? "true" : "false"}
                onClick={() => toggle("text")}
              >
                <I d={ICN.msg} size={13} sw={2.4} />
                {tFor(lang, "quotesPage.inquiries.textBack")}
              </button>
            )}
            {targets.email && (
              <button
                type="button"
                class={btn("email")}
                data-cy="quote-inquiry-email"
                aria-expanded={channel === "email" ? "true" : "false"}
                onClick={() => toggle("email")}
              >
                <I d={ICN.mail} size={13} sw={2.4} />
                {tFor(lang, "quotesPage.inquiries.emailBack")}
              </button>
            )}
            {targets.call && (
              <a
                class="qopen__btn"
                data-cy="quote-inquiry-call"
                href={targets.call}
              >
                <I d={ICN.phone} size={13} sw={2.4} />
                {tFor(lang, "quotesPage.inquiries.call")}
              </a>
            )}
          </div>
        )
        : (
          <p class="qinq__none" data-cy="quote-inquiry-no-contact">
            {tFor(lang, "quotesPage.inquiries.noContact")}
          </p>
        )}
      {channel && target && (
        <div class="qinq__reply">
          <div class="qinq__to">
            {tFor(lang, "quotesPage.inquiries.replyTo", {
              to: channel === "text"
                ? formatPhoneDisplay(target.to)
                : target.to,
            })}
          </div>
          <textarea
            class="qinq__input"
            data-cy="quote-inquiry-reply"
            rows={3}
            value={text}
            placeholder={tFor(lang, "quotesPage.inquiries.replyPlaceholder")}
            aria-label={tFor(
              lang,
              channel === "text"
                ? "quotesPage.inquiries.textBack"
                : "quotesPage.inquiries.emailBack",
            )}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          />
          <div class="qinq__reply-actions">
            <button
              type="button"
              class="qinq__ghost"
              onClick={() => {
                setChannel(null);
                setOutcome(null);
              }}
            >
              {tFor(lang, "common.cancel")}
            </button>
            <button
              type="button"
              class="qopen__btn qinq__btn--primary"
              data-cy="quote-inquiry-send"
              disabled={busy}
              onClick={send}
            >
              <I d={ICN.send} size={13} sw={2.4} />
              {busy
                ? tFor(lang, "quotesPage.inquiries.sending")
                : tFor(lang, "quotesPage.inquiries.send")}
            </button>
          </div>
        </div>
      )}
      {outcome && (
        <p
          class={`qinq__result${outcome.ok ? "" : " qinq__result--failed"}`}
          data-cy="quote-inquiry-result"
          role="status"
        >
          {tFor(lang, outcome.key, outcome.vars)}
        </p>
      )}
    </article>
  );
}
