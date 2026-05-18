import { useEffect, useRef, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import {
  assistantClient,
  type ContractLite,
  type CustomerLite,
  type Message,
} from "../clients/assistant.ts";
import { filesClient } from "../clients/files.ts";
import { quotesClient } from "../clients/quotes.ts";
import { clientsClient } from "../clients/clients.ts";
import { contractsClient } from "../clients/contracts.ts";
import { readCached, refreshDash, subscribeDash } from "../lib/dash-cache.ts";
import MoneyInput from "./MoneyInput.tsx";

type WizardFieldType = "percent" | "number" | "currency" | "days" | "text";

interface WizardFollowUpField {
  id: string;
  label: string;
  type: WizardFieldType;
  default?: number | string;
  min?: number;
  max?: number;
}

interface WizardOption {
  id: string;
  label: string;
  sub?: string;
  isCustom?: boolean;
  followUp?: { fields: WizardFollowUpField[] };
}

/**
 * Term-edit picker fallback: a static map of stepId → preset options for
 * the contract-terms wizard. Used when the term row is being edited
 * inline and no matching wizard message is in chat scope (older threads,
 * or threads where the wizard messages were pruned). Mirrors
 * `CONTRACT_TERMS_WIZARD_V1` in the backend — keep in sync if that spec
 * grows new steps. The `customer` step is intentionally excluded since
 * its picker has its own dedicated panel.
 */
const TERM_OPTIONS_FALLBACK: Record<string, { label: string; sub?: string }[]> =
  {
    config: [
      { label: "Standard residential", sub: "Most homes, simple jobs" },
      { label: "Standard commercial", sub: "Businesses, HOAs" },
      { label: "Start blank", sub: "I'll choose every option" },
    ],
    start_date: [
      { label: "Right away" },
      { label: "Next week" },
      { label: "Next Month" },
    ],
    wraps: [
      { label: "1 day" },
      { label: "2–3 days" },
      { label: "1 week" },
      { label: "2 weeks" },
    ],
    payment_terms: [
      { label: "Payment upon completion", sub: "Same-day payment" },
      { label: "50/50", sub: "Half upfront, half when done" },
      { label: "30/30/40", sub: "Start, halfway, done" },
      { label: "Deposit + balance", sub: "Small upfront, rest when done" },
    ],
    warranty: [
      { label: "No warranty" },
      { label: "6 months" },
      { label: "12 months" },
      { label: "24 months" },
    ],
    termination: [
      { label: "7 days" },
      { label: "14 days" },
      { label: "30 days" },
    ],
    dispute: [
      { label: "Mediation", sub: "Try to settle informally first" },
      { label: "Arbitration", sub: "Binding decision, no court" },
      { label: "Court", sub: "Standard small-claims path" },
    ],
    governing_state: [
      { label: "Use my business state" },
      { label: "Use the job site state" },
    ],
    state_notices: [
      { label: "Yes", sub: "Recommended" },
      { label: "No", sub: "I'll add my own" },
      { label: "Review first", sub: "Show me what's included" },
    ],
  };

interface ActionCardLineItem {
  description: string;
  amountCents: number;
}

interface ActionCardPayload {
  actionType?: string;
  status?: "draft" | "sent" | "viewed" | "approved" | "void" | string;
  quoteId?: string;
  customerId?: string;
  /** Polished narrative produced from the user's raw job-details input. */
  description?: string;
  lineItems?: ActionCardLineItem[];
  totalCents?: number;
}

/** Map a Quote/Contract status to the human-facing chip label on the
 *  in-chat Quote+Agreement card. Keeps the chip in sync with the doc's
 *  lifecycle: Draft → Sent → Viewed → Approved. */
function statusChipLabel(status: string | undefined): string {
  switch ((status ?? "draft").toLowerCase()) {
    case "sent":
      return "Sent";
    case "opened":
    case "viewed":
      return "Viewed";
    case "won":
    case "accepted":
    case "approved":
    case "signed":
      return "Approved";
    case "void":
    case "declined":
    case "lost":
      return "Declined";
    default:
      return "Draft";
  }
}

function fmtUSD(cents: number): string {
  if (!Number.isFinite(cents)) return "$0";
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

interface Props {
  conversationId?: string;
  initialMessages: Message[];
  /** Customer bound to this conversation (only present in phase 2). */
  initialCustomer?: CustomerLite;
  /** Contract bound to this conversation (only present once the wizard completes). */
  initialContract?: ContractLite;
  /** 1-2 letter user-avatar string. Pre-derived on the server so we don't
   *  flash a stale or default value while hydrating. */
  userInitials?: string;
}

/** Derive a stable 1-2 letter avatar string. Mirrors the backend
 *  `computeInitials(name, businessName)` so the chat bubble matches the
 *  sidebar disc. Single-token name + a business → first letter of each
 *  ("Diego" + "Riley Roofing Co." → "DR"). No name and no business →
 *  "👤". Phone digits are never used. */
export function deriveUserInitials(input: {
  name?: string;
  businessName?: string;
  phoneNumber?: string;
}): string {
  const name = input.name?.trim();
  const biz = input.businessName?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      if (biz) {
        const bizParts = biz.split(/\s+/).filter(Boolean);
        if (bizParts.length >= 1)
          return (parts[0][0] + bizParts[0][0]).toUpperCase();
      }
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (biz) {
    const bizParts = biz.split(/\s+/).filter(Boolean);
    if (bizParts.length >= 2)
      return (bizParts[0][0] + bizParts[1][0]).toUpperCase();
    if (bizParts.length === 1) return bizParts[0].slice(0, 2).toUpperCase();
  }
  return "👤";
}

function fmtTime(ts: number | string): string {
  const d = typeof ts === "string" ? new Date(ts) : new Date(ts);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtKB(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

interface PaymentMilestone {
  label: string;
  /** Percentage of the total. Omitted for absolute milestones (e.g. Net 15). */
  pct?: number;
  amountCents: number;
}

/**
 * Translate the wizard's picked Payment terms into a milestone schedule.
 * Inputs come straight from the wizard option labels (e.g. "30 / 30 / 40",
 * "50 / 50", "Net 15 — full", "Deposit + balance") or a custom free-text
 * answer the user typed. Returns null when we can't confidently parse —
 * the UI then falls back to the single Total Due number.
 *
 * Rounding: amounts are rounded to whole cents; the LAST milestone
 * absorbs the rounding remainder so the sum equals the total exactly.
 */
function buildPaymentMilestones(
  value: string,
  totalCents: number,
): PaymentMilestone[] | null {
  const v = value.trim().toLowerCase();
  if (!v || totalCents <= 0) return null;

  // Slash- or comma-separated percentages: "30 / 30 / 40", "50/50", "25, 25, 50".
  const parts = v
    .split(/[\/,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const numbers = parts
    .map((p) => parseFloat(p))
    .filter((n) => Number.isFinite(n));
  const sum = numbers.reduce((a, b) => a + b, 0);
  if (numbers.length >= 2 && Math.abs(sum - 100) <= 1) {
    const labels =
      numbers.length === 2
        ? ["Deposit", "On completion"]
        : numbers.length === 3
          ? ["Deposit", "Midpoint", "On completion"]
          : numbers.map((_, i) =>
              i === 0
                ? "Deposit"
                : i === numbers.length - 1
                  ? "On completion"
                  : `Milestone ${i}`,
            );
    const out: PaymentMilestone[] = numbers.map((pct, i) => ({
      label: labels[i],
      pct,
      amountCents: Math.round((totalCents * pct) / 100),
    }));
    const drift = totalCents - out.reduce((s, m) => s + m.amountCents, 0);
    if (drift !== 0) out[out.length - 1].amountCents += drift;
    return out;
  }

  // Net X — single payment due X days after wrap.
  const netMatch = v.match(/net\s*(\d+)/);
  if (netMatch) {
    return [
      { label: `Due in full · net ${netMatch[1]}`, amountCents: totalCents },
    ];
  }

  // "Deposit + balance" — small upfront, balance on completion. No
  // explicit split in the option label; default to 25/75 (matches the
  // wizard's deposit_bal preset hint).
  if (v.includes("deposit") && v.includes("balance")) {
    const deposit = Math.round(totalCents * 0.25);
    return [
      { label: "Deposit", pct: 25, amountCents: deposit },
      {
        label: "Balance on completion",
        pct: 75,
        amountCents: totalCents - deposit,
      },
    ];
  }

  // Custom / unrecognized — let the caller fall back to the single total.
  return null;
}

export default function AsstChat({
  conversationId,
  initialMessages,
  initialCustomer,
  initialContract,
  userInitials = "?",
}: Props) {
  const [convoId, setConvoId] = useState<string | undefined>(conversationId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [customer, setCustomer] = useState<CustomerLite | undefined>(
    initialCustomer,
  );
  const [contract, setContract] = useState<ContractLite | undefined>(
    initialContract,
  );
  const [quoteId, setQuoteId] = useState<string | undefined>();
  /** Full quote row, fetched lazily when the conversation has a quoteId.
   *  Used by the post-wizard quote-review preview to render `description`
   *  + `lineItems` without depending on an in-thread action_card. */
  const [quote, setQuote] = useState<
    | { id: string; summary?: string; description?: string; lineItems?: { description: string; quantity?: number; unit?: string; price?: number }[]; estimatedTotal?: number }
    | undefined
  >();
  const [draft, setDraft] = useState("");
  /** Inline price-capture flow opened by the "I already have my price"
   *  empty-state prompt. When set, renders the MoneyInput card in place
   *  of the three preset prompts. `priceCents` tracks the live value so
   *  Continue can hand the value to the phase-2 kickoff. */
  const [priceCaptureOpen, setPriceCaptureOpen] = useState(false);
  const [priceCents, setPriceCents] = useState<number | null>(null);
  /** Set after the user clicks Continue on the price step. While true,
   *  the chat input no longer routes to the LLM chat — instead its
   *  next submission is treated as raw job-details, sent through the
   *  polish endpoint, then used to seed the new quote + phase 2 wizard. */
  const [awaitingJobDetails, setAwaitingJobDetails] = useState(false);
  const [pendingPriceCents, setPendingPriceCents] = useState<number | null>(null);
  /** First-button flow is now "details first, price second." When the user
   *  taps "I know my price, write it up." we ask for the job details up
   *  front and stash the raw text here. After the user types it and
   *  submits, we flip to the price-capture screen with this populated,
   *  and the price-Continue handler combines both pieces to build the
   *  quote. (The other two flows ignore this — they go through the LLM.) */
  const [pendingJobDetailsRaw, setPendingJobDetailsRaw] = useState<string | null>(null);
  /** Captures the raw text the user submitted at the job-details step
   *  so we can render an optimistic user bubble + "Polishing…" indicator
   *  while the polish + create-quote + transition chain runs. */
  const [submittedJobDetails, setSubmittedJobDetails] = useState<string | null>(null);
  /** In-flight polish promise, kicked off the moment the user submits the
   *  raw job-details bubble. The price-step then `await`s it before
   *  creating the quote, so the heavy LLM call runs *while* the customer
   *  is typing the price — not after they hit Continue. */
  const polishInFlightRef = useRef<
    Promise<{ summary: string; jobName: string; description: string } | null> | null
  >(null);
  /** Inline contact-recovery inputs keyed by the failure phase_divider id.
   *  When SendContract reports a missing/invalid email or phone, we let
   *  the user type it right under the divider; saving patches the
   *  customer profile so we have it next time too. */
  const [recoveryDraft, setRecoveryDraft] = useState<Record<string, { email?: string; phone?: string }>>({});
  const [recoverySavingId, setRecoverySavingId] = useState<string | null>(null);
  /** Selected channel for the quote-review send action. Smart-defaults
   *  from customer.email/phoneNumber: both → both, email-only → email,
   *  phone-only → sms. Overridable via the split-button chevron menu. */
  const [sendChannel, setSendChannel] = useState<"email" | "sms" | "both">("both");
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  /**
   * Tracks `continue_cta` messages whose Review button has been clicked.
   * Drives the inline "Drafted ✓" confirmation state — replaces the
   * placeholder alert() that used to fire when the user reached the end
   * of the wizard. Real send flow (email + signature) is still pending,
   * but the user gets a clean acknowledgement instead of a system popup.
   */
  const [reviewedCtas, setReviewedCtas] = useState<Set<string>>(new Set());
  /**
   * Kind ("business" | "person") the user picked on the lock-quote CTA.
   * Recorded when they click Business or Person on the post-lock CTA so
   * the wizard's customer step can skip its own kind picker and jump
   * straight to the existing-or-new picker for that kind.
   */
  const [precommittedKind, setPrecommittedKind] = useState<
    "business" | "person" | null
  >(null);
  /**
   * stepId of the contract term currently being re-edited inline. Driving
   * a `null → stepId → null` cycle expands the term row into the wizard's
   * option buttons for that step, lets the user pick a new value, and
   * collapses back. Picking PUTs the contract directly (no rewinding the
   * wizard state) — the contract IS the source of truth post-wizard.
   */
  const [editingTermStepId, setEditingTermStepId] = useState<string | null>(
    null,
  );
  /** When the user clicks "Custom" inside a term picker, we swap the
   *  options out for a single free-text input. Tracks (stepId, draft). */
  const [customTermDraft, setCustomTermDraft] = useState<{
    stepId: string;
    value: string;
  } | null>(null);
  /**
   * Set when the user clicks "Review" on the wizard's send CTA. Drives the
   * inline contract preview card (total/customer/dates) so the user can
   * actually look the contract over before clicking "Send to client".
   */
  const [previewCtaId, setPreviewCtaId] = useState<string | null>(null);
  /**
   * When the user picks a wizard option that carries a `followUp`, we stash
   * the (messageId, optionId) here and render the inline form instead of
   * firing the answer. Submitting clears it; cancelling clears it too.
   */
  const [followUpPick, setFollowUpPick] = useState<{
    messageId: string;
    optionId: string;
  } | null>(null);
  // start_date "Pick a date" — when armed, renders an inline date picker
  // in place of the option grid for that wizard message.
  const [customDatePick, setCustomDatePick] = useState<{
    messageId: string;
    optionId: string;
  } | null>(null);
  // wraps "Custom" — structured number + unit picker so the contract gets a
  // clean duration string ("3 weeks") without relying on free-text parsing.
  const [customDurationPick, setCustomDurationPick] = useState<{
    messageId: string;
    optionId: string;
  } | null>(null);
  // warranty "Custom" — same two-phase Bossie chat → verify pattern as the
  // duration picker, but tuned for warranty language (months/years/lifetime)
  // so the contract reads cleanly ("12 months", "2 years", "Lifetime").
  const [customWarrantyPick, setCustomWarrantyPick] = useState<{
    messageId: string;
    optionId: string;
  } | null>(null);
  // payment_terms "Custom" — chat-with-verify Bossie flow that produces a
  // clean payment string ("Net 30", "30 / 30 / 40") that buildPaymentMilestones
  // can parse. Free-text never lands on the contract directly.
  const [customPaymentPick, setCustomPaymentPick] = useState<{
    messageId: string;
    optionId: string;
  } | null>(null);
  // #27 — gates the third empty-state chip ("Nudge an overdue invoice").
  // null = unknown / not yet loaded → don't render the chip yet (avoids
  // flashing it on then yanking it away). Sourced from the shared dash
  // cache so we don't fire a third copy of /analytics/dashboard.
  const [overdueCount, setOverdueCount] = useState<number | null>(() => {
    const snap = readCached();
    return snap?.stats?.invoices.overdue ?? null;
  });
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  /** Live transcript surfaced from the Web Speech API. `interim` updates
   *  as the user keeps speaking; `final` accumulates each finalised chunk
   *  and is what we send when the user taps Stop. */
  const [liveInterim, setLiveInterim] = useState("");
  const [liveFinal, setLiveFinal] = useState("");
  /** Smoothed audio level 0..1 driven by an AnalyserNode — used to
   *  animate the visualizer bars so the user has unambiguous feedback
   *  that the mic is hearing them. */
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | undefined>();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStartRef = useRef<number>(0);
  const recTickRef = useRef<number | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  /** Accumulated final transcript from AssemblyAI's `Turn` frames with
   *  `end_of_turn=true`. Lives in a ref because the audio-process and
   *  WS callbacks fire too fast for React state to be authoritative. */
  const finalSoFarRef = useRef<string>("");
  // Web Audio plumbing — one AudioContext drives both the visualizer
  // (AnalyserNode) and the STT pipe (ScriptProcessor → WS).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sttSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sttProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sttSocketRef = useRef<WebSocket | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setConvoId(conversationId);
    setMessages(initialMessages);
    setCustomer(initialCustomer);
    setContract(initialContract);
    // Seed quoteId from the bound contract (when present) so the
    // quote-fetch effect below kicks in without waiting for a CTA click.
    const seedQuoteId = (initialContract as { quoteId?: string } | undefined)
      ?.quoteId;
    if (seedQuoteId) setQuoteId(seedQuoteId);
  }, [conversationId]);

  // If we still don't have a quoteId on the route (terms phase but no
  // contract bound yet — the "I know my price → job details" flow lands
  // here before the wizard finalizes), pull it from the conversation.
  useEffect(() => {
    if (!convoId || quoteId) return;
    let cancelled = false;
    assistantClient
      .conversation(convoId)
      .then((detail) => {
        if (cancelled) return;
        const qId =
          (detail.conversation as { quoteId?: string } | undefined)?.quoteId ??
          (detail.contract as { quoteId?: string } | undefined)?.quoteId;
        if (qId) setQuoteId(qId);
      })
      .catch(() => { /* preview falls back to action_card */ });
    return () => { cancelled = true; };
  }, [convoId, quoteId]);

  // Close the send-channel menu on outside click / Esc.
  useEffect(() => {
    if (!channelMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest(".quote-review__send-split")) return;
      setChannelMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChannelMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [channelMenuOpen]);

  // Pick the send channel based on what contact info we actually have
  // for this customer. The user can still override via the chevron menu.
  useEffect(() => {
    const hasEmail = !!customer?.email;
    const hasPhone = !!customer?.phoneNumber;
    if (hasEmail && hasPhone) setSendChannel("both");
    else if (hasEmail) setSendChannel("email");
    else if (hasPhone) setSendChannel("sms");
    else setSendChannel("both");
  }, [customer?.email, customer?.phoneNumber]);

  // Whenever the active quoteId changes, fetch the full quote so the
  // post-wizard preview can render description + lineItems without
  // depending on a synthesized in-thread action_card.
  useEffect(() => {
    if (!quoteId) {
      setQuote(undefined);
      return;
    }
    let cancelled = false;
    quotesClient
      .get(quoteId)
      .then((q) => {
        if (!cancelled) {
          setQuote({
            id: q.id,
            summary: q.summary,
            description: q.description,
            lineItems: q.lineItems,
            estimatedTotal: q.estimatedTotal,
          });
        }
      })
      .catch(() => { /* silent — preview falls back to action_card */ });
    return () => { cancelled = true; };
  }, [quoteId]);

  // ?seed=… pre-fills the composer from a deeplink (e.g. hero CTAs on
  // /payments / /invoices / /contracts → "Ask Bossie to record a payment").
  // We strip the param after seeding so a refresh doesn't re-seed.
  useEffect(() => {
    if (typeof globalThis.window === "undefined") return;
    const url = new URL(globalThis.location.href);
    const seed = url.searchParams.get("seed");
    if (!seed) return;
    setDraft(seed);
    url.searchParams.delete("seed");
    globalThis.history.replaceState({}, "", url.toString());
    // Focus on next paint so the composer expands and the user can edit/send.
    queueMicrotask(() => taRef.current?.focus());
  }, []);

  // #27 — subscribe to the shared dash cache so the empty-state chip
  // gating stays fresh even when the dashboard sidebar (the usual driver
  // of the cache) is the one that triggers the refresh.
  useEffect(() => {
    let alive = true;
    const unsub = subscribeDash((snap) => {
      if (!alive) return;
      setOverdueCount(snap.stats?.invoices.overdue ?? 0);
    });
    refreshDash().then((snap) => {
      if (!alive) return;
      setOverdueCount(snap.stats?.invoices.overdue ?? 0);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  // P6.12: keep the chat header fresh while the conversation evolves. The
  // SSR-rendered header on /assistant (no threadId) starts as
  // "New conversation" and never updates. Broadcast a CustomEvent whenever
  // the bound customer or contract status changes so a sibling island can
  // swap the title in place — no page reload needed.
  useEffect(() => {
    if (typeof globalThis.window === "undefined") return;
    const client = customer?.name?.trim();
    const contractStatus = contract?.status;
    // Find the most recent quote action_card to derive a meaningful
    // status. "Drafting…" used to fire as soon as a conversation existed,
    // which mis-labelled the header on the literal first turn (audit #13).
    const lastQuoteCard = [...messages].reverse().find((m) => {
      if (m.kind !== "action_card") return false;
      const p = m.payload as ActionCardPayload | undefined;
      return p?.actionType === "quote" || p?.actionType == null;
    });
    const quoteStatus = (
      lastQuoteCard?.payload as ActionCardPayload | undefined
    )?.status;
    // The most recent phase_divider tells us where the conversation is in
    // the wizard timeline. Phase 2 (terms) lands the moment the user
    // clicks Continue, BEFORE a contract row exists — without this hook
    // the header sat at "Quote sent" through the entire wizard, which
    // broke #15 (chip didn't update on transition).
    const lastDivider = [...messages]
      .reverse()
      .find((m) => m.kind === "phase_divider");
    const dividerPhase = (
      lastDivider?.payload as { phase?: number } | undefined
    )?.phase;
    let status = "Your PM Assistant is here to help!";
    if (contractStatus === "signed") status = "Contract signed";
    else if (contractStatus === "sent") status = "Contract out for signature";
    else if (contract) status = "Contract drafting";
    else if (dividerPhase === 4) status = "Contract accepted";
    else if (dividerPhase === 3) status = "Contract sent";
    else if (dividerPhase === 2) status = "Gathering a little more info";
    else if (quoteStatus === "accepted") status = "Quote accepted";
    else if (quoteStatus === "sent") status = "Quote sent";
    else if (lastQuoteCard) status = "Quote drafted · review";
    // No status chip at all on a brand-new thread — "Drafting…" before
    // anything has been drafted reads as broken state.
    const headerClient =
      client ?? (lastQuoteCard ? "Conversation" : "New conversation");
    globalThis.window.dispatchEvent(
      new CustomEvent("pm:asst-header", {
        detail: { client: headerClient, status },
      }),
    );
  }, [
    customer?.name,
    contract?.id,
    contract?.status,
    convoId,
    messages.length,
  ]);

  // Keep the composer focused: on first mount (so users can just start typing)
  // and again whenever the assistant finishes a turn (sending: true → false).
  // Without this the textarea was getting blurred whenever it was disabled,
  // forcing a click back into the input between every message.
  useEffect(() => {
    if (!sending) taRef.current?.focus();
  }, [sending]);

  /**
   * Auto-scroll: pin the chat to the bottom whenever the content height
   * grows AND the user was already near the bottom (within 120px). The
   * messages.length-based effect was too narrow — clicking Review opens
   * an inline preview, the customer picker expands inline, the wizard
   * answer log appends a row… all of those grow the scroll height
   * without adding a message. A ResizeObserver on the inner content
   * catches every height change in one place. We only auto-scroll when
   * the user is near the bottom so we don't yank scroll while they're
   * reading history.
   */
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const inner = scroller.firstElementChild as HTMLElement | null;
    if (!inner) return;
    let nearBottom = true;
    const STICK_THRESHOLD = 120;
    function updateNearBottom() {
      const distFromBottom =
        scroller!.scrollHeight - scroller!.scrollTop - scroller!.clientHeight;
      nearBottom = distFromBottom <= STICK_THRESHOLD;
    }
    function pin() {
      scroller!.scrollTo({ top: scroller!.scrollHeight, behavior: "smooth" });
    }
    updateNearBottom();
    scroller.addEventListener("scroll", updateNearBottom, { passive: true });
    const ro = new ResizeObserver(() => {
      if (nearBottom) requestAnimationFrame(pin);
    });
    ro.observe(inner);
    // First paint — drop straight to bottom (no smooth on initial load).
    scroller.scrollTop = scroller.scrollHeight;
    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", updateNearBottom);
    };
  }, []);

  // Belt-and-suspenders: explicit scroll on message arrivals (for the
  // "user clicked away then a reply lands" case, where they expect to
  // be brought back regardless of where they were). The ResizeObserver
  // above won't kick in if the user scrolled up to read history.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  // Pin to bottom when the inline quote-review preview opens — it's a
  // big card and the trigger button often sits at the bottom of the
  // viewport, so we want to lift the new card fully into view.
  useEffect(() => {
    if (previewCtaId === null) return;
    const el = scrollRef.current;
    if (el)
      requestAnimationFrame(() =>
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }),
      );
  }, [previewCtaId]);

  // Auto-open the editable quote-review when the wizard emits its
  // "Ready to send" CTA. The CTA banner itself is suppressed below
  // (felt redundant), so this effect is the single entry point. Tracked
  // per-message-id in a ref so cancelling the preview doesn't re-trigger.
  const autoOpenedCtasRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (previewCtaId !== null) return;
    for (const m of messages) {
      if (m.kind !== "continue_cta") continue;
      const p = (m.payload ?? {}) as { toPhase?: string };
      if (p.toPhase !== "send") continue;
      if (reviewedCtas.has(m.id)) continue;
      if (autoOpenedCtasRef.current.has(m.id)) continue;
      autoOpenedCtasRef.current.add(m.id);
      submitContinueCta(m).catch(() => {});
      break;
    }
  }, [messages, previewCtaId, reviewedCtas]);

  function autosize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }

  /**
   * Common send pipeline. Inserts an optimistic user bubble, calls the
   * provided `submit` to talk to the backend, then either replaces the
   * stub with the authoritative messages from the server or rolls back
   * on error. `submit` returns the chat response shape.
   */
  async function submitTurn(
    optimistic: {
      role: "user" | "assistant";
      kind: "text" | "voice" | "image";
      content: string;
    },
    submit: () => Promise<{
      conversation?: { id: string };
      newMessages?: Message[];
      message?: Message;
      conversationId?: string;
    }>,
    onError?: () => void,
  ) {
    if (sending) return;
    setError(undefined);
    setSending(true);
    const tmpId = `tmp-${Date.now()}`;
    const stub: Message = {
      id: tmpId,
      conversationId: convoId ?? "",
      role: optimistic.role,
      kind: optimistic.kind,
      content: optimistic.content,
      createdAt: Date.now(),
    };
    setMessages((m) => [...m, stub]);

    try {
      const res = await submit();
      const newConvoId = res.conversation?.id ?? res.conversationId;
      if (newConvoId && newConvoId !== convoId) {
        setConvoId(newConvoId);
        if (!convoId && typeof globalThis.history !== "undefined") {
          globalThis.history.replaceState(null, "", `/assistant/${newConvoId}`);
        }
      }
      if (Array.isArray(res.newMessages) && res.newMessages.length > 0) {
        setMessages((m) => [
          ...m.filter((msg) => msg.id !== tmpId),
          ...res.newMessages!,
        ]);
        // If this turn produced an onboarding ack/handoff, the user just
        // saved a profile field (name / business / state / address) —
        // refresh the dash cache so the sidebar's identity card rebuilds
        // in real time. Cheap pattern match: the strings are stable
        // server-side ack copy.
        const onboardingHit = res.newMessages.some((msg) => {
          if (msg.role !== "assistant" || msg.kind !== "text") return false;
          const c = (msg.content ?? "").trim();
          return (
            c.startsWith("Nice to meet you,") ||
            c.startsWith("Almost there.") ||
            c.startsWith("Last one,") ||
            c.startsWith("Awesome — we're set,")
          );
        });
        const handoffFired = res.newMessages.some((msg) => {
          if (msg.role !== "assistant" || msg.kind !== "text") return false;
          return (msg.content ?? "").trim().startsWith("Awesome — we're set,");
        });
        if (onboardingHit) {
          refreshDash().catch(() => {
            /* best-effort */
          });
          if (typeof globalThis.window !== "undefined") {
            globalThis.window.dispatchEvent(
              new CustomEvent("pm:profile-updated"),
            );
          }
        }
        // Right after the handoff, surface the "see what your customer
        // sees" demo chip as a synthetic local-only message. We don't
        // persist it server-side — it's a one-time UX cue that goes
        // away on reload. The msg id prefix lets the renderer recognize
        // it and swap in the chip UI.
        if (handoffFired) {
          const demoMsg = {
            id: `local-onboard-demo-${Date.now()}`,
            conversationId: convoId ?? "",
            role: "assistant",
            kind: "text",
            content: "PM_ONBOARDING_DEMO_CTA",
            createdAt: Date.now(),
          } as unknown as Message;
          setMessages((m) => [...m, demoMsg]);
        }
      } else if (res.message) {
        setMessages((m) => [
          ...m.filter((msg) => msg.id !== tmpId),
          res.message as Message,
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "send failed");
      setMessages((m) => m.filter((msg) => msg.id !== tmpId));
      onError?.();
    } finally {
      setSending(false);
    }
  }

  async function sendText(content: string) {
    const trimmed = content.trim();
    if (!trimmed) return;
    // Empty-state job-details capture: the chat input is acting as
    // the answer surface for "tell me the job details", not a chat turn.
    // Intercept here so we don't fire a generic LLM call. This fires
    // for both flow orders (details-first or price-first) — submitJobDetails
    // itself decides whether to stash + open the price screen or to run
    // the polish + quote-create directly.
    if (awaitingJobDetails) {
      setDraft("");
      autosize();
      await submitJobDetails(trimmed);
      return;
    }
    setDraft("");
    autosize();
    await submitTurn(
      { role: "user", kind: "text", content: trimmed },
      () =>
        assistantClient.chat({
          conversationId: convoId,
          content: trimmed,
          kind: "text",
        }) as Promise<{
          conversation?: { id: string };
          newMessages?: Message[];
          message?: Message;
          conversationId?: string;
        }>,
      () => setDraft(trimmed),
    );
  }

  /**
   * Voice path: upload the recorded blob to /files, then post a chat
   * turn with kind=voice + payload.fileId. The backend re-transcribes
   * via its own pipeline (authoritative) and returns the persisted
   * user message with the transcript as content — that replaces our
   * optimistic bubble.
   *
   * `liveTranscript` is the realtime transcript captured client-side
   * via the AssemblyAI streaming proxy. We use it as the optimistic
   * bubble copy so the user sees their words land immediately rather
   * than a generic "Transcribing…" placeholder.
   */
  async function sendVoice(
    blob: Blob,
    elapsedSec: number,
    liveTranscript?: string,
  ) {
    const optimisticContent =
      liveTranscript && liveTranscript.length > 0
        ? liveTranscript
        : `🎙️ Voice memo · ${elapsedSec}s · ${fmtKB(blob.size)} — transcribing…`;
    await submitTurn(
      {
        role: "user",
        kind: "voice",
        content: optimisticContent,
      },
      async () => {
        const file = await filesClient.uploadBlob(
          blob,
          `voice-${Date.now()}.webm`,
        );
        return (await assistantClient.chat({
          conversationId: convoId,
          kind: "voice",
          payload: {
            fileId: file.id,
            ...(liveTranscript ? { transcript: liveTranscript } : {}),
          },
        })) as {
          conversation?: { id: string };
          newMessages?: Message[];
          message?: Message;
          conversationId?: string;
        };
      },
    );
  }

  function onSendClick() {
    sendText(draft);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendText(draft);
    }
  }

  /**
   * Dev-only: spin up a phase-2 conversation in one shot. Bypasses the
   * LLM (which may be in stub mode) by creating a quote directly, binding
   * it to a fresh conversation, transitioning to terms, and answering the
   * config step — leaving the user on the customer step.
   */
  /**
   * Continue handler for the inline "I already have my price" flow.
   * Stashes the captured price and flips into the "tell me the job details"
   * mode — the chat input becomes the answer surface for that step.
   * The next chat-input submission routes through `submitJobDetails`,
   * which polishes the raw text via LLM and kicks off the phase-2 flow.
   */
  function onPriceContinue(cents: number) {
    if (sending || cents <= 0) return;
    setError(undefined);
    setPendingPriceCents(cents);
    setPriceCaptureOpen(false);
    // If the user already gave us the job details (details-first flow on
    // the first button), the price is the last piece — kick off polish
    // + quote-creation immediately. Otherwise flip into the legacy
    // "now tell me the details" prompt mode.
    if (pendingJobDetailsRaw && pendingJobDetailsRaw.trim().length > 0) {
      // Keep the price screen mounted while the polish + quote-create
      // chain runs in the background. The Continue button flips to
      // "Setting up…" (driven by `sending`); navigation kicks the user
      // to the new quote when the chain finishes. No interstitial.
      setPriceCaptureOpen(true);
      // Pass cents explicitly — pendingPriceCents state hasn't committed
      // yet at the time the microtask fires, so the submit fn would
      // otherwise read null and loop back into the "open price screen"
      // branch, asking for the price a second time.
      queueMicrotask(() => { void submitJobDetails(pendingJobDetailsRaw, cents); });
    } else {
      setAwaitingJobDetails(true);
    }
  }

  /**
   * Runs after the user types the raw job description in the chat input.
   *
   * Two entry paths converge here:
   *   - Legacy "price → details" flow: pendingPriceCents was set on
   *     /onPriceContinue first; we polish + create the quote immediately.
   *   - New "details → price" flow (first button): no price yet. We
   *     stash the raw text and open the price-capture screen; once the
   *     user hits Continue there, /onPriceContinue replays this fn with
   *     the stashed raw.
   */
  async function submitJobDetails(raw: string, centsOverride?: number) {
    const trimmed = raw.trim();
    if (sending || !trimmed) return;
    setError(undefined);

    // Callers that just set the price in the same tick (onPriceContinue)
    // pass `centsOverride` so we don't rely on the not-yet-committed
    // `pendingPriceCents` React state. Without this, the state would
    // still read null and we'd loop back into the "open price screen"
    // branch — asking the user for the price a second time.
    const cents = centsOverride ?? pendingPriceCents;
    if (cents == null || cents <= 0) {
      // Details-first path: stash the raw and pop the price screen.
      // Kick off the polish NOW so the LLM call runs in parallel while
      // the user types the price (and continues running through phase 2
      // if needed). The quote-create path below reuses this in-flight
      // promise rather than starting a fresh one.
      setPendingJobDetailsRaw(trimmed);
      setSubmittedJobDetails(trimmed);
      setAwaitingJobDetails(false);
      setPriceCaptureOpen(true);
      polishInFlightRef.current = assistantClient
        .polishJobDetails(raw)
        .catch((err) => {
          console.warn("[asst] polish failed, keeping heuristic:", err);
          return null;
        });
      return;
    }

    setSubmittedJobDetails(trimmed);
    setSending(true);
    try {
      // Heuristic summary/jobName so the quote can be created immediately
      // without blocking on the LLM polish. Polish was kicked off at
      // job-details submit (it's already been running while the user
      // typed the price). We don't await it on the critical path — the
      // PUT below patches the quote when it lands.
      const firstLine = raw.split("\n")[0].trim();
      const heuristicSummary = firstLine.split(/\s+/).slice(0, 8).join(" ") || "New job";
      const heuristicJobName = heuristicSummary.split(/\s+/).slice(0, 3).join(" ");
      const draft = {
        summary: heuristicSummary,
        jobName: heuristicJobName,
        description: raw.trim(),
      };

      // Reuse the polish promise started at job-details submit. If the
      // user came in through a path that skipped that step (legacy
      // price→details flow), kick one off here as a fallback.
      const polishPromise = polishInFlightRef.current ?? assistantClient
        .polishJobDetails(raw, cents)
        .catch((err) => {
          console.warn("[asst] polish failed, keeping heuristic:", err);
          return null;
        });
      polishInFlightRef.current = null;

      const quote = await fetch("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          summary: draft.summary,
          jobName: draft.jobName,
          description: draft.description,
          lineItems: [
            {
              description: draft.summary,
              quantity: 1,
              unit: "ea",
              price: cents,
            },
          ],
          estimatedTotal: cents,
          status: "sent",
        }),
      }).then((r) => r.json());
      if (!quote?.id) throw new Error("failed to create quote");

      // When polish lands (post-navigation is fine), patch the quote with
      // the refined fields. Errors are swallowed — the heuristic stands.
      void polishPromise.then((polished) => {
        if (!polished) return;
        return fetch(`/api/quotes/${quote.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            summary: polished.summary,
            jobName: polished.jobName,
            description: polished.description,
            lineItems: [
              {
                description: polished.summary,
                quantity: 1,
                unit: "ea",
                price: cents,
              },
            ],
          }),
        }).catch(() => {});
      });

      const conv = await fetch("/api/agents/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ quoteId: quote.id }),
      }).then((r) => r.json());
      if (!conv?.id) throw new Error("failed to start conversation");

      await fetch(`/api/agents/conversations/${conv.id}/transition-to-terms`, {
        method: "POST",
        credentials: "include",
      });

      globalThis.location.href = `/assistant/${conv.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't start");
      setSubmittedJobDetails(null);
      setSending(false);
    }
  }

  async function seedPhase2() {
    if (sending) return;
    setError(undefined);
    setSending(true);
    try {
      const quote = await fetch("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          summary: "Kitchen backsplash — 30 sqft",
          lineItems: [
            {
              description: "Backsplash tile install (30 sqft)",
              quantity: 1,
              unit: "ea",
              price: 120000,
            },
          ],
          estimatedTotal: 120000,
          status: "sent",
        }),
      }).then((r) => r.json());
      if (!quote?.id) throw new Error("seed: failed to create stub quote");

      const conv = await fetch("/api/agents/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ quoteId: quote.id }),
      }).then((r) => r.json());
      if (!conv?.id) throw new Error("seed: failed to start conversation");

      await fetch(`/api/agents/conversations/${conv.id}/transition-to-terms`, {
        method: "POST",
        credentials: "include",
      });

      globalThis.location.href = `/assistant/${conv.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "seed failed");
      setSending(false);
    }
  }

  /**
   * Click handler for the assistant's `continue_cta` cards. Two flavors:
   *   - toPhase = "terms" → fires POST transition-to-terms (the quote→
   *     wizard hand-off); the response brings the phase_divider + first
   *     wizard message.
   *   - toPhase = "send"  → wizard is complete; for now we just surface
   *     a confirmation since the send-to-client UI is out of scope.
   * The CTA is removed client-side after click so the user can't fire it
   * twice while the request is in flight.
   */
  async function submitContinueCta(
    message: Message,
    kind?: "business" | "person",
  ) {
    if (sending) return;
    const payload = (message.payload ?? {}) as {
      toPhase?: string;
      contractId?: string;
    };
    if (payload.toPhase === "terms") {
      if (!convoId) return;
      // Stash the kind picked on the CTA so CustomerStepPanel can skip its
      // own kind picker. Cleared when the panel consumes it.
      if (kind) setPrecommittedKind(kind);
      setError(undefined);
      setSending(true);
      // Optimistically drop the CTA so it doesn't linger after the click.
      setMessages((m) => m.filter((x) => x.id !== message.id));
      try {
        const res = (await assistantClient.transitionToTerms(convoId)) as {
          conversation?: { id: string };
          newMessages?: Message[];
        };
        if (Array.isArray(res.newMessages) && res.newMessages.length > 0) {
          setMessages((m) => [...m, ...res.newMessages!]);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "couldn't advance to terms",
        );
        // Restore the CTA so the user can retry.
        setMessages((m) => [...m, message]);
      } finally {
        setSending(false);
      }
      return;
    }
    if (payload.toPhase === "send") {
      // Wizard is complete — open the inline preview card so the user can
      // look the contract over before sending. Hydrate contract+customer
      // state if we don't already have them (mid-session wizard runs land
      // here without page-load contract data).
      const contractId = payload.contractId ?? contract?.id;
      if (!convoId || !contractId) {
        setError("contract is not ready yet");
        return;
      }
      if (!contract || contract.id !== contractId || !customer) {
        setError(undefined);
        setSending(true);
        try {
          const detail = await assistantClient.conversation(convoId);
          if (detail.contract) setContract(detail.contract);
          if (detail.customer) setCustomer(detail.customer);
          const qId =
            (detail.conversation as { quoteId?: string } | undefined)
              ?.quoteId ??
            (detail.contract as { quoteId?: string } | undefined)?.quoteId;
          if (qId) setQuoteId(qId);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "couldn't load the contract",
          );
          return;
        } finally {
          setSending(false);
        }
      }
      setPreviewCtaId(message.id);
      return;
    }
    if (payload.toPhase === "invoice") {
      // Closing handoff: contract is signed, draft + send the invoice.
      // SendInvoice is idempotent server-side, so a double-click just
      // re-renders the same action_card. The CTA stays in the chat
      // history (don't drop it) so the user has a record of the click.
      if (!convoId) return;
      setError(undefined);
      setSending(true);
      try {
        const res = await assistantClient.sendInvoice(convoId);
        setReviewedCtas((prev) => {
          const next = new Set(prev);
          next.add(message.id);
          return next;
        });
        if (res.newMessages?.length) {
          setMessages((m) => [...m, ...res.newMessages]);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "couldn't send the invoice",
        );
      } finally {
        setSending(false);
      }
    }
  }

  /**
   * Dev-only: flip the contract to "accepted" via AcceptContract — the
   * single customer-facing acceptance event in the chain. The server
   * appends a phase_divider ("Contract accepted by client") + a
   * "Continue to invoice" CTA, sets hasUnreadEvent, and bumps preview;
   * we splice those into the chat in-place so the user can see the
   * progression without a navigation jump.
   */
  async function simulateCustomerAccept(contractId: string | undefined) {
    if (sending || !convoId || !contractId) return;
    setError(undefined);
    setSending(true);
    try {
      const res = await assistantClient.acceptContract(convoId, contractId);
      if (res.newMessages?.length) {
        setMessages((m) => [...m, ...res.newMessages]);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "couldn't simulate acceptance",
      );
    } finally {
      setSending(false);
    }
  }

  /**
   * Save inline-typed customer email/phone to the customer profile,
   * then re-fire SendContract on the same channel so the doc actually
   * reaches the client. Used by the recovery form rendered below a
   * delivery-failure phase_divider.
   */
  async function saveContactAndRetry(
    dividerId: string,
    args: { contractId: string; channel: "email" | "sms" | "both" },
  ) {
    if (!convoId || !customer?.id) return;
    const draft = recoveryDraft[dividerId] ?? {};
    const email = draft.email?.trim();
    const phone = draft.phone?.trim();
    if (!email && !phone) return;

    setRecoverySavingId(dividerId);
    setError(undefined);
    try {
      const patch: { email?: string; phoneNumber?: string } = {};
      if (email) patch.email = email;
      if (phone) patch.phoneNumber = phone;
      const updated = await clientsClient.update(customer.id, patch);
      setCustomer((c) => (c ? { ...c, ...patch } as typeof c : c));
      // Local optimistic patch for downstream renders that read the
      // customer block straight off our state (the assistant header,
      // the quote-review hero, etc.). We still trust the server row
      // for canonical values via updated.
      void updated;
      const res = await assistantClient.sendContract(convoId, args.contractId, args.channel);
      if (res.newMessages?.length) {
        setMessages((m) => [...m, ...res.newMessages]);
      }
      setRecoveryDraft((prev) => {
        const next = { ...prev };
        delete next[dividerId];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't save & resend");
    } finally {
      setRecoverySavingId(null);
    }
  }

  /**
   * Fire the post-wizard "Ready to send" CTA: dispatches the assembled
   * contract to the customer via the SendContract coordinator on the
   * requested channel (text, email, or both). Idempotent server-side
   * (re-clicks redeliver), so flipping local state optimistically is safe.
   */
  async function confirmSendContract(
    message: Message,
    channel: "email" | "sms" | "both" = "email",
  ) {
    if (sending || !convoId) return;
    const payload = (message.payload ?? {}) as { contractId?: string };
    let id = payload.contractId ?? contract?.id;
    setError(undefined);
    setSending(true);
    try {
      if (!id) {
        const detail = await assistantClient.conversation(convoId);
        id =
          detail.contract?.id ??
          (detail.conversation as { contractId?: string } | undefined)
            ?.contractId;
        if (detail.contract) setContract(detail.contract);
      }
      if (!id) throw new Error("no contract bound to this conversation");
      const res = await assistantClient.sendContract(convoId, id, channel);
      setReviewedCtas((prev) => {
        const next = new Set(prev);
        next.add(message.id);
        return next;
      });
      setContract((c) => (c ? { ...c, status: "sent" } : c));
      setPreviewCtaId(null);
      if (res.newMessages?.length) {
        setMessages((m) => [...m, ...res.newMessages]);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "couldn't send the contract",
      );
    } finally {
      setSending(false);
    }
  }

  // Inline-edit handlers for the quote-review preview. Each one fetches
  // the canonical record (the action_card payload only carries display
  // shape, not the full LineItemDto / ContractTerm), splices the field,
  // and PUTs the merged record back. Failure: revert the DOM by setting
  // textContent on the contentEditable element.
  async function onEditLineDesc(
    quoteId: string,
    lineIdx: number,
    original: string,
    el: HTMLElement,
  ) {
    const next = (el.innerText ?? "").trim();
    if (!quoteId || next === original.trim()) return;
    if (!next) {
      el.innerText = original;
      return;
    }
    try {
      const q = await quotesClient.get(quoteId);
      const items = Array.isArray(q.lineItems) ? [...q.lineItems] : [];
      if (!items[lineIdx]) throw new Error("line item index out of range");
      items[lineIdx] = { ...items[lineIdx], description: next };
      await quotesClient.update(quoteId, { lineItems: items });
    } catch (err) {
      el.innerText = original;
      setError(err instanceof Error ? err.message : "couldn't save edit");
    }
  }

  /**
   * Save an inline edit to a line-item amount. The user types a money
   * value into the `.quote-review__line-amt` span (we treat free text:
   * "$1,500", "1500.00", "1500" — all parse to 1500 dollars). On blur:
   *   - parse → cents; bail if invalid (revert)
   *   - PATCH the quote with the new price (in dollars, matching the
   *     existing API contract used by `seedPhase2`)
   *   - optimistically replace the action_card payload in local
   *     messages state so the Total Due (which reads from
   *     `lockedPayload.totalCents`) recalculates without a refresh
   */
  async function onEditLineAmount(
    quoteId: string,
    actionCardId: string,
    lineIdx: number,
    originalCents: number,
    el: HTMLElement,
  ) {
    const cleaned = (el.innerText ?? "").replace(/[^\d.]/g, "");
    const dollars = parseFloat(cleaned);
    if (!Number.isFinite(dollars) || dollars < 0) {
      el.innerText = fmtUSD(originalCents);
      return;
    }
    const nextCents = Math.round(dollars * 100);
    if (nextCents === originalCents) {
      el.innerText = fmtUSD(originalCents); // re-format so trailing junk is cleaned
      return;
    }
    try {
      const q = await quotesClient.get(quoteId);
      const items = Array.isArray(q.lineItems) ? [...q.lineItems] : [];
      if (!items[lineIdx]) throw new Error("line item index out of range");
      // Per LineItemDto / UpdateQuoteDto in paperwork/dto/quote.ts, both
      // `price` and `estimatedTotal` are INTEGER CENTS (audit1 #3 migration).
      items[lineIdx] = { ...items[lineIdx], price: nextCents };
      const newTotalCents = items.reduce(
        (s: number, it: { price?: number; quantity?: number }) =>
          s + (Number(it.price) || 0) * (Number(it.quantity) || 1),
        0,
      );
      await quotesClient.update(quoteId, {
        lineItems: items,
        estimatedTotal: newTotalCents,
      });
      // Reformat to canonical display (commas + cents) after save.
      el.innerText = fmtUSD(nextCents);
      // Optimistic patch: rewrite the matching action_card payload so
      // the preview's lineItems + totalCents reflect the new value
      // immediately. Other action_cards are untouched.
      setMessages((msgs) =>
        msgs.map((m) => {
          if (m.id !== actionCardId) return m;
          const p = (m.payload ?? {}) as ActionCardPayload;
          const li = Array.isArray(p.lineItems) ? [...p.lineItems] : [];
          if (li[lineIdx]) {
            li[lineIdx] = { ...li[lineIdx], amountCents: nextCents };
          }
          const recomputed = li.reduce((s, it) => s + (it.amountCents ?? 0), 0);
          return {
            ...m,
            payload: {
              ...p,
              lineItems: li,
              totalCents: recomputed,
            },
          };
        }),
      );
    } catch (err) {
      el.innerText = fmtUSD(originalCents);
      setError(err instanceof Error ? err.message : "couldn't save edit");
    }
  }

  /**
   * Save an inline edit to the grand total. The user types a money value
   * into the `.quote-review__total-amt` span; strip non-numeric chars and
   * convert to cents. Persistence:
   *   - PUT /quotes/:id  — `estimatedTotal` so the canonical record matches
   *   - PUT /contracts/:id (when a contract exists) — `totalAmount` is what
   *     the preview reads from (`totalCentsForBreakdown`), so updating it
   *     refreshes the displayed total + recomputes payment milestones.
   *   - When no contract is bound, patch the action_card payload's
   *     `totalCents` so the on-screen total reflects the edit.
   * Line items are NOT touched — the Subtotal row keeps showing the line
   * sum so the user sees the override delta.
   */
  async function onEditTotal(
    quoteId: string | undefined,
    actionCardId: string | undefined,
    contractId: string | undefined,
    originalCents: number,
    el: HTMLElement,
  ) {
    const cleaned = (el.innerText ?? "").replace(/[^\d.]/g, "");
    const dollars = parseFloat(cleaned);
    const fmtPlain = (cents: number) =>
      (cents / 100).toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
    if (!Number.isFinite(dollars) || dollars < 0) {
      el.innerText = fmtPlain(originalCents);
      return;
    }
    const nextCents = Math.round(dollars * 100);
    if (nextCents === originalCents) {
      el.innerText = fmtPlain(originalCents);
      return;
    }
    if (!quoteId) {
      el.innerText = fmtPlain(originalCents);
      return;
    }
    try {
      await quotesClient.update(quoteId, { estimatedTotal: nextCents });
      if (contractId) {
        await contractsClient.update(contractId, { totalAmount: nextCents });
        setContract((cur) =>
          cur ? ({ ...cur, totalAmount: nextCents } as typeof cur) : cur,
        );
      } else if (actionCardId) {
        setMessages((msgs) =>
          msgs.map((m) => {
            if (m.id !== actionCardId) return m;
            const p = (m.payload ?? {}) as ActionCardPayload;
            return { ...m, payload: { ...p, totalCents: nextCents } };
          }),
        );
      }
      el.innerText = fmtPlain(nextCents);
    } catch (err) {
      el.innerText = fmtPlain(originalCents);
      setError(err instanceof Error ? err.message : "couldn't save edit");
    }
  }

  async function onEditCustomerName(
    customerId: string | undefined,
    original: string,
    el: HTMLElement,
  ) {
    const next = (el.innerText ?? "").trim();
    if (!customerId || next === original.trim()) return;
    if (!next) {
      el.innerText = original;
      return;
    }
    try {
      await clientsClient.update(customerId, { name: next });
      setCustomer((c) => (c ? { ...c, name: next } : c));
    } catch (err) {
      el.innerText = original;
      setError(err instanceof Error ? err.message : "couldn't save edit");
    }
  }

  // Pick a new option for an already-answered wizard term. Patches the
  // contract's terms[] entry by stepId and PUTs the contract — does NOT
  // rewind the wizard state. The chat-history wizard answer message stays
  // as-is (historical record); the contract reflects the latest pick and
  // the preview reads from contract.terms going forward.
  async function pickTermOption(
    contractId: string | undefined,
    stepId: string,
    label: string,
    optionLabel: string,
  ) {
    if (!contractId) return;
    setEditingTermStepId(null);
    try {
      const c = await contractsClient.get(contractId);
      const existing = Array.isArray(c.terms)
        ? [...(c.terms as { stepId: string; label: string; value: string }[])]
        : [];
      const idx = existing.findIndex((t) => t.stepId === stepId);
      const nextTerm = { stepId, label, value: optionLabel };
      const terms =
        idx === -1
          ? [...existing, nextTerm]
          : existing.map((t, i) => (i === idx ? nextTerm : t));
      await contractsClient.update(contractId, { terms });
      // Reflect the pick on local contract state so the preview re-renders
      // without a reload. Don't append a synthetic chat message — that
      // would render as an out-of-order "Payment terms: 50/50 ✓" log
      // *after* the Contract sent CTA, which looks like a bug.
      setContract((cur) => (cur ? ({ ...cur, terms } as typeof cur) : cur));
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't save edit");
    }
  }

  /**
   * Click handler for an action_card's "Lock it in" button. Goes
   * directly to the dedicated /lock-quote endpoint instead of round-
   * tripping through the LLM (which sometimes drafts another quote
   * when asked to lock). Idempotent server-side, so a double-click
   * just re-renders the locked state.
   */
  async function lockActionCard(message: Message, payload: ActionCardPayload) {
    if (sending || !convoId || !payload.quoteId) return;
    setError(undefined);
    setSending(true);
    try {
      const res = await assistantClient.lockQuote(convoId, payload.quoteId);
      // Drop the just-clicked draft card and any stale chat-driven
      // "Drafting a quote." text bubble that followed it; append the
      // server's authoritative locked card + continue_cta.
      setMessages((m) => {
        const idx = m.findIndex((x) => x.id === message.id);
        const filtered = idx >= 0 ? m.slice(0, idx) : m;
        return [...filtered, ...res.newMessages];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't lock the quote");
    } finally {
      setSending(false);
    }
  }

  /**
   * Submit one wizard pick. The backend advances to the next step (or
   * fires the "Ready to send" CTA when all 10 are answered) and returns
   * the new messages — we drop the just-answered wizard message and the
   * CTA chips, then append the server's reply.
   *
   * For options flagged isCustom we prompt for the free-text value;
   * cancelling the prompt is a no-op (don't fire a half-formed answer).
   * The customer step bypasses this path entirely — it has its own
   * inline panel via submitCustomerStep().
   */
  async function submitWizardAnswer(message: Message, opt: WizardOption) {
    if (sending || !convoId) return;
    const stepId = (message.payload as { stepId?: string } | undefined)?.stepId;
    if (!stepId) return;
    let customValue: string | undefined;
    if (opt.isCustom) {
      // deno-lint-ignore no-alert
      const v = prompt(`${opt.label}:`);
      if (!v || !v.trim()) return;
      customValue = v.trim();
    }
    await postWizardAnswer(message, {
      stepId,
      optionId: opt.id,
      ...(customValue !== undefined ? { customValue } : {}),
    });
  }

  /**
   * Customer-step submitter shared by the inline panel's three branches:
   *   - "use_active"    → no extras (server uses conv.customerId).
   *   - "pick_existing" → { customer: { id } }.
   *   - "create_new"    → { customer: { create: { name, email?, phoneNumber? } } }.
   *
   * On success the response carries the server's user-pick bubble
   * (already namespaced with the resolved customer name) plus the next
   * wizard step. We update local `customer` from the conversation patch
   * so the rest of the UI knows who's bound.
   */
  async function submitCustomerStep(
    message: Message,
    optionId: "use_active" | "pick_existing" | "create_new",
    payload?: {
      customer?: {
        id?: string;
        create?: {
          name: string;
          email?: string;
          phoneNumber?: string;
          isBusiness?: boolean;
        };
      };
    },
  ) {
    await postWizardAnswer(message, {
      stepId: "customer",
      optionId,
      ...(payload ?? {}),
    });
  }

  /** Shared post-and-replace flow for any wizard answer. */
  async function postWizardAnswer(
    message: Message,
    body: {
      stepId: string;
      optionId: string;
      customValue?: string;
      customer?: {
        id?: string;
        create?: {
          name: string;
          email?: string;
          phoneNumber?: string;
          isBusiness?: boolean;
        };
      };
      followUpValues?: Record<string, string | number>;
    },
  ) {
    if (sending || !convoId) return;
    setError(undefined);
    setSending(true);
    setMessages((m) => m.filter((x) => x.id !== message.id));
    try {
      const res = await assistantClient.answerWizard({
        conversationId: convoId,
        ...body,
      });
      // Pick up the freshly-bound customer from the conversation patch
      // (the create_new and pick_existing flows mutate conv.customerId).
      if (res.conversation && typeof res.conversation === "object") {
        const newCustomerId = (res.conversation as { customerId?: string })
          .customerId;
        if (newCustomerId && newCustomerId !== customer?.id) {
          // We don't always have the full customer object (the server
          // only returns conv.customerId). For "create_new" we can
          // reconstruct from the body.
          if (body.customer?.create) {
            setCustomer({
              id: newCustomerId,
              name: body.customer.create.name,
              email: body.customer.create.email,
              phoneNumber: body.customer.create.phoneNumber,
            });
          }
          // For "pick_existing" the customer name is on the user-pick
          // bubble's content; the picker also passes us the full object,
          // but we'll let the next route reload settle the canonical
          // record.
        }
      }
      if (Array.isArray(res.newMessages) && res.newMessages.length > 0) {
        setMessages((m) => [...m, ...res.newMessages]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "wizard answer failed");
      setMessages((m) => [...m, message]);
    } finally {
      setSending(false);
    }
  }

  /** Tear down everything the recording path opened: MediaRecorder, the
   *  AssemblyAI WS, the audio-level RAF loop, the elapsed timer, and the
   *  mic stream's tracks. Safe to call multiple times. */
  function teardownRecording() {
    if (recTickRef.current) {
      clearInterval(recTickRef.current);
      recTickRef.current = null;
    }
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    try {
      (sttSocketRef.current as WebSocket | null)?.close();
    } catch {
      /* ignore */
    }
    sttSocketRef.current = null;
    try {
      sttProcessorRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    sttProcessorRef.current = null;
    try {
      sttSourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    sttSourceRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
    setAudioLevel(0);
  }

  /** Open the WebSocket to our Fresh SSR proxy (`/api/voice/stream`).
   *  The proxy bridges to AssemblyAI's v3 streaming endpoint with the
   *  API key kept server-side. Resolves once the upstream sends `Begin`
   *  (i.e. the session is hot and ready for audio). */
  function openSttSocket(sampleRate: number): Promise<WebSocket | null> {
    return new Promise((resolve) => {
      try {
        const proto = globalThis.location.protocol === "https:" ? "wss" : "ws";
        const url = `${proto}://${globalThis.location.host}/api/voice/stream?sample_rate=${sampleRate}`;
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        let begun = false;
        ws.onopen = () => {
          /* wait for Begin frame from AAI */
        };
        ws.onmessage = (e) => {
          if (typeof e.data !== "string") return;
          try {
            const msg = JSON.parse(e.data);
            // AssemblyAI v3 message types: Begin / Turn / Termination / error
            if (msg.type === "Begin") {
              begun = true;
              resolve(ws);
              return;
            }
            if (msg.type === "Turn") {
              const transcript: string = msg.transcript ?? "";
              if (msg.end_of_turn) {
                finalSoFarRef.current = (
                  finalSoFarRef.current +
                  " " +
                  transcript
                ).trim();
                setLiveFinal(finalSoFarRef.current);
                setLiveInterim("");
              } else {
                setLiveInterim(transcript.trim());
              }
              return;
            }
            if (msg.type === "Termination") {
              // session over — caller will close
              return;
            }
            if (msg.error || msg.type === "error") {
              setError(
                typeof msg.error === "string"
                  ? msg.error
                  : "voice stream error",
              );
            }
          } catch {
            /* non-JSON frame, ignore */
          }
        };
        ws.onerror = () => {
          if (!begun) {
            // The upstream / proxy never came up — resolve null so the
            // caller can fall back to backend-only transcription.
            resolve(null);
          } else {
            setError("voice stream interrupted");
          }
        };
        ws.onclose = () => {
          if (!begun) resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  }

  /** Drive `audioLevel` from a tap on the same source feeding the STT
   *  socket. Smoothed asymmetrically so the bars feel alive. */
  function startLevelMeter(
    ctx: AudioContext,
    source: MediaStreamAudioSourceNode,
  ) {
    try {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.fftSize);
      let easedLevel = 0;
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const target = Math.min(1, rms * 2.4);
        easedLevel =
          target > easedLevel
            ? easedLevel + (target - easedLevel) * 0.45
            : easedLevel + (target - easedLevel) * 0.1;
        setAudioLevel(easedLevel);
        levelRafRef.current = requestAnimationFrame(tick);
      };
      levelRafRef.current = requestAnimationFrame(tick);
    } catch {
      /* visualizer is decorative */
    }
  }

  /** Cancel an in-flight recording without sending. */
  function cancelRecord() {
    recChunksRef.current = [];
    try {
      recorderRef.current?.stop();
    } catch {
      /* idempotent */
    }
    recorderRef.current = null;
    teardownRecording();
    setRecording(false);
    setLiveInterim("");
    setLiveFinal("");
    finalSoFarRef.current = "";
  }

  async function toggleRecord() {
    if (recording) {
      // Tap-to-stop: finalise the STT socket, then stop MediaRecorder.
      // The MediaRecorder onstop handler reads the accumulated transcript
      // and submits the turn.
      try {
        (sttSocketRef.current as WebSocket | null)?.send(
          JSON.stringify({ type: "Terminate" }),
        );
      } catch {
        /* ignore */
      }
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("microphone not available in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      recStreamRef.current = stream;

      // 1) MediaRecorder for the authoritative blob (still uploaded to
      //    /files on stop so the backend's chat handler has the audio
      //    for archive / re-transcription / training).
      const rec = new MediaRecorder(stream);
      recChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const elapsed = Math.max(
          1,
          Math.round((Date.now() - recStartRef.current) / 1000),
        );
        const chunks = recChunksRef.current;
        const transcript = (
          finalSoFarRef.current.trim() || liveInterim.trim()
        ).trim();
        teardownRecording();
        setRecording(false);
        setLiveInterim("");
        setLiveFinal("");
        finalSoFarRef.current = "";
        if (chunks.length === 0) return;
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        sendVoice(blob, elapsed, transcript || undefined);
      };
      rec.start();
      recorderRef.current = rec;

      // 2) AudioContext + ScriptProcessor → AssemblyAI streaming WS.
      const Ctx =
        (
          globalThis as unknown as {
            AudioContext?: new () => AudioContext;
            webkitAudioContext?: new () => AudioContext;
          }
        ).AudioContext ??
        (
          globalThis as unknown as {
            webkitAudioContext?: new () => AudioContext;
          }
        ).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        sttSourceRef.current = source;
        startLevelMeter(ctx, source);

        // Open WS first so we don't drop the first 100ms of audio
        // waiting for the upstream Begin.
        const sampleRate = ctx.sampleRate; // typically 48000
        const ws = await openSttSocket(sampleRate);
        sttSocketRef.current = ws;

        if (ws) {
          // ScriptProcessorNode is deprecated but universally supported
          // and exactly what we need: a callback every N samples that we
          // can repackage as Int16 PCM and ship to the WS. AudioWorklet
          // would be cleaner but requires a separate worklet module file
          // and adds setup complexity for marginal gain.
          // deno-lint-ignore deprecation
          const proc = ctx.createScriptProcessor(4096, 1, 1);
          sttProcessorRef.current = proc;
          proc.onaudioprocess = (ev) => {
            const ws = sttSocketRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            const input = ev.inputBuffer.getChannelData(0);
            const pcm = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
              const s = Math.max(-1, Math.min(1, input[i]));
              pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            try {
              ws.send(pcm.buffer);
            } catch {
              /* WS may have closed */
            }
          };
          source.connect(proc);
          // Sink to a muted gain so the processor stays alive without
          // playing back through the user's speakers (echo loop).
          const sink = ctx.createGain();
          sink.gain.value = 0;
          proc.connect(sink);
          sink.connect(ctx.destination);
        }
      }

      recStartRef.current = Date.now();
      setRecElapsed(0);
      setLiveInterim("");
      setLiveFinal("");
      finalSoFarRef.current = "";
      setRecording(true);
      recTickRef.current = globalThis.setInterval(() => {
        setRecElapsed(Math.round((Date.now() - recStartRef.current) / 1000));
      }, 250) as unknown as number;
    } catch {
      setError("microphone permission denied");
      teardownRecording();
    }
  }

  const empty = messages.length === 0;

  return (
    <>
      <div class="chat__scroll" ref={scrollRef}>
        {empty ? (
          <div class="chat__empty">
            {!priceCaptureOpen && !awaitingJobDetails && (
              <>
                <div class="chat__empty-icon">
                  <img src="/logo-monster.png" alt="" />
                </div>
                <h3 class="chat__empty-title">
                  Click on a box or the text field below to get started!
                </h3>
              </>
            )}
            {awaitingJobDetails ? (
              <div class="chat__details-flow">
                <div class="chat__details-prompt">
                  <div class="chat__details-prompt-avatar">
                    <img src="/logo-monster.png" alt="" />
                  </div>
                  <div class="chat__details-prompt-bubble">
                    <strong>Okay great</strong> — tell me the job details.
                    <span class="chat__details-prompt-hint">
                      Type below. I'll clean it up so it reads sharp on the quote.
                    </span>
                  </div>
                </div>
                {submittedJobDetails ? (
                  <>
                    <div class="chat__details-user">
                      <div class="chat__details-user-bubble">
                        {submittedJobDetails}
                      </div>
                    </div>
                    <div class="chat__details-prompt">
                      <div class="chat__details-prompt-avatar">
                        <img src="/logo-monster.png" alt="" />
                      </div>
                      <div class="chat__details-prompt-bubble chat__details-prompt-bubble--working">
                        <span class="chat__details-dots" aria-hidden="true">
                          <span></span><span></span><span></span>
                        </span>
                        Polishing your job details…
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            ) : priceCaptureOpen ? (
              <div class="chat__price-capture">
                <div class="chat__price-capture-head">
                  <button
                    type="button"
                    class="chat__price-back"
                    onClick={() => {
                      setPriceCaptureOpen(false);
                      setPriceCents(null);
                    }}
                    aria-label="Back to prompts"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <path
                        d="M10 3L5 8l5 5"
                        stroke="currentColor"
                        stroke-width="2.2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        fill="none"
                      />
                    </svg>
                    Back
                  </button>
                  <h4 class="chat__price-title">What's the price?</h4>
                  <p class="chat__price-sub">
                    I'll build the job details around it.
                  </p>
                </div>
                <MoneyInput onChange={setPriceCents} />
                <button
                  type="button"
                  class="chat__price-continue"
                  disabled={(priceCents ?? 0) <= 0 || sending}
                  onClick={() => onPriceContinue(priceCents!)}
                >
                  {sending ? "Setting up…" : "Continue →"}
                </button>
              </div>
            ) : (
              <div class="chat__empty-prompts">
                <button
                  type="button"
                  class="chat__empty-prompt"
                  onClick={() => {
                    // Inverted flow: ask for job details FIRST, then price.
                    // submitJobDetails will detect the missing price and
                    // open the price-capture screen after stashing the raw.
                    setPendingJobDetailsRaw(null);
                    setAwaitingJobDetails(true);
                  }}
                >
                  I know my price, write it up.
                </button>
                <button
                  type="button"
                  class="chat__empty-prompt"
                  onClick={() => sendText("I know the job, help me price it.")}
                >
                  I know the job, help me price it.
                </button>
                <button
                  type="button"
                  class="chat__empty-prompt"
                  onClick={() => sendText("Just give me a quick quote.")}
                >
                  Just give me a quick quote.
                </button>
              </div>
            )}
            {typeof globalThis.location !== "undefined" &&
            globalThis.location.hostname === "localhost" &&
            new URLSearchParams(globalThis.location.search).has("dev") ? (
              <div class="chat__empty-debug">
                <button
                  type="button"
                  class="chat__empty-debug-btn"
                  onClick={seedPhase2}
                  disabled={sending}
                  title="Quote → lock → transition → answer config. Lands on the customer step."
                >
                  🔧 {sending ? "Seeding…" : "Seed phase 2 wizard"}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          (() => {
            // Phase-2 density: collapse any wizard card whose stepId has
            // already been answered (the answer log carries that info as
            // `text` messages with `payload.wizardStepId`). Among the
            // remaining unanswered wizards, only the most-recent one stays
            // visible so the active step always sits at the bottom.
            // Earlier logic only kept the latest wizard regardless of
            // answer state, which left the very first card stuck on screen
            // when the user re-opened a thread mid-flow.
            const answeredStepIds = new Set<string>();
            for (const x of messages) {
              const sid = (x.payload as { wizardStepId?: string } | undefined)
                ?.wizardStepId;
              if (x.kind === "text" && sid) answeredStepIds.add(sid);
            }
            let activeWizardId: string | undefined;
            for (let i = messages.length - 1; i >= 0; i--) {
              const m = messages[i];
              if (m.kind !== "wizard") continue;
              const stepId = (m.payload as { stepId?: string } | undefined)
                ?.stepId;
              if (!stepId || !answeredStepIds.has(stepId)) {
                activeWizardId = m.id;
                break;
              }
            }
            const visible = messages.filter((m) => {
              if (m.kind !== "wizard") return true;
              const stepId = (m.payload as { stepId?: string } | undefined)
                ?.stepId;
              if (stepId && answeredStepIds.has(stepId)) return false;
              return m.id === activeWizardId;
            });
            // The recovery form should appear ONLY on the most recent
            // failure-divider — otherwise older failures duplicate the
            // form everywhere and clutter the thread.
            let lastRecoveryDividerId: string | undefined;
            for (let i = visible.length - 1; i >= 0; i--) {
              const cand = visible[i];
              if (cand.kind !== "phase_divider") continue;
              const cp = (cand.payload ?? {}) as {
                contractId?: string;
                emailedTo?: string;
                textedTo?: string;
                emailFailureReason?: string;
                smsFailureReason?: string;
              };
              if (!cp.contractId) continue;
              const eMissing = !cp.emailedTo && !!cp.emailFailureReason && !customer?.email;
              const pMissing = !cp.textedTo && !!cp.smsFailureReason &&
                (!customer?.phoneNumber || /Invalid|21211/i.test(cp.smsFailureReason ?? ""));
              if (eMissing || pMissing) {
                lastRecoveryDividerId = cand.id;
                break;
              }
            }
            return visible.map((m) => {
              const wizardStepId = (
                m.payload as { wizardStepId?: string } | undefined
              )?.wizardStepId;
              if (m.role === "user" && wizardStepId) {
                // Compact pick log — one line, no avatar, no bubble.
                // Real SVG check (not the unstyled ✓ glyph) so it scales
                // with line-height and gets brand color + a circular pip.
                return (
                  <div
                    key={m.id}
                    class="wiz-log"
                    style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:14px;color:var(--fg,#1c2c30);line-height:1.45"
                  >
                    <span
                      class="wiz-log__check"
                      aria-hidden="true"
                      style="flex:0 0 auto;width:18px;height:18px;border-radius:50%;background:var(--brand-green,#519843);color:#fff;display:inline-flex;align-items:center;justify-content:center"
                    >
                      <I d={ICN.check} size={11} sw={3} />
                    </span>
                    <span class="wiz-log__text">{m.content}</span>
                  </div>
                );
              }
              // Phase divider — full-width separator with a label, no avatar/bubble.
              if (m.kind === "phase_divider") {
                const dp = (m.payload ?? {}) as {
                  label?: string;
                  contractId?: string;
                  channel?: "email" | "sms" | "both";
                  emailedTo?: string;
                  textedTo?: string;
                  emailFailureReason?: string;
                  smsFailureReason?: string;
                };
                const label = dp.label ?? m.content;
                // Show the recovery form when this divider belongs to a
                // send-contract attempt that failed (or partially failed)
                // due to missing/invalid contact info, AND we still have
                // a customer bound (we need a row to patch).
                // Channel may be missing on older threads (pre-channel-
                // routing dividers). Infer from which failure reason is
                // present so the recovery UI still shows up.
                const inferredChannel: "email" | "sms" | "both" | undefined =
                  dp.channel ??
                  (dp.emailFailureReason && dp.smsFailureReason
                    ? "both"
                    : dp.smsFailureReason
                    ? "sms"
                    : dp.emailFailureReason
                    ? "email"
                    : undefined);
                const emailMissing = !dp.emailedTo && !!dp.emailFailureReason &&
                  !customer?.email;
                const phoneMissing = !dp.textedTo && !!dp.smsFailureReason &&
                  (!customer?.phoneNumber || /Invalid|21211/i.test(dp.smsFailureReason));
                const needRecovery =
                  !!dp.contractId && !!customer?.id && !!inferredChannel &&
                  (emailMissing || phoneMissing) &&
                  m.id === lastRecoveryDividerId;
                const draft = recoveryDraft[m.id] ?? {};
                const saving = recoverySavingId === m.id;
                const askEmail = needRecovery && emailMissing;
                const askPhone = needRecovery && phoneMissing;
                return (
                  <div key={m.id}>
                    <div class="phase-divider">
                      <div class="phase-divider__line" />
                      <div class="phase-divider__label">
                        <I d={ICN.contract} size={11} /> {label}
                      </div>
                      <div class="phase-divider__line" />
                    </div>
                    {needRecovery ? (
                      <div class="recovery-card">
                        <div class="recovery-card__head">
                          <strong>
                            {askEmail && askPhone
                              ? "Add their email & phone to deliver"
                              : askEmail
                              ? "Add their email to deliver"
                              : "Add their phone to deliver"}
                          </strong>
                          <span class="recovery-card__hint">
                            Saved to {customer?.name ?? "this customer"} for next time.
                          </span>
                        </div>
                        <div class="recovery-card__fields">
                          {askEmail ? (
                            <input
                              type="email"
                              class="recovery-card__input"
                              placeholder="customer@email.com"
                              value={draft.email ?? ""}
                              disabled={saving}
                              onInput={(e) => {
                                const v = (e.target as HTMLInputElement).value;
                                setRecoveryDraft((p) => ({ ...p, [m.id]: { ...p[m.id], email: v } }));
                              }}
                            />
                          ) : null}
                          {askPhone ? (
                            <input
                              type="tel"
                              class="recovery-card__input"
                              placeholder="(555) 555-5555"
                              value={draft.phone ?? ""}
                              disabled={saving}
                              onInput={(e) => {
                                const v = (e.target as HTMLInputElement).value;
                                setRecoveryDraft((p) => ({ ...p, [m.id]: { ...p[m.id], phone: v } }));
                              }}
                            />
                          ) : null}
                          <button
                            type="button"
                            class="recovery-card__save"
                            disabled={
                              saving ||
                              (!draft.email?.trim() && !draft.phone?.trim()) ||
                              (askEmail && !askPhone && !draft.email?.trim()) ||
                              (askPhone && !askEmail && !draft.phone?.trim())
                            }
                            onClick={() =>
                              saveContactAndRetry(m.id, {
                                contractId: dp.contractId!,
                                channel: inferredChannel ?? "email",
                              })
                            }
                          >
                            {saving ? "Saving…" : "Save & resend"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              }

              // Continue-CTA — clickable card that fires phase transition.
              // For toPhase=send (wizard complete), clicking the Review button
              // transitions the card itself into a calm "Drafted ✓" state
              // showing the contract id inline. No popup — the user gets a
              // visible acknowledgement that the action registered.
              if (m.kind === "continue_cta") {
                const payload = (m.payload ?? {}) as {
                  toPhase?: string;
                  summary?: string;
                  contractId?: string;
                };
                const reviewed =
                  (payload.toPhase === "send" ||
                    payload.toPhase === "invoice") &&
                  reviewedCtas.has(m.id);
                // Pull the actual delivery outcome from the phase_divider
                // the server emits AFTER this CTA fires. Falls back to the
                // local customer.email when no divider is in scope yet
                // (older threads). Without this the banner can read
                // "no email on file" even when the dispatch actually
                // succeeded with a `to:` override.
                const ctaIdx = visible.indexOf(m);
                let dispatchedTo: string | undefined;
                let dispatchFailReason: string | undefined;
                if (reviewed && ctaIdx >= 0) {
                  for (let i = ctaIdx + 1; i < visible.length; i++) {
                    const next = visible[i];
                    if (next.kind !== "phase_divider") continue;
                    const np = (next.payload ?? {}) as {
                      emailedTo?: string;
                      emailFailureReason?: string;
                    };
                    if (np.emailedTo || np.emailFailureReason) {
                      dispatchedTo = np.emailedTo;
                      dispatchFailReason = np.emailFailureReason;
                      break;
                    }
                  }
                }
                const sentRecipient =
                  dispatchedTo ?? (reviewed ? customer?.email : undefined);
                const previewing =
                  payload.toPhase === "send" && previewCtaId === m.id;
                if (previewing) {
                  const contractId = payload.contractId ?? contract?.id ?? "";
                  // Pull line items from the most recent locked/sent action_card
                  // (status="sent" is the locked quote; fall back to "draft").
                  const lockedCard = [...messages]
                    .reverse()
                    .find(
                      (x) =>
                        x.kind === "action_card" &&
                        ((x.payload as ActionCardPayload | undefined)
                          ?.status === "sent" ||
                          (x.payload as ActionCardPayload | undefined)
                            ?.status === "draft"),
                    );
                  const lockedPayload = (lockedCard?.payload ??
                    {}) as ActionCardPayload;
                  // Fall back to the fetched quote when no action_card
                  // is present (the "I know my price → job details" flow
                  // skips lock-quote and doesn't emit one).
                  const quoteLineItems = (quote?.lineItems ?? []).map((li) => ({
                    description: li.description,
                    amountCents: Math.round(
                      (li.price ?? 0) * (li.quantity ?? 1),
                    ),
                  }));
                  const lineItems = (lockedPayload.lineItems?.length
                    ? lockedPayload.lineItems
                    : quoteLineItems);
                  const lineTotalCents =
                    lockedPayload.totalCents ??
                    quote?.estimatedTotal ??
                    lineItems.reduce(
                      (sum, li) => sum + (li.amountCents ?? 0),
                      0,
                    );
                  const polishedDescription =
                    lockedPayload.description ?? quote?.description;
                  // Wizard terms — every text msg with a wizardStepId is one
                  // answered step ("Start: ASAP", "Wraps: 1 week", ...). Skip
                  // the customer step since we render the customer block below.
                  // Prefer contract.terms (the source of truth) when present.
                  // Fall back to a chronological walk over wizardStepId-tagged
                  // chat messages (older threads, in-flight wizard runs that
                  // haven't materialized a contract row yet). Either way, dedupe
                  // by stepId — a re-edit emits another tagged message but the
                  // term row should only render once.
                  const contractTerms = Array.isArray(contract?.terms)
                    ? (contract!.terms as {
                        stepId: string;
                        label: string;
                        value: string;
                      }[])
                    : null;
                  const termsByStep = new Map<
                    string,
                    {
                      stepId: string;
                      label: string;
                      value: string;
                      firstIdx: number;
                    }
                  >();
                  if (contractTerms && contractTerms.length > 0) {
                    contractTerms.forEach((t, i) => {
                      if (!t?.stepId || t.stepId === "customer") return;
                      termsByStep.set(t.stepId, {
                        stepId: t.stepId,
                        label: t.label,
                        value: t.value,
                        firstIdx: i,
                      });
                    });
                  } else {
                    for (let i = messages.length - 1; i >= 0; i--) {
                      const x = messages[i];
                      const p = x.payload as
                        | { wizardStepId?: string }
                        | undefined;
                      const sid = p?.wizardStepId;
                      if (x.kind !== "text" || !sid || sid === "customer")
                        continue;
                      if (termsByStep.has(sid)) continue;
                      const raw = x.content ?? "";
                      const colon = raw.indexOf(":");
                      const label =
                        colon === -1 ? raw : raw.slice(0, colon).trim();
                      const value =
                        colon === -1 ? "" : raw.slice(colon + 1).trim();
                      termsByStep.set(sid, {
                        stepId: sid,
                        label,
                        value,
                        firstIdx: i,
                      });
                    }
                  }
                  const termAnswers = Array.from(termsByStep.values())
                    .sort((a, b) => a.firstIdx - b.firstIdx)
                    // Drop warranty row entirely when the contractor picked
                    // "No warranty" — the legal-text warranty clause in the
                    // contract's Fine Print still applies.
                    .filter(({ stepId, value }) => {
                      if (stepId !== "warranty") return true;
                      const v = value.trim().toLowerCase();
                      return !(v === "" || v === "no warranty" || v === "none" || v === "n/a" || v === "no");
                    })
                    .map(({ stepId, label, value }) => ({
                      stepId,
                      label,
                      // Time-to-complete reads as an estimate, not a hard
                      // promise — surface that on the card to match the
                      // customer-facing wording.
                      value: stepId === "time_to_complete" && value && !/^estimated\s*:/i.test(value)
                        ? `Estimated: ${value}`
                        : value,
                    }));
                  const totalCentsForBreakdown =
                    typeof contract?.totalAmount === "number"
                      ? contract.totalAmount
                      : lineTotalCents;
                  const totalStr = (
                    totalCentsForBreakdown / 100
                  ).toLocaleString("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  });
                  // Translate the picked payment terms into a milestone schedule
                  // so the customer sees what they actually owe at each step,
                  // not one big number that hides the deposit / balance split.
                  const paymentTerm = termAnswers.find(
                    (t) => t.stepId === "payment_terms",
                  );
                  const milestones = paymentTerm
                    ? buildPaymentMilestones(
                        paymentTerm.value,
                        totalCentsForBreakdown,
                      )
                    : null;
                  return (
                    <div key={m.id} class="quote-review-wrap">
                      <article class="quote-review">
                        <header class="quote-review__head">
                          <div class="quote-review__head-left">
                            <div class="quote-review__kind">
                              Quote + Agreement
                            </div>
                            {contractId ? (
                              <div class="quote-review__num">
                                #{contractId.slice(0, 8)}
                              </div>
                            ) : null}
                          </div>
                          <div class="quote-review__head-right">
                            <span class="quote-review__chip">{statusChipLabel(lockedPayload.status)}</span>
                            <button
                              type="button"
                              class="quote-review__close"
                              aria-label="Close preview"
                              onClick={() => setPreviewCtaId(null)}
                              disabled={sending}
                            >
                              <I d={ICN.x} size={14} sw={2.4} />
                            </button>
                          </div>
                        </header>

                        {customer?.name ? (
                          <section class="quote-review__hero">
                            <div class="quote-review__hero-label">For</div>
                            <div
                              class="quote-review__hero-name quote-review__editable"
                              contentEditable
                              spellcheck={true}
                              lang="en"
                              onBlur={(e) =>
                                onEditCustomerName(
                                  customer.id,
                                  customer.name,
                                  e.currentTarget as HTMLElement,
                                )
                              }
                            >
                              {customer.name}
                            </div>
                            {customer.email || customer.phoneNumber ? (
                              <div class="quote-review__hero-meta">
                                {customer.email ? (
                                  <span>{customer.email}</span>
                                ) : null}
                                {customer.email && customer.phoneNumber ? (
                                  <span class="quote-review__dot">·</span>
                                ) : null}
                                {customer.phoneNumber ? (
                                  <span>{customer.phoneNumber}</span>
                                ) : null}
                              </div>
                            ) : null}
                          </section>
                        ) : null}

                        {lineItems.length > 0 ? (
                          <section class="quote-review__section">
                            <div class="quote-review__section-label">
                              What we'll do
                            </div>
                            <div class="quote-review__lines">
                              {lineItems.map((li, i) => (
                                <div key={`li-${i}`} class="quote-review__line">
                                  <span
                                    class="quote-review__line-desc quote-review__editable"
                                    contentEditable
                                    spellcheck={true}
                                    lang="en"
                                    onBlur={(e) => {
                                      const qid = lockedPayload.quoteId;
                                      if (qid)
                                        onEditLineDesc(
                                          qid,
                                          i,
                                          li.description,
                                          e.currentTarget as HTMLElement,
                                        );
                                    }}
                                  >
                                    {li.description}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </section>
                        ) : null}

                        {termAnswers.length > 0 ? (
                          <section class="quote-review__section">
                            <div class="quote-review__section-label">
                              Terms
                            </div>
                            <dl class="quote-review__terms">
                              {termAnswers.map((t, i) => {
                                // contractId from the parent scope defaults to "" via `?? ""`,
                                // so use || not ?? to fall back to contract.id when empty.
                                const cid = contractId || contract?.id;
                                const isEditing =
                                  editingTermStepId === t.stepId;
                                // Find the original wizard message for this stepId
                                // so we can re-render its options inline. Searching
                                // backwards picks up the most recent re-ask if the
                                // user has already edited this term once.
                                const wizMsg = isEditing
                                  ? [...messages]
                                      .reverse()
                                      .find(
                                        (x) =>
                                          x.kind === "wizard" &&
                                          (
                                            x.payload as
                                              | { stepId?: string }
                                              | undefined
                                          )?.stepId === t.stepId,
                                      )
                                  : undefined;
                                const wizOptsRaw =
                                  (
                                    wizMsg?.payload as
                                      | { options?: WizardOption[] }
                                      | undefined
                                  )?.options ?? [];
                                // Fall back to the static spec when the chat scope
                                // doesn't carry the options (older threads, pruned
                                // history, etc.). Otherwise the picker would render
                                // with only Custom + Cancel.
                                const wizOpts: WizardOption[] =
                                  wizOptsRaw.length > 0
                                    ? wizOptsRaw
                                    : (
                                        TERM_OPTIONS_FALLBACK[t.stepId] ?? []
                                      ).map((o, i) => ({
                                        id: `fallback-${i}`,
                                        label: o.label,
                                        sub: o.sub,
                                      }));
                                return (
                                  <div
                                    key={`t-${i}`}
                                    class="quote-review__term"
                                    style={
                                      isEditing
                                        ? "grid-column:1 / -1"
                                        : undefined
                                    }
                                  >
                                    <dt>{t.label}</dt>
                                    {isEditing ? (
                                      <dd style="margin-top:4px">
                                        {customTermDraft &&
                                        customTermDraft.stepId === t.stepId ? (
                                          <div style="display:flex;flex-direction:column;gap:8px">
                                            <input
                                              type="text"
                                              class="cust-pick__search"
                                              placeholder={`Type a custom ${t.label.toLowerCase()}…`}
                                              value={customTermDraft.value}
                                              onInput={(e) =>
                                                setCustomTermDraft({
                                                  stepId: t.stepId,
                                                  value: (
                                                    e.target as HTMLInputElement
                                                  ).value,
                                                })
                                              }
                                              autoFocus
                                              onKeyDown={(e) => {
                                                if (
                                                  e.key === "Enter" &&
                                                  customTermDraft.value.trim()
                                                ) {
                                                  const v =
                                                    customTermDraft.value.trim();
                                                  setCustomTermDraft(null);
                                                  pickTermOption(
                                                    cid,
                                                    t.stepId,
                                                    t.label,
                                                    v,
                                                  );
                                                } else if (e.key === "Escape") {
                                                  setCustomTermDraft(null);
                                                }
                                              }}
                                            />
                                            <div style="display:flex;gap:8px">
                                              <button
                                                type="button"
                                                class="cust-create__btn cust-create__btn--primary"
                                                disabled={
                                                  sending ||
                                                  !customTermDraft.value.trim()
                                                }
                                                onClick={() => {
                                                  const v =
                                                    customTermDraft.value.trim();
                                                  setCustomTermDraft(null);
                                                  pickTermOption(
                                                    cid,
                                                    t.stepId,
                                                    t.label,
                                                    v,
                                                  );
                                                }}
                                              >
                                                Save
                                              </button>
                                              <button
                                                type="button"
                                                class="cust-create__btn"
                                                onClick={() =>
                                                  setCustomTermDraft(null)
                                                }
                                                disabled={sending}
                                              >
                                                Back
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div
                                            class="wiz__opts"
                                            style="flex-direction:column;align-items:stretch;gap:6px"
                                          >
                                            {wizOpts
                                              .filter((o) => !o.isCustom)
                                              .map((opt) => (
                                                <button
                                                  key={opt.id}
                                                  type="button"
                                                  class={`wiz-opt ${opt.label === t.value ? "wiz-opt--selected" : ""}`}
                                                  onClick={() =>
                                                    pickTermOption(
                                                      cid,
                                                      t.stepId,
                                                      t.label,
                                                      opt.label,
                                                    )
                                                  }
                                                  disabled={sending}
                                                >
                                                  {opt.label}
                                                  {opt.sub ? (
                                                    <span class="wiz-opt__sub">
                                                      {opt.sub}
                                                    </span>
                                                  ) : null}
                                                </button>
                                              ))}
                                            <button
                                              type="button"
                                              class="wiz-opt wiz-opt--custom"
                                              onClick={() =>
                                                setCustomTermDraft({
                                                  stepId: t.stepId,
                                                  value: "",
                                                })
                                              }
                                              disabled={sending}
                                            >
                                              + Custom · type your own
                                            </button>
                                            <button
                                              type="button"
                                              class="wiz-opt wiz-opt--custom"
                                              onClick={() => {
                                                setEditingTermStepId(null);
                                                setCustomTermDraft(null);
                                              }}
                                              disabled={sending}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        )}
                                      </dd>
                                    ) : (
                                      <dd>
                                        <button
                                          type="button"
                                          class="quote-review__term-edit"
                                          onClick={() =>
                                            setEditingTermStepId(t.stepId)
                                          }
                                          disabled={!cid || !t.stepId}
                                          title="Edit"
                                        >
                                          {t.value}
                                        </button>
                                      </dd>
                                    )}
                                  </div>
                                );
                              })}
                            </dl>
                          </section>
                        ) : null}

                        <section class="quote-review__total">
                          <div class="quote-review__total-label">Total due</div>
                          <div class="quote-review__total-amt">
                            <span class="quote-review__total-currency">$</span>
                            <span
                              class="quote-review__total-num quote-review__editable"
                              contentEditable
                              spellcheck={false}
                              inputMode="decimal"
                              onFocus={(e) => {
                                const el = e.currentTarget as HTMLElement;
                                const range = document.createRange();
                                range.selectNodeContents(el);
                                const sel = globalThis.getSelection();
                                sel?.removeAllRanges();
                                sel?.addRange(range);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  (e.currentTarget as HTMLElement).blur();
                                }
                              }}
                              onBlur={(e) =>
                                onEditTotal(
                                  lockedPayload.quoteId,
                                  lockedCard?.id,
                                  contractId || contract?.id,
                                  totalCentsForBreakdown,
                                  e.currentTarget as HTMLElement,
                                )
                              }
                            >
                              {totalStr}
                            </span>
                          </div>
                          {milestones && milestones.length > 1 ? (
                            <ul class="quote-review__milestones">
                              {milestones.map((ms, i) => (
                                <li
                                  key={`ms-${i}`}
                                  class="quote-review__milestone"
                                >
                                  <span class="quote-review__milestone-label">
                                    {ms.label}
                                    {typeof ms.pct === "number" ? (
                                      <span class="quote-review__milestone-pct">
                                        {" "}
                                        · {ms.pct}%
                                      </span>
                                    ) : null}
                                  </span>
                                  <strong class="quote-review__milestone-amt">
                                    {fmtUSD(ms.amountCents)}
                                  </strong>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </section>

                        <footer class="quote-review__cta">
                          <div class="quote-review__send-split">
                            <button
                              type="button"
                              class="quote-review__send-main"
                              onClick={() => confirmSendContract(m, sendChannel)}
                              disabled={sending}
                            >
                              <I d={ICN.send} size={14} sw={2.4} />
                              {sending
                                ? "Sending…"
                                : sendChannel === "both"
                                ? "Click here to send by Text + Email"
                                : sendChannel === "sms"
                                ? "Click here to send by Text"
                                : "Click here to send by Email"}
                            </button>
                            <button
                              type="button"
                              class="quote-review__send-caret"
                              aria-label="Choose how to send"
                              aria-expanded={channelMenuOpen ? "true" : "false"}
                              onClick={() => setChannelMenuOpen((o) => !o)}
                              disabled={sending}
                            >
                              <I d={ICN.chev} size={12} sw={2.4} />
                            </button>
                            {channelMenuOpen ? (
                              <div class="quote-review__send-menu" role="menu">
                                <button
                                  type="button"
                                  role="menuitem"
                                  class={`quote-review__send-menu-item${
                                    sendChannel === "both" ? " is-current" : ""
                                  }`}
                                  onClick={() => {
                                    setSendChannel("both");
                                    setChannelMenuOpen(false);
                                  }}
                                >
                                  <I d={ICN.send} size={13} sw={2.4} />
                                  <span class="quote-review__send-menu-label">
                                    Text + Email
                                  </span>
                                  <span class="quote-review__send-menu-tag">
                                    Recommended
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  class={`quote-review__send-menu-item${
                                    sendChannel === "sms" ? " is-current" : ""
                                  }`}
                                  onClick={() => {
                                    setSendChannel("sms");
                                    setChannelMenuOpen(false);
                                  }}
                                >
                                  <I d={ICN.phone} size={13} sw={2.4} />
                                  <span class="quote-review__send-menu-label">
                                    Text only
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  class={`quote-review__send-menu-item${
                                    sendChannel === "email" ? " is-current" : ""
                                  }`}
                                  onClick={() => {
                                    setSendChannel("email");
                                    setChannelMenuOpen(false);
                                  }}
                                >
                                  <I d={ICN.mail} size={13} sw={2.4} />
                                  <span class="quote-review__send-menu-label">
                                    Email only
                                  </span>
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </footer>
                      </article>
                    </div>
                  );
                }
                // The "Ready to send" banner is intentionally suppressed —
                // the editable quote-review opens automatically on wizard
                // completion via the autoOpenedCtasRef effect. The reviewed
                // success state ("Contract sent") still renders below.
                if (payload.toPhase === "send" && !reviewed && !previewing) {
                  return null;
                }
                // Per audit #19: surface the upcoming phase label as an eyebrow
                // *before* the CTA, so users see "PHASE 2 — CONTRACT TERMS" at
                // click time, not as a divider that lands after they've already
                // clicked through. The backend still emits the divider on
                // transition; once it lands, the chat shows both.
                const phaseEyebrow = !reviewed
                  ? payload.toPhase === "terms"
                    ? "We need a little more info"
                    : payload.toPhase === "send"
                      ? "Up next · Send to client"
                      : payload.toPhase === "invoice"
                        ? "Up next · Send invoice"
                        : null
                  : null;
                return (
                  <div key={m.id} class="msg">
                    <div class="msg__avatar">
                      <img src="/logo-monster.png" alt="" />
                    </div>
                    <div style="flex:1;min-width:0">
                      <div
                        class={`continue-cta ${reviewed ? "continue-cta--done" : ""}`}
                      >
                        <div class="continue-cta__icon">
                          <I
                            d={reviewed ? ICN.check : ICN.contract}
                            size={18}
                          />
                        </div>
                        <div class="continue-cta__txt">
                          {phaseEyebrow && (
                            <div style="font-size:10.5px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:var(--brand-pink);margin-bottom:4px">
                              {phaseEyebrow}
                            </div>
                          )}
                          <div class="continue-cta__title">
                            {reviewed
                              ? payload.toPhase === "invoice"
                                ? "Invoice sent"
                                : "Contract sent"
                              : m.content}
                          </div>
                          {reviewed ? (
                            <div class="continue-cta__sub">
                              {sentRecipient ? (
                                <>
                                  emailed to <code>{sentRecipient}</code>
                                </>
                              ) : dispatchFailReason ? (
                                <>not delivered — {dispatchFailReason}</>
                              ) : (
                                <>
                                  no email on file — add one to{" "}
                                  <code>
                                    {customer?.name ?? "the customer"}
                                  </code>{" "}
                                  to deliver
                                </>
                              )}
                            </div>
                          ) : payload.summary ? (
                            <div class="continue-cta__sub">
                              {payload.summary}
                            </div>
                          ) : null}
                        </div>
                        {reviewed ? null : payload.toPhase === "terms" ? (
                          <div style="display:flex;gap:8px;flex-shrink:0">
                            <button
                              type="button"
                              class="continue-cta__btn"
                              onClick={() => submitContinueCta(m, "business")}
                              disabled={sending}
                            >
                              Business
                            </button>
                            <button
                              type="button"
                              class="continue-cta__btn"
                              onClick={() => submitContinueCta(m, "person")}
                              disabled={sending}
                            >
                              Person
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            class="continue-cta__btn"
                            onClick={() => submitContinueCta(m)}
                            disabled={sending}
                          >
                            {payload.toPhase === "send"
                              ? "Review"
                              : payload.toPhase === "invoice"
                                ? "Send invoice"
                                : "Start"}{" "}
                            <I d={ICN.arrow} size={11} sw={2.5} />
                          </button>
                        )}
                      </div>
                      {/* Dev-only trigger: simulate the customer accepting the
                        quote so the threads-sidebar notification UX can be
                        tested without a real signing webhook. */}
                      {reviewed &&
                      payload.toPhase === "send" &&
                      typeof globalThis.location !== "undefined" &&
                      globalThis.location.hostname === "localhost" &&
                      new URLSearchParams(globalThis.location.search).has(
                        "dev",
                      ) ? (
                        <button
                          type="button"
                          class="dev-accept-btn"
                          onClick={() =>
                            simulateCustomerAccept(payload.contractId)
                          }
                          disabled={sending}
                          title="Localhost-only: flip contract to accepted, bump conversation, set unread."
                        >
                          🔧{" "}
                          {sending
                            ? "Simulating…"
                            : "Simulate customer accepted"}
                        </button>
                      ) : null}
                      <div class="msg__time">{fmtTime(m.createdAt)}</div>
                    </div>
                  </div>
                );
              }

              // Wizard step — question + clickable option buttons.
              if (m.kind === "wizard") {
                const payload = (m.payload ?? {}) as {
                  stepId?: string;
                  stepIdx?: number;
                  options?: WizardOption[];
                  hint?: string;
                };
                const opts = payload.options ?? [];
                const isCustomerStep = payload.stepId === "customer";
                return (
                  <div key={m.id} class="msg">
                    <div class="msg__avatar">
                      <img src="/logo-monster.png" alt="" />
                    </div>
                    <div style="flex:1;min-width:0">
                      <div class="wiz">
                        <div class="wiz__step">
                          {typeof payload.stepIdx === "number" ? (
                            // #16 — hide the "of 10" total until step 6. Through
                            // the first half it reads as a daunting commitment;
                            // past the halfway hump revealing it is reassuring.
                            <div class="wiz__step-num">
                              Step {payload.stepIdx + 1}
                              {payload.stepIdx >= 5 ? " of 10" : ""}
                            </div>
                          ) : null}
                          {/* Customer step renders its own heading inside the
                            panel because the prompt swaps after picking
                            Business / Person ("What is the business name?"
                            etc). Every other wizard step uses the static
                            wizard-supplied question. */}
                          {!isCustomerStep ? (
                            <h3 class="wiz__step-q">{m.content}</h3>
                          ) : null}
                          {payload.hint ? (
                            <div class="wiz__step-hint">{payload.hint}</div>
                          ) : null}
                          {(() => {
                            if (isCustomerStep) {
                              return (
                                <CustomerStepPanel
                                  boundCustomer={customer}
                                  initialKind={precommittedKind ?? undefined}
                                  onKindConsumed={() =>
                                    setPrecommittedKind(null)
                                  }
                                  sending={sending}
                                  onSubmit={(optionId, body) =>
                                    submitCustomerStep(m, optionId, body)
                                  }
                                />
                              );
                            }
                            const activeFollowUp =
                              followUpPick && followUpPick.messageId === m.id
                                ? opts.find(
                                    (o) => o.id === followUpPick.optionId,
                                  )
                                : null;
                            if (activeFollowUp && activeFollowUp.followUp) {
                              return (
                                <WizardFollowUpForm
                                  option={activeFollowUp}
                                  quoteTotalCents={latestSentQuoteCents(
                                    messages,
                                  )}
                                  sending={sending}
                                  onSubmit={(values) => {
                                    setFollowUpPick(null);
                                    postWizardAnswer(m, {
                                      stepId: payload.stepId!,
                                      optionId: activeFollowUp.id,
                                      followUpValues: values,
                                    });
                                  }}
                                  onCancel={() => setFollowUpPick(null)}
                                />
                              );
                            }
                            if (
                              customDatePick &&
                              customDatePick.messageId === m.id
                            ) {
                              return (
                                <CustomDatePickerForm
                                  sending={sending}
                                  onSubmit={(dateStr) => {
                                    setCustomDatePick(null);
                                    postWizardAnswer(m, {
                                      stepId: payload.stepId!,
                                      optionId: customDatePick.optionId,
                                      customValue: dateStr,
                                    });
                                  }}
                                  onCancel={() => setCustomDatePick(null)}
                                />
                              );
                            }
                            if (
                              customDurationPick &&
                              customDurationPick.messageId === m.id
                            ) {
                              return (
                                <CustomDurationPickerForm
                                  sending={sending}
                                  onSubmit={(durationStr) => {
                                    setCustomDurationPick(null);
                                    postWizardAnswer(m, {
                                      stepId: payload.stepId!,
                                      optionId: customDurationPick.optionId,
                                      customValue: durationStr,
                                    });
                                  }}
                                  onCancel={() => setCustomDurationPick(null)}
                                />
                              );
                            }
                            if (
                              customWarrantyPick &&
                              customWarrantyPick.messageId === m.id
                            ) {
                              return (
                                <CustomWarrantyPickerForm
                                  sending={sending}
                                  onSubmit={(warrantyStr) => {
                                    setCustomWarrantyPick(null);
                                    postWizardAnswer(m, {
                                      stepId: payload.stepId!,
                                      optionId: customWarrantyPick.optionId,
                                      customValue: warrantyStr,
                                    });
                                  }}
                                  onCancel={() => setCustomWarrantyPick(null)}
                                />
                              );
                            }
                            if (
                              customPaymentPick &&
                              customPaymentPick.messageId === m.id
                            ) {
                              return (
                                <CustomPaymentPickerForm
                                  sending={sending}
                                  onSubmit={(paymentStr) => {
                                    setCustomPaymentPick(null);
                                    postWizardAnswer(m, {
                                      stepId: payload.stepId!,
                                      optionId: customPaymentPick.optionId,
                                      customValue: paymentStr,
                                    });
                                  }}
                                  onCancel={() => setCustomPaymentPick(null)}
                                />
                              );
                            }
                            return (
                              <div class="wiz__opts">
                                {opts.map((opt) => (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    class={`wiz-opt ${opt.isCustom ? "wiz-opt--custom" : ""}`}
                                    onClick={() => {
                                      if (opt.followUp) {
                                        setFollowUpPick({
                                          messageId: m.id,
                                          optionId: opt.id,
                                        });
                                        return;
                                      }
                                      if (
                                        opt.isCustom &&
                                        payload.stepId === "start_date"
                                      ) {
                                        setCustomDatePick({
                                          messageId: m.id,
                                          optionId: opt.id,
                                        });
                                        return;
                                      }
                                      if (
                                        opt.isCustom &&
                                        payload.stepId === "wraps"
                                      ) {
                                        setCustomDurationPick({
                                          messageId: m.id,
                                          optionId: opt.id,
                                        });
                                        return;
                                      }
                                      if (
                                        opt.isCustom &&
                                        payload.stepId === "payment_terms"
                                      ) {
                                        setCustomPaymentPick({
                                          messageId: m.id,
                                          optionId: opt.id,
                                        });
                                        return;
                                      }
                                      if (
                                        opt.isCustom &&
                                        payload.stepId === "warranty"
                                      ) {
                                        setCustomWarrantyPick({
                                          messageId: m.id,
                                          optionId: opt.id,
                                        });
                                        return;
                                      }
                                      submitWizardAnswer(m, opt);
                                    }}
                                    disabled={sending}
                                  >
                                    {opt.label}
                                    {opt.sub ? (
                                      <span class="wiz-opt__sub">
                                        {opt.sub}
                                      </span>
                                    ) : null}
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                      <div class="msg__time">{fmtTime(m.createdAt)}</div>
                    </div>
                  </div>
                );
              }

              // Action card — currently the only actionType is "quote", but
              // the renderer is structured so other types (contract, invoice)
              // can land here later. Buttons short-circuit the LLM by posting
              // shortcut text into the chat so the model fires lock_quote /
              // its sibling tools without the user having to type.
              if (m.kind === "action_card") {
                const payload = (m.payload ?? {}) as ActionCardPayload;
                const lineItems = payload.lineItems ?? [];
                const totalCents =
                  payload.totalCents ??
                  lineItems.reduce((sum, li) => sum + (li.amountCents ?? 0), 0);
                const statusLabel = (payload.status ?? "draft").replace(
                  /^[a-z]/,
                  (c) => c.toUpperCase(),
                );
                // Detect a later action_card for the same quote that has
                // already advanced past draft. The earlier DRAFT card stays
                // visible in chat history (audit #18) but its action buttons
                // would otherwise re-fire against an already-sent quote.
                const idx = messages.indexOf(m);
                const supersededBy =
                  payload.quoteId && payload.status === "draft"
                    ? messages
                        .slice(idx + 1)
                        .find(
                          (later) =>
                            later.kind === "action_card" &&
                            (later.payload as ActionCardPayload | undefined)
                              ?.quoteId === payload.quoteId &&
                            (later.payload as ActionCardPayload | undefined)
                              ?.status !== "draft",
                        )
                    : undefined;
                const isSuperseded = !!supersededBy;
                return (
                  <div key={m.id} class="msg">
                    <div class="msg__avatar">
                      <img src="/logo-monster.png" alt="" />
                    </div>
                    <div style="flex:1;min-width:0">
                      <div
                        class="action-card"
                        style={isSuperseded ? "opacity:0.55" : undefined}
                      >
                        <div class="action-card__head">
                          <div class="action-card__icon">
                            <I d={ICN.quote} size={16} />
                          </div>
                          <div style="flex:1;min-width:0">
                            <div class="action-card__title">{m.content}</div>
                          </div>
                          <span class="action-card__chip">
                            {isSuperseded ? "Superseded" : statusLabel}
                          </span>
                        </div>
                        <div class="action-card__body">
                          {lineItems.map((li, i) => (
                            <div key={i} class="action-card__row">
                              <span>{li.description}</span>
                              <strong>{fmtUSD(li.amountCents)}</strong>
                            </div>
                          ))}
                          {lineItems.length > 0 ? (
                            <div
                              class="action-card__row"
                              style="border-top:1px solid rgba(20,72,82,0.08);margin-top:6px;padding-top:8px"
                            >
                              <span style="font-weight:700;color:var(--brand-teal)">
                                Total
                              </span>
                              <strong style="font-size:15px">
                                {fmtUSD(totalCents)}
                              </strong>
                            </div>
                          ) : null}
                        </div>
                        {payload.status === "draft" && !isSuperseded ? (
                          <div class="action-card__cta">
                            <button
                              type="button"
                              class="action-card__btn action-card__btn--primary"
                              onClick={() => lockActionCard(m, payload)}
                              disabled={sending || !payload.quoteId}
                            >
                              <I d={ICN.bolt} size={11} /> Lock it in
                            </button>
                            <button
                              type="button"
                              class="action-card__btn"
                              onClick={() => setDraft("")}
                              disabled={sending}
                            >
                              Edit
                            </button>
                          </div>
                        ) : null}
                        {payload.status === "sent" ? (
                          <div class="action-card__cta">
                            <button
                              type="button"
                              class="action-card__btn"
                              onClick={() => sendText("Re-open the quote.")}
                              disabled={sending}
                            >
                              <I d={ICN.refresh} size={11} /> Re-open
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div class="msg__time">{fmtTime(m.createdAt)}</div>
                    </div>
                  </div>
                );
              }

              // Synthetic local-only post-handoff demo CTA. Lives in the
              // chat as a pink chip card so the user sees ONE concrete
              // next-step ("see what your customer sees") right after the
              // onboarding handoff. Not persisted; survives only until
              // refresh.
              if (m.kind === "text" && m.content === "PM_ONBOARDING_DEMO_CTA") {
                return (
                  <div key={m.id} class="msg" style="margin-top:6px">
                    <div class="msg__avatar">
                      <img src="/logo-monster.png" alt="" />
                    </div>
                    <div style="flex:1;min-width:0">
                      <a
                        href="/q/03a22a99-3504-47b4-b6b0-cf62efe881cf"
                        target="_blank"
                        rel="noopener"
                        style="display:flex;align-items:center;gap:14px;padding:14px 18px;background:linear-gradient(135deg,rgba(255,107,107,0.10) 0%,rgba(255,107,107,0.04) 100%);border:1px solid rgba(255,107,107,0.30);border-radius:14px;text-decoration:none;color:inherit;transition:transform 200ms"
                      >
                        <span
                          aria-hidden="true"
                          style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:#FF6B6B;color:#fff;font-size:18px;flex-shrink:0"
                        >
                          👀
                        </span>
                        <span style="flex:1;min-width:0">
                          <span style="display:block;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#d94e4e">
                            Try it · 5 seconds
                          </span>
                          <span style="display:block;margin-top:2px;font-weight:800;color:#144852;font-size:14.5px">
                            See what your customer sees
                          </span>
                          <span style="display:block;margin-top:2px;font-size:12px;color:#6b7a7e">
                            A live sample quote — branded with everything you
                            just shared. Opens in a new tab.
                          </span>
                        </span>
                        <span
                          aria-hidden="true"
                          style="font-size:18px;color:#d94e4e;font-weight:800"
                        >
                          →
                        </span>
                      </a>
                      <div class="msg__time">{fmtTime(m.createdAt)}</div>
                    </div>
                  </div>
                );
              }

              // Default chat bubble (text/voice/image).
              const fileId = (m.payload as { fileId?: string } | undefined)
                ?.fileId;
              const filename = (m.payload as { filename?: string } | undefined)
                ?.filename;
              // Skip ghost bubbles: a text/voice message with no content and
              // no attached media is something the LLM (or a buggy persist
              // path) emitted with no signal — rendering it as an empty pill
              // looks broken. Phase_divider / continue_cta / action_card /
              // wizard / image / file are handled above with their own UI.
              const hasMedia = !!fileId;
              const hasContent = !!m.content?.trim();
              if (!hasMedia && !hasContent) return null;
              return (
                <div
                  key={m.id}
                  class={`msg ${m.role === "user" ? "msg--user" : ""}`}
                >
                  <div class="msg__avatar">
                    {m.role === "user" ? (
                      userInitials
                    ) : (
                      <img src="/logo-monster.png" alt="" />
                    )}
                  </div>
                  <div>
                    {m.kind === "image" && fileId ? (
                      <a
                        class="msg__image"
                        href={`/api/files/${fileId}`}
                        target="_blank"
                        rel="noopener"
                      >
                        <img
                          src={`/api/files/${fileId}`}
                          alt={filename ?? "attached image"}
                        />
                      </a>
                    ) : null}
                    <div class="msg__bubble" style="white-space:pre-wrap">
                      {m.content}
                    </div>
                    <div class="msg__time">{fmtTime(m.createdAt)}</div>
                  </div>
                </div>
              );
            });
          })()
        )}
        {!empty &&
        sending &&
        messages.length > 0 &&
        messages[messages.length - 1].role === "user" ? (
          <div class="msg" aria-live="polite" aria-label="Bossie is thinking">
            <div class="msg__avatar">
              <img src="/logo-monster.png" alt="" />
            </div>
            <div class="msg__bubble msg__bubble--typing">
              <span class="typing-dot" />
              <span class="typing-dot" />
              <span class="typing-dot" />
            </div>
          </div>
        ) : null}
      </div>

      {(() => {
        // Roadmap p.2: hide the composer when the user is in a "tapping-only"
        // structured step — the MoneyInput screen, or any unanswered wizard
        // card that exposes its own options. Text input has no place there
        // and was visually distracting customers during testing.
        const answeredStepIds = new Set<string>();
        for (const x of messages) {
          const sid = (x.payload as { wizardStepId?: string } | undefined)?.wizardStepId;
          if (x.kind === "text" && sid) answeredStepIds.add(sid);
        }
        const hasUnansweredWizard = messages.some((m) => {
          if (m.kind !== "wizard") return false;
          const sid = (m.payload as { stepId?: string } | undefined)?.stepId;
          return !sid || !answeredStepIds.has(sid);
        });
        const composerHidden = priceCaptureOpen || hasUnansweredWizard;
        if (composerHidden) return null;
        return (
      <div
        class={`composer${
          awaitingJobDetails && !submittedJobDetails && !draft.trim()
            ? " composer--flash"
            : ""
        }`}
      >
        {error ? <div class="composer__err">{error}</div> : null}
        {recording ? (
          <RecordingPanel
            elapsed={recElapsed}
            level={audioLevel}
            finalText={liveFinal}
            interimText={liveInterim}
            onStop={toggleRecord}
            onCancel={cancelRecord}
          />
        ) : (
          <>
            <div class="composer__inner">
              <textarea
                ref={taRef}
                class="composer__input"
                placeholder="Ex: Customer wants a 10'x10' slab, what should I charge?"
                rows={1}
                value={draft}
                onInput={(e) => {
                  setDraft((e.target as HTMLTextAreaElement).value);
                  autosize();
                }}
                onKeyDown={onKeyDown}
              />
              <div class="composer__tools">
                <button
                  type="button"
                  class="composer__mic"
                  aria-label="Voice memo"
                  title="Tap to talk"
                  onClick={toggleRecord}
                  disabled={sending}
                >
                  <I d={ICN.mic} size={20} />
                </button>
                <button
                  type="button"
                  class="composer__send"
                  title="Send"
                  onClick={onSendClick}
                  disabled={sending || !draft.trim()}
                >
                  <I d={ICN.arrow} size={16} sw={2.4} />
                </button>
              </div>
            </div>
            <div class="composer__hint">
              Not sure? Just tell me about the job.
            </div>
          </>
        )}
      </div>
        );
      })()}
    </>
  );
}

/** RecordingPanel — glassy "voice mode" surface that takes over the
 *  composer while the mic is hot.
 *
 *  Centerpiece is an animated orb: three concentric circles (core, halo,
 *  outer halo) each scaled by smoothed audio level, plus three pulse
 *  rings that ripple outward when level crosses a threshold. The orb
 *  uses an SVG filter with a soft Gaussian blur for the glow, layered
 *  under a sharp core so the bloom reads as light, not noise.
 *
 *  Below the orb sits a large live transcript — finalised words in full
 *  brand teal, in-flight interim words in a softer color and italic, so
 *  the eye understands at a glance which words are "locked in". A small
 *  fade-in animation on each new finalised chunk makes incoming
 *  transcript feel alive rather than slammed in. */
function RecordingPanel({
  elapsed,
  level,
  finalText,
  interimText,
  onStop,
  onCancel,
}: {
  elapsed: number;
  level: number;
  finalText: string;
  interimText: string;
  onStop: () => void;
  onCancel: () => void;
}) {
  const hasAny = finalText.trim().length > 0 || interimText.trim().length > 0;
  // Smoothed level → orb scale + glow intensity. The asymmetric easing
  // happens upstream in startLevelMeter; here we just map.
  const coreScale = 1 + level * 0.18;
  const haloScale = 1 + level * 0.42;
  const outerScale = 1 + level * 0.72;
  const glowOpacity = 0.35 + level * 0.55;
  const elapsedLabel =
    elapsed < 60
      ? `0:${String(elapsed).padStart(2, "0")}`
      : `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  // Use the previous final-text length to key a fade-in span on new
  // chunks. We split into "old" (already shown) + "new" (just landed)
  // to animate only the recently transcribed words.
  const lastFinalLenRef = useRef(0);
  const oldFinal = finalText.slice(0, lastFinalLenRef.current);
  const newFinal = finalText.slice(lastFinalLenRef.current);
  // Update the ref AFTER render so the next render captures what's
  // already been animated in.
  useEffect(() => {
    lastFinalLenRef.current = finalText.length;
  }, [finalText]);

  return (
    <div class="rec-panel" role="region" aria-label="Voice memo recording">
      <div class="rec-panel__bg" aria-hidden="true" />
      <div class="rec-panel__row">
        <div class="rec-panel__orb-wrap" aria-hidden="true">
          <svg
            class="rec-panel__orb"
            viewBox="0 0 80 80"
            width="56"
            height="56"
          >
            <defs>
              <radialGradient id="recOrbCore" cx="50%" cy="45%" r="60%">
                <stop offset="0%" stop-color="#fff7f7" stop-opacity="1" />
                <stop offset="55%" stop-color="#ff8a8a" stop-opacity="1" />
                <stop offset="100%" stop-color="#e63d6d" stop-opacity="1" />
              </radialGradient>
              <radialGradient id="recOrbHalo" cx="50%" cy="50%" r="55%">
                <stop offset="0%" stop-color="#ffb4b4" stop-opacity="0.85" />
                <stop offset="100%" stop-color="#ff6b9d" stop-opacity="0" />
              </radialGradient>
            </defs>
            {/* Pulse rings */}
            <circle
              class="rec-panel__ring rec-panel__ring--1"
              cx="40"
              cy="40"
              r="20"
            />
            <circle
              class="rec-panel__ring rec-panel__ring--2"
              cx="40"
              cy="40"
              r="20"
            />
            {/* Outer halo */}
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="url(#recOrbHalo)"
              style={`transform:scale(${outerScale.toFixed(3)});transform-origin:40px 40px;opacity:${glowOpacity.toFixed(3)};transition:transform 70ms ease-out, opacity 90ms ease-out`}
            />
            {/* Core */}
            <circle
              cx="40"
              cy="40"
              r="22"
              fill="url(#recOrbCore)"
              style={`transform:scale(${coreScale.toFixed(3)});transform-origin:40px 40px;transition:transform 60ms ease-out`}
            />
            {/* Specular highlight */}
            <ellipse
              cx="34"
              cy="35"
              rx="7"
              ry="4"
              fill="rgba(255,255,255,0.55)"
              style={`transform:scale(${coreScale.toFixed(3)});transform-origin:40px 40px`}
            />
          </svg>
        </div>

        <div class="rec-panel__center">
          <div class="rec-panel__head">
            <span class="rec-panel__live">
              <span class="rec-panel__live-dot" />
              Live
            </span>
            <span class="rec-panel__elapsed">{elapsedLabel}</span>
          </div>
          <div class="rec-panel__transcript" aria-live="polite">
            {hasAny ? (
              <p class="rec-panel__transcript-text">
                <span class="rec-panel__final">{oldFinal}</span>
                {newFinal ? (
                  <span class="rec-panel__final rec-panel__final--new">
                    {newFinal}
                  </span>
                ) : null}
                {interimText && finalText ? " " : ""}
                <span class="rec-panel__interim">{interimText}</span>
                <span class="rec-panel__caret" aria-hidden="true">
                  ▍
                </span>
              </p>
            ) : (
              <p class="rec-panel__placeholder">
                Start talking — I'll write it out as you speak.
              </p>
            )}
          </div>
        </div>

        <div class="rec-panel__controls">
          <button
            type="button"
            class="rec-panel__cancel"
            onClick={onCancel}
            aria-label="Cancel recording"
            title="Cancel"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
          <button
            type="button"
            class="rec-panel__stop"
            onClick={onStop}
            aria-label="Stop and send"
            title="Stop & send"
          >
            <span class="rec-panel__stop-icon" aria-hidden="true">
              <span class="rec-panel__stop-square" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===========================================================================
 * CustomerStepPanel — inline UI for the wizard's `customer` step.
 *
 * The generic wizard renders steps as three buttons. The customer step's
 * three buttons each need a different interaction:
 *   - "Use [Name]"            visible ONLY when conv has a customer bound;
 *                             one click → use_active.
 *   - "Pick existing"         expands an inline searchable list of the
 *                             user's customers (fetched lazily on click).
 *   - "Create new"            expands an inline form (name + email + phone)
 *                             that posts create_new with the structured
 *                             customer.create payload.
 *
 * The panel manages its own UI mode/state; the parent only learns about
 * a successful pick via the onSubmit callback, which routes through the
 * shared wizard answer pipeline.
 * =========================================================================== */
type CustomerStepView = "list" | "form";
type CustomerKind = "business" | "person";

function CustomerStepPanel(props: {
  boundCustomer?: CustomerLite;
  /** Pre-picked from the lock-quote CTA. Drives whether labels read
   *  "business" vs "person" and the form's heading + placeholder. */
  initialKind?: CustomerKind;
  /** Fired once when the panel consumes `initialKind`, so the parent can
   *  clear the precommitted value and not re-apply it on a back-and-forth. */
  onKindConsumed?: () => void;
  sending: boolean;
  onSubmit: (
    optionId: "use_active" | "pick_existing" | "create_new",
    body?: {
      customer?: {
        id?: string;
        create?: {
          name: string;
          email?: string;
          phoneNumber?: string;
          isBusiness?: boolean;
        };
      };
    },
  ) => Promise<void>;
}) {
  const { boundCustomer, initialKind, onKindConsumed, sending, onSubmit } =
    props;
  // Two views, walked in order:
  //   1. list — Use [bound] from chat / pick existing / create a new
  //             [business|person]. The kind itself is picked on the
  //             lock-quote CTA, not here, so this is the entry point.
  //   2. form — name + phone + email, with the heading swapped to ask for
  //             the right thing ("What is the business name?" etc.)
  // `initialKind` is supplied by the lock-quote CTA. On the rare edge
  // case of a page reload with no precommit, we fall back to "person"
  // (the most common kind) rather than blocking the user.
  const [view, setView] = useState<CustomerStepView>("list");
  const [kind] = useState<CustomerKind>(initialKind ?? "person");

  // Consume the precommitted kind exactly once so the parent can clear it.
  useEffect(() => {
    if (initialKind && onKindConsumed) onKindConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [customers, setCustomers] = useState<CustomerLite[] | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [localErr, setLocalErr] = useState<string | undefined>();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    assistantClient
      .listCustomers()
      .then((list) => {
        if (!cancelled) setCustomers(list);
      })
      .catch((err) => {
        if (!cancelled)
          setLocalErr(
            err instanceof Error ? err.message : "couldn't load customers",
          );
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const scroller = el.closest(".chat__scroll") as HTMLElement | null;
    if (!scroller) return;
    requestAnimationFrame(() => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    });
  }, [view, kind, loadingList]);

  function backToList() {
    setView("list");
    setLocalErr(undefined);
  }

  function openCreate() {
    setView("form");
    setLocalErr(undefined);
  }

  const isBusiness = kind === "business";
  const filtered = (customers ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (c.phoneNumber ?? "").toLowerCase().includes(q)
    );
  });

  // ---- View: form ----
  if (view === "form") {
    const trimmedName = createName.trim();
    const submitDisabled = sending || trimmedName.length === 0;
    const formHeading = "Who is this for?";
    const namePlaceholder = "Name";
    return (
      <div ref={rootRef}>
        <h3 class="wiz__step-q">{formHeading}</h3>
        <div class="cust-create" style="margin-top:8px">
          <input
            type="text"
            class="cust-pick__search"
            placeholder={namePlaceholder}
            aria-label={namePlaceholder}
            value={createName}
            onInput={(e) => setCreateName((e.target as HTMLInputElement).value)}
            autoFocus
          />
          <div class="cust-create__row">
            <input
              type="tel"
              class="cust-pick__search"
              placeholder="Phone Number"
              value={createPhone}
              onInput={(e) =>
                setCreatePhone((e.target as HTMLInputElement).value)
              }
            />
            <input
              type="email"
              class="cust-pick__search"
              placeholder="Email (optional)"
              value={createEmail}
              onInput={(e) =>
                setCreateEmail((e.target as HTMLInputElement).value)
              }
            />
          </div>
          {localErr ? <div class="cust-pick__err">{localErr}</div> : null}
          <div class="cust-create__actions">
            <button
              type="button"
              class="cust-create__btn cust-create__btn--primary"
              disabled={submitDisabled}
              onClick={() =>
                onSubmit("create_new", {
                  customer: {
                    create: {
                      name: trimmedName,
                      ...(createEmail.trim()
                        ? { email: createEmail.trim() }
                        : {}),
                      ...(createPhone.trim()
                        ? { phoneNumber: createPhone.trim() }
                        : {}),
                      isBusiness,
                    },
                  },
                })
              }
            >
              Next
            </button>
            <button
              type="button"
              class="cust-create__btn"
              onClick={backToList}
              disabled={sending}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- View: default — dropdown (kind already picked on the lock-quote CTA) ----
  return (
    <div ref={rootRef}>
      <h3 class="wiz__step-q">Pick a Customer</h3>
      <div
        class="wiz__opts"
        style="flex-direction:column;align-items:stretch;gap:8px;margin-top:8px"
      >
        {boundCustomer ? (
          <button
            type="button"
            class="wiz-opt"
            onClick={() => onSubmit("use_active")}
            disabled={sending}
          >
            Use {boundCustomer.name} from chat
            {boundCustomer.email ? (
              <span class="wiz-opt__sub">{boundCustomer.email}</span>
            ) : null}
          </button>
        ) : null}
        {loadingList ? (
          <div class="cust-pick__empty">Loading customers…</div>
        ) : customers && customers.length === 0 ? (
          <div class="cust-pick__empty">
            No saved customers yet — add one below.
          </div>
        ) : (
          <div class={`cust-dd ${pickerOpen ? "cust-dd--open" : ""}`}>
            {!pickerOpen ? (
              <button
                type="button"
                class="cust-dd__trigger"
                onClick={() => setPickerOpen(true)}
                disabled={sending}
              >
                <span class="cust-dd__placeholder">
                  Click Here For Existing Customers
                </span>
                <svg
                  class="cust-dd__chevron"
                  viewBox="0 0 12 12"
                  width="12"
                  height="12"
                  aria-hidden="true"
                >
                  <path
                    d="M2 4l4 4 4-4"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    fill="none"
                  />
                </svg>
              </button>
            ) : (
              <div class="cust-dd__panel">
                <input
                  type="text"
                  class="cust-pick__search"
                  placeholder={
                    (customers?.length ?? 0) > 5
                      ? `Search ${customers?.length} customers…`
                      : "Search customers…"
                  }
                  value={search}
                  onInput={(e) =>
                    setSearch((e.target as HTMLInputElement).value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSearch("");
                      setPickerOpen(false);
                    }
                  }}
                  autoFocus
                />
                {filtered.length === 0 ? (
                  <div class="cust-pick__empty">No matches.</div>
                ) : (
                  <div class="cust-pick__list cust-pick__list--scroll">
                    {filtered.slice(0, 100).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        class="cust-pick__row"
                        onClick={() =>
                          onSubmit("pick_existing", {
                            customer: { id: c.id },
                          })
                        }
                        disabled={sending}
                      >
                        <span class="cust-pick__name">{c.name}</span>
                        {c.email || c.phoneNumber ? (
                          <span class="cust-pick__meta">
                            {c.email ?? c.phoneNumber}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {localErr ? <div class="cust-pick__err">{localErr}</div> : null}
        <button
          type="button"
          class="wiz-opt wiz-opt--custom"
          onClick={openCreate}
          disabled={sending}
        >
          + New Customer
        </button>
      </div>
    </div>
  );
}

/* ===========================================================================
 * WizardFollowUpForm — inline form for an option that carries a `followUp`.
 *
 * The user has just clicked, e.g., "Deposit + balance" on the payment step.
 * Rendering the option as a no-op label would be lossy — we don't know the
 * actual deposit %. Instead, swap the option list out for a tight form
 * with one input per declared field (defaults prefilled from spec).
 *
 * For percent fields on payment_terms specifically, we show a live $
 * preview against the locked quote total — pulled from the most recent
 * sent action_card. Picking 25% on a $1,200 quote shows "$300 deposit /
 * $900 balance" inline as the user types.
 *
 * onSubmit fires with the typed values; onCancel returns to the option
 * list without persisting anything.
 * =========================================================================== */
function WizardFollowUpForm(props: {
  option: WizardOption;
  quoteTotalCents: number;
  sending: boolean;
  onSubmit: (values: Record<string, string | number>) => void;
  onCancel: () => void;
}) {
  const { option, quoteTotalCents, sending, onSubmit, onCancel } = props;
  const fields = option.followUp?.fields ?? [];

  const initial: Record<string, string | number> = {};
  for (const f of fields) initial[f.id] = f.default ?? "";
  const [values, setValues] =
    useState<Record<string, string | number>>(initial);

  function setField(id: string, raw: string, type: WizardFieldType) {
    if (type === "text") {
      setValues((v) => ({ ...v, [id]: raw }));
      return;
    }
    // Numeric-typed field — keep raw string while user is typing, but
    // store as number when it parses cleanly.
    if (raw === "") {
      setValues((v) => ({ ...v, [id]: "" }));
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) {
      setValues((v) => ({ ...v, [id]: n }));
    } else {
      setValues((v) => ({ ...v, [id]: raw }));
    }
  }

  function suffix(type: WizardFieldType): string {
    switch (type) {
      case "percent":
        return "%";
      case "days":
        return "days";
      case "currency":
        return "$";
      default:
        return "";
    }
  }

  // Submit-disabled rule: every numeric field must be a finite number, and
  // every required field must be non-empty. (Optional support if needed
  // later — for now treat all declared fields as required.)
  const submitDisabled =
    sending ||
    fields.some((f) => {
      const v = values[f.id];
      if (v === undefined || v === null || v === "") return true;
      if (f.type !== "text" && !Number.isFinite(Number(v))) return true;
      if (f.type !== "text" && typeof f.min === "number" && Number(v) < f.min)
        return true;
      if (f.type !== "text" && typeof f.max === "number" && Number(v) > f.max)
        return true;
      return false;
    });

  // Live $ preview — only meaningful when there's a quote total AND the
  // option declares a percent field (the only shape we can preview right
  // now). For deposit_bal that's "$X deposit · $Y balance".
  const depositPctField = fields.find((f) => f.type === "percent");
  const showPreview = quoteTotalCents > 0 && depositPctField;
  const depositPct = depositPctField ? Number(values[depositPctField.id]) : 0;
  const previewDepositCents =
    showPreview && Number.isFinite(depositPct)
      ? Math.round((quoteTotalCents * depositPct) / 100)
      : 0;
  const previewBalanceCents = showPreview
    ? quoteTotalCents - previewDepositCents
    : 0;

  return (
    <div class="cust-create">
      <div class="cust-create__row">
        {fields.map((f) => (
          <label key={f.id} class="wiz-field">
            <span class="wiz-field__label">{f.label}</span>
            <span class="wiz-field__input">
              <input
                type={f.type === "text" ? "text" : "number"}
                class="cust-pick__search"
                value={String(values[f.id] ?? "")}
                min={f.min}
                max={f.max}
                onInput={(e) =>
                  setField(f.id, (e.target as HTMLInputElement).value, f.type)
                }
              />
              {suffix(f.type) ? (
                <span class="wiz-field__suffix">{suffix(f.type)}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      {showPreview ? (
        <div class="wiz-preview">
          <span class="wiz-preview__row">
            Deposit · <strong>{fmtUSD(previewDepositCents)}</strong>
          </span>
          <span class="wiz-preview__sep">·</span>
          <span class="wiz-preview__row">
            Balance · <strong>{fmtUSD(previewBalanceCents)}</strong>
          </span>
        </div>
      ) : null}
      <div class="cust-create__actions">
        <button
          type="button"
          class="cust-create__btn cust-create__btn--primary"
          onClick={() => onSubmit(values)}
          disabled={submitDisabled}
        >
          Use {option.label}
        </button>
        <button
          type="button"
          class="cust-create__btn"
          onClick={onCancel}
          disabled={sending}
        >
          Back
        </button>
      </div>
    </div>
  );
}

/** Inline date picker for the start_date "Pick a date" custom option.
 *  Renders a styled month grid with prev/next navigation. Past dates are
 *  disabled (job can't start in the past). */
function CustomDatePickerForm(props: {
  sending: boolean;
  onSubmit: (dateStr: string) => void;
  onCancel: () => void;
}) {
  const { sending, onSubmit, onCancel } = props;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [picked, setPicked] = useState<Date>(today);
  const [viewMonth, setViewMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const toIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const toUsDate = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

  const firstOfMonth = new Date(
    viewMonth.getFullYear(),
    viewMonth.getMonth(),
    1,
  );
  const startDow = firstOfMonth.getDay();
  const daysInMonth = new Date(
    viewMonth.getFullYear(),
    viewMonth.getMonth() + 1,
    0,
  ).getDate();
  const cells: { date: Date; outside: boolean }[] = [];
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(firstOfMonth);
    d.setDate(d.getDate() - i - 1);
    cells.push({ date: d, outside: true });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({
      date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i),
      outside: false,
    });
  }
  while (cells.length < 42) {
    const next = new Date(cells[cells.length - 1].date);
    next.setDate(next.getDate() + 1);
    cells.push({ date: next, outside: true });
  }

  const monthLabel = viewMonth.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
  const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const prevDisabled =
    viewMonth.getFullYear() === today.getFullYear() &&
    viewMonth.getMonth() === today.getMonth();
  const stepMonth = (delta: number) =>
    setViewMonth(
      new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1),
    );

  const submitDisabled = sending || picked < today;
  const longLabel = picked.toLocaleDateString("default", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div class="cal" style="margin-top:8px">
      <div class="cal__head">
        <button
          type="button"
          class="cal__nav"
          onClick={() => stepMonth(-1)}
          disabled={prevDisabled || sending}
          aria-label="Previous month"
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path
              d="M8 2L4 6l4 4"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"
            />
          </svg>
        </button>
        <div class="cal__title">{monthLabel}</div>
        <button
          type="button"
          class="cal__nav"
          onClick={() => stepMonth(1)}
          disabled={sending}
          aria-label="Next month"
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path
              d="M4 2l4 4-4 4"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"
            />
          </svg>
        </button>
      </div>
      <div class="cal__weekdays">
        {weekdays.map((w) => (
          <span key={w} class="cal__weekday">
            {w}
          </span>
        ))}
      </div>
      <div class="cal__grid">
        {cells.map(({ date, outside }) => {
          const past = date < today;
          const selected = sameDay(date, picked);
          const isToday = sameDay(date, today);
          const cls = [
            "cal__day",
            outside ? "cal__day--outside" : "",
            selected ? "cal__day--selected" : "",
            isToday && !selected ? "cal__day--today" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={toIso(date)}
              type="button"
              class={cls}
              disabled={past || sending}
              onClick={() => setPicked(date)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <div class="cal__footer">
        <span class="cal__picked">{longLabel}</span>
      </div>
      <div class="cust-create__actions">
        <button
          type="button"
          class="cust-create__btn cust-create__btn--primary"
          onClick={() => onSubmit(toUsDate(picked))}
          disabled={submitDisabled}
        >
          Use this date
        </button>
        <button
          type="button"
          class="cust-create__btn"
          onClick={onCancel}
          disabled={sending}
        >
          Back
        </button>
      </div>
    </div>
  );
}

/** Best-effort free-text duration parser. Handles numerics ("3 weeks"),
 *  word-numerics ("a week", "couple of months"), fractions ("half a month"),
 *  and abbreviations. Returns null when nothing recognisable is found —
 *  caller falls back to the manual form. Confidence is "ok" for clean
 *  numeric matches, "guess" when we had to interpret words/fractions. */
function parseDurationGuess(text: string): {
  n: number;
  unit: "days" | "weeks" | "months";
  confidence: "ok" | "guess";
} | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;
  let unit: "days" | "weeks" | "months";
  if (/\bmonths?\b|\bmos?\b|\bmo\b/.test(t)) unit = "months";
  else if (/\bweeks?\b|\bwks?\b/.test(t)) unit = "weeks";
  else if (/\bdays?\b|\bd\b/.test(t)) unit = "days";
  else return null;
  let n: number | null = null;
  let confidence: "ok" | "guess" = "guess";
  const numMatch = t.match(/(\d+(\.\d+)?)/);
  const wordNums: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    couple: 2,
    few: 3,
  };
  if (numMatch) {
    n = parseFloat(numMatch[1]);
    confidence =
      Number.isInteger(n) && !/half|about|roughly|~/.test(t) ? "ok" : "guess";
  } else {
    for (const [w, v] of Object.entries(wordNums)) {
      const re = new RegExp(`\\b${w}\\b`);
      if (re.test(t)) {
        n = v;
        break;
      }
    }
  }
  if (n == null) return null;
  if (/half/.test(t) && /\band\b/.test(t)) n = n + 0.5;
  else if (/half/.test(t) && n === 1) n = 0.5;
  const rounded = Math.max(1, Math.min(99, Math.round(n)));
  return { n: rounded, unit, confidence };
}

/** Inline duration picker for the wraps "Custom" option. Two-phase Bossie
 *  flow: chat-style ask → free-text parse → structured verify form. The
 *  contract value always comes from the verify form so an LLM/parser miss
 *  never propagates — the user has the final word. */
function CustomDurationPickerForm(props: {
  sending: boolean;
  onSubmit: (durationStr: string) => void;
  onCancel: () => void;
}) {
  const { sending, onSubmit, onCancel } = props;
  const [phase, setPhase] = useState<"ask" | "verify">("ask");
  const [freeText, setFreeText] = useState("");
  const [parseFailed, setParseFailed] = useState(false);
  const [n, setN] = useState("3");
  const [unit, setUnit] = useState<"days" | "weeks" | "months">("weeks");
  const [confidence, setConfidence] = useState<"ok" | "guess" | "fail">("ok");
  const [heardFrom, setHeardFrom] = useState("");

  const num = Math.max(1, Math.min(99, Number(n) || 0));
  const valid = Number.isFinite(num) && num >= 1 && num <= 99;
  const unitLabel = num === 1 ? unit.replace(/s$/, "") : unit;
  const preview = valid ? `${num} ${unitLabel}` : "—";

  const presets: {
    label: string;
    n: string;
    unit: typeof unit;
    confidence: "ok" | "guess";
  }[] = [
    { label: "1 day", n: "1", unit: "days", confidence: "ok" },
    { label: "2–3 days", n: "3", unit: "days", confidence: "guess" },
    { label: "1 week", n: "1", unit: "weeks", confidence: "ok" },
    { label: "2 weeks", n: "2", unit: "weeks", confidence: "ok" },
  ];

  function tryParseAndAdvance() {
    const raw = freeText.trim();
    if (!raw) return;
    const parsed = parseDurationGuess(raw);
    setHeardFrom(raw);
    if (parsed) {
      setN(String(parsed.n));
      setUnit(parsed.unit);
      setConfidence(parsed.confidence);
      setParseFailed(false);
    } else {
      setConfidence("fail");
      setParseFailed(true);
    }
    setPhase("verify");
  }

  if (phase === "ask") {
    return (
      <div class="dur dur--ask" style="margin-top:8px">
        <div class="dur__bossie">
          <span class="dur__bossie-tag">Bossie</span>
          <span class="dur__bossie-msg">
            How long will it take? Tell me however you want — "3 weeks", "about
            a month", "10 business days". I'll show you what I heard before
            locking it in.
          </span>
        </div>
        <textarea
          class="cust-pick__search dur__textarea"
          placeholder="e.g. about 3 weeks, a month and a half, 10 days…"
          value={freeText}
          onInput={(e) => setFreeText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              tryParseAndAdvance();
            }
          }}
          rows={2}
          autoFocus
        />
        <div class="dur__presets">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              class="dur__chip"
              onClick={() => {
                setN(p.n);
                setUnit(p.unit);
                setConfidence(p.confidence);
                setHeardFrom(p.label);
                setParseFailed(false);
                setPhase("verify");
              }}
              disabled={sending}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            class="dur__chip dur__chip--ghost"
            onClick={() => {
              setHeardFrom("");
              setConfidence("fail");
              setParseFailed(true);
              setPhase("verify");
            }}
            disabled={sending}
          >
            Or set it manually
          </button>
        </div>
        <div class="cust-create__actions">
          <button
            type="button"
            class="cust-create__btn cust-create__btn--primary"
            onClick={tryParseAndAdvance}
            disabled={sending || !freeText.trim()}
          >
            Continue →
          </button>
          <button
            type="button"
            class="cust-create__btn"
            onClick={onCancel}
            disabled={sending}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="dur dur--verify" style="margin-top:8px">
      <div class="dur__head">
        <strong class="dur__title">
          {confidence === "fail"
            ? "Set the duration"
            : confidence === "guess"
              ? "Did I hear that right?"
              : "Got it — confirm and we'll lock it in"}
        </strong>
        {heardFrom ? (
          <span class="dur__sub">
            You said: <em>"{heardFrom}"</em>
          </span>
        ) : (
          <span class="dur__sub">
            Pick a number and a unit — I'll write it into the contract.
          </span>
        )}
        {confidence === "guess" ? (
          <span class="dur__warn">
            ⚠ Best guess — please double-check before locking in.
          </span>
        ) : null}
        {parseFailed ? (
          <span class="dur__warn">
            I couldn't read that as a duration — set it manually.
          </span>
        ) : null}
      </div>
      <div class="dur__row">
        <input
          type="number"
          class="cust-pick__search dur__num"
          inputMode="numeric"
          min={1}
          max={99}
          value={n}
          onInput={(e) => {
            const raw = (e.target as HTMLInputElement).value;
            if (raw === "") setN("");
            else setN(String(Math.max(1, Math.min(99, Number(raw) || 1))));
          }}
          onBlur={() => {
            if (!n || Number(n) < 1) setN("1");
          }}
          autoFocus
          aria-label="Number"
        />
        <select
          class="cust-pick__search dur__unit"
          value={unit}
          onChange={(e) =>
            setUnit((e.currentTarget as HTMLSelectElement).value as typeof unit)
          }
          aria-label="Unit"
        >
          <option value="days">Days</option>
          <option value="weeks">Weeks</option>
          <option value="months">Months</option>
        </select>
      </div>
      <div class="dur__presets">
        {presets.map((p) => {
          const active = n === p.n && unit === p.unit;
          return (
            <button
              key={p.label}
              type="button"
              class={`dur__chip ${active ? "dur__chip--active" : ""}`}
              onClick={() => {
                setN(p.n);
                setUnit(p.unit);
              }}
              disabled={sending}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div class="dur__preview">
        <span class="dur__preview-label">Contract reads:</span>
        <span class="dur__preview-val">{preview}</span>
      </div>
      <div class="cust-create__actions">
        <button
          type="button"
          class="cust-create__btn cust-create__btn--primary"
          onClick={() => onSubmit(preview)}
          disabled={!valid || sending}
        >
          Lock it in
        </button>
        <button
          type="button"
          class="cust-create__btn"
          onClick={() => {
            setPhase("ask");
            setParseFailed(false);
          }}
          disabled={sending}
        >
          Try a different way
        </button>
      </div>
    </div>
  );
}

/** Best-effort warranty-language parser. Recognises months/years and the
 *  "lifetime" / "no warranty" extremes that read naturally on a contract.
 *  Returns null when nothing matches — caller falls back to the manual
 *  form. Confidence mirrors the duration parser: "ok" for clean numerics,
 *  "guess" when we leaned on word-numbers or fuzzy phrases. */
function parseWarrantyGuess(text: string): {
  kind: "term" | "lifetime" | "none";
  n?: number;
  unit?: "days" | "months" | "years";
  confidence: "ok" | "guess";
} | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;
  if (/\blifetime\b|\bforever\b|\blife\b/.test(t)) {
    return { kind: "lifetime", confidence: "ok" };
  }
  if (/\bno warranty\b|\bnone\b|\bno guarantee\b|\bas[- ]is\b/.test(t)) {
    return { kind: "none", confidence: "ok" };
  }
  let unit: "days" | "months" | "years";
  if (/\byears?\b|\byrs?\b/.test(t)) unit = "years";
  else if (/\bmonths?\b|\bmos?\b|\bmo\b/.test(t)) unit = "months";
  else if (/\bdays?\b|\bd\b/.test(t)) unit = "days";
  else return null;
  let n: number | null = null;
  let confidence: "ok" | "guess" = "guess";
  const numMatch = t.match(/(\d+(\.\d+)?)/);
  const wordNums: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    eighteen: 18,
    twenty: 20,
    thirty: 30,
    sixty: 60,
    ninety: 90,
  };
  if (numMatch) {
    n = Number(numMatch[1]);
    confidence = "ok";
  } else {
    for (const w of Object.keys(wordNums)) {
      if (new RegExp(`\\b${w}\\b`).test(t)) {
        n = wordNums[w];
        break;
      }
    }
  }
  if (/half a |a half|and a half/.test(t) && n !== null) n += 0.5;
  if (/\bcouple\b/.test(t) && n === null) n = 2;
  if (n === null) return null;

  // Normalise unwieldy values to a unit that reads better on a contract:
  //   "370 days" → "1 year"  (within ±30 days of a whole year)
  //   "180 days" → "6 months"
  //   "24 months" → "2 years" (clean multiples only)
  // Confidence drops to "guess" whenever we transform the unit so the
  // verify card flags it for the user instead of looking certain.
  if (unit === "days" && n >= 330) {
    const years = Math.round(n / 365);
    if (years >= 1 && Math.abs(n - years * 365) <= 30) {
      n = years;
      unit = "years";
      confidence = "guess";
    } else {
      n = Math.round(n / 30);
      unit = "months";
      confidence = "guess";
    }
  } else if (unit === "days" && n >= 60) {
    n = Math.round(n / 30);
    unit = "months";
    confidence = "guess";
  } else if (unit === "months" && n >= 24 && n % 12 === 0) {
    n = n / 12;
    unit = "years";
  }

  const cap = unit === "days" ? 365 : unit === "months" ? 60 : 25;
  const rounded = Math.max(1, Math.min(cap, Math.round(n)));
  return { kind: "term", n: rounded, unit, confidence };
}

/** Inline warranty picker for the "What warranty do you stand behind?"
 *  step. Same two-phase Bossie pattern as the duration picker — natural
 *  chat, parse, then a structured verify form so the contract value is
 *  always confirmed by the user. Supports days/months/years plus the
 *  extremes (Lifetime, No warranty) that contractors actually use. */
function CustomWarrantyPickerForm(props: {
  sending: boolean;
  onSubmit: (warrantyStr: string) => void;
  onCancel: () => void;
}) {
  const { sending, onSubmit, onCancel } = props;
  const [phase, setPhase] = useState<"ask" | "verify">("ask");
  const [freeText, setFreeText] = useState("");
  const [parseFailed, setParseFailed] = useState(false);
  const [kind, setKind] = useState<"term" | "lifetime" | "none">("term");
  const [n, setN] = useState("12");
  const [unit, setUnit] = useState<"days" | "months" | "years">("months");
  const [confidence, setConfidence] = useState<"ok" | "guess" | "fail">("ok");
  const [heardFrom, setHeardFrom] = useState("");

  // Cap depends on unit so realistic warranty terms aren't truncated:
  // up to a year in days, 5 years in months, 25 years in years.
  const cap = unit === "days" ? 365 : unit === "months" ? 60 : 25;
  const num = Math.max(1, Math.min(cap, Number(n) || 0));
  const valid =
    kind !== "term" || (Number.isFinite(num) && num >= 1 && num <= cap);
  const unitLabel = num === 1 ? unit.replace(/s$/, "") : unit;
  const preview =
    kind === "lifetime"
      ? "Lifetime"
      : kind === "none"
        ? "No warranty"
        : valid
          ? `${num} ${unitLabel}`
          : "—";

  const presets: {
    label: string;
    apply: () => void;
  }[] = [
    {
      label: "No warranty",
      apply: () => {
        setKind("none");
      },
    },
    {
      label: "6 months",
      apply: () => {
        setKind("term");
        setN("6");
        setUnit("months");
      },
    },
    {
      label: "12 months",
      apply: () => {
        setKind("term");
        setN("12");
        setUnit("months");
      },
    },
    {
      label: "24 months",
      apply: () => {
        setKind("term");
        setN("24");
        setUnit("months");
      },
    },
  ];

  function tryParseAndAdvance() {
    const raw = freeText.trim();
    if (!raw) return;
    const parsed = parseWarrantyGuess(raw);
    setHeardFrom(raw);
    if (parsed) {
      setKind(parsed.kind);
      if (parsed.kind === "term") {
        setN(String(parsed.n));
        setUnit(parsed.unit!);
      }
      setConfidence(parsed.confidence);
      setParseFailed(false);
    } else {
      setConfidence("fail");
      setParseFailed(true);
    }
    setPhase("verify");
  }

  if (phase === "ask") {
    return (
      <div class="dur dur--ask" style="margin-top:8px">
        <div class="dur__bossie">
          <span class="dur__bossie-tag">Bossie</span>
          <span class="dur__bossie-msg">
            How long do you stand behind your work? Tell me however you want —
            "12 months", "1 year", "90 days", "lifetime". I'll show you what I
            heard before locking it in.
          </span>
        </div>
        <textarea
          class="cust-pick__search dur__textarea"
          placeholder="e.g. 1 year, 18 months, 90 days, lifetime…"
          value={freeText}
          onInput={(e) => setFreeText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              tryParseAndAdvance();
            }
          }}
          rows={2}
          autoFocus
        />
        <div class="dur__presets">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              class="dur__chip"
              onClick={() => {
                p.apply();
                setConfidence("ok");
                setHeardFrom(p.label);
                setParseFailed(false);
                setPhase("verify");
              }}
              disabled={sending}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            class="dur__chip dur__chip--ghost"
            onClick={() => {
              setHeardFrom("");
              setConfidence("fail");
              setParseFailed(true);
              setPhase("verify");
            }}
            disabled={sending}
          >
            Or set it manually
          </button>
        </div>
        <div class="cust-create__actions">
          <button
            type="button"
            class="cust-create__btn cust-create__btn--primary"
            onClick={tryParseAndAdvance}
            disabled={sending || !freeText.trim()}
          >
            Continue →
          </button>
          <button
            type="button"
            class="cust-create__btn"
            onClick={onCancel}
            disabled={sending}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="dur dur--verify" style="margin-top:8px">
      <div class="dur__head">
        <strong class="dur__title">
          {confidence === "fail"
            ? "Set the warranty"
            : confidence === "guess"
              ? "Did I hear that right?"
              : "Got it — confirm and we'll lock it in"}
        </strong>
        {heardFrom ? (
          <span class="dur__sub">
            You said: <em>"{heardFrom}"</em>
          </span>
        ) : (
          <span class="dur__sub">
            Pick a length — I'll write it into the contract.
          </span>
        )}
        {confidence === "guess" ? (
          <span class="dur__warn">
            ⚠ Best guess — please double-check before locking in.
          </span>
        ) : null}
        {parseFailed ? (
          <span class="dur__warn">
            I couldn't read that as a warranty term — set it manually.
          </span>
        ) : null}
      </div>
      <div class="dur__row">
        <select
          class="cust-pick__search dur__unit"
          value={kind}
          onChange={(e) =>
            setKind((e.currentTarget as HTMLSelectElement).value as typeof kind)
          }
          aria-label="Warranty type"
        >
          <option value="term">Set a term</option>
          <option value="lifetime">Lifetime</option>
          <option value="none">No warranty</option>
        </select>
      </div>
      {kind === "term" ? (
        <div class="dur__row">
          <input
            type="number"
            class="cust-pick__search dur__num"
            inputMode="numeric"
            min={1}
            max={cap}
            value={n}
            onInput={(e) => {
              const raw = (e.target as HTMLInputElement).value;
              if (raw === "") setN("");
              else setN(String(Math.max(1, Math.min(cap, Number(raw) || 1))));
            }}
            onBlur={() => {
              if (!n || Number(n) < 1) setN("1");
            }}
            autoFocus
            aria-label="Number"
          />
          <select
            class="cust-pick__search dur__unit"
            value={unit}
            onChange={(e) => {
              const next = (e.currentTarget as HTMLSelectElement)
                .value as typeof unit;
              const nextCap =
                next === "days" ? 365 : next === "months" ? 60 : 25;
              if (Number(n) > nextCap) setN(String(nextCap));
              setUnit(next);
            }}
            aria-label="Unit"
          >
            <option value="days">Days</option>
            <option value="months">Months</option>
            <option value="years">Years</option>
          </select>
        </div>
      ) : null}
      <div class="dur__presets">
        {presets.map((p) => {
          const active = p.label === preview;
          return (
            <button
              key={p.label}
              type="button"
              class={`dur__chip ${active ? "dur__chip--active" : ""}`}
              onClick={() => p.apply()}
              disabled={sending}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div class="dur__preview">
        <span class="dur__preview-label">Contract reads:</span>
        <span class="dur__preview-val">{preview}</span>
      </div>
      <div class="cust-create__actions">
        <button
          type="button"
          class="cust-create__btn cust-create__btn--primary"
          onClick={() => onSubmit(preview)}
          disabled={!valid || sending}
        >
          Lock it in
        </button>
        <button
          type="button"
          class="cust-create__btn"
          onClick={() => {
            setPhase("ask");
            setParseFailed(false);
          }}
          disabled={sending}
        >
          Try a different way
        </button>
      </div>
    </div>
  );
}

/** Best-effort free-text payment-terms parser. Recognises "Net X" (single
 *  payment), comma/slash-separated percentage splits ("50/50", "30 30 40"),
 *  and "paid upfront / in full" phrasings. Returns null when nothing maps
 *  cleanly so the verify form falls back to manual mode. */
function parsePaymentGuess(text: string): {
  mode: "net" | "split";
  netDays?: number;
  splits?: number[];
  confidence: "ok" | "guess";
} | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;

  // Net X — single payment X days after invoice. "net 30", "net15", "net-7".
  const netMatch = t.match(/\bnet[\s-]*(\d{1,3})\b/);
  if (netMatch) {
    const days = Math.max(0, Math.min(180, parseInt(netMatch[1], 10)));
    return { mode: "net", netDays: days, confidence: "ok" };
  }

  // "Due on completion / on delivery / when done / same day" → Net 0.
  if (
    /\b(on (completion|delivery|done|finish)|when (done|finished|complete)|same[\s-]?day|on the day|due on)\b/.test(
      t,
    )
  ) {
    return { mode: "net", netDays: 0, confidence: "guess" };
  }

  // "Paid upfront / in full / 100%" → 100/0 split (deposit-only).
  if (/\b(upfront|up front|in full|100\s*%|prepay|prepaid)\b/.test(t)) {
    return { mode: "split", splits: [100, 0], confidence: "guess" };
  }

  // Substitute fraction-words with their digit values so the digit extractor
  // picks them up alongside explicit percentages. Critical: "half now, 40%
  // midway, 10% at end" must yield [50, 40, 10] — never short-circuit on
  // "half" alone before reading the rest of the sentence.
  const subbed = t
    .replace(/\btwo[\s-]thirds?\b/g, "67")
    .replace(/\bthree[\s-]quarters?\b/g, "75")
    .replace(/\b(?:a |one )?third\b/g, "33")
    .replace(/\b(?:a |one )?quarter\b/g, "25")
    .replace(/\bhalves\b/g, "50")
    .replace(/\bhalf\b/g, "50");

  // Percentage splits — pull every 1-3 digit run, keep only those that read
  // like milestone shares (≤100 each).
  const numMatches = Array.from(subbed.matchAll(/(\d{1,3})\s*%?/g))
    .map((m) => parseInt(m[1], 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 100);
  if (numMatches.length >= 2) {
    let nums = numMatches.slice();
    // Strip a trailing "100" total mention when prior numbers already sum to 100.
    if (nums.length >= 3) {
      const lead = nums.slice(0, -1).reduce((a, b) => a + b, 0);
      if (lead === 100 && nums[nums.length - 1] === 100) {
        nums = nums.slice(0, -1);
      }
    }
    // Cap to 4 milestones, keep the first occurrences (closer to user intent
    // than trailing summary mentions).
    if (nums.length > 4) nums = nums.slice(0, 4);
    const sum = nums.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) <= 1 && nums.length >= 2) {
      const conf = sum === 100 && /[\/,]/.test(t) ? "ok" : "guess";
      return { mode: "split", splits: nums, confidence: conf };
    }
  }

  // Single fraction or percent — assume remainder lands on completion.
  // "a third up front" → 33/67, "30% deposit" → 30/70.
  if (numMatches.length === 1 && numMatches[0] > 0 && numMatches[0] < 100) {
    const dep = numMatches[0];
    return {
      mode: "split",
      splits: [dep, 100 - dep],
      confidence: "guess",
    };
  }

  return null;
}

/** Inline payment-terms picker for the payment_terms "Custom" option.
 *  Two-phase Bossie flow mirroring the duration picker: chat-style ask →
 *  deterministic parser → structured verify form (Net days OR milestone
 *  splits). The contract value always comes from the verify form's preview
 *  string so a parser miss never propagates downstream. */
function CustomPaymentPickerForm(props: {
  sending: boolean;
  onSubmit: (paymentStr: string) => void;
  onCancel: () => void;
}) {
  const { sending, onSubmit, onCancel } = props;
  const [phase, setPhase] = useState<"ask" | "verify">("ask");
  const [freeText, setFreeText] = useState("");
  const [parseFailed, setParseFailed] = useState(false);
  const [mode, setMode] = useState<"net" | "split">("net");
  const [netDays, setNetDays] = useState("30");
  const [splits, setSplits] = useState<string[]>(["50", "50"]);
  const [confidence, setConfidence] = useState<"ok" | "guess" | "fail">("ok");
  const [heardFrom, setHeardFrom] = useState("");

  const days = Math.max(0, Math.min(180, Number(netDays) || 0));
  const splitNums = splits.map((s) =>
    Math.max(0, Math.min(100, Number(s) || 0)),
  );
  const splitSum = splitNums.reduce((a, b) => a + b, 0);
  const splitsValid = splitNums.length >= 2 && splitSum === 100;

  const preview =
    mode === "net"
      ? days === 0
        ? "Net 0 — due on completion"
        : `Net ${days}`
      : splitsValid
        ? splitNums.join(" / ")
        : "—";

  const valid = mode === "net" ? Number.isFinite(days) : splitsValid;

  const presets: { label: string; apply: () => void }[] = [
    {
      label: "Payment upon completion",
      apply: () => {
        setMode("net");
        setNetDays("0");
      },
    },
    {
      label: "50 / 50",
      apply: () => {
        setMode("split");
        setSplits(["50", "50"]);
      },
    },
    {
      label: "30 / 30 / 40",
      apply: () => {
        setMode("split");
        setSplits(["30", "30", "40"]);
      },
    },
    {
      label: "Deposit + balance",
      apply: () => {
        setMode("split");
        setSplits(["25", "75"]);
      },
    },
  ];

  function applyParsed(p: ReturnType<typeof parsePaymentGuess>) {
    if (!p) return;
    if (p.mode === "net") {
      setMode("net");
      setNetDays(String(p.netDays ?? 30));
    } else {
      setMode("split");
      const arr = (p.splits ?? [50, 50]).slice(0, 4).map(String);
      while (arr.length < 2) arr.push("0");
      setSplits(arr);
    }
    setConfidence(p.confidence);
    setParseFailed(false);
  }

  function tryParseAndAdvance() {
    const raw = freeText.trim();
    if (!raw) return;
    const parsed = parsePaymentGuess(raw);
    setHeardFrom(raw);
    if (parsed) {
      applyParsed(parsed);
    } else {
      setConfidence("fail");
      setParseFailed(true);
    }
    setPhase("verify");
  }

  function setSplitAt(idx: number, raw: string) {
    const next = splits.slice();
    next[idx] =
      raw === "" ? "" : String(Math.max(0, Math.min(100, Number(raw) || 0)));
    setSplits(next);
  }

  function addMilestone() {
    if (splits.length >= 4) return;
    // Take 10% off the last milestone to seed the new one — keeps total
    // closer to 100 so the user has less rebalancing to do.
    const last = Math.max(0, Number(splits[splits.length - 1]) || 0);
    const seed = Math.min(last, 10);
    const next = splits.slice();
    next[next.length - 1] = String(last - seed);
    next.push(String(seed));
    setSplits(next);
  }

  function removeMilestone(idx: number) {
    if (splits.length <= 2) return;
    const removed = Number(splits[idx]) || 0;
    const next = splits.filter((_, i) => i !== idx);
    next[next.length - 1] = String(
      Math.min(100, (Number(next[next.length - 1]) || 0) + removed),
    );
    setSplits(next);
  }

  function autoBalance() {
    if (mode !== "split" || splits.length < 2) return;
    const lead = splitNums.slice(0, -1).reduce((a, b) => a + b, 0);
    const tail = Math.max(0, Math.min(100, 100 - lead));
    const next = splits.slice();
    next[next.length - 1] = String(tail);
    setSplits(next);
  }

  if (phase === "ask") {
    return (
      <div class="dur dur--ask" style="margin-top:8px">
        <div class="dur__bossie">
          <span class="dur__bossie-tag">Bossie</span>
          <span class="dur__bossie-msg">
            How do you want to get paid? Tell me however you want — "on
            completion", "50/50", "30/30/40", "deposit + balance". I'll show you
            what I heard before locking it in.
          </span>
        </div>
        <textarea
          class="cust-pick__search dur__textarea"
          placeholder="e.g. on completion, 50/50 split, deposit + balance…"
          value={freeText}
          onInput={(e) => setFreeText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              tryParseAndAdvance();
            }
          }}
          rows={2}
          autoFocus
        />
        <div class="dur__presets">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              class="dur__chip"
              onClick={() => {
                p.apply();
                setConfidence("ok");
                setHeardFrom(p.label);
                setParseFailed(false);
                setPhase("verify");
              }}
              disabled={sending}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            class="dur__chip dur__chip--ghost"
            onClick={() => {
              setHeardFrom("");
              setConfidence("fail");
              setParseFailed(true);
              setPhase("verify");
            }}
            disabled={sending}
          >
            Or set it manually
          </button>
        </div>
        <div class="cust-create__actions">
          <button
            type="button"
            class="cust-create__btn cust-create__btn--primary"
            onClick={tryParseAndAdvance}
            disabled={sending || !freeText.trim()}
          >
            Continue →
          </button>
          <button
            type="button"
            class="cust-create__btn"
            onClick={onCancel}
            disabled={sending}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="dur dur--verify pay" style="margin-top:8px">
      <div class="dur__head">
        <strong class="dur__title">
          {confidence === "fail"
            ? "Set your payment terms"
            : confidence === "guess"
              ? "Did I hear that right?"
              : "Got it — confirm and we'll lock it in"}
        </strong>
        {heardFrom ? (
          <span class="dur__sub">
            You said: <em>"{heardFrom}"</em>
          </span>
        ) : (
          <span class="dur__sub">
            Pick a mode and enter the numbers — I'll write it into the contract.
          </span>
        )}
        {confidence === "guess" ? (
          <span class="dur__warn">
            ⚠ Best guess — please double-check before locking in.
          </span>
        ) : null}
        {parseFailed ? (
          <span class="dur__warn">
            I couldn't read that as payment terms — set it manually.
          </span>
        ) : null}
      </div>

      <div class="pay__modes" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "net"}
          class={`pay__mode ${mode === "net" ? "pay__mode--active" : ""}`}
          onClick={() => setMode("net")}
          disabled={sending}
        >
          One payment
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "split"}
          class={`pay__mode ${mode === "split" ? "pay__mode--active" : ""}`}
          onClick={() => setMode("split")}
          disabled={sending}
        >
          Split payments
        </button>
      </div>

      {mode === "net" ? (
        <div class="pay__net">
          <label class="pay__net-label">
            Due
            <input
              type="number"
              class="cust-pick__search pay__net-num"
              inputMode="numeric"
              min={0}
              max={180}
              value={netDays}
              onInput={(e) => setNetDays((e.target as HTMLInputElement).value)}
              onBlur={() => {
                if (!netDays || Number(netDays) < 0) setNetDays("0");
              }}
              autoFocus
              aria-label="Days after invoice"
            />
            days after the invoice
          </label>
          <span class="pay__net-hint">
            {days === 0
              ? "0 = paid same day the work wraps."
              : `Customer has ${days} day${days === 1 ? "" : "s"} to pay after you send the invoice.`}
          </span>
        </div>
      ) : (
        <div class="pay__split">
          <div class="pay__split-rows">
            {splits.map((val, idx) => {
              const labelText =
                splits.length === 2
                  ? idx === 0
                    ? "Deposit"
                    : "On completion"
                  : idx === 0
                    ? "Deposit"
                    : idx === splits.length - 1
                      ? "On completion"
                      : `Milestone ${idx}`;
              return (
                <div key={idx} class="pay__split-row">
                  <input
                    type="number"
                    class="cust-pick__search pay__split-pct"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    value={val}
                    onInput={(e) =>
                      setSplitAt(idx, (e.target as HTMLInputElement).value)
                    }
                    onBlur={() => {
                      if (val === "") setSplitAt(idx, "0");
                    }}
                    aria-label={`${labelText} percentage`}
                  />
                  <span class="pay__split-pctsign">%</span>
                  <span class="pay__split-lbl">{labelText}</span>
                  {splits.length > 2 ? (
                    <button
                      type="button"
                      class="pay__split-del"
                      onClick={() => removeMilestone(idx)}
                      aria-label={`Remove ${labelText}`}
                      disabled={sending}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div class="pay__split-tools">
            {splits.length < 4 ? (
              <button
                type="button"
                class="dur__chip dur__chip--ghost"
                onClick={addMilestone}
                disabled={sending}
              >
                + Add milestone
              </button>
            ) : null}
            {!splitsValid ? (
              <button
                type="button"
                class="dur__chip"
                onClick={autoBalance}
                disabled={sending}
              >
                Auto-balance to 100%
              </button>
            ) : null}
            <span
              class={`pay__split-sum ${splitsValid ? "pay__split-sum--ok" : "pay__split-sum--bad"}`}
            >
              Total: {splitSum}%
            </span>
          </div>
        </div>
      )}

      <div class="dur__presets">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            class="dur__chip"
            onClick={p.apply}
            disabled={sending}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div class="dur__preview">
        <span class="dur__preview-label">Contract reads:</span>
        <span class="dur__preview-val">{preview}</span>
      </div>

      <div class="cust-create__actions">
        <button
          type="button"
          class="cust-create__btn cust-create__btn--primary"
          onClick={() => onSubmit(preview)}
          disabled={!valid || sending}
        >
          Lock it in
        </button>
        <button
          type="button"
          class="cust-create__btn"
          onClick={() => {
            setPhase("ask");
            setParseFailed(false);
          }}
          disabled={sending}
        >
          Try a different way
        </button>
      </div>
    </div>
  );
}

/** Find the most-recent locked (sent) action_card and return its totalCents,
 *  or 0 when no quote is bound to the conversation yet. Used by the live
 *  payment-step preview. */
function latestSentQuoteCents(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind !== "action_card") continue;
    const p = m.payload as ActionCardPayload | undefined;
    if (!p) continue;
    if (p.status === "sent" && typeof p.totalCents === "number")
      return p.totalCents;
  }
  return 0;
}
