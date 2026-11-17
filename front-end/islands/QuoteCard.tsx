/**
 * Pipeline quote card with flip-to-back engagement timeline.
 * Mirrors the prototype's QuoteCard component verbatim.
 */
import { useEffect, useState } from "preact/hooks";
import { api } from "../lib/api.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtMoney } from "../lib/format.ts";
import { tFor } from "../lib/i18n.ts";
import {
  moodForQuote,
  type OpenEvent,
  QSTORIES,
  type Quote,
  readingFor,
  stageLabelFor,
} from "../lib/quotes-seed.ts";
import DeleteQuoteButton from "./DeleteQuoteButton.tsx";
import { customerLinkPath, customerLinkUrl } from "../lib/customer-link.ts";
import { assistantClient } from "../clients/assistant.ts";
import {
  draftConversationFor,
  quoteCta,
} from "../../shared/card-actions/mod.ts";
import {
  interpretSendResult,
  summarizeDispatch,
} from "../../shared/quote-flow/send-result.ts";

/** REQ-626: send the quote again over both channels and read the BODIES
 *  (P-09: a 200 {ok:false} is a failure, not a send). */
async function resendQuote(id: string) {
  const one = async (channel: "email" | "text") => {
    try {
      const r = await fetch(`/api/quotes/${id}/${channel}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json().catch(() => null);
      return interpretSendResult({ httpOk: r.ok, body });
    } catch {
      return { delivered: false, reason: "http" as const };
    }
  };
  const [email, text] = await Promise.all([one("email"), one("text")]);
  return {
    ...summarizeDispatch({ email, text }),
    // nothing to send to — the client has neither an email nor a phone
    noContact: email.reason === "noEmail" && text.reason === "noPhone",
  };
}

/** Real engagement entry from GET /quotes/:id/opens. */
interface RealOpen {
  at: string;
  atRel: string;
  device: "desktop" | "mobile" | "tablet" | "unknown";
}

/** Map a REAL open to the card's timeline shape — day, local time, device.
 *  Nothing is invented: the canned "Today · 9:42am · iPhone" seed list is
 *  gone (P-15); only recorded views render. */
function toOpenEvent(o: RealOpen, lang: "en" | "es"): OpenEvent {
  const locale = lang === "es" ? "es-US" : "en-US";
  const d = new Date(o.at);
  const valid = Number.isFinite(d.getTime());
  return {
    when: valid
      ? d.toLocaleDateString(locale, { month: "short", day: "numeric" })
      : o.atRel,
    time: valid
      ? d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
      : "",
    device: tFor(lang, `quoteCard.device.${o.device}`),
  };
}

interface Props {
  q: Quote;
  idx: number;
  lang?: "en" | "es";
  /** Deep-link (/quotes?open=<id>): mount the card already flipped to its
   *  detail back so the opened quote's actions are immediately visible. */
  flipOnMount?: boolean;
  /** REQ-239 (M28): open the quote panel (/quotes?open=<id>) — the same
   *  entry point the decided rows have. REQ-626: QuotesPage's openQuote. */
  onOpen?: (id: string) => void;
}

function OpenDots({ count, max = 5 }: { count: number; max?: number }) {
  return (
    <span class="qcard__opens-dots">
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          class={`qcard__opens-dot ${i < count ? "qcard__opens-dot--on" : ""}`}
        />
      ))}
    </span>
  );
}

export default function QuoteCard(
  { q, idx, lang = "en", flipOnMount = false, onOpen }: Props,
) {
  const [flipped, setFlipped] = useState(flipOnMount);
  const [copied, setCopied] = useState(false);
  // REAL opens, fetched lazily on first flip. Until loaded (or when there
  // are none) the timeline shows the honest "no opens" copy — never a
  // fabricated seed entry (P-15).
  const [realOpens, setRealOpens] = useState<OpenEvent[] | null>(null);

  useEffect(() => {
    if (!flipped || realOpens !== null || q.opens === 0) return;
    let alive = true;
    api.get<{ opens: RealOpen[] }>(`/quotes/${q.id}/opens`)
      .then((r) => {
        if (!alive) return;
        setRealOpens((r?.opens ?? []).map((o) => toOpenEvent(o, lang)));
      })
      .catch(() => {
        if (alive) setRealOpens([]);
      });
    return () => {
      alive = false;
    };
  }, [flipped, q.id, q.opens, lang]);

  async function copyPublicLink(e: MouseEvent) {
    e.stopPropagation();
    try {
      // REQ-586 (cycle 4, M11): in the language the quote went out in.
      await navigator.clipboard.writeText(
        customerLinkUrl(globalThis.location.origin, q.id, q.sendLang),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — leave the label as-is */ }
  }
  // REQ-626: Resend / the nudge CTAs report what happened, on the card
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<
    { ok: boolean; text: string } | null
  >(null);

  function openPanel() {
    if (onOpen) onOpen(q.id);
    else globalThis.location.assign(`/quotes?open=${encodeURIComponent(q.id)}`);
  }

  async function onResend(e: Event) {
    e.stopPropagation();
    if (sending) return;
    setSending(true);
    setSendNote(null);
    try {
      const d = await resendQuote(q.id);
      setSendNote(
        d.delivered
          ? {
            ok: true,
            text: tFor(
              lang,
              d.partial
                ? d.failedChannels.includes("text")
                  ? "quoteCard.resent.emailOnly"
                  : "quoteCard.resent.textOnly"
                : "quoteCard.resent.ok",
            ),
          }
          : {
            ok: false,
            text: tFor(
              lang,
              d.noContact
                ? "quoteCard.resent.noContact"
                : "quoteCard.resent.failed",
            ),
          },
      );
    } finally {
      setSending(false);
    }
  }

  /** REQ-626: a draft resumes in its assistant conversation (the panel if
   *  none is left); a nudge re-sends; anything else opens the panel. */
  async function onCta(e: Event) {
    e.stopPropagation();
    const { action } = quoteCta(q.stage, q.opens);
    if (action === "resend") return onResend(e);
    if (action === "resume") {
      setSending(true);
      const convos = await assistantClient.conversations(200).catch(() => []);
      const cid = draftConversationFor(
        q.id,
        Array.isArray(convos) ? convos : [],
      );
      setSending(false);
      if (cid) {
        globalThis.location.assign(`/assistant/${encodeURIComponent(cid)}`);
        return;
      }
    }
    openPanel();
  }

  const noteEl = sendNote && (
    <p
      class="qcard__sendfail"
      role={sendNote.ok ? "status" : "alert"}
      data-cy="qcard-send-note"
      style={`margin:0 0 8px;${
        sendNote.ok ? "color:var(--brand-green,#519843)" : ""
      }`}
    >
      {sendNote.text}
    </p>
  );

  const mood = moodForQuote(q);
  const story = QSTORIES[q.id] ?? tFor(lang, "quoteCard.storyFallback");
  // REQ-626: the label says what the click does (shared/card-actions).
  // REQ-614 (cycle 4, m16): the onboarding sample is an unnumbered draft with
  // no customer — it is looked at, never finished and sent. REQ-555-era
  // "undelivered": the panel opens to fix the contact.
  const cta = q.isSample
    ? tFor(lang, "quoteCard.cta.viewSample")
    : q.stage === "undelivered"
    ? tFor(lang, "quoteCard.cta.fixContact")
    : tFor(lang, quoteCta(q.stage, q.opens).key);
  const showOpens = q.stage !== "draft" && q.stage !== "undelivered" &&
    q.opens > 0;
  const opens = realOpens ?? [];
  const reading = readingFor(q, opens, lang);

  function onCardClick(e: MouseEvent) {
    if (flipped) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(".qcard__cta") || target.closest(".qcard__flip-hint") ||
      target.closest(".qcard__back")
    ) return;
    setFlipped(true);
  }

  const styleStr = `--mood-from:${mood.from};` +
    `--mood-to:${mood.to};` +
    `--mood-shadow:${mood.shadow};` +
    `--mood-status:${mood.statusFg};`;

  return (
    <article
      class={`qcard ${flipped ? "qcard--flipped" : ""}`}
      style={styleStr}
      onClick={onCardClick}
    >
      <div class="qcard__mood">
        <div class="qcard__numeral">{String(idx + 1).padStart(2, "0")}</div>
        <div class="qcard__status">
          <span class="qcard__status-dot" />
          {q.isSample
            ? tFor(lang, "quoteCard.sampleTag")
            : stageLabelFor(lang, q.stage)}
        </div>
        {showOpens && (
          <div class="qcard__opens">
            <OpenDots count={Math.min(q.opens, 5)} /> {q.opens}×
          </div>
        )}
      </div>
      <div class="qcard__av">{q.initials}</div>
      <div class="qcard__body">
        <div class="qcard__client-name">
          {q.client}
          {q.number && (
            /* REQ-313 (demo m48): the quote's own number — the big numeral
               is only the card's position. REQ-429 (cycle 3, p8-pair3-b): it
               rides in the client line ("client · Q-001", as the invoice and
               payment cards do), not in the mood strip under the avatar. */
            <>
              {" · "}
              <span class="qcard__number">{q.number}</span>
            </>
          )}
        </div>
        <h3 class="qcard__title">{q.title}</h3>
        <p class="qcard__story">{story}</p>
      </div>
      <div class="qcard__foot">
        {
          /* REQ-626: the front CTA does what it says (resend, resume the
            draft, open the panel — onCta); REQ-310 AMENDMENT (reconciled with
            develop on demo-fixes): "open" is the quote panel via onOpen. */
        }
        {!q.isSample
          ? (
            <button
              class="qcard__cta"
              type="button"
              data-cy="qcard-cta"
              onClick={onCta}
              disabled={sending}
            >
              {cta}{" "}
              <span style="display:inline-block;transition:transform 240ms">
                →
              </span>
            </button>
          )
          : (
            /* REQ-614 (cycle 4, m16): the sample's CTA shows the quote as a
              customer would see it — it never opens the send flow. */
            <a
              class="qcard__cta"
              data-cy="qcard-cta"
              href={customerLinkPath(q.id, q.sendLang)} // REQ-586
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
            >
              {cta}{" "}
              <span style="display:inline-block;transition:transform 240ms">
                →
              </span>
            </a>
          )}
        <div class="qcard__val-wrap">
          <div class="qcard__val-lbl">
            {q.isSample
              ? tFor(lang, "quoteCard.sampleTag")
              : tFor(lang, "quoteCard.valueLabel")}
          </div>
          {
            /* P-15: the sample's canned $3,700 never renders as real money —
              its value cell carries the sample marker instead. */
          }
          <div class="qcard__val-num">
            {q.isSample ? "—" : fmtMoney(q.value)}
          </div>
        </div>
      </div>

      {/* REQ-626: what a Resend / nudge did — on whichever face is showing */}
      {sendNote && !flipped && noteEl}

      <div class="qcard__back" aria-hidden={!flipped}>
        <div class="qcard__back-head">
          <button
            class="qcard__back-close"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFlipped(false);
            }}
            aria-label={tFor(lang, "common.close")}
          >
            <I d={ICN.x} size={14} sw={2.5} />
          </button>
          <div class="qcard__back-eyebrow">
            {q.number
              ? `${q.number} · ${
                tFor(lang, "quotes.ledger.versionN", { n: q.version ?? 1 })
              } · `
              : null}
            {tFor(lang, "quoteCard.back.eyebrow")}
          </div>
          <p class="qcard__back-big">
            {
              /* REQ-313 (p15-11): a real space before the unit, so the DOM
                text reads "0 aperturas", not "0aperturas". */
            }
            {q.opens}{" "}
            <small>
              {tFor(
                lang,
                `quoteCard.back.opens.${q.opens === 1 ? "one" : "other"}`,
                { n: q.opens },
              )} · {q.client.split(/\s+/)[0]}
            </small>
          </p>
        </div>
        <div class="qcard__back-body">
          {sendNote && flipped && noteEl}
          {opens.length > 0
            ? (
              <div class="qcard__timeline">
                {opens.map((o, i) => (
                  <div class="qcard__topen" key={i}>
                    <span class="qcard__topen-dot" />
                    <div>
                      <div class="qcard__topen-when">
                        <strong>{o.when}</strong> · {o.time}
                      </div>
                    </div>
                    <div class="qcard__topen-dev">{o.device}</div>
                  </div>
                ))}
              </div>
            )
            : (
              <div class="qcard__topen-meta" style="padding:8px 0">
                {tFor(lang, "quoteCard.back.noOpens")}
              </div>
            )}
          <p class="qcard__read">
            {reading.text}
            {reading.em ? <em>{reading.em}</em> : null}
            {reading.tail ?? null}
          </p>
        </div>
        <div class="qcard__back-foot">
          <button
            type="button"
            class="qcard__back-btn--primary qcard__back-open"
            data-cy="qcard-open"
            onClick={(e) => {
              e.stopPropagation();
              if (onOpen) onOpen(q.id);
              else openPanel();
            }}
          >
            {tFor(lang, "quoteCard.back.open")}
          </button>
          {
            /* REQ-626: Resend is real (both channels, the bodies read).
              REQ-360 (demo-loop cycle 1, m11): never for the never-sent
              sample, which has no customer to share a link with either;
              "View as customer" stays. */
          }
          {!q.isSample && (
            <button
              type="button"
              data-cy="qcard-resend"
              onClick={onResend}
              disabled={sending}
            >
              {sending ? "…" : tFor(lang, "quoteCard.back.resend")}
            </button>
          )}
          {!q.isSample && (
            <button type="button" onClick={copyPublicLink}>
              {copied
                ? tFor(lang, "quoteCard.back.linkCopied")
                : tFor(lang, "quoteCard.back.copyLink")}
            </button>
          )}
          <a
            href={customerLinkPath(q.id, q.sendLang)}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
          >
            {tFor(lang, "quoteCard.back.viewAsClient")}
          </a>
          {/* REQ-485 (m22): a signed quote is the agreement — no Delete. */}
          {q.stage !== "won" && <DeleteQuoteButton id={q.id} />}
        </div>
      </div>
    </article>
  );
}
