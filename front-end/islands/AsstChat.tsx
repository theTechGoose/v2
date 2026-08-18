import { useEffect, useRef, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { detailLines } from "../lib/format.ts";
import {
  computePaymentSplit,
  type MilestoneRole,
} from "../lib/payment-split.ts";
import { api } from "../lib/api.ts";
import {
  assistantClient,
  type ContractLite,
  type CustomerLite,
  type JobOption,
  type Message,
} from "../clients/assistant.ts";
import { filesClient } from "../clients/files.ts";
import { quotesClient } from "../clients/quotes.ts";
import { clientsClient } from "../clients/clients.ts";
import { contractsClient } from "../clients/contracts.ts";
import { readCached, refreshDash, subscribeDash } from "../lib/dash-cache.ts";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";
import { localizeTermValue } from "../lib/term-i18n.ts";
import {
  type ChipKey,
  chipReply,
} from "../../shared/quote-flow/starter-chips.ts";
import { termLabel } from "../../shared/quote-flow/terms-i18n.ts";
import { versionTitle } from "../../shared/quote-flow/version-titles.ts";
import {
  TimeoutError,
  withChatTimeout,
} from "../../shared/quote-flow/chat-timeout.ts";
import {
  interpretSendResult,
  sendResultLangKey,
} from "../../shared/quote-flow/send-result.ts";
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
const TERM_OPTIONS_FALLBACK: Record<
  string,
  { labelKey: string; subKey?: string }[]
> = {
  config: [
    {
      labelKey: "asstChat.terms.config.residential",
      subKey: "asstChat.terms.config.residentialSub",
    },
    {
      labelKey: "asstChat.terms.config.commercial",
      subKey: "asstChat.terms.config.commercialSub",
    },
    {
      labelKey: "asstChat.terms.config.blank",
      subKey: "asstChat.terms.config.blankSub",
    },
  ],
  start_date: [
    { labelKey: "asstChat.terms.startDate.rightAway" },
    { labelKey: "asstChat.terms.startDate.nextWeek" },
    { labelKey: "asstChat.terms.startDate.nextMonth" },
  ],
  wraps: [
    { labelKey: "asstChat.duration.preset.oneDay" },
    { labelKey: "asstChat.duration.preset.twoThreeDays" },
    { labelKey: "asstChat.duration.preset.oneWeek" },
    { labelKey: "asstChat.duration.preset.twoWeeks" },
  ],
  payment_terms: [
    {
      labelKey: "asstChat.payment.preset.onCompletion",
      subKey: "asstChat.terms.payment.onCompletionSub",
    },
    {
      labelKey: "asstChat.payment.preset.fiftyFifty",
      subKey: "asstChat.terms.payment.fiftyFiftySub",
    },
    {
      labelKey: "asstChat.payment.preset.threeThreeForty",
      subKey: "asstChat.terms.payment.threeThreeFortySub",
    },
    {
      labelKey: "asstChat.payment.preset.depositBalance",
      subKey: "asstChat.terms.payment.depositBalanceSub",
    },
  ],
  warranty: [
    { labelKey: "asstChat.warranty.preset.none" },
    { labelKey: "asstChat.warranty.preset.sixMonths" },
    { labelKey: "asstChat.warranty.preset.twelveMonths" },
    { labelKey: "asstChat.warranty.preset.twentyFourMonths" },
  ],
  termination: [
    { labelKey: "asstChat.terms.termination.sevenDays" },
    { labelKey: "asstChat.terms.termination.fourteenDays" },
    { labelKey: "asstChat.terms.termination.thirtyDays" },
  ],
  dispute: [
    {
      labelKey: "asstChat.terms.dispute.mediation",
      subKey: "asstChat.terms.dispute.mediationSub",
    },
    {
      labelKey: "asstChat.terms.dispute.arbitration",
      subKey: "asstChat.terms.dispute.arbitrationSub",
    },
    {
      labelKey: "asstChat.terms.dispute.court",
      subKey: "asstChat.terms.dispute.courtSub",
    },
  ],
  governing_state: [
    { labelKey: "asstChat.terms.governingState.business" },
    { labelKey: "asstChat.terms.governingState.jobSite" },
  ],
  state_notices: [
    {
      labelKey: "asstChat.terms.stateNotices.yes",
      subKey: "asstChat.terms.stateNotices.yesSub",
    },
    {
      labelKey: "asstChat.terms.stateNotices.no",
      subKey: "asstChat.terms.stateNotices.noSub",
    },
    {
      labelKey: "asstChat.terms.stateNotices.review",
      subKey: "asstChat.terms.stateNotices.reviewSub",
    },
  ],
};

/** One editable bullet on the "Job Details" picker screen. `deleted`
 *  is a soft toggle (the "x"/restore affordance) so the row can be
 *  brought back without losing its text. */
interface BulletDraft {
  id: string;
  text: string;
  deleted: boolean;
}

/** Editable mirror of a server-returned JobOption — the picker lets the
 *  contractor delete/restore/edit bullets and append a custom one. */
interface JobOptionDraft {
  id: string;
  jobName: string;
  summary: string;
  bullets: BulletDraft[];
  /** Per-language content of the ORIGINAL (pre-edit) option, used to fill the
   *  quote's descriptionByLang on pick without re-translating unedited bullets. */
  byLang?: Record<
    string,
    { jobName: string; summary: string; bullets: string[] }
  >;
}

/** Sentinel id for the "write it myself" card — a free-text job description
 *  the contractor types verbatim instead of picking a generated option. */
const CUSTOM_OPTION_ID = "__custom__";

let bulletSeq = 0;
function toOptionDrafts(options: JobOption[]): JobOptionDraft[] {
  return options.map((o) => ({
    id: o.id,
    jobName: o.jobName,
    summary: o.summary,
    bullets: o.bullets.map((text) => ({
      id: `b${++bulletSeq}`,
      text,
      deleted: false,
    })),
    byLang: o.byLang,
  }));
}

/** Client-side last resort if the options endpoint itself errors (network
 *  / 4xx). The backend already returns a heuristic fallback on LLM failure,
 *  so this only fires when the request never completed. Mirrors that
 *  heuristic so the picker still renders three usable options. */
function localFallbackOptions(raw: string, lang: Lang): JobOption[] {
  const lines = raw
    .split(/[\n.;]+/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const base = (lines.length > 0 ? lines : [raw.trim()]).slice(0, 4);
  const summary = base[0]?.split(/\s+/).slice(0, 8).join(" ") ||
    tFor(lang, "asstChat.newJob");
  const jobName = summary.split(/\s+/).slice(0, 3).join(" ");
  // P-24: the three versions must be distinguishable at a glance. They used
  // to share one jobName verbatim (and the server's old scheme numbered the
  // collisions "(2)" / "(3)"), so the picker looked like the same job three
  // times. Each variant now carries the qualifier that describes what it IS.
  return [
    { id: "opt1", jobName, summary, bullets: base },
    {
      id: "opt2",
      jobName: versionTitle(jobName, "short", lang),
      summary,
      bullets: base.slice(0, 3),
    },
    {
      id: "opt3",
      jobName: versionTitle(jobName, "wider", lang),
      summary,
      bullets: [...base.slice(0, 3), tFor(lang, "asstChat.jobsiteCleanup")]
        .slice(0, 4),
    },
  ];
}

/** P-26: the preview's send button brands the ACTION ("Send by Text +
 *  Email"), never a "Click here to …" imperative. The EN channel dict values
 *  still carry the legacy prefix, so strip it here (ES values are already
 *  clean — this is the identity for them). */
function sendActionLabel(lang: Lang, key: string): string {
  const raw = tFor(lang, key);
  const stripped = raw.replace(
    /^\s*(click here to|haz clic aqu[ií] para)\s+/i,
    "",
  );
  if (stripped === raw) return raw;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** Split a chip reply into a bold lead + the rest for the details bubble
 *  (P-20). The lead runs to the first "—" or sentence period; the rest keeps
 *  its own leading punctuation/space so the markup can render
 *  <strong>{lead}</strong>{rest} verbatim. */
function chipBubbleParts(reply: string): { lead: string; rest: string } {
  const idx = reply.search(/[—.]/);
  if (idx <= 0) return { lead: reply, rest: "" };
  return { lead: reply.slice(0, idx), rest: reply.slice(idx) };
}

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

/** Compose the composer placeholder. During onboarding we want it to
 *  echo the question Bossie is asking rather than the generic job-mode
 *  slab example, otherwise new users wonder if they're in the right
 *  surface. After onboarding hands off, revert to the job example. */
function composerPlaceholder(msgs: Message[], lang: Lang): string {
  const lastAssistant = [...msgs].reverse().find((m) =>
    m.role === "assistant" && m.kind === "text"
  );
  const text = (lastAssistant?.content ?? "").toLowerCase();
  if (/what should i call you|what.s your (first )?name/.test(text)) {
    return tFor(lang, "asstChat.composer.firstName");
  }
  if (/what.s your business called|business name/.test(text)) {
    return tFor(lang, "asstChat.composer.businessName");
  }
  if (/looks like you.re in|which state|right state/.test(text)) {
    return tFor(lang, "asstChat.composer.stateCode");
  }
  if (/business address|paste it on one line/.test(text)) {
    return tFor(lang, "asstChat.composer.address");
  }
  if (/email/.test(text)) return tFor(lang, "asstChat.composer.email");
  if (/payment|venmo|zelle|cash app|how.*get paid/.test(text)) {
    return tFor(lang, "asstChat.composer.payment");
  }
  return tFor(lang, "asstChat.composer.default");
}

/** Map a Quote/Contract status to the human-facing chip label on the
 *  in-chat Quote+Agreement card. Keeps the chip in sync with the doc's
 *  lifecycle: Draft → Sent → Viewed → Approved. */
function statusChipLabel(status: string | undefined, lang: Lang): string {
  switch ((status ?? "draft").toLowerCase()) {
    case "sent":
      return tFor(lang, "status.sent");
    case "opened":
    case "viewed":
      return tFor(lang, "status.viewed");
    case "won":
    case "accepted":
    case "approved":
    case "signed":
      return tFor(lang, "asstChat.statusChip.approved");
    case "void":
    case "declined":
    case "lost":
      return tFor(lang, "status.declined");
    default:
      return tFor(lang, "status.draft");
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
  /** Contractor "FROM" details for the quote/agreement preview card
   *  (roadmap p.5 — Quote & Agreement Preview.docx). */
  from?: {
    business?: string;
    name?: string;
    phone?: string;
    email?: string;
  };
  /** Languages the contractor can send in (from Settings checkboxes). Drives
   *  the quote-review "Preview in" language toggle. Defaults to ["en"]. */
  sendLanguages?: string[];
  /** The contractor's own UI language — drives all contractor-facing chrome.
   *  Defaults to "en". (The customer-facing quote preview uses its own
   *  `previewLang` toggle, sourced from `sendLanguages`.) */
  lang?: Lang;
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
        if (bizParts.length >= 1) {
          return (parts[0][0] + bizParts[0][0]).toUpperCase();
        }
      }
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (biz) {
    const bizParts = biz.split(/\s+/).filter(Boolean);
    if (bizParts.length >= 2) {
      return (bizParts[0][0] + bizParts[1][0]).toUpperCase();
    }
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
  lang: Lang,
): PaymentMilestone[] | null {
  // All money comes from the shared #payment-split source of truth so this
  // preview matches the signed contract, the PDF, and the actual invoices.
  // Only the display labels live here.
  const parts = computePaymentSplit(value, totalCents);
  // A single full payment → return null so the caller shows the plain
  // Total Due (unchanged behavior for "net X" / unrecognized terms).
  if (parts.length === 0 || (parts.length === 1 && parts[0].role === "full")) {
    return null;
  }
  const labelFor: Record<MilestoneRole, string> = {
    deposit: tFor(lang, "asstChat.milestone.deposit"),
    midpoint: tFor(lang, "asstChat.milestone.midpoint"),
    milestone: tFor(lang, "asstChat.milestone.milestone"),
    completion: tFor(lang, "asstChat.milestone.completion"),
    full: tFor(lang, "asstChat.milestone.full"),
  };
  return parts.map((p) => ({
    label: labelFor[p.role],
    pct: p.pct,
    amountCents: p.amountCents,
  }));
}

/** Labels for the quote-review PREVIEW language toggle, and Spanish copy for
 *  the card chrome. Mirrors the customer-facing public quote/contract pages
 *  (routes/q/[id].tsx, contract-doc) so the contractor's preview matches what
 *  the customer actually receives. Free-text the contractor typed (term
 *  values, line-item names) stays verbatim — exactly like the public pages. */
/** Language endonym labels for the preview toggle. Keyed by send-language
 *  code; the value (endonym) is identical across UI languages, so the
 *  i18n key resolves to the same string regardless of `previewLang`. */
const SEND_LANG_LABEL_KEYS: Record<string, string> = {
  en: "asstChat.previewLang.en",
  es: "asstChat.previewLang.es",
};
/** Term-row label keys by wizard stepId. The preview resolves these in the
 *  selected preview language (so the row label matches the agreement the
 *  customer receives), falling back to the stored label for unknown steps. */
const TERM_LABEL_KEYS: Record<string, string> = {
  config: "asstChat.preview.termLabel.config",
  start_date: "asstChat.preview.termLabel.startDate",
  wraps: "asstChat.preview.termLabel.wraps",
  time_to_complete: "asstChat.preview.termLabel.timeToComplete",
  payment_terms: "asstChat.preview.termLabel.payment",
  warranty: "asstChat.preview.termLabel.warranty",
};

export default function AsstChat({
  conversationId,
  initialMessages,
  initialCustomer,
  initialContract,
  userInitials = "?",
  from,
  sendLanguages,
}: Props) {
  // Self-source the reactive UI language so this island re-renders live when
  // the contractor flips the language in Settings. `lang?: Lang` remains on
  // Props as an optional SSR seed but is intentionally ignored here.
  const lang = langSignal.value;
  // Languages offered in the quote-review "Preview in" toggle. Start from the
  // contractor's configured send languages, but ALWAYS include their app
  // language (first → the default) so e.g. a Spanish-app contractor can always
  // preview/send in Spanish even when their send languages are English-only.
  const previewLangOptions =
    (sendLanguages && sendLanguages.length ? sendLanguages : ["en"]).filter((
      l,
    ) => l in SEND_LANG_LABEL_KEYS);
  const sendLangs = Array.from(new Set([lang, ...previewLangOptions]))
    .filter((l) => l in SEND_LANG_LABEL_KEYS);
  const [convoId, setConvoId] = useState<string | undefined>(conversationId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [customer, setCustomer] = useState<CustomerLite | undefined>(
    initialCustomer,
  );
  const [contract, setContract] = useState<ContractLite | undefined>(
    initialContract,
  );
  /** Per-user "see what your customer sees" sample quote URL. Minted
   *  lazily — eagerly fetched on mount when the synthetic onboarding-
   *  handoff CTA is in the thread so cmd+click works without a round-
   *  trip. The click handler falls back to inline mint+open if this
   *  isn't ready yet. */
  const [sampleQuoteUrl, setSampleQuoteUrl] = useState<string | undefined>(
    undefined,
  );
  /** Swap-customer pencil in the quote-review hero. Lazily loads the
   *  user's saved customers on first open. */
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerPickerList, setCustomerPickerList] = useState<
    CustomerLite[] | null
  >(null);
  const [customerPickerSearch, setCustomerPickerSearch] = useState("");
  const [customerPickerBusy, setCustomerPickerBusy] = useState(false);
  const [quoteId, setQuoteId] = useState<string | undefined>();
  /** Full quote row, fetched lazily when the conversation has a quoteId.
   *  Used by the post-wizard quote-review preview to render `description`
   *  + `lineItems` without depending on an in-thread action_card. */
  const [quote, setQuote] = useState<
    | {
      id: string;
      summary?: string;
      /** ≤3-word job title — the platform-wide identifier (roadmap p.10). */
      jobName?: string;
      description?: string;
      descriptionByLang?: Record<string, string>;
      lineItems?: {
        description: string;
        quantity?: number;
        unit?: string;
        price?: number;
      }[];
      estimatedTotal?: number;
    }
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
  /** Which starter chip opened the current flow (P-20). Drives the
   *  intent-appropriate first reply on the job-details screen — the
   *  "job done, need to invoice" chip must never be answered with quote
   *  copy. Null before any chip is tapped. */
  const [flowChip, setFlowChip] = useState<ChipKey | null>(null);
  const [pendingPriceCents, setPendingPriceCents] = useState<number | null>(
    null,
  );
  /** First-button flow is now "details first, price second." When the user
   *  taps "I know my price, write it up." we ask for the job details up
   *  front and stash the raw text here. After the user types it and
   *  submits, we flip to the price-capture screen with this populated,
   *  and the price-Continue handler combines both pieces to build the
   *  quote. (The other two flows ignore this — they go through the LLM.) */
  const [pendingJobDetailsRaw, setPendingJobDetailsRaw] = useState<
    string | null
  >(null);
  /** Captures the raw text the user submitted at the job-details step
   *  so we can render an optimistic user bubble + "Polishing…" indicator
   *  while the polish + create-quote + transition chain runs. */
  const [submittedJobDetails, setSubmittedJobDetails] = useState<string | null>(
    null,
  );
  /** "Job Details" picker screen (the LLM-generated scope-of-work options).
   *  Shown at the END of phase 2, right before the quote review. */
  const [jobOptionsOpen, setJobOptionsOpen] = useState(false);
  // Roadmap p.10: "I know the job, help me price it." — when set, the
  // price-capture screen shows three LLM-suggested tiers (+ custom entry).
  const [suggestPricing, setSuggestPricing] = useState(false);
  const [priceSuggestions, setPriceSuggestions] = useState<
    Array<
      { tier: string; label: string; priceCents: number; rationale: string }
    > | null
  >(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [jobOptions, setJobOptions] = useState<JobOptionDraft[] | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  /** Which bullet is open for inline edit, keyed by option+bullet id. */
  const [editingBullet, setEditingBullet] = useState<
    { optionId: string; bulletId: string } | null
  >(null);
  /** Which option's TITLE is open for inline edit (null = none). */
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  /** When set, renders the "Want me to professionalize that?" popup for
   *  the bullet that was just edited or added. */
  const [proPopup, setProPopup] = useState<
    { optionId: string; bulletId: string } | null
  >(null);
  const [proBusy, setProBusy] = useState(false);
  /** "Write it myself" editor on the job-details step (roadmap p.5): the
   *  contractor types the scope one item per line, then can ask Bossie to
   *  "Professionalize that" — the polished items come back as a PROPOSAL
   *  they accept / edit-in-place / discard before anything is applied. */
  const [writeMyselfOpen, setWriteMyselfOpen] = useState(false);
  /** Whether the editor textarea currently has content (gates the
   *  Professionalize button without re-rendering on every keystroke). */
  const [wmHasText, setWmHasText] = useState(false);
  /** The professionalized items proposed by the backend — NOT yet applied
   *  to the user's textarea (they accept/edit first). */
  const [wmProposal, setWmProposal] = useState<string[] | null>(null);
  /** True while the proposal is editable in place (Edit was clicked). */
  const [wmEditingProposal, setWmEditingProposal] = useState(false);
  const [wmBusy, setWmBusy] = useState(false);
  const [wmError, setWmError] = useState<string | undefined>(undefined);
  /** Uncontrolled editor value (same pattern as customDraftRef — typing must
   *  not re-render this whole island). */
  const wmDraftRef = useRef<string>("");
  const wmTaRef = useRef<HTMLTextAreaElement | null>(null);
  const wmProposalTaRef = useRef<HTMLTextAreaElement | null>(null);
  /** In-flight options generation, kicked off the moment the user submits
   *  the raw job-details bubble so the LLM runs while they type the price. */
  const optionsInFlightRef = useRef<
    Promise<{ options: JobOption[] } | null> | null
  >(null);
  /** Snapshot of a bullet's text at edit-start, so commit can tell whether
   *  it actually changed (and only then offer to professionalize). */
  const editOriginalRef = useRef<string>("");
  /** Title text at edit-start, so commit can skip no-op renames. */
  const titleOriginalRef = useRef<string>("");
  /** Uncontrolled "write it myself" textarea value — kept in a ref (not state)
   *  so typing doesn't re-render this whole island, and persists across the
   *  card unmount/remount when the contractor toggles the selection. */
  const customDraftRef = useRef<string>("");
  /** Set once the user starts editing the picker (delete/edit/add). Blocks
   *  the silent heuristic→LLM upgrade so we never clobber their changes. */
  const optionsTouchedRef = useRef(false);
  /** Inline-edit + "add your own" inputs are UNCONTROLLED (defaultValue,
   *  commit on blur/Enter). Re-rendering this whole island on every keystroke
   *  was dropping characters and lagging — so we read values from the DOM at
   *  commit time instead of tracking them in state. */
  const addInputRef = useRef<HTMLInputElement | null>(null);
  const editEscapedRef = useRef(false);
  /** True when this conversation entered phase 2 via the "I know my price"
   *  flow and still owes the Job Details picker before the quote review.
   *  Driven by a sessionStorage marker so it survives the page load that
   *  hands off into the terms wizard. */
  const [needsJobPolish, setNeedsJobPolish] = useState(false);
  /** Raw job-details text carried from phase 1, used to (re)generate the
   *  scope-of-work options in phase 2. */
  const jobPolishRawRef = useRef<string | null>(null);
  /** The "Ready to send" CTA whose review we deferred until the picker is
   *  done. Set when we intercept it; consumed by applyJobOption. */
  const pendingReviewCtaRef = useRef<string | null>(null);
  /** Inline contact-recovery inputs keyed by the failure phase_divider id.
   *  When SendContract reports a missing/invalid email or phone, we let
   *  the user type it right under the divider; saving patches the
   *  customer profile so we have it next time too. */
  const [recoveryDraft, setRecoveryDraft] = useState<
    Record<string, { email?: string; phone?: string }>
  >({});
  const [recoverySavingId, setRecoverySavingId] = useState<string | null>(null);
  /** Selected channel for the quote-review send action. Smart-defaults
   *  from customer.email/phoneNumber: both → both, email-only → email,
   *  phone-only → sms. Overridable via the split-button chevron menu. */
  const [sendChannel, setSendChannel] = useState<"email" | "sms" | "both">(
    "both",
  );
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  /** Transient "Link copied!" feedback for the send menu's copy-link action
   *  (roadmap: copy link alongside email / text / text+email). */
  const [linkCopied, setLinkCopied] = useState(false);
  /** The pick popped by the last wizard rewind — highlighted on the
   *  re-asked step's matching option so Back restores the prior selection
   *  (roadmap p.8). Cleared on the next answer. */
  const [rewindAnswer, setRewindAnswer] = useState<
    { stepId: string; optionId: string; customValue?: string } | null
  >(null);
  /** Job-details picker mode. "polish" = the classic end-of-phase-2 pass
   *  that patches the existing quote. "confirm" = the roadmap p.18 order for
   *  "I know the job, help me price it.": details → CONFIRM → pricing →
   *  wizard — the picker runs pre-quote and its pick feeds quote creation. */
  const [pickerMode, setPickerMode] = useState<"polish" | "confirm">("polish");
  /** The option confirmed in "confirm" mode — consumed by startQuoteFromRaw
   *  so the quote is created with the confirmed title/summary/bullets (and
   *  the end-of-flow picker is skipped). */
  const confirmedOptionRef = useRef<JobOptionDraft | null>(null);
  /** Doc type for the finished-flow review (roadmap: "swap between quote and
   *  invoice"). "invoice" sends a standalone invoice — no signature, no
   *  terms — instead of the Quote + Agreement. */
  const [reviewDocType, setReviewDocType] = useState<"quote" | "invoice">(
    "quote",
  );
  /** Set once the swapped invoice is created+sent: drives the success panel
   *  with the public /i/:id link. The ref keeps the create idempotent if
   *  dispatch fails and the user retries. */
  const [swapInvoiceSent, setSwapInvoiceSent] = useState<string | null>(null);
  /** Honest swap-send outcome (P-09): the invoice endpoints report logical
   *  failure as HTTP 200 + {ok:false, reason}, so the swap panel must read
   *  the BODY — never just Response.ok. When a leg fails this holds the
   *  divider lang key (sendContract.divider.noEmail / .emailFailed) plus
   *  the server's reason text, rendered like the honest contract-send
   *  divider. Null = everything requested was delivered. */
  const [swapSendFail, setSwapSendFail] = useState<
    { key: string; reason: string } | null
  >(null);
  const swapInvoiceIdRef = useRef<string | null>(null);
  const [swapLinkCopied, setSwapLinkCopied] = useState(false);
  /** "Job done, need to invoice." starter (roadmap p.3): marks the pre-quote
   *  details→price capture as invoice-bound, then collects the customer
   *  through the standard wizard CustomerStepPanel and creates a standalone
   *  invoice. */
  const [invoiceFlow, setInvoiceFlow] = useState(false);
  const [invoiceCustomerOpen, setInvoiceCustomerOpen] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState<
    { id: string; customerEmail?: string; customerPhone?: string } | null
  >(null);
  const [invLinkCopied, setInvLinkCopied] = useState(false);
  /** Language the quote-review card is PREVIEWED in (and sent in). The
   *  contractor flips it with the "Preview in" toggle; defaults to their app
   *  language until they explicitly pick one. */
  const [previewLang, setPreviewLang] = useState<"en" | "es">(
    (sendLangs[0] as "en" | "es") ?? "en",
  );
  // Until the contractor explicitly taps a "Preview in" pill, keep the preview
  // following their app language — so a Spanish-app contractor sees the quote
  // in Spanish even if the app language only resolved after first render
  // (e.g. profile/impersonation loaded late).
  const previewLangPickedRef = useRef(false);
  useEffect(() => {
    if (!previewLangPickedRef.current) {
      setPreviewLang(lang === "es" ? "es" : "en");
    }
  }, [lang]);
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
  const [customTermDraft, setCustomTermDraft] = useState<
    {
      stepId: string;
      value: string;
    } | null
  >(null);
  /**
   * Set when the user clicks "Review" on the wizard's send CTA. Drives the
   * inline contract preview card (total/customer/dates) so the user can
   * actually look the contract over before clicking "Send to client".
   */
  const [previewCtaId, setPreviewCtaId] = useState<string | null>(null);

  // Lazily fill quote.descriptionByLang[lang] so the preview (and the sent
  // agreement, which reads the same field) render the job-details description
  // in the reader's language. Translates once per language, cached on the
  // quote, and only when a language is actually previewed/sent.
  const descLangInFlight = useRef<Set<string>>(new Set<string>());
  async function ensureDescriptionLang(targetLang: "en" | "es") {
    const id = quoteId ?? quote?.id;
    const base = (quote?.description ?? "").trim();
    if (!id || !base) return;
    if (quote?.descriptionByLang?.[targetLang]?.trim()) return;
    if (descLangInFlight.current.has(targetLang)) return;
    descLangInFlight.current.add(targetLang);
    try {
      const lines = base.split("\n").map((l) => l.trim()).filter(Boolean);
      const res = await assistantClient.translate(lines, targetLang);
      const translated =
        (res?.texts && res.texts.length === lines.length ? res.texts : lines)
          .join("\n");
      const merged = {
        ...(quote?.descriptionByLang ?? {}),
        [targetLang]: translated,
      };
      setQuote((q) => q ? { ...q, descriptionByLang: merged } : q);
      quotesClient.update(id, { descriptionByLang: merged }).catch(() => {});
    } catch {
      /* keep the base description */
    } finally {
      descLangInFlight.current.delete(targetLang);
    }
  }

  // When the preview is open, make sure the current preview language has a
  // translated description (keyed on description, not descriptionByLang, so
  // filling the cache doesn't re-trigger this effect).
  useEffect(() => {
    if (previewCtaId) ensureDescriptionLang(previewLang);
  }, [previewCtaId, previewLang, quote?.id, quote?.description]);
  /**
   * When the user picks a wizard option that carries a `followUp`, we stash
   * the (messageId, optionId) here and render the inline form instead of
   * firing the answer. Submitting clears it; cancelling clears it too.
   */
  const [followUpPick, setFollowUpPick] = useState<
    {
      messageId: string;
      optionId: string;
    } | null
  >(null);
  // start_date "Pick a date" — when armed, renders an inline date picker
  // in place of the option grid for that wizard message.
  const [customDatePick, setCustomDatePick] = useState<
    {
      messageId: string;
      optionId: string;
    } | null
  >(null);
  // wraps "Custom" — structured number + unit picker so the contract gets a
  // clean duration string ("3 weeks") without relying on free-text parsing.
  const [customDurationPick, setCustomDurationPick] = useState<
    {
      messageId: string;
      optionId: string;
    } | null
  >(null);
  // warranty "Custom" — same two-phase Bossie chat → verify pattern as the
  // duration picker, but tuned for warranty language (months/years/lifetime)
  // so the contract reads cleanly ("12 months", "2 years", "Lifetime").
  const [customWarrantyPick, setCustomWarrantyPick] = useState<
    {
      messageId: string;
      optionId: string;
    } | null
  >(null);
  // payment_terms "Custom" — chat-with-verify Bossie flow that produces a
  // clean payment string ("Net 30", "30 / 30 / 40") that buildPaymentMilestones
  // can parse. Free-text never lands on the contract directly.
  const [customPaymentPick, setCustomPaymentPick] = useState<
    {
      messageId: string;
      optionId: string;
    } | null
  >(null);
  // #27 — gates the third empty-state chip ("Nudge an overdue invoice").
  // null = unknown / not yet loaded → don't render the chip yet (avoids
  // flashing it on then yanking it away). Sourced from the shared dash
  // cache so we don't fire a third copy of /analytics/dashboard.
  const [, setOverdueCount] = useState<number | null>(() => {
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
  /** Re-fires the last failed chat turn (P-10): when a send times out or
   *  errors, the composer error strip offers one-tap retry instead of an
   *  endless spinner + lost message. Cleared on the next attempt. */
  const retryTurnRef = useRef<(() => void) | null>(null);
  const [canRetryTurn, setCanRetryTurn] = useState(false);

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
  /** Wraps the price-capture MoneyInput so [data-cy=pricing-option-custom]
   *  can focus its (visually hidden) input without reaching into MoneyInput. */
  const moneyBoxRef = useRef<HTMLDivElement | null>(null);

  // ── Assistant history stack ──────────────────────────────────────
  // Snapshots of UI-only state pushed before every user-initiated
  // view change; the universal back button pops the latest (see onBack).
  interface ViewSnapshot {
    priceCaptureOpen: boolean;
    awaitingJobDetails: boolean;
    submittedJobDetails: string | null;
    pendingJobDetailsRaw: string | null;
    pendingPriceCents: number | null;
    priceCents: number | null;
    jobOptionsOpen: boolean;
    writeMyselfOpen: boolean;
    flowChip: ChipKey | null;
  }
  const historyStackRef = useRef<ViewSnapshot[]>([]);

  function pushHistory() {
    historyStackRef.current.push({
      priceCaptureOpen,
      awaitingJobDetails,
      submittedJobDetails,
      pendingJobDetailsRaw,
      pendingPriceCents,
      priceCents,
      jobOptionsOpen,
      writeMyselfOpen,
      flowChip,
    });
  }

  function popHistory() {
    const snap = historyStackRef.current.pop();
    if (!snap) return;
    setPriceCaptureOpen(snap.priceCaptureOpen);
    setAwaitingJobDetails(snap.awaitingJobDetails);
    setSubmittedJobDetails(snap.submittedJobDetails);
    setPendingJobDetailsRaw(snap.pendingJobDetailsRaw);
    setPendingPriceCents(snap.pendingPriceCents);
    setPriceCents(snap.priceCents);
    setJobOptionsOpen(snap.jobOptionsOpen);
    setWriteMyselfOpen(snap.writeMyselfOpen);
    setFlowChip(snap.flowChip);
  }

  // The universal back button (ChatHeaderLive) dispatches `pm:asst-back`;
  // resolve what "back" means here, most-immediate action first:
  //   1. an active wizard step (last message, stepIdx > 0) → rewind a step
  //   2. an in-chat view on the stack (price capture / job details / …) → pop
  //   3. nothing left → leave the chat for the dashboard
  // No deps array (re-binds each render) so the closure reads current state.
  useEffect(() => {
    function onBack() {
      const last = messages[messages.length - 1];
      const wizardStepIdx =
        (last?.payload as { stepIdx?: number } | undefined)?.stepIdx;
      if (
        last?.kind === "wizard" && typeof wizardStepIdx === "number" &&
        wizardStepIdx > 0
      ) {
        goBackWizard();
        return;
      }
      if (historyStackRef.current.length > 0) {
        popHistory();
        return;
      }
      globalThis.location.href = "/dashboard";
    }
    globalThis.addEventListener("pm:asst-back", onBack);
    return () => globalThis.removeEventListener("pm:asst-back", onBack);
  });
  // ── end history stack ───────────────────────────────────────────

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
      .catch(() => {/* preview falls back to action_card */});
    return () => {
      cancelled = true;
    };
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
            jobName: q.jobName,
            description: q.description,
            lineItems: q.lineItems,
            estimatedTotal: q.estimatedTotal,
          });
        }
      })
      .catch(() => {/* silent — preview falls back to action_card */});
    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  // Phase-2 entry from the "I know my price" flow: a sessionStorage marker
  // (written just before the hand-off page load) carries the raw job
  // details. Kick off the scope-of-work generation NOW so it runs in the
  // background the whole time the user answers wizard questions — by the
  // time the wizard finishes, the Job Details picker opens instantly. The
  // marker is cleared once the picker is applied (see applyJobOption).
  useEffect(() => {
    if (!convoId) return;
    let raw: string | null = null;
    try {
      raw = globalThis.sessionStorage?.getItem(`pm:jobpolish:${convoId}`) ??
        null;
    } catch { /* sessionStorage unavailable — skip */ }
    if (!raw || !raw.trim()) return;
    jobPolishRawRef.current = raw;
    setNeedsJobPolish(true);
    if (!optionsInFlightRef.current) {
      optionsInFlightRef.current = assistantClient
        .generateJobOptions(raw)
        .catch((err) => {
          console.warn("[asst] phase-2 job-options generation failed:", err);
          return null;
        });
    }
  }, [convoId]);

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

  // /assistant?c=<conversationId> deep link: open THAT conversation in place.
  // The /assistant route SSRs with no thread bound, so we hydrate the target
  // conversation client-side. Once loaded, the universal back behaves exactly
  // as on /assistant/<id>: rewind an active wizard step → pop history →
  // (terminal / nothing left) exit to /dashboard.
  useEffect(() => {
    if (typeof globalThis.window === "undefined") return;
    if (conversationId) return; // the route already bound a conversation
    const target = new URL(globalThis.location.href).searchParams.get("c");
    if (!target) return;
    let cancelled = false;
    assistantClient
      .conversation(target)
      .then((detail) => {
        if (cancelled) return;
        setConvoId(target);
        if (Array.isArray(detail.messages)) setMessages(detail.messages);
        if (detail.customer) setCustomer(detail.customer);
        if (detail.contract) setContract(detail.contract);
        const qId =
          (detail.conversation as { quoteId?: string } | undefined)?.quoteId ??
            (detail.contract as { quoteId?: string } | undefined)?.quoteId;
        if (qId) setQuoteId(qId);
      })
      .catch(() => {/* stay on the empty state — back still exits */});
    return () => {
      cancelled = true;
    };
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
    let status = tFor(lang, "asstChat.header.default");
    if (contractStatus === "signed") {
      status = tFor(lang, "asstChat.header.contractSigned");
    } else if (contractStatus === "sent") {
      status = tFor(lang, "asstChat.header.contractOutForSignature");
    } else if (contract) {
      status = tFor(lang, "asstChat.header.contractDrafting");
    } else if (dividerPhase === 4) {
      status = tFor(lang, "asstChat.header.contractAccepted");
    } else if (dividerPhase === 3) {
      status = tFor(lang, "asstChat.header.contractSent");
    } else if (dividerPhase === 2) {
      status = tFor(lang, "asstChat.header.gatheringInfo");
    } else if (quoteStatus === "accepted") {
      status = tFor(lang, "asstChat.header.quoteAccepted");
    } else if (quoteStatus === "sent") {
      status = tFor(lang, "asstChat.header.quoteSent");
    } else if (lastQuoteCard) {
      status = tFor(lang, "asstChat.header.quoteDrafted");
    }
    // No status chip at all on a brand-new thread — "Drafting…" before
    // anything has been drafted reads as broken state.
    const headerClient = client ??
      (lastQuoteCard
        ? tFor(lang, "asstChat.header.conversation")
        : tFor(lang, "asstChat.header.newConversation"));
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
    lang,
  ]);

  // Keep the composer focused: on first mount (so users can just start typing)
  // and again whenever the assistant finishes a turn (sending: true → false).
  // Without this the textarea was getting blurred whenever it was disabled,
  // forcing a click back into the input between every message.
  useEffect(() => {
    if (!sending) taRef.current?.focus();
  }, [sending]);

  // Auto-focus the composer when the "awaiting job details" view appears
  // (user clicked "I know my price, write it up."). Without this the user
  // has to manually click the textarea before typing.
  useEffect(() => {
    if (awaitingJobDetails && !submittedJobDetails) {
      queueMicrotask(() => taRef.current?.focus());
    }
  }, [awaitingJobDetails, submittedJobDetails]);

  // Onboarding banner quick-reply chips (Yes / Different state / Skip /
  // Skip setup) dispatch this event with the reply text. AsstChat owns
  // the chat transport, so we forward the text through sendText so it
  // hits the same onboarding handler as a manually typed answer.
  useEffect(() => {
    function onQuickReply(e: Event) {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (typeof text === "string" && text.trim().length > 0) {
        void sendText(text);
      }
    }
    globalThis.addEventListener("pm:onboard-send-text", onQuickReply);
    return () =>
      globalThis.removeEventListener("pm:onboard-send-text", onQuickReply);
  }, []);

  // Eagerly mint the per-user sample quote URL once the synthetic
  // onboarding-handoff CTA appears in the thread. Cheap (server-side
  // idempotent) and ensures cmd+click on the link opens the right URL
  // without an inline round-trip.
  useEffect(() => {
    if (sampleQuoteUrl) return;
    const hasCta = messages.some(
      (m) => m.kind === "text" && m.content === "PM_ONBOARDING_DEMO_CTA",
    );
    if (!hasCta) return;
    let cancelled = false;
    assistantClient
      .ensureSampleQuote()
      .then((r) => {
        if (!cancelled) setSampleQuoteUrl(`/q/${r.quoteId}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [messages, sampleQuoteUrl]);

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
      const distFromBottom = scroller!.scrollHeight - scroller!.scrollTop -
        scroller!.clientHeight;
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
    if (el) {
      requestAnimationFrame(() =>
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
      );
    }
  }, [previewCtaId]);

  // While the inline quote-review preview is open and the bound contract
  // hasn't reached a terminal state (signed / declined), poll its row
  // every 8s so the status chip ticks forward as the customer interacts:
  //   Sent → Viewed (first public GET) → Approved (sign).
  // No SSE channel exists today; polling here is scoped to the preview
  // surface to keep traffic minimal.
  useEffect(() => {
    if (previewCtaId === null) return;
    const cid = contract?.id;
    if (!cid) return;
    const TERMINAL = new Set([
      "signed",
      "accepted",
      "approved",
      "declined",
      "void",
      "lost",
    ]);
    if (TERMINAL.has((contract?.status ?? "").toLowerCase())) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await contractsClient.get(cid);
        if (cancelled) return;
        setContract((cur) => {
          if (!cur || cur.id !== cid) return cur;
          if (cur.status === fresh.status) return cur;
          return { ...cur, ...fresh } as typeof cur;
        });
      } catch {
        /* swallow — next tick will retry */
      }
    };
    const id = globalThis.setInterval(tick, 8_000);
    return () => {
      cancelled = true;
      globalThis.clearInterval(id);
    };
  }, [previewCtaId, contract?.id, contract?.status]);

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
    // Floor at ~2 lines so the long example placeholder ("Ex: Customer wants a
    // 10'x10' slab, what should I charge?") wraps and stays readable on mobile
    // instead of clipping to a single line (problems.md #5).
    ta.style.height = Math.min(Math.max(ta.scrollHeight, 56), 120) + "px";
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
    retryTurnRef.current = null;
    setCanRetryTurn(false);
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
      // P-10: bound the turn client-side too — a hung backend/LLM call used
      // to spin forever with no error and no way out. After ~30s the send
      // rejects with a typed TimeoutError and the error strip offers Retry.
      const res = await withChatTimeout(submit());
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
        // in real time. Detection matches the stable leading literal of
        // each server ack template (everything before the first
        // `{placeholder}`) in BOTH languages, derived from the shared lang
        // dicts — the old English-only string match meant ES completions
        // never fired the payoff (P-33).
        const ackTemplatePrefix = (l: Lang, key: string): string =>
          tFor(l, key).split("{")[0].trim();
        const ACK_TEMPLATE_KEYS = [
          "onboarding.askBusiness", // "Nice to meet you," / "¡Mucho gusto,"
          "onboarding.askState", // "Almost there." / "Ya casi terminamos."
          "onboarding.askStateGuess",
          "onboarding.askAddress", // "Last one," / "La última,"
          "onboarding.handoff", // "Awesome — we're set," / "…ya está todo listo,"
        ];
        const ACK_LANGS: Lang[] = ["en", "es"];
        const ackPrefixes = ACK_LANGS.flatMap((l) =>
          ACK_TEMPLATE_KEYS.map((k) => ackTemplatePrefix(l, k))
        ).filter((p) => p.length > 0);
        const handoffPrefixes = ACK_LANGS.map((l) =>
          ackTemplatePrefix(l, "onboarding.handoff")
        ).filter((p) => p.length > 0);
        const onboardingHit = res.newMessages.some((msg) => {
          if (msg.role !== "assistant" || msg.kind !== "text") return false;
          const c = (msg.content ?? "").trim();
          return ackPrefixes.some((p) => c.startsWith(p));
        });
        const handoffFired = res.newMessages.some((msg) => {
          if (msg.role !== "assistant" || msg.kind !== "text") return false;
          const c = (msg.content ?? "").trim();
          return handoffPrefixes.some((p) => c.startsWith(p));
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
      // A timed-out turn gets a human message (not "Chat turn timed out
      // after 30000ms") — and every failure arms the one-tap Retry that
      // re-fires this exact turn.
      setError(
        err instanceof TimeoutError
          ? tFor(lang, "landing.cta.sendError")
          : err instanceof Error
          ? err.message
          : "send failed",
      );
      retryTurnRef.current = () => void submitTurn(optimistic, submit, onError);
      setCanRetryTurn(true);
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
    // The chat input is acting as the job-details answer surface: stash the
    // text and open the price screen (the quote + terms hand-off happens on
    // price Continue).
    if (awaitingJobDetails) {
      setDraft("");
      autosize();
      submitJobDetails(trimmed);
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
    const optimisticContent = liveTranscript && liveTranscript.length > 0
      ? liveTranscript
      : `🎙️ ${
        tFor(lang, "asstChat.voiceMemo.optimistic", {
          sec: elapsedSec,
          size: fmtKB(blob.size),
        })
      }`;
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
    if (invoiceFlow) {
      // "Job done, need to invoice." — no quote/wizard: go pick the customer
      // and mint the standalone invoice (roadmap p.3).
      pushHistory();
      openInvoiceCustomerStep();
      return;
    }
    if (pendingJobDetailsRaw && pendingJobDetailsRaw.trim().length > 0) {
      // Price + details in hand → create the quote now and hand off into the
      // terms wizard. The Job Details picker is deferred to the END of phase
      // 2 (right before the quote review): generation runs in the background
      // while the user answers wizard questions, so they never wait on it.
      // Keep the price screen mounted (its Continue flips to "Setting up…"
      // via `sending`) so we don't flash the prompts before navigating.
      void startQuoteFromRaw(pendingJobDetailsRaw, cents);
    } else {
      setPriceCaptureOpen(false);
      setAwaitingJobDetails(true);
    }
  }

  /**
   * Opens the "Job Details" picker at the end of phase 2. The generation
   * was kicked off on phase-2 mount and has been running the whole time the
   * user answered wizard questions, so it's almost always already resolved
   * → the picker opens instantly. We still render a local heuristic first
   * (so the screen is never blank) and silently swap in the LLM options when
   * they land, unless the user has already started editing.
   */
  async function openJobPicker() {
    const raw = (jobPolishRawRef.current ?? quote?.description ?? "").trim();
    optionsTouchedRef.current = false;
    setJobOptionsOpen(true);
    setOptionsLoading(false);
    const heuristic = toOptionDrafts(
      localFallbackOptions(raw || tFor(lang, "asstChat.newJob"), lang),
    );
    setJobOptions(heuristic);
    setSelectedOptionId(heuristic[0]?.id ?? null);

    const inflight = optionsInFlightRef.current ?? assistantClient
      .generateJobOptions(raw)
      .catch((err) => {
        console.warn(
          "[asst] job-options generation failed, keeping heuristic:",
          err,
        );
        return null;
      });
    optionsInFlightRef.current = null;
    const res = await inflight;
    if (res?.options && res.options.length > 0 && !optionsTouchedRef.current) {
      const drafts = toOptionDrafts(res.options);
      setJobOptions(drafts);
      setSelectedOptionId((prev) =>
        prev && drafts.some((d) => d.id === prev)
          ? prev
          : (drafts[0]?.id ?? null)
      );
    }
  }

  /**
   * Opens the Job Details picker as the CONFIRM step of the "help me price
   * it" flow (roadmap p.18: details → confirm → pricing → wizard). Runs
   * pre-quote: the pick is stashed on confirmedOptionRef and consumed by
   * startQuoteFromRaw, so the end-of-phase-2 polish pass is skipped.
   */
  async function openJobPickerForConfirm(raw: string) {
    setPickerMode("confirm");
    optionsTouchedRef.current = false;
    setJobOptionsOpen(true);
    setOptionsLoading(false);
    const heuristic = toOptionDrafts(
      localFallbackOptions(raw || tFor(lang, "asstChat.newJob"), lang),
    );
    setJobOptions(heuristic);
    setSelectedOptionId(heuristic[0]?.id ?? null);
    const res = await assistantClient.generateJobOptions(raw).catch((err) => {
      console.warn(
        "[asst] confirm-step option generation failed, keeping heuristic:",
        err,
      );
      return null;
    });
    if (res?.options && res.options.length > 0 && !optionsTouchedRef.current) {
      const drafts = toOptionDrafts(res.options);
      setJobOptions(drafts);
      setSelectedOptionId((prev) =>
        prev && drafts.some((d) => d.id === prev)
          ? prev
          : (drafts[0]?.id ?? null)
      );
    }
  }

  // ── Job Details picker handlers ──────────────────────────────────
  function toggleBulletDeleted(optionId: string, bulletId: string) {
    optionsTouchedRef.current = true;
    setJobOptions((prev) =>
      prev?.map((o) =>
        o.id === optionId
          ? {
            ...o,
            bullets: o.bullets.map((b) =>
              b.id === bulletId ? { ...b, deleted: !b.deleted } : b
            ),
          }
          : o
      ) ?? prev
    );
  }

  function setBulletText(optionId: string, bulletId: string, text: string) {
    setJobOptions((prev) =>
      prev?.map((o) =>
        o.id === optionId
          ? {
            ...o,
            bullets: o.bullets.map((
              b,
            ) => (b.id === bulletId ? { ...b, text } : b)),
          }
          : o
      ) ?? prev
    );
  }

  function startBulletEdit(
    optionId: string,
    bulletId: string,
    current: string,
  ) {
    optionsTouchedRef.current = true;
    editOriginalRef.current = current;
    setEditingBullet({ optionId, bulletId });
  }

  function setOptionName(optionId: string, name: string) {
    setJobOptions((prev) =>
      prev?.map((o) => (o.id === optionId ? { ...o, jobName: name } : o)) ??
        prev
    );
  }

  function startTitleEdit(optionId: string, current: string) {
    optionsTouchedRef.current = true;
    titleOriginalRef.current = current;
    setEditingTitleId(optionId);
  }

  /** Commit an inline title edit (uncontrolled input → value read on blur).
   *  Empty or unchanged input is a no-op so a stray click never blanks a
   *  heading. */
  function commitTitleEdit(optionId: string, value: string) {
    setEditingTitleId(null);
    const next = value.trim();
    if (!next || next === titleOriginalRef.current.trim()) return;
    setOptionName(optionId, next);
  }

  /** Commit an inline bullet edit (uncontrolled input → value read on blur).
   *  Updates state once; offers to professionalize only when the text
   *  actually changed. Empty input reverts to the original (no blank rows). */
  function commitBulletEdit(optionId: string, bulletId: string, value: string) {
    setEditingBullet(null);
    const next = value.trim();
    if (!next || next === editOriginalRef.current.trim()) return;
    setBulletText(optionId, bulletId, next);
    setProPopup({ optionId, bulletId });
  }

  /** Append the trailing "add your own" bullet, then offer to professionalize. */
  function addCustomBullet(optionId: string, raw: string) {
    const text = (raw ?? "").trim();
    if (!text) return;
    optionsTouchedRef.current = true;
    const id = `b${++bulletSeq}`;
    setJobOptions((prev) =>
      prev?.map((o) =>
        o.id === optionId
          ? { ...o, bullets: [...o.bullets, { id, text, deleted: false }] }
          : o
      ) ?? prev
    );
    setProPopup({ optionId, bulletId: id });
  }

  async function confirmProfessionalize() {
    if (!proPopup || proBusy) return;
    const { optionId, bulletId } = proPopup;
    const b = jobOptions?.find((o) => o.id === optionId)?.bullets.find((x) =>
      x.id === bulletId
    );
    if (!b) {
      setProPopup(null);
      return;
    }
    setProBusy(true);
    try {
      const res = await assistantClient.professionalizeBullet(b.text);
      if (res?.text) setBulletText(optionId, bulletId, res.text);
    } catch (err) {
      console.warn("[asst] professionalize failed, keeping text:", err);
    } finally {
      setProBusy(false);
      setProPopup(null);
    }
  }

  function dismissProfessionalize() {
    if (proBusy) return;
    setProPopup(null);
  }

  /**
   * Create the quote + conversation from the raw job-details text and hand
   * off into the terms wizard (phase 2). The Job Details picker is NOT shown
   * here — it's deferred to the end of phase 2. We stash the raw text in
   * sessionStorage (keyed by the new conversation id) so the phase-2 mount
   * can kick off generation in the background and re-open the picker before
   * the quote review. Navigation is a full page load, hence sessionStorage
   * rather than an in-memory promise.
   */
  async function startQuoteFromRaw(raw: string, cents: number) {
    if (sending) return;
    setError(undefined);
    setSubmittedJobDetails(raw.trim());
    setSending(true);
    try {
      // Roadmap p.18: when the details were CONFIRMED via the pre-quote
      // picker ("help me price it" flow), seed the quote from the confirmed
      // option — title, summary, bullets, and any pre-generated translations
      // — and skip the end-of-phase-2 polish pass entirely.
      const confirmed = confirmedOptionRef.current;
      const firstLine = raw.split("\n")[0].trim();
      const summary = confirmed?.summary ||
        firstLine.split(/\s+/).slice(0, 8).join(" ") ||
        tFor(lang, "asstChat.newJob");
      const jobName = confirmed?.jobName ||
        summary.split(/\s+/).slice(0, 3).join(" ");
      const byLang = confirmed?.byLang;
      const byLangFields = byLang
        ? {
          jobNameByLang: Object.fromEntries(
            Object.entries(byLang).map((
              [l, v],
            ) => [l, l === lang ? jobName : v.jobName]),
          ),
          summaryByLang: Object.fromEntries(
            Object.entries(byLang).map((
              [l, v],
            ) => [l, l === lang ? summary : v.summary]),
          ),
          descriptionByLang: Object.fromEntries(
            Object.entries(byLang).map((
              [l, v],
            ) => [l, l === lang ? raw.trim() : v.bullets.join("\n")]),
          ),
        }
        : {};
      // Use the api helper (same base as quotesClient/assistantClient) — NOT
      // a raw /api/* fetch. In prod the api helper hits the standalone backend
      // directly while /api/* bounces through the Fresh proxy; mixing the two
      // creates the quote on one backend and reads/updates it on another, so
      // the later GET/PUT /quotes/:id 404s. Keep all quote ops on one path.
      const quote = await api.post<{ id?: string }>("/quotes", {
        summary,
        jobName,
        description: raw.trim(),
        ...byLangFields,
        lineItems: [{
          description: summary,
          quantity: 1,
          unit: "ea",
          price: cents,
        }],
        estimatedTotal: cents,
        status: "sent",
      });
      if (!quote?.id) throw new Error("failed to create quote");

      // P-22: reuse the conversation minted when the details were submitted
      // (its id is already in the URL) instead of orphaning it behind a
      // second one. Falls back to creating one when the early mint failed.
      const conv = convoId
        ? await api.post<{ id?: string }>(
          `/agents/conversations/${convoId}/draft`,
          { quoteId: quote.id },
        )
        : await api.post<{ id?: string }>("/agents/conversations", {
          quoteId: quote.id,
        });
      if (!conv?.id) throw new Error("failed to start conversation");

      await api.post(`/agents/conversations/${conv.id}/transition-to-terms`);

      if (!confirmed) {
        try {
          globalThis.sessionStorage?.setItem(
            `pm:jobpolish:${conv.id}`,
            raw.trim(),
          );
        } catch { /* sessionStorage unavailable — picker just won't auto-open */ }
      }

      globalThis.location.href = `/assistant/${conv.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't start");
      setSubmittedJobDetails(null);
      setSending(false);
    }
  }

  /**
   * Apply the picked option at the end of phase 2: surviving bullets become
   * the quote description, the option's summary/jobName seed the quote and
   * its price line. Patches the existing quote (created in phase 1), then
   * opens the deferred quote review.
   */
  async function applyJobOption() {
    if (sending) return;
    let opt = jobOptions?.find((o) => o.id === selectedOptionId);
    // "Write it myself" — synthesize a draft from the free-text box: each
    // non-empty line becomes a bullet, the first line seeds the title/summary.
    // No byLang, so the customer-language copy is filled lazily on preview.
    if (selectedOptionId === CUSTOM_OPTION_ID) {
      const lines = customDraftRef.current
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        setError(tFor(lang, "asstChat.jobOpts.customEmpty"));
        return;
      }
      opt = {
        id: CUSTOM_OPTION_ID,
        // Job Names are ≤3 words platform-wide (roadmap p.10) — match the
        // LLM-side clampJobName instead of the old 5-word slice.
        jobName: lines[0].split(/\s+/).slice(0, 3).join(" "),
        summary: lines[0],
        bullets: lines.map((text, i) => ({
          id: `c${i}`,
          text,
          deleted: false,
        })),
      };
    }
    if (!opt) {
      setError(tFor(lang, "asstChat.error.pickOption"));
      return;
    }
    const live = opt.bullets.filter((b) =>
      !b.deleted && b.text.trim().length > 0
    );
    const liveTexts = live.map((b) => b.text.trim());
    const description = liveTexts.join("\n");
    const summary =
      (opt.summary || opt.jobName || tFor(lang, "asstChat.newJob"))
        .trim();
    const jobName = (opt.jobName || summary).trim();
    // CONFIRM mode (roadmap p.18): no quote exists yet — stash the confirmed
    // option and advance to the pricing screen. Suggestions are computed on
    // the CONFIRMED scope, so the three tiers price what was actually agreed.
    if (pickerMode === "confirm") {
      confirmedOptionRef.current = {
        ...opt,
        jobName,
        summary,
        bullets: live,
      };
      setPendingJobDetailsRaw(description || summary);
      setJobOptionsOpen(false);
      setPickerMode("polish");
      setPriceCaptureOpen(true);
      setPriceSuggestions(null);
      void fetchPriceSuggestions(description || summary);
      return;
    }
    setError(undefined);
    setSending(true);
    try {
      // Store the picked job details in EVERY language the option was generated
      // in, so the quote/agreement renders in the customer's language. Reuse the
      // pre-generated translation for unedited bullets; translate edited ones.
      const appLang = lang;
      const descByLang: Record<string, string> = {};
      if (liveTexts.length > 0) {
        descByLang[appLang] = description;
        const origApp = (opt.byLang?.[appLang]?.bullets ?? []).map((b) =>
          b.trim()
        );
        const unedited = liveTexts.length === origApp.length &&
          liveTexts.every((t, i) => t === origApp[i]);
        for (const ol of Object.keys(opt.byLang ?? {})) {
          if (ol === appLang) continue;
          const pre = opt.byLang?.[ol]?.bullets;
          if (unedited && pre && pre.length) {
            descByLang[ol] = pre.map((b) => b.trim()).join("\n");
          } else {
            try {
              const res = await assistantClient.translate(
                liveTexts,
                ol as "en" | "es",
              );
              descByLang[ol] = (res?.texts &&
                  res.texts.length === liveTexts.length
                ? res.texts
                : liveTexts).join("\n");
            } catch {
              descByLang[ol] = description;
            }
          }
        }
      }
      const hasByLang = Object.keys(descByLang).length > 0;
      // Per-language title + summary so the customer's agreement heading renders
      // in their language. The summary isn't editable, so it always reuses the
      // pre-generated translation. The TITLE is now editable — when the
      // contractor renames it, the pre-generated translations are stale, so we
      // re-translate the new title (and the app-lang entry always reflects the
      // edit so it shows for the contractor too).
      const nameByLang: Record<string, string> = {};
      const summByLang: Record<string, string> = {};
      const origAppName = opt.byLang?.[appLang]?.jobName?.trim() ?? "";
      const nameEdited = jobName !== origAppName;
      if (jobName) nameByLang[appLang] = jobName;
      for (const ol of Object.keys(opt.byLang ?? {})) {
        const b = opt.byLang?.[ol];
        if (b?.summary?.trim()) summByLang[ol] = b.summary.trim();
        if (ol === appLang) continue;
        if (!nameEdited && b?.jobName?.trim()) {
          nameByLang[ol] = b.jobName.trim();
        } else if (jobName) {
          try {
            const res = await assistantClient.translate(
              [jobName],
              ol as "en" | "es",
            );
            nameByLang[ol] = (res?.texts?.[0] ?? jobName).trim();
          } catch {
            nameByLang[ol] = jobName;
          }
        }
      }
      const hasName = Object.keys(nameByLang).length > 0;
      const hasSumm = Object.keys(summByLang).length > 0;
      if (quoteId) {
        const items = quote?.lineItems && quote.lineItems.length > 0
          ? quote.lineItems.map((
            li,
            i,
          ) => (i === 0 ? { ...li, description: summary } : li))
          : undefined;
        await quotesClient.update(quoteId, {
          description: description || summary,
          ...(hasByLang ? { descriptionByLang: descByLang } : {}),
          ...(hasName ? { jobNameByLang: nameByLang } : {}),
          ...(hasSumm ? { summaryByLang: summByLang } : {}),
          summary,
          jobName,
          ...(items ? { lineItems: items } : {}),
        });
        setQuote((q) =>
          q
            ? {
              ...q,
              summary,
              description: description || summary,
              ...(hasByLang ? { descriptionByLang: descByLang } : {}),
              lineItems: items ?? q.lineItems,
            }
            : q
        );
      }
      try {
        globalThis.sessionStorage?.removeItem(`pm:jobpolish:${convoId}`);
      } catch { /* ignore */ }
      setNeedsJobPolish(false);
      setJobOptionsOpen(false);
      const ctaId = pendingReviewCtaRef.current;
      pendingReviewCtaRef.current = null;
      if (ctaId) setPreviewCtaId(ctaId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "couldn't save job details",
      );
    } finally {
      setSending(false);
    }
  }

  /**
   * "Details-first" step of the "I know my price" flow: the user typed the
   * raw job description into the chat input. Stash it and open the price
   * screen. On price Continue, `startQuoteFromRaw` creates the quote and
   * hands off into the terms wizard; the Job Details picker is deferred to
   * the end of phase 2.
   */
  /**
   * P-22 — "mid-flow work silently lost." The details-first flow used to keep
   * everything in component state and only mint a conversation once the quote
   * existed, so the URL sat at /assistant and navigating away discarded the
   * work. Mint the conversation the moment real work exists, park the typed
   * details on it, and put its id in the address bar (replaceState, so the
   * in-flight UI is not torn down). startQuoteFromRaw then REUSES this
   * conversation instead of starting a second one.
   */
  async function ensureConversationForDraft(note: string) {
    if (convoId) return;
    try {
      const conv = await assistantClient.startConversation({});
      const id = conv?.id;
      if (!id) return;
      setConvoId(id);
      if (typeof globalThis.history !== "undefined") {
        globalThis.history.replaceState(null, "", `/assistant/${id}`);
      }
      await api.post(`/agents/conversations/${id}/draft`, { note });
    } catch {
      // Best-effort: a failed mint must never block the flow the user is in.
    }
  }

  function submitJobDetails(raw: string) {
    const trimmed = raw.trim();
    if (sending || !trimmed) return;
    setError(undefined);
    void ensureConversationForDraft(trimmed);
    pushHistory();
    setPendingJobDetailsRaw(trimmed);
    setSubmittedJobDetails(trimmed);
    setAwaitingJobDetails(false);
    if (suggestPricing) {
      // "Help me price it" (roadmap p.18): confirm the job details FIRST,
      // then price the confirmed scope. The picker's Continue advances to
      // the pricing screen via applyJobOption's confirm branch.
      void openJobPickerForConfirm(trimmed);
    } else {
      setPriceCaptureOpen(true);
    }
  }

  /**
   * In-flow step back ([data-cy=wizard-back], roadmap p.2/p.8): steps back
   * exactly ONE view using the same snapshots the universal back pops. When
   * the landing view is the job-details step, the composer is PREFILLED with
   * the previously typed details so they're editable — not blanked — and
   * re-sending regenerates the flow with the edits.
   */
  function wizardStepBack() {
    // "Help me price it": pricing came AFTER the confirm step — back reopens
    // the confirm picker instead of dumping to the start screen.
    if (priceCaptureOpen && suggestPricing && confirmedOptionRef.current) {
      setPriceCaptureOpen(false);
      setPriceCents(null);
      setPriceSuggestions(null);
      setPickerMode("confirm");
      setJobOptionsOpen(true);
      return;
    }
    const prevDetails = pendingJobDetailsRaw ?? submittedJobDetails ?? "";
    const landing =
      historyStackRef.current[historyStackRef.current.length - 1];
    if (landing) {
      popHistory();
      if (landing.awaitingJobDetails && prevDetails) {
        setDraft(prevDetails);
        requestAnimationFrame(() => {
          taRef.current?.focus();
          autosize();
        });
      }
      return;
    }
    // No snapshot to pop (deep-linked mid-flow) — close the capture back to
    // the empty-state prompts, mirroring the old inline reset.
    setPriceCaptureOpen(false);
    setPriceCents(null);
    setSuggestPricing(false);
    setPriceSuggestions(null);
  }

  /** Opens the "Write it myself" details editor on the job-details step. */
  function openWriteMyself() {
    pushHistory();
    setWriteMyselfOpen(true);
    setWmError(undefined);
    setWmProposal(null);
    setWmEditingProposal(false);
    setWmHasText(wmDraftRef.current.trim().length > 0);
    requestAnimationFrame(() => wmTaRef.current?.focus());
  }

  /**
   * "Professionalize that" (roadmap p.5): sends the editor's raw lines to
   * POST /agents/job-details/professionalize ({details} → {items}) and shows
   * the polished items as a proposal WITHOUT touching the user's textarea.
   */
  async function professionalizeWmDetails() {
    if (wmBusy) return;
    const details = (wmTaRef.current?.value ?? wmDraftRef.current).trim();
    if (!details) return;
    setWmError(undefined);
    setWmBusy(true);
    try {
      const res = await api.post<{ items?: string[] }>(
        "/agents/job-details/professionalize",
        { details },
      );
      const items = (res?.items ?? [])
        .map((s) => String(s).trim())
        .filter((s) => s.length > 0);
      if (items.length === 0) {
        throw new Error(tFor(lang, "asstChat.writeSelf.error"));
      }
      setWmProposal(items);
      setWmEditingProposal(false);
    } catch (err) {
      setWmError(
        err instanceof Error && err.message
          ? err.message
          : tFor(lang, "asstChat.writeSelf.error"),
      );
    } finally {
      setWmBusy(false);
    }
  }

  /** Makes the proposal editable in place, focused with the caret at the end
   *  so appended lines land after the proposed items. The trigger button is
   *  blurred synchronously so focus unambiguously belongs to the editor once
   *  it mounts (nothing else holds focus in between). */
  function editWmProposal(trigger?: HTMLElement | null) {
    trigger?.blur();
    setWmEditingProposal(true);
    requestAnimationFrame(() => {
      const ta = wmProposalTaRef.current;
      if (!ta) return;
      ta.focus();
      const len = ta.value.length;
      try {
        ta.setSelectionRange(len, len);
      } catch { /* selection unsupported — focus is enough */ }
    });
  }

  /** Applies the (possibly edited) proposal to the editor textarea and
   *  clears the proposal UI. */
  function acceptWmProposal() {
    const source = wmEditingProposal
      ? (wmProposalTaRef.current?.value ?? "")
      : (wmProposal ?? []).join("\n");
    const text = source
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    setWmProposal(null);
    setWmEditingProposal(false);
    if (!text) return;
    wmDraftRef.current = text;
    if (wmTaRef.current) wmTaRef.current.value = text;
    setWmHasText(true);
  }

  /** Continue out of the editor: the typed items become the job details and
   *  the flow proceeds exactly like a composer submission. */
  function useWmDetails() {
    const raw = (wmTaRef.current?.value ?? wmDraftRef.current).trim();
    if (!raw) return;
    submitJobDetails(raw);
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
          const qId = (detail.conversation as { quoteId?: string } | undefined)
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
      // End of phase 2 — right before the quote review. If this conversation
      // came in through the "I know my price" flow, show the Job Details
      // picker first (its options were generated in the background while the
      // user answered wizard questions). applyJobOption patches the quote and
      // then re-fires the review for this CTA.
      if (needsJobPolish) {
        pendingReviewCtaRef.current = message.id;
        void openJobPicker();
        return;
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
      const res = await assistantClient.sendContract(
        convoId,
        args.contractId,
        args.channel,
      );
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
    language?: "en" | "es",
  ) {
    if (sending || !convoId) return;
    const payload = (message.payload ?? {}) as { contractId?: string };
    let id = payload.contractId ?? contract?.id;
    setError(undefined);
    setSending(true);
    try {
      if (!id) {
        const detail = await assistantClient.conversation(convoId);
        id = detail.contract?.id ??
          (detail.conversation as { contractId?: string } | undefined)
            ?.contractId;
        if (detail.contract) setContract(detail.contract);
      }
      if (!id) throw new Error("no contract bound to this conversation");
      const res = await assistantClient.sendContract(
        convoId,
        id,
        channel,
        language,
      );
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
          cur ? ({ ...cur, totalAmount: nextCents } as typeof cur) : cur
        );
      } else if (actionCardId) {
        setMessages((msgs) =>
          msgs.map((m) => {
            if (m.id !== actionCardId) return m;
            const p = (m.payload ?? {}) as ActionCardPayload;
            return { ...m, payload: { ...p, totalCents: nextCents } };
          })
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

  function openCustomerPicker() {
    setCustomerPickerOpen(true);
    setCustomerPickerSearch("");
    if (customerPickerList !== null) return;
    assistantClient
      .listCustomers()
      .then((list) => setCustomerPickerList(list))
      .catch((err) =>
        setError(
          err instanceof Error
            ? err.message
            : tFor(lang, "asstChat.error.loadCustomers"),
        )
      );
  }

  async function onBindDifferentCustomer(nextCustomer: CustomerLite) {
    if (!convoId || customerPickerBusy) return;
    if (nextCustomer.id === customer?.id) {
      setCustomerPickerOpen(false);
      return;
    }
    setCustomerPickerBusy(true);
    try {
      const res = await assistantClient.bindCustomer(convoId, nextCustomer.id);
      setCustomer(res.customer);
      setContract((
        c,
      ) => (c ? ({ ...c, customerId: res.customer.id } as typeof c) : c));
      setCustomerPickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't switch customer");
    } finally {
      setCustomerPickerBusy(false);
    }
  }

  /** Generic inline-edit handler for the customer's email + phone in the
   *  quote-review hero. Empty next value clears the field (allowed); the
   *  PUT goes through whether the field had a prior value or not. */
  async function onEditCustomerField(
    field: "email" | "phoneNumber",
    customerId: string | undefined,
    original: string | undefined,
    el: HTMLElement,
  ) {
    const next = (el.innerText ?? "").trim();
    const prev = (original ?? "").trim();
    if (!customerId || next === prev) return;
    try {
      const patch = { [field]: next.length === 0 ? null : next } as Record<
        string,
        unknown
      >;
      await clientsClient.update(customerId, patch);
      setCustomer((c) =>
        c ? { ...c, [field]: next.length === 0 ? undefined : next } : c
      );
    } catch (err) {
      el.innerText = prev;
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
      const terms = idx === -1
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
          businessName?: string;
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
          businessName?: string;
        };
      };
      followUpValues?: Record<string, string | number>;
    },
  ) {
    if (sending || !convoId) return;
    setError(undefined);
    setSending(true);
    setRewindAnswer(null);
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

  /**
   * Step one wizard question backwards so it can be re-edited (roadmap p.2).
   * The server drops the trailing step + pick; we reload the conversation so
   * the previous step's wizard card (which the optimistic flow had removed
   * locally) is restored as the active question.
   */
  async function goBackWizard() {
    if (sending || !convoId) return;
    setError(undefined);
    setSending(true);
    try {
      const res = await assistantClient.rewindWizard(convoId);
      // Highlight the user's previous pick on the re-asked step so Back
      // "restores the prior step's selections" (roadmap p.8).
      setRewindAnswer(res.previousAnswer ?? null);
      const snap = await assistantClient.conversation(convoId);
      if (snap && Array.isArray(snap.messages)) setMessages(snap.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't go back a step");
    } finally {
      setSending(false);
    }
  }

  /**
   * Shared entry for the "I know my price, write it up." and "Just give me a
   * quick quote." starters. Per roadmap p.11 the two are merged: both ask for
   * job details first, then open the price-capture screen. submitJobDetails
   * detects the missing price and stashes the raw before opening it.
   */
  function startKnownPriceFlow() {
    pushHistory();
    setFlowChip("knownPrice");
    setSuggestPricing(false);
    setPriceSuggestions(null);
    setPendingJobDetailsRaw(null);
    setAwaitingJobDetails(true);
    // Synchronous focus inside the user gesture so iOS Safari pops the
    // keyboard. The effect at the awaitingJobDetails mount is a fallback.
    taRef.current?.focus();
  }

  /**
   * "Just give me a quick quote." — mechanically the same details-first
   * capture as the known-price starter, but it is its OWN entry point so the
   * chip gets its own intent-appropriate first reply (P-20: the four chips
   * used to share one canned bubble).
   */
  function startQuickQuoteFlow() {
    pushHistory();
    setFlowChip("quickQuote");
    setSuggestPricing(false);
    setPriceSuggestions(null);
    setPendingJobDetailsRaw(null);
    setAwaitingJobDetails(true);
    taRef.current?.focus();
  }

  /**
   * "I know the job, help me price it." (roadmap p.10): same details-first
   * capture, but the price-capture screen then offers three LLM-suggested
   * tiers (+ the manual input as the 4th custom option) instead of asking
   * the contractor to name a price cold.
   */
  function startHelpMePriceFlow() {
    pushHistory();
    setFlowChip("helpPrice");
    setSuggestPricing(true);
    setPriceSuggestions(null);
    setPendingJobDetailsRaw(null);
    setAwaitingJobDetails(true);
    taRef.current?.focus();
  }

  /**
   * "Job done, need to invoice." (roadmap p.3): the work already happened —
   * same easy details-first capture as the first starter, then the amount,
   * then a quick customer pick, and out comes a standalone invoice (no
   * signature, no terms).
   */
  function startInvoiceFlow() {
    pushHistory();
    setFlowChip("invoiceDone");
    setInvoiceFlow(true);
    setSuggestPricing(false);
    setPriceSuggestions(null);
    setPendingJobDetailsRaw(null);
    setAwaitingJobDetails(true);
    taRef.current?.focus();
  }

  /** Open the invoice flow's customer step (the standard wizard
   *  CustomerStepPanel — it loads the client list itself). */
  function openInvoiceCustomerStep() {
    setPriceCaptureOpen(false);
    setInvoiceCustomerOpen(true);
  }

  /**
   * Final step of the "Job done, need to invoice." flow — fired by the
   * wizard CustomerStepPanel's pick/create. Resolves the customer (creating
   * the client when needed), then mints a standalone invoice for the
   * captured amount, due on receipt. Lands on a success card with the
   * public /i/:id link + send actions.
   */
  async function createInvoiceFromFlow(
    optionId: "use_active" | "pick_existing" | "create_new",
    body?: {
      customer?: {
        id?: string;
        create?: {
          name: string;
          email?: string;
          phoneNumber?: string;
          isBusiness?: boolean;
          businessName?: string;
        };
      };
    },
  ) {
    if (sending) return;
    const cents = pendingPriceCents ?? 0;
    if (cents <= 0) {
      setError(tFor(lang, "asstChat.invoiceFlow.noAmount"));
      return;
    }
    setError(undefined);
    setSending(true);
    try {
      let customerId: string | undefined;
      let custEmail: string | undefined;
      let custPhone: string | undefined;
      if (optionId === "create_new" && body?.customer?.create) {
        const c = body.customer.create;
        const created = await clientsClient.create({
          name: c.name,
          ...(c.phoneNumber ? { phoneNumber: c.phoneNumber } : {}),
          ...(c.email ? { email: c.email } : {}),
          ...(c.businessName ? { businessName: c.businessName } : {}),
        });
        customerId = created.id;
        custEmail = created.email;
        custPhone = created.phoneNumber;
      } else if (optionId === "pick_existing" && body?.customer?.id) {
        customerId = body.customer.id;
        const picked = await clientsClient.list().then((cs) =>
          cs.find((c) => c.id === customerId)
        ).catch(() => undefined);
        custEmail = picked?.email;
        custPhone = picked?.phoneNumber;
      } else {
        setError(tFor(lang, "asstChat.invoiceFlow.needCustomer"));
        return;
      }
      const raw = (pendingJobDetailsRaw ?? "").trim();
      const firstLine = raw.split("\n")[0]?.trim() ?? "";
      const jobName = firstLine.split(/\s+/).slice(0, 3).join(" ") ||
        tFor(lang, "asstChat.newJob");
      const today = new Date().toISOString().slice(0, 10);
      const inv = await api.post<{ id?: string }>("/invoices", {
        customerId,
        amount: cents,
        dueDate: today, // job's done — due on receipt
        issuedDate: today,
        status: "sent",
        jobName,
        ...(raw ? { description: raw } : {}),
      });
      if (!inv?.id) throw new Error("failed to create invoice");
      setInvoiceCustomerOpen(false);
      setInvoiceResult({
        id: inv.id,
        ...(custEmail ? { customerEmail: custEmail } : {}),
        ...(custPhone ? { customerPhone: custPhone } : {}),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "couldn't create the invoice",
      );
    } finally {
      setSending(false);
    }
  }

  /**
   * Quote ⇄ Invoice swap on the finished-flow review (roadmap: "swap between
   * quote and invoice"). Mints ONE standalone invoice from the reviewed
   * quote's customer + total (idempotent across retries via the ref), then
   * dispatches it on the chosen channel through the invoice email/text
   * endpoints.
   */
  async function confirmSendInvoiceSwap(
    channel: "email" | "sms" | "both",
    totalCents: number,
  ) {
    if (sending) return;
    setError(undefined);
    setSending(true);
    try {
      let invId = swapInvoiceIdRef.current;
      if (!invId) {
        const today = new Date().toISOString().slice(0, 10);
        const inv = await api.post<{ id?: string }>("/invoices", {
          ...(customer?.id ? { customerId: customer.id } : {}),
          amount: totalCents,
          dueDate: today,
          issuedDate: today,
          status: "sent",
          ...(quote?.jobName ? { jobName: quote.jobName } : {}),
          ...(quote?.description ? { description: quote.description } : {}),
        });
        if (!inv?.id) throw new Error("couldn't create the invoice");
        invId = inv.id;
        swapInvoiceIdRef.current = invId;
      }
      // P-09: the invoice send endpoints report logical failure as HTTP 200
      // + {ok:false, reason} — interpret the BODY, never just Response.ok
      // (the old `await` chain read every 200 as delivered). A failed leg
      // surfaces the same honest divider the contract-send path renders.
      let fail: { key: string; reason: string } | null = null;
      const interpretLeg = (body: unknown, httpOk: boolean) => {
        const outcome = interpretSendResult({ httpOk, body });
        const key = sendResultLangKey(outcome);
        if (key && !fail) {
          const b = body as { reason?: unknown } | null;
          fail = {
            key,
            reason: typeof b?.reason === "string"
              ? b.reason
              : outcome.reason ?? "",
          };
        }
      };
      if (channel === "email" || channel === "both") {
        try {
          const res = await api.post<{ ok?: boolean; reason?: string }>(
            `/invoices/${invId}/email`,
            {},
          );
          interpretLeg(res, true);
        } catch {
          interpretLeg(null, false);
        }
      }
      if (channel === "sms" || channel === "both") {
        try {
          const res = await api.post<{ ok?: boolean; reason?: string }>(
            `/invoices/${invId}/text`,
            {},
          );
          interpretLeg(res, true);
        } catch {
          interpretLeg(null, false);
        }
      }
      setSwapSendFail(fail);
      setSwapInvoiceSent(invId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "couldn't send the invoice",
      );
    } finally {
      setSending(false);
    }
  }

  async function fetchPriceSuggestions(raw: string) {
    try {
      const res = await assistantClient.suggestPrices(raw);
      setPriceSuggestions(res.options ?? []);
    } catch {
      setPriceSuggestions([]);
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
        const url =
          `${proto}://${globalThis.location.host}/api/voice/stream?sample_rate=${sampleRate}`;
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
                  : tFor(lang, "asstChat.error.voiceStream"),
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
            setError(tFor(lang, "asstChat.error.voiceInterrupted"));
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
        easedLevel = target > easedLevel
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
      setError(tFor(lang, "asstChat.error.micUnavailable"));
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
      const Ctx = (
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
      setError(tFor(lang, "asstChat.error.micDenied"));
      teardownRecording();
    }
  }

  const empty = messages.length === 0;

  return (
    <>
      <div class="chat__scroll" ref={scrollRef}>
        {(empty || jobOptionsOpen)
          ? (
            <div class="chat__empty">
              {!priceCaptureOpen && !awaitingJobDetails && !jobOptionsOpen &&
                !invoiceCustomerOpen && !invoiceResult && (
                <>
                  <div class="chat__empty-icon">
                    <img src="/logo-monster.png" alt="" />
                  </div>
                  <h3 class="chat__empty-title">
                    {tFor(lang, "asstChat.empty.title")}
                  </h3>
                </>
              )}
              {jobOptionsOpen
                ? (
                  <div class="chat__jobopts">
                    <div class="chat__jobopts-head">
                      {
                        /* Roadmap p.8: every step needs a working Back. In
                          confirm mode (pre-quote) Back returns to the details
                          entry with the typed text restored; in polish mode
                          the picker is re-openable from the review CTA, so
                          backing out just returns to the chat without losing
                          answers. */
                      }
                      <button
                        type="button"
                        data-cy="wizard-back"
                        class="chat__price-back"
                        onClick={() => {
                          if (pickerMode === "confirm") {
                            setJobOptionsOpen(false);
                            setPickerMode("polish");
                            setSubmittedJobDetails(null);
                            setAwaitingJobDetails(true);
                            setDraft(pendingJobDetailsRaw ?? "");
                            return;
                          }
                          pendingReviewCtaRef.current = null;
                          setJobOptionsOpen(false);
                        }}
                        aria-label={tFor(lang, "common.back")}
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
                        {tFor(lang, "common.back")}
                      </button>
                      <h4 class="chat__jobopts-title">
                        {pickerMode === "confirm"
                          ? tFor(lang, "asstChat.jobOpts.confirmHeading")
                          : tFor(lang, "asstChat.jobOpts.heading")}
                      </h4>
                      <p class="chat__jobopts-sub">
                        {pickerMode === "confirm"
                          ? tFor(lang, "asstChat.jobOpts.confirmSub")
                          : tFor(lang, "asstChat.jobOpts.sub")}
                      </p>
                    </div>
                    {optionsLoading || !jobOptions
                      ? (
                        <div class="chat__jobopts-loading">
                          <span class="chat__details-dots" aria-hidden="true">
                            <span></span>
                            <span></span>
                            <span></span>
                          </span>
                          {tFor(lang, "asstChat.jobOpts.writing")}
                        </div>
                      )
                      : (
                        <>
                          <div class="chat__jobopts-list">
                            {jobOptions.map((opt, i) => {
                              const selected = selectedOptionId === opt.id;
                              return (
                                <div
                                  key={opt.id}
                                  class={`chat__jobopt${
                                    selected ? " is-selected" : ""
                                  }`}
                                  onClick={() => setSelectedOptionId(opt.id)}
                                  role="button"
                                  tabIndex={0}
                                >
                                  <div class="chat__jobopt-head">
                                    <span
                                      class="chat__jobopt-radio"
                                      aria-hidden="true"
                                    >
                                    </span>
                                    {editingTitleId === opt.id
                                      ? (
                                        <input
                                          type="text"
                                          class="chat__jobopt-name-edit"
                                          defaultValue={opt.jobName}
                                          autoFocus
                                          onClick={(e) => e.stopPropagation()}
                                          onKeyDown={(e) => {
                                            const el = e
                                              .currentTarget as HTMLInputElement;
                                            if (e.key === "Enter") {
                                              e.preventDefault();
                                              el.blur();
                                            } else if (e.key === "Escape") {
                                              editEscapedRef.current = true;
                                              el.blur();
                                            }
                                          }}
                                          onBlur={(e) => {
                                            if (editEscapedRef.current) {
                                              editEscapedRef.current = false;
                                              setEditingTitleId(null);
                                              return;
                                            }
                                            commitTitleEdit(
                                              opt.id,
                                              (e.currentTarget as HTMLInputElement)
                                                .value,
                                            );
                                          }}
                                        />
                                      )
                                      : (
                                        <>
                                          {
                                            /* P-24: tapping the card's TEXT
                                              selects it — it no longer opens
                                              inline editing (which popped the
                                              phone keyboard on a first tap).
                                              Editing lives on the always-
                                              visible pencil beside it. */
                                          }
                                          <button
                                            type="button"
                                            class="chat__jobopt-name-btn"
                                            style="cursor:pointer"
                                            aria-pressed={selected}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedOptionId(opt.id);
                                            }}
                                          >
                                            <span>
                                              {opt.jobName ||
                                                tFor(
                                                  lang,
                                                  "asstChat.jobOpts.optionN",
                                                  { n: i + 1 },
                                                )}
                                            </span>
                                          </button>
                                          <button
                                            type="button"
                                            class="chat__jobopt-name-pencil"
                                            style="opacity:1;appearance:none;border:0;background:transparent;cursor:pointer;padding:0 2px;line-height:1"
                                            title={tFor(
                                              lang,
                                              "asstChat.jobOpts.editTitle",
                                            )}
                                            aria-label={tFor(
                                              lang,
                                              "asstChat.jobOpts.editTitle",
                                            )}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              startTitleEdit(
                                                opt.id,
                                                opt.jobName,
                                              );
                                            }}
                                          >
                                            ✎
                                          </button>
                                        </>
                                      )}
                                  </div>
                                  <ul class="chat__jobopt-bullets">
                                    {opt.bullets.map((b) => {
                                      const isEditing =
                                        editingBullet?.optionId === opt.id &&
                                        editingBullet?.bulletId === b.id;
                                      return (
                                        <li
                                          key={b.id}
                                          class={`chat__jobopt-bullet${
                                            b.deleted ? " is-deleted" : ""
                                          }`}
                                        >
                                          {isEditing
                                            ? (
                                              <input
                                                type="text"
                                                class="chat__jobopt-edit"
                                                defaultValue={b.text}
                                                autoFocus
                                                onClick={(e) =>
                                                  e.stopPropagation()}
                                                onKeyDown={(e) => {
                                                  const el = e
                                                    .currentTarget as HTMLInputElement;
                                                  if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    el.blur();
                                                  } else if (
                                                    e.key === "Escape"
                                                  ) {
                                                    editEscapedRef.current =
                                                      true;
                                                    el.blur();
                                                  }
                                                }}
                                                onBlur={(e) => {
                                                  if (editEscapedRef.current) {
                                                    editEscapedRef.current =
                                                      false;
                                                    setEditingBullet(null);
                                                    return;
                                                  }
                                                  commitBulletEdit(
                                                    opt.id,
                                                    b.id,
                                                    (e.currentTarget as HTMLInputElement)
                                                      .value,
                                                  );
                                                }}
                                              />
                                            )
                                            : (
                                              <button
                                                type="button"
                                                class="chat__jobopt-text"
                                                disabled={b.deleted}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  if (!b.deleted) {
                                                    startBulletEdit(
                                                      opt.id,
                                                      b.id,
                                                      b.text,
                                                    );
                                                  }
                                                }}
                                              >
                                                {b.text}
                                              </button>
                                            )}
                                          <button
                                            type="button"
                                            class="chat__jobopt-x"
                                            aria-label={b.deleted
                                              ? tFor(
                                                lang,
                                                "asstChat.jobOpts.restoreBullet",
                                              )
                                              : tFor(
                                                lang,
                                                "asstChat.jobOpts.deleteBullet",
                                              )}
                                            title={b.deleted
                                              ? tFor(lang, "common.restore")
                                              : tFor(lang, "common.delete")}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleBulletDeleted(opt.id, b.id);
                                            }}
                                          >
                                            {b.deleted ? "↺" : "×"}
                                          </button>
                                        </li>
                                      );
                                    })}
                                    {selected
                                      ? (
                                        <li class="chat__jobopt-add">
                                          <input
                                            ref={addInputRef}
                                            type="text"
                                            class="chat__jobopt-add-input"
                                            placeholder={tFor(
                                              lang,
                                              "asstChat.jobOpts.addOwn",
                                            )}
                                            onClick={(e) => e.stopPropagation()}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                const el = e
                                                  .currentTarget as HTMLInputElement;
                                                addCustomBullet(
                                                  opt.id,
                                                  el.value,
                                                );
                                                el.value = "";
                                              }
                                            }}
                                          />
                                          <button
                                            type="button"
                                            class="chat__jobopt-add-btn"
                                            aria-label={tFor(
                                              lang,
                                              "asstChat.jobOpts.addBullet",
                                            )}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const el = addInputRef.current;
                                              if (el) {
                                                addCustomBullet(
                                                  opt.id,
                                                  el.value,
                                                );
                                                el.value = "";
                                              }
                                            }}
                                          >
                                            +
                                          </button>
                                        </li>
                                      )
                                      : null}
                                  </ul>
                                </div>
                              );
                            })}
                            <div
                              // P-24: the "Write it myself" tile is NOT one
                              // of the three version cards — it must not
                              // match .chat__jobopt (the picker shows exactly
                              // 3 versions). Card chrome comes from the
                              // .chat__jobopt-custom CSS twin.
                              class={`chat__jobopt-custom${
                                selectedOptionId === CUSTOM_OPTION_ID
                                  ? " is-selected"
                                  : ""
                              }`}
                              onClick={() =>
                                setSelectedOptionId(CUSTOM_OPTION_ID)}
                              role="button"
                              tabIndex={0}
                            >
                              <div class="chat__jobopt-head">
                                <span
                                  class="chat__jobopt-radio"
                                  aria-hidden="true"
                                >
                                </span>
                                <span class="chat__jobopt-name">
                                  {tFor(lang, "asstChat.jobOpts.customTitle")}
                                </span>
                              </div>
                              {selectedOptionId === CUSTOM_OPTION_ID
                                ? (
                                  <textarea
                                    class="chat__jobopt-custom-area"
                                    placeholder={tFor(
                                      lang,
                                      "asstChat.jobOpts.customPlaceholder",
                                    )}
                                    autoFocus
                                    defaultValue={customDraftRef.current}
                                    onClick={(e) => e.stopPropagation()}
                                    onInput={(e) => {
                                      customDraftRef.current =
                                        (e.currentTarget as HTMLTextAreaElement)
                                          .value;
                                    }}
                                  />
                                )
                                : (
                                  <p class="chat__jobopt-custom-hint">
                                    {tFor(lang, "asstChat.jobOpts.customHint")}
                                  </p>
                                )}
                            </div>
                          </div>
                          {pickerMode === "confirm"
                            ? (
                              /* Roadmap p.16: explicit confirm-details step —
                                 shows the collected details and confirms on
                                 click, advancing to the pricing options. */
                              <button
                                type="button"
                                data-cy="confirm-details"
                                class="chat__confirm-details"
                                disabled={sending}
                                onClick={applyJobOption}
                              >
                                <span class="chat__confirm-details-label">
                                  {sending
                                    ? tFor(lang, "asstChat.settingUp")
                                    : tFor(lang, "asstChat.confirmDetails.cta")}
                                </span>
                                {pendingJobDetailsRaw
                                  ? (
                                    <span class="chat__confirm-details-text">
                                      {pendingJobDetailsRaw}
                                    </span>
                                  )
                                  : null}
                              </button>
                            )
                            : (
                              <button
                                type="button"
                                class="chat__price-continue"
                                disabled={!selectedOptionId || sending}
                                onClick={applyJobOption}
                              >
                                {sending
                                  ? (
                                    <>
                                      <span class="spinner" aria-hidden="true" />
                                      {" "}
                                      {tFor(lang, "asstChat.settingUp")}
                                    </>
                                  )
                                  : tFor(lang, "asstChat.continue")}
                              </button>
                            )}
                        </>
                      )}
                    {proPopup
                      ? (
                        <div
                          class="chat__pro-pop"
                          onClick={dismissProfessionalize}
                        >
                          <div
                            class="chat__pro-pop-card"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <p class="chat__pro-pop-msg">
                              {tFor(lang, "asstChat.proPopup.msg")}
                            </p>
                            <div class="chat__pro-pop-actions">
                              <button
                                type="button"
                                class="chat__pro-pop-no"
                                disabled={proBusy}
                                onClick={dismissProfessionalize}
                              >
                                {tFor(lang, "asstChat.proPopup.no")}
                              </button>
                              <button
                                type="button"
                                class="chat__pro-pop-yes"
                                disabled={proBusy}
                                onClick={confirmProfessionalize}
                              >
                                {proBusy
                                  ? tFor(lang, "asstChat.proPopup.polishing")
                                  : tFor(lang, "asstChat.proPopup.yes")}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                      : null}
                  </div>
                )
                : awaitingJobDetails
                ? (
                  <div class="chat__details-flow">
                    <div class="chat__details-prompt">
                      <div class="chat__details-prompt-avatar">
                        <img src="/logo-monster.png" alt="" />
                      </div>
                      <div class="chat__details-prompt-bubble">
                        {flowChip
                          ? (
                            // P-20: each starter chip opens with its own
                            // intent-appropriate reply — the invoice chip
                            // talks facturas, never a cotización (so it
                            // also drops the quote-polish hint).
                            <>
                              <strong>
                                {chipBubbleParts(chipReply(flowChip, lang))
                                  .lead}
                              </strong>
                              {chipBubbleParts(chipReply(flowChip, lang)).rest}
                              {flowChip !== "invoiceDone"
                                ? (
                                  <span class="chat__details-prompt-hint">
                                    {tFor(lang, "asstChat.details.hint")}
                                  </span>
                                )
                                : null}
                            </>
                          )
                          : (
                            <>
                              <strong>
                                {tFor(lang, "asstChat.details.promptBold")}
                              </strong>{" "}
                              {tFor(lang, "asstChat.details.promptRest")}
                              <span class="chat__details-prompt-hint">
                                {tFor(lang, "asstChat.details.hint")}
                              </span>
                            </>
                          )}
                      </div>
                    </div>
                    {/* Roadmap p.5: "Write it myself" — a structured editor
                        (one item per line) with the "Professionalize that"
                        accept/edit proposal loop. */}
                    {!submittedJobDetails && !writeMyselfOpen
                      ? (
                        <button
                          type="button"
                          class="chat__details-writeself"
                          onClick={openWriteMyself}
                        >
                          ✎ {tFor(lang, "asstChat.jobOpts.customTitle")}
                        </button>
                      )
                      : null}
                    {!submittedJobDetails && writeMyselfOpen
                      ? (
                        <div class="chat__writeself">
                          <div class="chat__writeself-head">
                            <h4 class="chat__writeself-title">
                              {tFor(lang, "asstChat.jobOpts.customTitle")}
                            </h4>
                            <p class="chat__writeself-sub">
                              {tFor(lang, "asstChat.writeSelf.hint")}
                            </p>
                          </div>
                          <textarea
                            ref={wmTaRef}
                            class="chat__writeself-input"
                            rows={5}
                            placeholder={tFor(
                              lang,
                              "asstChat.jobOpts.customPlaceholder",
                            )}
                            defaultValue={wmDraftRef.current}
                            onInput={(e) => {
                              const v =
                                (e.currentTarget as HTMLTextAreaElement).value;
                              wmDraftRef.current = v;
                              const has = v.trim().length > 0;
                              if (has !== wmHasText) setWmHasText(has);
                            }}
                          />
                          {wmError
                            ? <div class="chat__writeself-err">{wmError}</div>
                            : null}
                          {wmProposal
                            ? (
                              <div class="chat__writeself-proposal">
                                <div class="chat__writeself-proposal-label">
                                  {tFor(lang, "asstChat.writeSelf.proposalLabel")}
                                </div>
                                {wmEditingProposal
                                  ? (
                                    <textarea
                                      ref={wmProposalTaRef}
                                      data-cy="professionalize-proposal"
                                      class="chat__writeself-proposal-edit"
                                      rows={Math.max(3, wmProposal.length + 2)}
                                      defaultValue={wmProposal.join("\n")}
                                    />
                                  )
                                  : (
                                    <div
                                      data-cy="professionalize-proposal"
                                      class="chat__writeself-proposal-text"
                                    >
                                      {wmProposal.join("\n")}
                                    </div>
                                  )}
                                <div class="chat__writeself-proposal-actions">
                                  <button
                                    type="button"
                                    data-cy="professionalize-accept"
                                    class="chat__writeself-accept"
                                    onClick={acceptWmProposal}
                                  >
                                    {tFor(lang, "asstChat.writeSelf.accept")}
                                  </button>
                                  {!wmEditingProposal
                                    ? (
                                      <button
                                        type="button"
                                        data-cy="professionalize-edit"
                                        class="chat__writeself-editbtn"
                                        onClick={(e) =>
                                          editWmProposal(
                                            e.currentTarget as HTMLElement,
                                          )}
                                      >
                                        {tFor(lang, "common.edit")}
                                      </button>
                                    )
                                    : null}
                                  <button
                                    type="button"
                                    class="chat__writeself-dismiss"
                                    onClick={() => {
                                      setWmProposal(null);
                                      setWmEditingProposal(false);
                                    }}
                                  >
                                    {tFor(lang, "common.cancel")}
                                  </button>
                                </div>
                              </div>
                            )
                            : null}
                          <div class="chat__writeself-actions">
                            {wmHasText && !wmProposal
                              ? (
                                <button
                                  type="button"
                                  data-cy="professionalize-btn"
                                  class="chat__writeself-pro"
                                  disabled={wmBusy}
                                  onClick={professionalizeWmDetails}
                                >
                                  {wmBusy
                                    ? (
                                      <>
                                        <span
                                          class="spinner"
                                          aria-hidden="true"
                                        />{" "}
                                        {tFor(
                                          lang,
                                          "asstChat.writeSelf.professionalizing",
                                        )}
                                      </>
                                    )
                                    : tFor(
                                      lang,
                                      "asstChat.writeSelf.professionalize",
                                    )}
                                </button>
                              )
                              : null}
                            <button
                              type="button"
                              class="chat__price-continue"
                              disabled={!wmHasText || wmBusy || sending}
                              onClick={useWmDetails}
                            >
                              {tFor(lang, "asstChat.continue")}
                            </button>
                          </div>
                        </div>
                      )
                      : null}
                    {submittedJobDetails
                      ? (
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
                              <span
                                class="chat__details-dots"
                                aria-hidden="true"
                              >
                                <span></span>
                                <span></span>
                                <span></span>
                              </span>
                              {tFor(lang, "asstChat.details.polishing")}
                            </div>
                          </div>
                        </>
                      )
                      : null}
                  </div>
                )
                : invoiceResult
                ? (
                  // "Job done, need to invoice." success card (roadmap p.3):
                  // the standalone invoice exists — hand over the link + send
                  // actions. It also shows up under /invoices.
                  <div class="chat__price-capture">
                    <div class="chat__price-capture-head">
                      <h4 class="chat__price-title">
                        {tFor(lang, "asstChat.invoiceFlow.readyTitle")}
                      </h4>
                      <p class="chat__price-sub">
                        {tFor(lang, "asstChat.invoiceFlow.readySub")}
                      </p>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:8px">
                      <button
                        type="button"
                        class="chat__price-continue"
                        disabled={sending}
                        onClick={async () => {
                          setError(undefined);
                          setSending(true);
                          try {
                            if (invoiceResult.customerEmail) {
                              await api.post(
                                `/invoices/${invoiceResult.id}/email`,
                                {},
                              );
                            }
                            if (invoiceResult.customerPhone) {
                              await api.post(
                                `/invoices/${invoiceResult.id}/text`,
                                {},
                              );
                            }
                            if (
                              !invoiceResult.customerEmail &&
                              !invoiceResult.customerPhone
                            ) {
                              setError(
                                tFor(lang, "asstChat.invoiceFlow.noContact"),
                              );
                              return;
                            }
                            globalThis.location.href = "/invoices";
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : "couldn't send the invoice",
                            );
                          } finally {
                            setSending(false);
                          }
                        }}
                      >
                        {sending
                          ? tFor(lang, "asstChat.preview.sending")
                          : tFor(lang, "asstChat.invoiceFlow.sendNow")}
                      </button>
                      <div style="display:flex;gap:8px">
                        <button
                          type="button"
                          class="chat__price-back"
                          style="flex:1;justify-content:center;border:1px solid var(--border,#d8dcd5);border-radius:10px;padding:10px"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(
                                `${globalThis.location.origin}/i/${invoiceResult.id}`,
                              );
                              setInvLinkCopied(true);
                              setTimeout(() => setInvLinkCopied(false), 1500);
                            } catch { /* clipboard unavailable */ }
                          }}
                        >
                          {invLinkCopied
                            ? tFor(lang, "asstChat.preview.linkCopied")
                            : tFor(lang, "asstChat.preview.menuCopyLink")}
                        </button>
                        <a
                          class="chat__price-back"
                          style="flex:1;justify-content:center;border:1px solid var(--border,#d8dcd5);border-radius:10px;padding:10px;text-decoration:none"
                          href={`/i/${invoiceResult.id}`}
                          target="_blank"
                          rel="noopener"
                        >
                          {tFor(lang, "asstChat.invoiceFlow.viewInvoice")}
                        </a>
                      </div>
                      <a
                        class="chat__price-back"
                        style="justify-content:center;padding:8px;text-decoration:none"
                        href="/invoices"
                      >
                        {tFor(lang, "asstChat.invoiceFlow.goToInvoices")}
                      </a>
                    </div>
                  </div>
                )
                : invoiceCustomerOpen
                ? (
                  // Customer step of the invoice flow — the SAME wizard
                  // customer panel used in phase 2 (existing-customers
                  // dropdown + "+ New Customer" form), so the assistant has
                  // one customer-pick interaction everywhere.
                  <div class="chat__price-capture">
                    <div class="chat__price-capture-head">
                      <button
                        type="button"
                        data-cy="wizard-back"
                        class="chat__price-back"
                        onClick={() => {
                          setInvoiceCustomerOpen(false);
                          setPriceCaptureOpen(true);
                        }}
                        aria-label={tFor(lang, "common.back")}
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
                        {tFor(lang, "common.back")}
                      </button>
                    </div>
                    <CustomerStepPanel
                      ownerEmail={from?.email}
                      ownerPhone={from?.phone}
                      sending={sending}
                      lang={lang}
                      onSubmit={createInvoiceFromFlow}
                    />
                  </div>
                )
                : priceCaptureOpen
                ? (
                  <div class="chat__price-capture">
                    <div class="chat__price-capture-head">
                      <button
                        type="button"
                        data-cy="wizard-back"
                        class="chat__price-back"
                        onClick={wizardStepBack}
                        aria-label={tFor(lang, "common.back")}
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
                        {tFor(lang, "common.back")}
                      </button>
                      <h4 class="chat__price-title">
                        {suggestPricing
                          ? tFor(lang, "asstChat.price.pickTitle")
                          : tFor(lang, "asstChat.price.whatTitle")}
                      </h4>
                      <p class="chat__price-sub">
                        {suggestPricing
                          ? tFor(lang, "asstChat.price.tapSub")
                          : tFor(lang, "asstChat.price.buildSub")}
                      </p>
                    </div>
                    {/* Job-details recap: keeps the (possibly re-edited)
                        details visible while pricing, so Back-and-edit runs
                        visibly land on the regenerated flow (roadmap p.2). */}
                    {pendingJobDetailsRaw
                      ? (
                        <div class="chat__price-details-recap">
                          <span class="chat__price-details-recap-label">
                            {tFor(lang, "asstChat.price.forJob")}
                          </span>
                          <span class="chat__price-details-recap-text">
                            {pendingJobDetailsRaw}
                          </span>
                        </div>
                      )
                      : null}
                    {/* Roadmap p.10: three suggested tiers (+ custom input). */}
                    {suggestPricing && (
                      <div
                        class="chat__price-tiers"
                        style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px"
                      >
                        {priceSuggestions === null
                          ? (
                            <div style="font-size:13px;color:var(--fg-muted,#6b7560);padding:6px 2px">
                              {tFor(lang, "asstChat.price.pricing")}
                            </div>
                          )
                          : priceSuggestions.map((t) => (
                            <button
                              key={t.tier}
                              type="button"
                              data-cy="pricing-option"
                              disabled={sending}
                              onClick={() => onPriceContinue(t.priceCents)}
                              style="display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;padding:12px 14px;border:1px solid var(--border,#d8dcd5);border-radius:12px;background:#fff;cursor:pointer;font:inherit"
                            >
                              <span style="min-width:0">
                                <span style="display:block;font-weight:800;font-size:14px;color:var(--fg)">
                                  {t.label}
                                </span>
                                {t.rationale
                                  ? (
                                    <span style="display:block;font-size:12px;color:var(--fg-muted,#6b7560)">
                                      {t.rationale}
                                    </span>
                                  )
                                  : null}
                              </span>
                              <span style="font-weight:800;font-size:16px;color:var(--brand-green,#519843);flex-shrink:0">
                                ${(t.priceCents / 100).toLocaleString("en-US")}
                              </span>
                            </button>
                          ))}
                        {/* 4th option (roadmap p.16): custom price — clicking
                            focuses the MoneyInput below so the contractor can
                            type their own number and press Enter. */}
                        <button
                          type="button"
                          data-cy="pricing-option-custom"
                          class="chat__price-custom-cta"
                          disabled={sending}
                          onClick={() => {
                            const el = moneyBoxRef.current?.querySelector(
                              "input",
                            ) as HTMLInputElement | null;
                            el?.focus();
                          }}
                        >
                          {tFor(lang, "asstChat.price.orCustom")}
                        </button>
                      </div>
                    )}
                    <div ref={moneyBoxRef}>
                      <MoneyInput
                        autoFocus={!suggestPricing}
                        onChange={setPriceCents}
                        onSubmit={(cents) => {
                          if (sending) return;
                          onPriceContinue(cents);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      class="chat__price-continue"
                      disabled={(priceCents ?? 0) <= 0 || sending}
                      onClick={() => onPriceContinue(priceCents!)}
                    >
                      {sending
                        ? (
                          <>
                            <span class="spinner" aria-hidden="true" />{" "}
                            {tFor(lang, "asstChat.settingUp")}
                          </>
                        )
                        : tFor(lang, "asstChat.continue")}
                    </button>
                  </div>
                )
                : (
                  <div class="chat__empty-prompts">
                    <button
                      type="button"
                      class="chat__empty-prompt"
                      onClick={startKnownPriceFlow}
                    >
                      {tFor(lang, "asstChat.prompt.knownPrice")}
                    </button>
                    <button
                      type="button"
                      class="chat__empty-prompt"
                      onClick={startHelpMePriceFlow}
                    >
                      {tFor(lang, "asstChat.prompt.helpPrice")}
                    </button>
                    <button
                      type="button"
                      class="chat__empty-prompt"
                      onClick={startQuickQuoteFlow}
                    >
                      {tFor(lang, "asstChat.prompt.quickQuote")}
                    </button>
                    <button
                      type="button"
                      class="chat__empty-prompt"
                      onClick={startInvoiceFlow}
                    >
                      {tFor(lang, "asstChat.prompt.invoiceDone")}
                    </button>
                  </div>
                )}
              {typeof globalThis.location !== "undefined" &&
                  globalThis.location.hostname === "localhost" &&
                  new URLSearchParams(globalThis.location.search).has("dev")
                ? (
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
                )
                : null}
            </div>
          )
          : (
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
                const eMissing = !cp.emailedTo && !!cp.emailFailureReason &&
                  !customer?.email;
                const pMissing = !cp.textedTo && !!cp.smsFailureReason &&
                  (!customer?.phoneNumber ||
                    /Invalid|21211/i.test(cp.smsFailureReason ?? ""));
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
                  const emailMissing = !dp.emailedTo &&
                    !!dp.emailFailureReason &&
                    !customer?.email;
                  const phoneMissing = !dp.textedTo && !!dp.smsFailureReason &&
                    (!customer?.phoneNumber ||
                      /Invalid|21211/i.test(dp.smsFailureReason));
                  const needRecovery = !!dp.contractId && !!customer?.id &&
                    !!inferredChannel &&
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
                      {needRecovery
                        ? (
                          <div class="recovery-card">
                            <div class="recovery-card__head">
                              <strong>
                                {askEmail && askPhone
                                  ? tFor(lang, "asstChat.recovery.addBoth")
                                  : askEmail
                                  ? tFor(lang, "asstChat.recovery.addEmail")
                                  : tFor(lang, "asstChat.recovery.addPhone")}
                              </strong>
                              <span class="recovery-card__hint">
                                {tFor(lang, "asstChat.recovery.savedHint", {
                                  name: customer?.name ??
                                    tFor(lang, "asstChat.thisCustomer"),
                                })}
                              </span>
                            </div>
                            <div class="recovery-card__fields">
                              {askEmail
                                ? (
                                  <input
                                    type="email"
                                    class="recovery-card__input"
                                    placeholder={tFor(
                                      lang,
                                      "asstChat.recovery.emailPlaceholder",
                                    )}
                                    value={draft.email ?? ""}
                                    disabled={saving}
                                    onInput={(e) => {
                                      const v =
                                        (e.target as HTMLInputElement).value;
                                      setRecoveryDraft((p) => ({
                                        ...p,
                                        [m.id]: { ...p[m.id], email: v },
                                      }));
                                    }}
                                  />
                                )
                                : null}
                              {askPhone
                                ? (
                                  <input
                                    type="tel"
                                    class="recovery-card__input"
                                    placeholder={tFor(
                                      lang,
                                      "asstChat.recovery.phonePlaceholder",
                                    )}
                                    value={draft.phone ?? ""}
                                    disabled={saving}
                                    onInput={(e) => {
                                      const v =
                                        (e.target as HTMLInputElement).value;
                                      setRecoveryDraft((p) => ({
                                        ...p,
                                        [m.id]: { ...p[m.id], phone: v },
                                      }));
                                    }}
                                  />
                                )
                                : null}
                              <button
                                type="button"
                                class="recovery-card__save"
                                disabled={saving ||
                                  (!draft.email?.trim() &&
                                    !draft.phone?.trim()) ||
                                  (askEmail && !askPhone &&
                                    !draft.email?.trim()) ||
                                  (askPhone && !askEmail &&
                                    !draft.phone?.trim())}
                                onClick={() =>
                                  saveContactAndRetry(m.id, {
                                    contractId: dp.contractId!,
                                    channel: inferredChannel ?? "email",
                                  })}
                              >
                                {saving
                                  ? tFor(lang, "asstChat.recovery.saving")
                                  : tFor(lang, "asstChat.recovery.saveResend")}
                              </button>
                            </div>
                          </div>
                        )
                        : null}
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
                  const reviewed = (payload.toPhase === "send" ||
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
                  const sentRecipient = dispatchedTo ??
                    (reviewed ? customer?.email : undefined);
                  const previewing = payload.toPhase === "send" &&
                    previewCtaId === m.id;
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
                    const quoteLineItems = (quote?.lineItems ?? []).map((
                      li,
                    ) => ({
                      description: li.description,
                      amountCents: Math.round(
                        (li.price ?? 0) * (li.quantity ?? 1),
                      ),
                    }));
                    const lineItems = lockedPayload.lineItems?.length
                      ? lockedPayload.lineItems
                      : quoteLineItems;
                    const lineTotalCents = lockedPayload.totalCents ??
                      quote?.estimatedTotal ??
                      lineItems.reduce(
                        (sum, li) => sum + (li.amountCents ?? 0),
                        0,
                      );
                    // Job-details description in the preview language. Falls
                    // back to the stored single-language description until the
                    // lazy translate (ensureDescriptionLang) fills it in.
                    const polishedDescription =
                      quote?.descriptionByLang?.[previewLang] ??
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
                        if (x.kind !== "text" || !sid || sid === "customer") {
                          continue;
                        }
                        if (termsByStep.has(sid)) continue;
                        const raw = x.content ?? "";
                        const colon = raw.indexOf(":");
                        const label = colon === -1
                          ? raw
                          : raw.slice(0, colon).trim();
                        const value = colon === -1
                          ? ""
                          : raw.slice(colon + 1).trim();
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
                        return !(v === "" || v === "no warranty" ||
                          v === "none" || v === "n/a" || v === "no");
                      })
                      .map(({ stepId, label, value }) => {
                        // Stored terms are English (the neutral base) — localize
                        // the value into the preview language so the card matches
                        // the agreement the customer actually receives (the public
                        // doc uses the same helper).
                        const v = localizeTermValue(value, previewLang);
                        // Time-to-complete reads as an estimate, not a hard
                        // promise — surface that on the card to match the
                        // customer-facing wording. Strip any existing
                        // "Estimated/Estimado" prefix(es) first so the wrapper is
                        // idempotent (legacy rows sometimes stored it pre-wrapped).
                        const isDuration = stepId === "time_to_complete" ||
                          stepId === "wraps";
                        const bare = isDuration
                          ? v.replace(
                            /^(?:\s*estima(?:ted|d[oa])\b\s*:?\s*)+/i,
                            "",
                          ).trim()
                          : v;
                        return {
                          stepId,
                          label,
                          value: isDuration && bare
                            ? tFor(
                              previewLang,
                              "asstChat.preview.estimatedValue",
                              { value: bare },
                            )
                            : v,
                        };
                      });
                    const totalCentsForBreakdown =
                      typeof contract?.totalAmount === "number"
                        ? contract.totalAmount
                        : lineTotalCents;
                    // Two decimals to match the public agreement's
                    // fmtMoneyExact() (lib/format.ts) — the "$" is rendered in
                    // a sibling span, so we format only the numeric portion.
                    const totalStr = (
                      totalCentsForBreakdown / 100
                    ).toLocaleString("en-US", {
                      minimumFractionDigits: 2,
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
                        previewLang,
                      )
                      : null;
                    return (
                      <div key={m.id} class="quote-review-wrap">
                        <article class="quote-review">
                          <header class="quote-review__head">
                            <div class="quote-review__head-left">
                              <div class="quote-review__kind">
                                {tFor(previewLang, "asstChat.preview.kind")}
                              </div>
                              {contractId
                                ? (
                                  <div class="quote-review__num">
                                    #{contractId.slice(0, 8).toUpperCase()}
                                  </div>
                                )
                                : null}
                            </div>
                            <div class="quote-review__head-right">
                              <span class="quote-review__chip">
                                {statusChipLabel(
                                  contract?.status ?? lockedPayload.status,
                                  previewLang,
                                )}
                              </span>
                              <button
                                type="button"
                                class="quote-review__close"
                                aria-label={tFor(
                                  previewLang,
                                  "asstChat.preview.closePreview",
                                )}
                                onClick={() => setPreviewCtaId(null)}
                                disabled={sending}
                              >
                                <I d={ICN.x} size={14} sw={2.4} />
                              </button>
                            </div>
                          </header>

                          {
                            /* Preview-language toggle — re-renders the card (and
                              sets the send language) in each language the
                              contractor enabled in Settings. Hidden when only
                              one language is configured. */
                          }
                          {sendLangs.length > 1
                            ? (
                              <div
                                class="quote-review__langtoggle"
                                role="group"
                                aria-label={tFor(
                                  previewLang,
                                  "asstChat.preview.languageGroup",
                                )}
                              >
                                <span class="quote-review__langtoggle-label">
                                  {tFor(
                                    previewLang,
                                    "asstChat.preview.previewIn",
                                  )}
                                </span>
                                {sendLangs.map((lng) => (
                                  <button
                                    key={`pl-${lng}`}
                                    type="button"
                                    class={`quote-review__langpill${
                                      previewLang === lng ? " is-active" : ""
                                    }`}
                                    aria-pressed={previewLang === lng
                                      ? "true"
                                      : "false"}
                                    onClick={() => {
                                      previewLangPickedRef.current = true;
                                      setPreviewLang(lng as "en" | "es");
                                    }}
                                  >
                                    {SEND_LANG_LABEL_KEYS[lng]
                                      ? tFor(
                                        previewLang,
                                        SEND_LANG_LABEL_KEYS[lng],
                                      )
                                      : lng}
                                  </button>
                                ))}
                              </div>
                            )
                            : null}

                          {
                            /* Roadmap: swap the finished doc between Quote +
                              Agreement and a standalone Invoice. Invoice mode
                              drops signature/terms and sends a payable bill
                              for the same total. */
                          }
                          <div
                            class="quote-review__langtoggle"
                            role="group"
                            aria-label={tFor(
                              previewLang,
                              "asstChat.preview.docTypeGroup",
                            )}
                          >
                            <span class="quote-review__langtoggle-label">
                              {tFor(previewLang, "asstChat.preview.sendAs")}
                            </span>
                            <button
                              type="button"
                              class={`quote-review__langpill${
                                reviewDocType === "quote" ? " is-active" : ""
                              }`}
                              aria-pressed={reviewDocType === "quote"
                                ? "true"
                                : "false"}
                              onClick={() => setReviewDocType("quote")}
                              disabled={sending}
                            >
                              {tFor(previewLang, "asstChat.preview.kind")}
                            </button>
                            <button
                              type="button"
                              class={`quote-review__langpill${
                                reviewDocType === "invoice" ? " is-active" : ""
                              }`}
                              aria-pressed={reviewDocType === "invoice"
                                ? "true"
                                : "false"}
                              onClick={() => setReviewDocType("invoice")}
                              disabled={sending}
                            >
                              {tFor(
                                previewLang,
                                "asstChat.preview.docTypeInvoice",
                              )}
                            </button>
                          </div>
                          {reviewDocType === "invoice"
                            ? (
                              <div style="margin:10px 14px 0;padding:10px 14px;background:var(--coffee-50,#f5f0e8);border:1px dashed var(--border,#d8dcd5);border-radius:10px;font-size:12.5px;color:var(--fg-muted,#6b7560)">
                                {tFor(
                                  previewLang,
                                  "asstChat.preview.invoiceModeNote",
                                )}
                              </div>
                            )
                            : null}

                          {
                            /* Roadmap p.5 (Preview.docx): FROM = the contractor.
                              Read-only; the editable TO (customer) follows. */
                          }
                          {from && (from.business || from.name)
                            ? (
                              <section
                                class="quote-review__hero"
                                style="opacity:.92"
                              >
                                <div class="quote-review__hero-label">
                                  {tFor(previewLang, "asstChat.preview.from")}
                                </div>
                                <div class="quote-review__hero-name">
                                  {from.business || from.name}
                                </div>
                                <div class="quote-review__hero-meta">
                                  {from.name && from.business
                                    ? <span>{from.name}</span>
                                    : null}
                                  {from.phone
                                    ? (
                                      <>
                                        <span class="quote-review__dot">·</span>
                                        <span>{from.phone}</span>
                                      </>
                                    )
                                    : null}
                                  {from.email
                                    ? (
                                      <>
                                        <span class="quote-review__dot">·</span>
                                        <span>{from.email}</span>
                                      </>
                                    )
                                    : null}
                                </div>
                              </section>
                            )
                            : null}

                          {customer?.name
                            ? (
                              <section class="quote-review__hero">
                                <div class="quote-review__hero-label">
                                  {tFor(previewLang, "asstChat.preview.for")}
                                </div>
                                <button
                                  type="button"
                                  class="quote-review__swap"
                                  aria-label={tFor(
                                    previewLang,
                                    "asstChat.preview.switchCustomer",
                                  )}
                                  title={tFor(
                                    previewLang,
                                    "asstChat.preview.switchCustomer",
                                  )}
                                  onClick={openCustomerPicker}
                                  disabled={customerPickerBusy}
                                >
                                  <svg
                                    viewBox="0 0 20 20"
                                    width="18"
                                    height="18"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M14.06 3.94a1.5 1.5 0 0 1 2.12 0l1.88 1.88a1.5 1.5 0 0 1 0 2.12L8.5 17.5 3 19l1.5-5.5z"
                                      fill="none"
                                      stroke="currentColor"
                                      stroke-width="1.6"
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                    />
                                  </svg>
                                </button>
                                <div
                                  class="quote-review__hero-name quote-review__editable"
                                  contentEditable
                                  spellcheck
                                  lang="en"
                                  onBlur={(e) =>
                                    onEditCustomerName(
                                      customer.id,
                                      customer.name,
                                      e.currentTarget as HTMLElement,
                                    )}
                                >
                                  {customer.name}
                                </div>
                                <div class="quote-review__hero-meta">
                                  <span
                                    class={`quote-review__editable quote-review__hero-field${
                                      customer.email
                                        ? ""
                                        : " quote-review__hero-field--empty"
                                    }`}
                                    contentEditable
                                    spellcheck={false}
                                    data-placeholder={tFor(
                                      previewLang,
                                      "asstChat.preview.addEmail",
                                    )}
                                    onBlur={(e) =>
                                      onEditCustomerField(
                                        "email",
                                        customer.id,
                                        customer.email,
                                        e.currentTarget as HTMLElement,
                                      )}
                                  >
                                    {customer.email ?? ""}
                                  </span>
                                  <span class="quote-review__dot">·</span>
                                  <span
                                    class={`quote-review__editable quote-review__hero-field${
                                      customer.phoneNumber
                                        ? ""
                                        : " quote-review__hero-field--empty"
                                    }`}
                                    contentEditable
                                    spellcheck={false}
                                    data-placeholder={tFor(
                                      previewLang,
                                      "asstChat.preview.addPhone",
                                    )}
                                    onBlur={(e) =>
                                      onEditCustomerField(
                                        "phoneNumber",
                                        customer.id,
                                        customer.phoneNumber,
                                        e.currentTarget as HTMLElement,
                                      )}
                                  >
                                    {customer.phoneNumber ?? ""}
                                  </span>
                                </div>
                                {customerPickerOpen
                                  ? (
                                    <div class="quote-review__swap-panel">
                                      <input
                                        type="text"
                                        class="cust-pick__search"
                                        placeholder={customerPickerList &&
                                            customerPickerList.length > 5
                                          ? tFor(
                                            previewLang,
                                            "asstChat.searchNCustomers",
                                            { n: customerPickerList.length },
                                          )
                                          : tFor(
                                            previewLang,
                                            "common.searchCustomers",
                                          )}
                                        value={customerPickerSearch}
                                        autoFocus
                                        onInput={(e) =>
                                          setCustomerPickerSearch(
                                            (e.target as HTMLInputElement)
                                              .value,
                                          )}
                                        onKeyDown={(e) => {
                                          if (e.key === "Escape") {
                                            setCustomerPickerOpen(false);
                                          }
                                        }}
                                      />
                                      {customerPickerList === null
                                        ? (
                                          <div class="cust-pick__empty">
                                            {tFor(
                                              previewLang,
                                              "common.loadingCustomers",
                                            )}
                                          </div>
                                        )
                                        : (() => {
                                          const q = customerPickerSearch.trim()
                                            .toLowerCase();
                                          const filtered =
                                            (customerPickerList ?? []).filter(
                                              (c) => {
                                                if (c.id === customer.id) {
                                                  return false;
                                                }
                                                if (!q) return true;
                                                return (
                                                  c.name.toLowerCase().includes(
                                                    q,
                                                  ) ||
                                                  (c.email ?? "").toLowerCase()
                                                    .includes(q) ||
                                                  (c.phoneNumber ?? "")
                                                    .toLowerCase().includes(q)
                                                );
                                              },
                                            );
                                          if (filtered.length === 0) {
                                            return (
                                              <div class="cust-pick__empty">
                                                {q
                                                  ? tFor(
                                                    previewLang,
                                                    "common.noMatches",
                                                  )
                                                  : tFor(
                                                    previewLang,
                                                    "asstChat.noOtherCustomers",
                                                  )}
                                              </div>
                                            );
                                          }
                                          return (
                                            <div class="cust-pick__list cust-pick__list--scroll">
                                              {filtered.slice(0, 100).map((
                                                c,
                                              ) => (
                                                <button
                                                  key={c.id}
                                                  type="button"
                                                  class="cust-pick__row"
                                                  disabled={customerPickerBusy}
                                                  onClick={() =>
                                                    onBindDifferentCustomer(c)}
                                                >
                                                  <span class="cust-pick__name">
                                                    {c.name}
                                                  </span>
                                                  {c.email || c.phoneNumber
                                                    ? (
                                                      <span class="cust-pick__meta">
                                                        {c.email ??
                                                          c.phoneNumber}
                                                      </span>
                                                    )
                                                    : null}
                                                </button>
                                              ))}
                                            </div>
                                          );
                                        })()}
                                      <button
                                        type="button"
                                        class="cust-create__btn"
                                        onClick={() =>
                                          setCustomerPickerOpen(false)}
                                        disabled={customerPickerBusy}
                                        style="margin-top:8px"
                                      >
                                        {tFor(previewLang, "common.cancel")}
                                      </button>
                                    </div>
                                  )
                                  : null}
                              </section>
                            )
                            : null}

                          {(() => {
                            const lines = detailLines(polishedDescription);
                            if (lines.length === 0) return null;
                            return (
                              <section class="quote-review__section">
                                <div class="quote-review__section-label">
                                  {tFor(
                                    previewLang,
                                    "asstChat.preview.jobDetails",
                                  )}
                                </div>
                                {lines.length > 1
                                  ? (
                                    <ul class="quote-review__details">
                                      {lines.map((l, i) => (
                                        <li key={i}>{l}</li>
                                      ))}
                                    </ul>
                                  )
                                  : (
                                    <p class="quote-review__details-text">
                                      {lines[0]}
                                    </p>
                                  )}
                              </section>
                            );
                          })()}

                          {/* Term grid shows in BOTH modes — the invoice keeps
                            the start/duration/payment/warranty grid; only the
                            14 legal clauses + signature are dropped (and the
                            compact preview never rendered those anyway). */}
                          {termAnswers.length > 0
                            ? (
                              <section class="quote-review__section">
                                <div class="quote-review__section-label">
                                  {tFor(previewLang, "asstChat.preview.terms")}
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
                                    const wizOptsRaw = (
                                      wizMsg?.payload as
                                        | { options?: WizardOption[] }
                                        | undefined
                                    )?.options ?? [];
                                    // Fall back to the static spec when the chat scope
                                    // doesn't carry the options (older threads, pruned
                                    // history, etc.). Otherwise the picker would render
                                    // with only Custom + Cancel.
                                    const wizOpts: WizardOption[] =
                                      wizOptsRaw.length > 0 ? wizOptsRaw : (
                                        TERM_OPTIONS_FALLBACK[t.stepId] ?? []
                                      ).map((o, i) => ({
                                        id: `fallback-${i}`,
                                        label: tFor(previewLang, o.labelKey),
                                        sub: o.subKey
                                          ? tFor(previewLang, o.subKey)
                                          : undefined,
                                      }));
                                    return (
                                      <div
                                        key={`t-${i}`}
                                        class="quote-review__term"
                                        style={isEditing
                                          ? "grid-column:1 / -1"
                                          : undefined}
                                      >
                                        <dt>
                                          {
                                            /* Resolve the term label in the
                                              preview language from its stepId so
                                              it matches the sent agreement,
                                              regardless of the stored label's
                                              language. Falls back to the stored
                                              label for unknown steps. */
                                          }
                                          {TERM_LABEL_KEYS[t.stepId]
                                            ? tFor(
                                              previewLang,
                                              TERM_LABEL_KEYS[t.stepId],
                                            )
                                            : t.label}
                                        </dt>
                                        {isEditing
                                          ? (
                                            <dd style="margin-top:4px">
                                              {customTermDraft &&
                                                  customTermDraft.stepId ===
                                                    t.stepId
                                                ? (
                                                  <div style="display:flex;flex-direction:column;gap:8px">
                                                    <input
                                                      type="text"
                                                      class="cust-pick__search"
                                                      placeholder={tFor(
                                                        previewLang,
                                                        "asstChat.preview.typeCustom",
                                                        {
                                                          label: t.label
                                                            .toLowerCase(),
                                                        },
                                                      )}
                                                      value={customTermDraft
                                                        .value}
                                                      onInput={(e) =>
                                                        setCustomTermDraft({
                                                          stepId: t.stepId,
                                                          value: (
                                                            e.target as HTMLInputElement
                                                          ).value,
                                                        })}
                                                      autoFocus
                                                      onKeyDown={(e) => {
                                                        if (
                                                          e.key === "Enter" &&
                                                          customTermDraft.value
                                                            .trim()
                                                        ) {
                                                          const v =
                                                            customTermDraft
                                                              .value.trim();
                                                          setCustomTermDraft(
                                                            null,
                                                          );
                                                          pickTermOption(
                                                            cid,
                                                            t.stepId,
                                                            t.label,
                                                            v,
                                                          );
                                                        } else if (
                                                          e.key === "Escape"
                                                        ) {
                                                          setCustomTermDraft(
                                                            null,
                                                          );
                                                        }
                                                      }}
                                                    />
                                                    <div style="display:flex;gap:8px">
                                                      <button
                                                        type="button"
                                                        class="cust-create__btn cust-create__btn--primary"
                                                        disabled={sending ||
                                                          !customTermDraft.value
                                                            .trim()}
                                                        onClick={() => {
                                                          const v =
                                                            customTermDraft
                                                              .value.trim();
                                                          setCustomTermDraft(
                                                            null,
                                                          );
                                                          pickTermOption(
                                                            cid,
                                                            t.stepId,
                                                            t.label,
                                                            v,
                                                          );
                                                        }}
                                                      >
                                                        {tFor(
                                                          previewLang,
                                                          "common.save",
                                                        )}
                                                      </button>
                                                      <button
                                                        type="button"
                                                        class="cust-create__btn"
                                                        onClick={() =>
                                                          setCustomTermDraft(
                                                            null,
                                                          )}
                                                        disabled={sending}
                                                      >
                                                        {tFor(
                                                          previewLang,
                                                          "common.back",
                                                        )}
                                                      </button>
                                                    </div>
                                                  </div>
                                                )
                                                : (
                                                  <div
                                                    class="wiz__opts"
                                                    style="flex-direction:column;align-items:stretch;gap:6px"
                                                  >
                                                    {wizOpts
                                                      .filter((o) =>
                                                        !o.isCustom
                                                      )
                                                      .map((opt) => (
                                                        <button
                                                          key={opt.id}
                                                          type="button"
                                                          class={`wiz-opt ${
                                                            opt.label ===
                                                                t.value
                                                              ? "wiz-opt--selected"
                                                              : ""
                                                          }`}
                                                          onClick={() =>
                                                            pickTermOption(
                                                              cid,
                                                              t.stepId,
                                                              t.label,
                                                              opt.label,
                                                            )}
                                                          disabled={sending}
                                                        >
                                                          {opt.label}
                                                          {opt.sub
                                                            ? (
                                                              <span class="wiz-opt__sub">
                                                                {opt.sub}
                                                              </span>
                                                            )
                                                            : null}
                                                        </button>
                                                      ))}
                                                    <button
                                                      type="button"
                                                      class="wiz-opt wiz-opt--custom"
                                                      onClick={() =>
                                                        setCustomTermDraft({
                                                          stepId: t.stepId,
                                                          value: "",
                                                        })}
                                                      disabled={sending}
                                                    >
                                                      {tFor(
                                                        previewLang,
                                                        "asstChat.preview.customOption",
                                                      )}
                                                    </button>
                                                    <button
                                                      type="button"
                                                      class="wiz-opt wiz-opt--custom"
                                                      onClick={() => {
                                                        setEditingTermStepId(
                                                          null,
                                                        );
                                                        setCustomTermDraft(
                                                          null,
                                                        );
                                                      }}
                                                      disabled={sending}
                                                    >
                                                      {tFor(
                                                        previewLang,
                                                        "common.cancel",
                                                      )}
                                                    </button>
                                                  </div>
                                                )}
                                            </dd>
                                          )
                                          : (
                                            <dd>
                                              <button
                                                type="button"
                                                class="quote-review__term-edit"
                                                onClick={() =>
                                                  setEditingTermStepId(
                                                    t.stepId,
                                                  )}
                                                disabled={!cid || !t.stepId}
                                                title={tFor(
                                                  previewLang,
                                                  "common.edit",
                                                )}
                                              >
                                                {
                                                  /* Value is already localized +
                                                    "Estimated"-wrapped (for
                                                    durations) by the termAnswers
                                                    map above — render as-is to
                                                    avoid double-wrapping. */
                                                }
                                                {t.value}
                                              </button>
                                            </dd>
                                          )}
                                      </div>
                                    );
                                  })}
                                </dl>
                              </section>
                            )
                            : null}

                          <section class="quote-review__total">
                            <div class="quote-review__total-label">
                              {tFor(previewLang, "asstChat.preview.totalDue")}
                            </div>
                            <div class="quote-review__total-amt">
                              <span class="quote-review__total-currency">
                                $
                              </span>
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
                                  )}
                              >
                                {totalStr}
                              </span>
                            </div>
                            {milestones &&
                                milestones.length > 1
                              ? (
                                <ul class="quote-review__milestones">
                                  {milestones.map((ms, i) => (
                                    <li
                                      key={`ms-${i}`}
                                      class="quote-review__milestone"
                                    >
                                      <span class="quote-review__milestone-label">
                                        {ms.label}
                                        {typeof ms.pct === "number"
                                          ? (
                                            <span class="quote-review__milestone-pct">
                                              {" "}
                                              · {ms.pct}%
                                            </span>
                                          )
                                          : null}
                                      </span>
                                      <strong class="quote-review__milestone-amt">
                                        {fmtUSD(ms.amountCents)}
                                      </strong>
                                    </li>
                                  ))}
                                </ul>
                              )
                              : null}
                          </section>

                          <footer class="quote-review__cta">
                            {swapInvoiceSent
                              ? (
                                <div style="display:flex;flex-direction:column;gap:8px;width:100%">
                                  {swapSendFail
                                    ? (
                                      // P-09: honest outcome — the invoice
                                      // exists but delivery failed; render
                                      // the same divider chip the contract-
                                      // send path uses instead of a green
                                      // "sent" banner.
                                      <div class="phase-divider">
                                        <div class="phase-divider__line" />
                                        <div class="phase-divider__label">
                                          <I d={ICN.contract} size={11} />{" "}
                                          {tFor(lang, swapSendFail.key, {
                                            reason: swapSendFail.reason,
                                          })}
                                        </div>
                                        <div class="phase-divider__line" />
                                      </div>
                                    )
                                    : (
                                      <div style="padding:12px 14px;background:var(--green-50,#eef6ea);border:1px solid var(--brand-green,#519843);border-radius:12px;font-weight:700;font-size:13.5px;color:var(--brand-teal,#144852)">
                                        {tFor(
                                          previewLang,
                                          "asstChat.preview.invoiceSent",
                                        )}
                                      </div>
                                    )}
                                  <div style="display:flex;gap:8px">
                                    <button
                                      type="button"
                                      class="quote-review__send-caret"
                                      style="flex:1;border-radius:10px;padding:10px"
                                      onClick={async () => {
                                        try {
                                          await navigator.clipboard
                                            .writeText(
                                              `${globalThis.location.origin}/i/${swapInvoiceSent}`,
                                            );
                                          setSwapLinkCopied(true);
                                          setTimeout(
                                            () => setSwapLinkCopied(false),
                                            1500,
                                          );
                                        } catch { /* ignore */ }
                                      }}
                                    >
                                      {swapLinkCopied
                                        ? tFor(
                                          previewLang,
                                          "asstChat.preview.linkCopied",
                                        )
                                        : tFor(
                                          previewLang,
                                          "asstChat.preview.menuCopyLink",
                                        )}
                                    </button>
                                    <a
                                      class="quote-review__send-caret"
                                      style="flex:1;border-radius:10px;padding:10px;text-decoration:none;display:flex;align-items:center;justify-content:center"
                                      href={`/i/${swapInvoiceSent}`}
                                      target="_blank"
                                      rel="noopener"
                                    >
                                      {tFor(
                                        previewLang,
                                        "asstChat.invoiceFlow.viewInvoice",
                                      )}
                                    </a>
                                  </div>
                                </div>
                              )
                              : (
                                <div class="quote-review__send-split">
                                  <button
                                    type="button"
                                    class="quote-review__send-main"
                                    onClick={() =>
                                      reviewDocType === "invoice"
                                        ? confirmSendInvoiceSwap(
                                          sendChannel,
                                          totalCentsForBreakdown,
                                        )
                                        : confirmSendContract(
                                          m,
                                          sendChannel,
                                          previewLang,
                                        )}
                                    disabled={sending}
                                  >
                                    <I d={ICN.send} size={14} sw={2.4} />
                                    {sending
                                      ? tFor(
                                        previewLang,
                                        "asstChat.preview.sending",
                                      )
                                      : reviewDocType === "invoice"
                                      ? tFor(
                                        previewLang,
                                        "asstChat.preview.sendInvoice",
                                      )
                                      : sendChannel === "both"
                                      ? sendActionLabel(
                                        previewLang,
                                        "asstChat.preview.sendBoth",
                                      )
                                      : sendChannel === "sms"
                                      ? sendActionLabel(
                                        previewLang,
                                        "asstChat.preview.sendSms",
                                      )
                                      : sendActionLabel(
                                        previewLang,
                                        "asstChat.preview.sendEmail",
                                      )}
                                  </button>
                              <button
                                type="button"
                                class="quote-review__send-caret"
                                aria-label={tFor(
                                  previewLang,
                                  "asstChat.preview.chooseSend",
                                )}
                                aria-expanded={channelMenuOpen
                                  ? "true"
                                  : "false"}
                                onClick={() => setChannelMenuOpen((o) => !o)}
                                disabled={sending}
                              >
                                <I d={ICN.chev} size={12} sw={2.4} />
                              </button>
                              {channelMenuOpen
                                ? (
                                  <div
                                    class="quote-review__send-menu"
                                    role="menu"
                                  >
                                    <button
                                      type="button"
                                      role="menuitem"
                                      class={`quote-review__send-menu-item${
                                        sendChannel === "both"
                                          ? " is-current"
                                          : ""
                                      }`}
                                      onClick={() => {
                                        setSendChannel("both");
                                        setChannelMenuOpen(false);
                                      }}
                                    >
                                      <I d={ICN.send} size={13} sw={2.4} />
                                      <span class="quote-review__send-menu-label">
                                        {tFor(
                                          previewLang,
                                          "asstChat.preview.menuBoth",
                                        )}
                                      </span>
                                      <span class="quote-review__send-menu-tag">
                                        {tFor(
                                          previewLang,
                                          "asstChat.preview.recommended",
                                        )}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      class={`quote-review__send-menu-item${
                                        sendChannel === "sms"
                                          ? " is-current"
                                          : ""
                                      }`}
                                      onClick={() => {
                                        setSendChannel("sms");
                                        setChannelMenuOpen(false);
                                      }}
                                    >
                                      <I d={ICN.phone} size={13} sw={2.4} />
                                      <span class="quote-review__send-menu-label">
                                        {tFor(
                                          previewLang,
                                          "asstChat.preview.menuSms",
                                        )}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      class={`quote-review__send-menu-item${
                                        sendChannel === "email"
                                          ? " is-current"
                                          : ""
                                      }`}
                                      onClick={() => {
                                        setSendChannel("email");
                                        setChannelMenuOpen(false);
                                      }}
                                    >
                                      <I d={ICN.mail} size={13} sw={2.4} />
                                      <span class="quote-review__send-menu-label">
                                        {tFor(
                                          previewLang,
                                          "asstChat.preview.menuEmail",
                                        )}
                                      </span>
                                    </button>
                                    {
                                      /* Copy link — an immediate action, not a
                                        channel pick: copies the public
                                        agreement URL so the contractor can
                                        paste it anywhere (WhatsApp, DMs). */
                                    }
                                    <button
                                      type="button"
                                      role="menuitem"
                                      class="quote-review__send-menu-item"
                                      onClick={async () => {
                                        const cid = contractId ||
                                          contract?.id;
                                        if (!cid) return;
                                        try {
                                          await navigator.clipboard.writeText(
                                            `${globalThis.location.origin}/c/${cid}`,
                                          );
                                          setLinkCopied(true);
                                          setTimeout(() => {
                                            setLinkCopied(false);
                                            setChannelMenuOpen(false);
                                          }, 1200);
                                        } catch {
                                          setChannelMenuOpen(false);
                                        }
                                      }}
                                    >
                                      <I d={ICN.clip} size={13} sw={2.4} />
                                      <span class="quote-review__send-menu-label">
                                        {linkCopied
                                          ? tFor(
                                            previewLang,
                                            "asstChat.preview.linkCopied",
                                          )
                                          : tFor(
                                            previewLang,
                                            "asstChat.preview.menuCopyLink",
                                          )}
                                      </span>
                                    </button>
                                  </div>
                                )
                                : null}
                                </div>
                              )}
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
                      ? tFor(lang, "asstChat.cta.eyebrowTerms")
                      : payload.toPhase === "send"
                      ? tFor(lang, "asstChat.cta.eyebrowSend")
                      : payload.toPhase === "invoice"
                      ? tFor(lang, "asstChat.cta.eyebrowInvoice")
                      : null
                    : null;
                  return (
                    <div key={m.id} class="msg">
                      <div class="msg__avatar">
                        <img src="/logo-monster.png" alt="" />
                      </div>
                      <div style="flex:1;min-width:0">
                        <div
                          class={`continue-cta ${
                            reviewed ? "continue-cta--done" : ""
                          }`}
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
                                  ? tFor(lang, "asstChat.cta.invoiceSent")
                                  : tFor(lang, "asstChat.cta.contractSent")
                                : m.content}
                            </div>
                            {reviewed
                              ? (
                                <div class="continue-cta__sub">
                                  {sentRecipient
                                    ? (
                                      <>
                                        {tFor(lang, "asstChat.cta.emailedTo")}
                                        {" "}
                                        <code>{sentRecipient}</code>
                                      </>
                                    )
                                    : dispatchFailReason
                                    ? (
                                      <>
                                        {tFor(
                                          lang,
                                          "asstChat.cta.notDelivered",
                                        )} {dispatchFailReason}
                                      </>
                                    )
                                    : (
                                      <>
                                        {tFor(lang, "asstChat.cta.noEmailPre")}
                                        {" "}
                                        <code>
                                          {customer?.name ??
                                            tFor(lang, "asstChat.theCustomer")}
                                        </code>{" "}
                                        {tFor(lang, "asstChat.cta.toDeliver")}
                                      </>
                                    )}
                                </div>
                              )
                              : payload.summary
                              ? (
                                <div class="continue-cta__sub">
                                  {payload.summary}
                                </div>
                              )
                              : null}
                          </div>
                          {reviewed
                            ? null
                            : payload.toPhase === "terms"
                            ? (
                              <div style="display:flex;gap:8px;flex-shrink:0">
                                <button
                                  type="button"
                                  class="continue-cta__btn"
                                  onClick={() =>
                                    submitContinueCta(m, "business")}
                                  disabled={sending}
                                >
                                  {tFor(lang, "asstChat.cta.business")}
                                </button>
                                <button
                                  type="button"
                                  class="continue-cta__btn"
                                  onClick={() => submitContinueCta(m, "person")}
                                  disabled={sending}
                                >
                                  {tFor(lang, "asstChat.cta.person")}
                                </button>
                              </div>
                            )
                            : (
                              <button
                                type="button"
                                class="continue-cta__btn"
                                onClick={() => submitContinueCta(m)}
                                disabled={sending}
                              >
                                {payload.toPhase === "send"
                                  ? tFor(lang, "asstChat.cta.review")
                                  : payload.toPhase === "invoice"
                                  ? tFor(lang, "asstChat.cta.sendInvoice")
                                  : tFor(lang, "asstChat.cta.start")}{" "}
                                <I d={ICN.arrow} size={11} sw={2.5} />
                              </button>
                            )}
                        </div>
                        {
                          /* Dev-only trigger: simulate the customer accepting the
                        quote so the threads-sidebar notification UX can be
                        tested without a real signing webhook. */
                        }
                        {reviewed &&
                            payload.toPhase === "send" &&
                            typeof globalThis.location !== "undefined" &&
                            globalThis.location.hostname === "localhost" &&
                            new URLSearchParams(globalThis.location.search).has(
                              "dev",
                            )
                          ? (
                            <button
                              type="button"
                              class="dev-accept-btn"
                              onClick={() =>
                                simulateCustomerAccept(payload.contractId)}
                              disabled={sending}
                              title="Localhost-only: flip contract to accepted, bump conversation, set unread."
                            >
                              🔧 {sending
                                ? "Simulating…"
                                : "Simulate customer accepted"}
                            </button>
                          )
                          : null}
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
                            {
                              /* Step-level Back (roadmap p.2/p.8): every wizard
                                step after Job Details carries a visible Back.
                                It routes through the SAME universal resolver as
                                the header button (pm:asst-back): rewind a step
                                → pop an in-chat view → exit to /dashboard. */
                            }
                            <button
                              type="button"
                              data-cy="wizard-back"
                              class="wiz__back"
                              disabled={sending}
                              onClick={() =>
                                globalThis.dispatchEvent(
                                  new CustomEvent("pm:asst-back"),
                                )}
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
                              {tFor(lang, "common.back")}
                            </button>
                            {
                              /* No "Step N of 10" label: the flow has an
                                unnumbered Job Details picker after the wizard,
                                so numbering only the wizard steps read as
                                inconsistent. Title-only across every step keeps
                                it uniform (problems.md #12). */
                            }
                            {
                              /* Customer step renders its own heading inside the
                            panel because the prompt swaps after picking
                            Business / Person ("What is the business name?"
                            etc). Every other wizard step uses the static
                            wizard-supplied question. */
                            }
                            {!isCustomerStep
                              ? <h3 class="wiz__step-q">{m.content}</h3>
                              : null}
                            {payload.hint
                              ? <div class="wiz__step-hint">{payload.hint}</div>
                              : null}
                            {(() => {
                              if (isCustomerStep) {
                                return (
                                  <CustomerStepPanel
                                    boundCustomer={customer}
                                    initialKind={precommittedKind ?? undefined}
                                    onKindConsumed={() =>
                                      setPrecommittedKind(null)}
                                    ownerEmail={from?.email}
                                    ownerPhone={from?.phone}
                                    sending={sending}
                                    lang={lang}
                                    onSubmit={(optionId, body) =>
                                      submitCustomerStep(m, optionId, body)}
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
                                    lang={lang}
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
                                    lang={lang}
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
                                    lang={lang}
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
                                    lang={lang}
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
                                    lang={lang}
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
                                      class={`wiz-opt ${
                                        opt.isCustom ? "wiz-opt--custom" : ""
                                      } ${
                                        rewindAnswer &&
                                          rewindAnswer.stepId ===
                                            payload.stepId &&
                                          rewindAnswer.optionId === opt.id
                                          ? "wiz-opt--prev"
                                          : ""
                                      }`}
                                      title={rewindAnswer &&
                                          rewindAnswer.stepId ===
                                            payload.stepId &&
                                          rewindAnswer.optionId === opt.id
                                        ? tFor(lang, "asstChat.wiz.prevChoice")
                                        : undefined}
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
                                      {opt.sub
                                        ? (
                                          <span class="wiz-opt__sub">
                                            {opt.sub}
                                          </span>
                                        )
                                        : null}
                                    </button>
                                  ))}
                                </div>
                              );
                            })()}
                            {
                              /* Step re-edit ("back") is handled by the
                                universal header back button: pm:asst-back →
                                goBackWizard when this step is active. No
                                per-step control needed (Roadmap p.2). */
                            }
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
                  const totalCents = payload.totalCents ??
                    lineItems.reduce(
                      (sum, li) => sum + (li.amountCents ?? 0),
                      0,
                    );
                  // Roadmap p.5: progress the badge Draft → Sent → Viewed →
                  // Approved via the shared label map (backend flips the
                  // underlying status as the customer opens/signs).
                  const statusLabel = statusChipLabel(payload.status, lang);
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
                              {isSuperseded
                                ? tFor(lang, "asstChat.actionCard.superseded")
                                : statusLabel}
                            </span>
                          </div>
                          <div class="action-card__body">
                            {(() => {
                              const lines = detailLines(payload.description);
                              if (lines.length === 0) return null;
                              return (
                                <div class="action-card__details">
                                  <div class="action-card__details-label">
                                    {tFor(
                                      lang,
                                      "asstChat.actionCard.jobDetails",
                                    )}
                                  </div>
                                  {lines.length > 1
                                    ? (
                                      <ul class="action-card__details-list">
                                        {lines.map((l, i) => (
                                          <li key={i}>{l}</li>
                                        ))}
                                      </ul>
                                    )
                                    : (
                                      <p class="action-card__details-text">
                                        {lines[0]}
                                      </p>
                                    )}
                                </div>
                              );
                            })()}
                            {lineItems.map((li, i) => (
                              <div key={i} class="action-card__row">
                                <span>{li.description}</span>
                                <strong>{fmtUSD(li.amountCents)}</strong>
                              </div>
                            ))}
                            {lineItems.length > 0
                              ? (
                                <div
                                  class="action-card__row"
                                  style="border-top:1px solid rgba(20,72,82,0.08);margin-top:6px;padding-top:8px"
                                >
                                  <span style="font-weight:700;color:var(--brand-teal)">
                                    {tFor(lang, "asstChat.actionCard.total")}
                                  </span>
                                  <strong style="font-size:15px">
                                    {fmtUSD(totalCents)}
                                  </strong>
                                </div>
                              )
                              : null}
                          </div>
                          {payload.status === "draft" && !isSuperseded
                            ? (
                              <div class="action-card__cta">
                                <button
                                  type="button"
                                  class="action-card__btn action-card__btn--primary"
                                  onClick={() => lockActionCard(m, payload)}
                                  disabled={sending || !payload.quoteId}
                                >
                                  <I d={ICN.bolt} size={11} />{" "}
                                  {tFor(lang, "asstChat.actionCard.lockIn")}
                                </button>
                                <button
                                  type="button"
                                  class="action-card__btn"
                                  onClick={() => setDraft("")}
                                  disabled={sending}
                                >
                                  {tFor(lang, "common.edit")}
                                </button>
                              </div>
                            )
                            : null}
                          {payload.status === "sent"
                            ? (
                              <div class="action-card__cta">
                                <button
                                  type="button"
                                  class="action-card__btn"
                                  onClick={() => sendText("Re-open the quote.")}
                                  disabled={sending}
                                >
                                  <I d={ICN.refresh} size={11} />{" "}
                                  {tFor(lang, "asstChat.actionCard.reopen")}
                                </button>
                              </div>
                            )
                            : null}
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
                if (
                  m.kind === "text" && m.content === "PM_ONBOARDING_DEMO_CTA"
                ) {
                  return (
                    <div key={m.id} class="msg" style="margin-top:6px">
                      <div class="msg__avatar">
                        <img src="/logo-monster.png" alt="" />
                      </div>
                      <div style="flex:1;min-width:0">
                        <a
                          href={sampleQuoteUrl ?? "#"}
                          target="_blank"
                          rel="noopener"
                          onClick={(e) => {
                            // If the per-user sample isn't minted yet, mint
                            // synchronously inside the click so the same tab
                            // can still navigate. Falls back to a no-op if
                            // the request fails — better than landing on a
                            // 404 or a stranger's branded quote.
                            if (sampleQuoteUrl) return;
                            e.preventDefault();
                            assistantClient
                              .ensureSampleQuote()
                              .then((r) => {
                                const url = `/q/${r.quoteId}`;
                                setSampleQuoteUrl(url);
                                globalThis.open(url, "_blank", "noopener");
                              })
                              .catch(() => {});
                          }}
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
                              {tFor(lang, "asstChat.demo.eyebrow")}
                            </span>
                            <span style="display:block;margin-top:2px;font-weight:800;color:#144852;font-size:14.5px">
                              {tFor(lang, "asstChat.demo.title")}
                            </span>
                            <span style="display:block;margin-top:2px;font-size:12px;color:#6b7a7e">
                              {tFor(lang, "asstChat.demo.body")}
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
                const filename =
                  (m.payload as { filename?: string } | undefined)
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
                      {m.role === "user"
                        ? userInitials
                        : <img src="/logo-monster.png" alt="" />}
                    </div>
                    <div>
                      {m.kind === "image" && fileId
                        ? (
                          <a
                            class="msg__image"
                            href={`/api/files/${fileId}`}
                            target="_blank"
                            rel="noopener"
                          >
                            <img
                              src={`/api/files/${fileId}`}
                              alt={filename ??
                                tFor(lang, "asstChat.attachedImage")}
                            />
                          </a>
                        )
                        : null}
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
            messages[messages.length - 1].role === "user"
          ? (
            <div
              class="msg"
              aria-live="polite"
              aria-label={tFor(lang, "asstChat.bossieThinking")}
            >
              <div class="msg__avatar">
                <img src="/logo-monster.png" alt="" />
              </div>
              <div class="msg__bubble msg__bubble--typing">
                <span class="typing-dot" />
                <span class="typing-dot" />
                <span class="typing-dot" />
              </div>
            </div>
          )
          : null}
      </div>

      {(() => {
        // Roadmap p.2: hide the composer when the user is in a "tapping-only"
        // structured step — the MoneyInput screen, or any unanswered wizard
        // card that exposes its own options. Text input has no place there
        // and was visually distracting customers during testing.
        const answeredStepIds = new Set<string>();
        for (const x of messages) {
          const sid = (x.payload as { wizardStepId?: string } | undefined)
            ?.wizardStepId;
          if (x.kind === "text" && sid) answeredStepIds.add(sid);
        }
        const hasUnansweredWizard = messages.some((m) => {
          if (m.kind !== "wizard") return false;
          const sid = (m.payload as { stepId?: string } | undefined)?.stepId;
          return !sid || !answeredStepIds.has(sid);
        });
        // Also hide it while the final quote-review card is open (previewCtaId
        // set): that screen is tap-only — the user sends via the card's button,
        // so a text box underneath just invites stray typing.
        const composerHidden = priceCaptureOpen || jobOptionsOpen ||
          invoiceCustomerOpen || invoiceResult !== null ||
          hasUnansweredWizard || previewCtaId !== null;
        if (composerHidden) return null;
        return (
          <div
            class={`composer${
              awaitingJobDetails && !submittedJobDetails && !draft.trim()
                ? " composer--flash"
                : ""
            }`}
          >
            {error
              ? (
                <div class="composer__err">
                  {error}
                  {canRetryTurn && retryTurnRef.current
                    ? (
                      // P-10: one-tap retry for a timed-out/failed turn —
                      // the affordance that replaces the endless spinner.
                      <button
                        type="button"
                        class="composer__err-retry"
                        style="margin-left:8px;appearance:none;border:1px solid currentColor;background:transparent;color:inherit;border-radius:8px;padding:2px 10px;font-weight:700;cursor:pointer"
                        onClick={() => {
                          const fn = retryTurnRef.current;
                          retryTurnRef.current = null;
                          setCanRetryTurn(false);
                          setError(undefined);
                          setDraft("");
                          autosize();
                          fn?.();
                        }}
                      >
                        {tFor(lang, "welcome.sample.retry")}
                      </button>
                    )
                    : null}
                </div>
              )
              : null}
            {recording
              ? (
                <RecordingPanel
                  elapsed={recElapsed}
                  level={audioLevel}
                  finalText={liveFinal}
                  interimText={liveInterim}
                  onStop={toggleRecord}
                  onCancel={cancelRecord}
                  lang={lang}
                />
              )
              : (
                <>
                  <div class="composer__inner">
                    <textarea
                      ref={taRef}
                      class="composer__input"
                      placeholder={composerPlaceholder(messages, lang)}
                      rows={2}
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
                        aria-label={tFor(lang, "asstChat.composer.voiceMemo")}
                        title={tFor(lang, "asstChat.composer.tapToTalk")}
                        onClick={toggleRecord}
                        disabled={sending}
                      >
                        <I d={ICN.mic} size={20} />
                      </button>
                      <button
                        type="button"
                        class="composer__send"
                        title={tFor(lang, "common.send")}
                        onClick={onSendClick}
                        disabled={sending || !draft.trim()}
                      >
                        <I d={ICN.arrow} size={16} sw={2.4} />
                      </button>
                    </div>
                  </div>
                  <div class="composer__hint">
                    {tFor(lang, "asstChat.composer.hint")}
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
  lang = "en",
}: {
  lang?: Lang;
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
  const outerScale = 1 + level * 0.72;
  const glowOpacity = 0.35 + level * 0.55;
  const elapsedLabel = elapsed < 60
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
    <div
      class="rec-panel"
      role="region"
      aria-label={tFor(lang, "asstChat.rec.region")}
    >
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
              style={`transform:scale(${
                outerScale.toFixed(3)
              });transform-origin:40px 40px;opacity:${
                glowOpacity.toFixed(3)
              };transition:transform 70ms ease-out, opacity 90ms ease-out`}
            />
            {/* Core */}
            <circle
              cx="40"
              cy="40"
              r="22"
              fill="url(#recOrbCore)"
              style={`transform:scale(${
                coreScale.toFixed(3)
              });transform-origin:40px 40px;transition:transform 60ms ease-out`}
            />
            {/* Specular highlight */}
            <ellipse
              cx="34"
              cy="35"
              rx="7"
              ry="4"
              fill="rgba(255,255,255,0.55)"
              style={`transform:scale(${
                coreScale.toFixed(3)
              });transform-origin:40px 40px`}
            />
          </svg>
        </div>

        <div class="rec-panel__center">
          <div class="rec-panel__head">
            <span class="rec-panel__live">
              <span class="rec-panel__live-dot" />
              {tFor(lang, "asstChat.rec.live")}
            </span>
            <span class="rec-panel__elapsed">{elapsedLabel}</span>
          </div>
          <div class="rec-panel__transcript" aria-live="polite">
            {hasAny
              ? (
                <p class="rec-panel__transcript-text">
                  <span class="rec-panel__final">{oldFinal}</span>
                  {newFinal
                    ? (
                      <span class="rec-panel__final rec-panel__final--new">
                        {newFinal}
                      </span>
                    )
                    : null}
                  {interimText && finalText ? " " : ""}
                  <span class="rec-panel__interim">{interimText}</span>
                  <span class="rec-panel__caret" aria-hidden="true">
                    ▍
                  </span>
                </p>
              )
              : (
                <p class="rec-panel__placeholder">
                  {tFor(lang, "asstChat.rec.placeholder")}
                </p>
              )}
          </div>
        </div>

        <div class="rec-panel__controls">
          <button
            type="button"
            class="rec-panel__cancel"
            onClick={onCancel}
            aria-label={tFor(lang, "asstChat.rec.cancelRecording")}
            title={tFor(lang, "common.cancel")}
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
            aria-label={tFor(lang, "asstChat.rec.stopAndSend")}
            title={tFor(lang, "asstChat.rec.stopSend")}
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
  /** The contractor's OWN contact (from the quote/agreement FROM block).
   *  Used to block saving a customer with the contractor's own email/phone —
   *  the bug where every customer carried Hans's contact and the agreement
   *  sent to the contractor instead of the customer. */
  ownerEmail?: string;
  ownerPhone?: string;
  sending: boolean;
  lang?: Lang;
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
          businessName?: string;
        };
      };
    },
  ) => Promise<void>;
}) {
  const {
    boundCustomer,
    initialKind,
    onKindConsumed,
    ownerEmail,
    ownerPhone,
    sending,
    lang = "en",
    onSubmit,
  } = props;
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
  /** Roadmap p.7: the "Who is this for?" step also collects a Business
   *  Name. Optional — an empty value never blocks Next. */
  const [createBusiness, setCreateBusiness] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [localErr, setLocalErr] = useState<string | undefined>();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    assistantClient
      .listCustomers()
      .then((list) => {
        if (!cancelled) {
          setCustomers(list);
          // Fresh users have nobody to pick — jump straight to the
          // "Who is this for?" create form instead of an empty dropdown.
          if (list.length === 0 && !boundCustomer) setView("form");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLocalErr(
            err instanceof Error
              ? err.message
              : tFor(lang, "asstChat.error.loadCustomers"),
          );
        }
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
    const trimmedEmail = createEmail.trim();
    const trimmedPhone = createPhone.trim();
    const normEmail = (e: string | undefined) => (e ?? "").trim().toLowerCase();
    // Trailing 10 digits so a US country-code prefix doesn't defeat the match
    // (E.164 "+15403331334" vs a typed "(540) 333-1334").
    const normPhone = (p: string | undefined) => {
      const d = (p ?? "").replace(/\D/g, "");
      return d.length > 10 ? d.slice(-10) : d;
    };
    // The customer must be reachable on at least one channel — without a
    // contact the agreement can't be delivered to them.
    const hasContact = trimmedEmail.length > 0 || trimmedPhone.length > 0;
    // Guard: the customer's contact must not be the contractor's own. This is
    // the root of the "every customer carries my email/phone, and the contract
    // sends to me" bug.
    const emailIsOwn = !!ownerEmail && trimmedEmail.length > 0 &&
      normEmail(trimmedEmail) === normEmail(ownerEmail);
    const phoneIsOwn = !!ownerPhone && trimmedPhone.length > 0 &&
      normPhone(trimmedPhone) === normPhone(ownerPhone);
    const contactErr = emailIsOwn
      ? tFor(lang, "asstChat.customerStep.ownEmail")
      : phoneIsOwn
      ? tFor(lang, "asstChat.customerStep.ownPhone")
      : !hasContact && trimmedName.length > 0
      ? tFor(lang, "asstChat.customerStep.needContact")
      : undefined;
    const submitDisabled = sending || trimmedName.length === 0 ||
      !hasContact || emailIsOwn || phoneIsOwn;
    const formHeading = tFor(lang, "asstChat.customerStep.whoFor");
    const namePlaceholder = tFor(lang, "asstChat.customerStep.name");
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
          <input
            type="text"
            data-cy="wizard-business-name"
            class="cust-pick__search"
            placeholder={tFor(
              lang,
              "asstChat.customerStep.businessNamePlaceholder",
            )}
            aria-label={tFor(
              lang,
              "asstChat.customerStep.businessNamePlaceholder",
            )}
            value={createBusiness}
            onInput={(e) =>
              setCreateBusiness((e.target as HTMLInputElement).value)}
          />
          <div class="cust-create__row">
            <input
              type="tel"
              class="cust-pick__search"
              placeholder={tFor(lang, "asstChat.customerStep.phonePlaceholder")}
              value={createPhone}
              onInput={(e) =>
                setCreatePhone((e.target as HTMLInputElement).value)}
            />
            <input
              type="email"
              class="cust-pick__search"
              placeholder={tFor(lang, "asstChat.customerStep.emailPlaceholder")}
              value={createEmail}
              onInput={(e) =>
                setCreateEmail((e.target as HTMLInputElement).value)}
            />
          </div>
          {localErr ?? contactErr
            ? <div class="cust-pick__err">{localErr ?? contactErr}</div>
            : null}
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
                      ...(createBusiness.trim()
                        ? { businessName: createBusiness.trim() }
                        : {}),
                    },
                  },
                })}
            >
              {tFor(lang, "common.next")}
            </button>
            <button
              type="button"
              class="cust-create__btn"
              onClick={backToList}
              disabled={sending}
            >
              {tFor(lang, "common.back")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- View: default — dropdown (kind already picked on the lock-quote CTA) ----
  return (
    <div ref={rootRef}>
      {/* Lead with the step question ("Who is this for?") so the customer
          step reads the same whether the user lands on the pick list or the
          create form (roadmap p.7). */}
      <h3 class="wiz__step-q">
        {tFor(lang, "asstChat.customerStep.whoFor")}
      </h3>
      <div class="wiz__step-hint">
        {tFor(lang, "asstChat.customerStep.pickTitle")}
      </div>
      <div
        class="wiz__opts"
        style="flex-direction:column;align-items:stretch;gap:8px;margin-top:8px"
      >
        {boundCustomer
          ? (
            <button
              type="button"
              class="wiz-opt"
              onClick={() => onSubmit("use_active")}
              disabled={sending}
            >
              {tFor(lang, "asstChat.customerStep.useFromChat", {
                name: boundCustomer.name,
              })}
              {boundCustomer.email
                ? <span class="wiz-opt__sub">{boundCustomer.email}</span>
                : null}
            </button>
          )
          : null}
        {loadingList
          ? (
            <div class="cust-pick__empty">
              {tFor(lang, "common.loadingCustomers")}
            </div>
          )
          : customers && customers.length === 0
          ? (
            <div class="cust-pick__empty">
              {tFor(lang, "asstChat.customerStep.noSaved")}
            </div>
          )
          : (
            <div class={`cust-dd ${pickerOpen ? "cust-dd--open" : ""}`}>
              {!pickerOpen
                ? (
                  <button
                    type="button"
                    class="cust-dd__trigger"
                    onClick={() => setPickerOpen(true)}
                    disabled={sending}
                  >
                    <span class="cust-dd__placeholder">
                      {tFor(lang, "asstChat.customerStep.existingTrigger")}
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
                )
                : (
                  <div class="cust-dd__panel">
                    <input
                      type="text"
                      class="cust-pick__search"
                      placeholder={(customers?.length ?? 0) > 5
                        ? tFor(lang, "asstChat.searchNCustomers", {
                          n: customers?.length ?? 0,
                        })
                        : tFor(lang, "common.searchCustomers")}
                      value={search}
                      onInput={(e) =>
                        setSearch((e.target as HTMLInputElement).value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setSearch("");
                          setPickerOpen(false);
                        }
                      }}
                      autoFocus
                    />
                    {filtered.length === 0
                      ? (
                        <div class="cust-pick__empty">
                          {tFor(lang, "common.noMatches")}
                        </div>
                      )
                      : (
                        <div class="cust-pick__list cust-pick__list--scroll">
                          {filtered.slice(0, 100).map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              class="cust-pick__row"
                              onClick={() =>
                                onSubmit("pick_existing", {
                                  customer: { id: c.id },
                                })}
                              disabled={sending}
                            >
                              <span class="cust-pick__name">{c.name}</span>
                              {c.email || c.phoneNumber
                                ? (
                                  <span class="cust-pick__meta">
                                    {c.email ?? c.phoneNumber}
                                  </span>
                                )
                                : null}
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
          {tFor(lang, "asstChat.customerStep.newCustomer")}
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
  lang?: Lang;
  onSubmit: (values: Record<string, string | number>) => void;
  onCancel: () => void;
}) {
  const { option, quoteTotalCents, sending, lang = "en", onSubmit, onCancel } =
    props;
  const fields = option.followUp?.fields ?? [];

  const initial: Record<string, string | number> = {};
  for (const f of fields) initial[f.id] = f.default ?? "";
  const [values, setValues] = useState<Record<string, string | number>>(
    initial,
  );

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
        return tFor(lang, "asstChat.followUp.daysSuffix");
      case "currency":
        return "$";
      default:
        return "";
    }
  }

  // Submit-disabled rule: every numeric field must be a finite number, and
  // every required field must be non-empty. (Optional support if needed
  // later — for now treat all declared fields as required.)
  const submitDisabled = sending ||
    fields.some((f) => {
      const v = values[f.id];
      if (v === undefined || v === null || v === "") return true;
      if (f.type !== "text" && !Number.isFinite(Number(v))) return true;
      if (f.type !== "text" && typeof f.min === "number" && Number(v) < f.min) {
        return true;
      }
      if (f.type !== "text" && typeof f.max === "number" && Number(v) > f.max) {
        return true;
      }
      return false;
    });

  // Live $ preview — only meaningful when there's a quote total AND the
  // option declares a percent field (the only shape we can preview right
  // now). For deposit_bal that's "$X deposit · $Y balance".
  const depositPctField = fields.find((f) => f.type === "percent");
  const showPreview = quoteTotalCents > 0 && depositPctField;
  const depositPct = depositPctField ? Number(values[depositPctField.id]) : 0;
  const previewDepositCents = showPreview && Number.isFinite(depositPct)
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
                  setField(f.id, (e.target as HTMLInputElement).value, f.type)}
              />
              {suffix(f.type)
                ? <span class="wiz-field__suffix">{suffix(f.type)}</span>
                : null}
            </span>
          </label>
        ))}
      </div>
      {showPreview
        ? (
          <div class="wiz-preview">
            <span class="wiz-preview__row">
              {tFor(lang, "asstChat.followUp.depositLabel")}{" "}
              <strong>{fmtUSD(previewDepositCents)}</strong>
            </span>
            <span class="wiz-preview__sep">·</span>
            <span class="wiz-preview__row">
              {tFor(lang, "asstChat.followUp.balanceLabel")}{" "}
              <strong>{fmtUSD(previewBalanceCents)}</strong>
            </span>
          </div>
        )
        : null}
      <div class="cust-create__actions">
        <button
          type="button"
          class="cust-create__btn cust-create__btn--primary"
          onClick={() => onSubmit(values)}
          disabled={submitDisabled}
        >
          {tFor(lang, "asstChat.followUp.useOption", { label: option.label })}
        </button>
        <button
          type="button"
          class="cust-create__btn"
          onClick={onCancel}
          disabled={sending}
        >
          {tFor(lang, "common.back")}
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
  lang?: Lang;
  onSubmit: (dateStr: string) => void;
  onCancel: () => void;
}) {
  const { sending, lang = "en", onSubmit, onCancel } = props;
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
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
      String(d.getDate()).padStart(2, "0")
    }`;
  const toUsDate = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}/${
      String(d.getDate()).padStart(2, "0")
    }/${d.getFullYear()}`;

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
  const weekdays = [
    tFor(lang, "asstChat.cal.su"),
    tFor(lang, "asstChat.cal.mo"),
    tFor(lang, "asstChat.cal.tu"),
    tFor(lang, "asstChat.cal.we"),
    tFor(lang, "asstChat.cal.th"),
    tFor(lang, "asstChat.cal.fr"),
    tFor(lang, "asstChat.cal.sa"),
  ];
  const prevDisabled = viewMonth.getFullYear() === today.getFullYear() &&
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
          aria-label={tFor(lang, "asstChat.cal.prevMonth")}
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
          aria-label={tFor(lang, "asstChat.cal.nextMonth")}
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
          {tFor(lang, "asstChat.cal.useDate")}
        </button>
        <button
          type="button"
          class="cust-create__btn"
          onClick={onCancel}
          disabled={sending}
        >
          {tFor(lang, "common.back")}
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
    confidence = Number.isInteger(n) && !/half|about|roughly|~/.test(t)
      ? "ok"
      : "guess";
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
  lang?: Lang;
  onSubmit: (durationStr: string) => void;
  onCancel: () => void;
}) {
  const { sending, lang = "en", onSubmit, onCancel } = props;
  // P-25/P-24: "Personalizado" opens the STRUCTURED picker (number + unit +
  // presets + a live contract preview) straight away. It used to land on a
  // chat-style free-text ask that popped the keyboard for what is literally
  // a number and a unit; describing it in words is still one tap away via
  // "Probar de otra forma".
  const [phase, setPhase] = useState<"ask" | "verify">("verify");
  const [freeText, setFreeText] = useState("");
  const [parseFailed, setParseFailed] = useState(false);
  const [n, setN] = useState("3");
  const [unit, setUnit] = useState<"days" | "weeks" | "months">("weeks");
  const [confidence, setConfidence] = useState<"ok" | "guess" | "fail">("ok");
  const [heardFrom, setHeardFrom] = useState("");

  const num = Math.max(1, Math.min(99, Number(n) || 0));
  const valid = Number.isFinite(num) && num >= 1 && num <= 99;
  // P-25: the manual duration control used to build the EN string
  // ("3 weeks") and submit it verbatim into a Spanish contract. Preview AND
  // submitted value now go through termLabel, so an ES contractor locks in
  // "3 semanas".
  const preview = valid
    ? termLabel({ kind: "duration", value: { n: num, unit } }, lang)
    : "—";

  const presets: {
    label: string;
    n: string;
    unit: typeof unit;
    confidence: "ok" | "guess";
  }[] = [
    {
      label: tFor(lang, "asstChat.duration.preset.oneDay"),
      n: "1",
      unit: "days",
      confidence: "ok",
    },
    {
      label: tFor(lang, "asstChat.duration.preset.twoThreeDays"),
      n: "3",
      unit: "days",
      confidence: "guess",
    },
    {
      label: tFor(lang, "asstChat.duration.preset.oneWeek"),
      n: "1",
      unit: "weeks",
      confidence: "ok",
    },
    {
      label: tFor(lang, "asstChat.duration.preset.twoWeeks"),
      n: "2",
      unit: "weeks",
      confidence: "ok",
    },
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
          <span class="dur__bossie-tag">{tFor(lang, "asstChat.bossie")}</span>
          <span class="dur__bossie-msg">
            {tFor(lang, "asstChat.duration.bossieMsg")}
          </span>
        </div>
        <textarea
          class="cust-pick__search dur__textarea"
          placeholder={tFor(lang, "asstChat.duration.placeholder")}
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
            {tFor(lang, "asstChat.setManually")}
          </button>
        </div>
        <div class="cust-create__actions">
          <button
            type="button"
            class="cust-create__btn cust-create__btn--primary"
            onClick={tryParseAndAdvance}
            disabled={sending || !freeText.trim()}
          >
            {tFor(lang, "asstChat.continue")}
          </button>
          <button
            type="button"
            class="cust-create__btn"
            onClick={onCancel}
            disabled={sending}
          >
            {tFor(lang, "common.back")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="dur dur--verify" style="margin-top:8px">
      <div class="dur__head">
        <strong class="dur__title">
          {
            /* Nothing was "heard" on a cold open — headline the task
              ("Configura la duración"), not a confirmation. */
          }
          {confidence === "fail" || !heardFrom
            ? tFor(lang, "asstChat.duration.titleFail")
            : confidence === "guess"
            ? tFor(lang, "asstChat.verify.titleGuess")
            : tFor(lang, "asstChat.verify.titleOk")}
        </strong>
        {heardFrom
          ? (
            <span class="dur__sub">
              {tFor(lang, "asstChat.verify.youSaid")} <em>"{heardFrom}"</em>
            </span>
          )
          : (
            <span class="dur__sub">
              {tFor(lang, "asstChat.duration.subPick")}
            </span>
          )}
        {confidence === "guess"
          ? (
            <span class="dur__warn">
              {tFor(lang, "asstChat.verify.bestGuess")}
            </span>
          )
          : null}
        {parseFailed
          ? (
            <span class="dur__warn">
              {tFor(lang, "asstChat.duration.warnFail")}
            </span>
          )
          : null}
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
          aria-label={tFor(lang, "asstChat.verify.number")}
        />
        <select
          class="cust-pick__search dur__unit"
          value={unit}
          onChange={(e) =>
            setUnit(
              (e.currentTarget as HTMLSelectElement).value as typeof unit,
            )}
          aria-label={tFor(lang, "asstChat.verify.unit")}
        >
          <option value="days">{tFor(lang, "asstChat.unit.days")}</option>
          <option value="weeks">{tFor(lang, "asstChat.unit.weeks")}</option>
          <option value="months">{tFor(lang, "asstChat.unit.months")}</option>
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
        <span class="dur__preview-label">
          {tFor(lang, "asstChat.verify.contractReads")}
        </span>
        <span class="dur__preview-val">{preview}</span>
      </div>
      <div class="cust-create__actions">
        <button
          type="button"
          class="cust-create__btn cust-create__btn--primary"
          onClick={() => onSubmit(preview)}
          disabled={!valid || sending}
        >
          {tFor(lang, "asstChat.lockIn")}
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
          {tFor(lang, "asstChat.tryDifferent")}
        </button>
        {
          /* Cold open (nothing parsed yet) — keep a way back out of the
            custom editor without detouring through the free-text ask. */
        }
        {!heardFrom
          ? (
            <button
              type="button"
              class="cust-create__btn"
              style="background:transparent;border-color:transparent"
              onClick={onCancel}
              disabled={sending}
            >
              {tFor(lang, "common.back")}
            </button>
          )
          : null}
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
  lang?: Lang;
  onSubmit: (warrantyStr: string) => void;
  onCancel: () => void;
}) {
  const { sending, lang = "en", onSubmit, onCancel } = props;
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
  const valid = kind !== "term" ||
    (Number.isFinite(num) && num >= 1 && num <= cap);
  // P-25: the fallback used to build "Lifetime" / "No warranty" / "12
  // months" and submit them verbatim into a Spanish contract. Preview AND
  // submitted value now go through termLabel ("De por vida", "Sin
  // garantía", "12 meses").
  const preview = kind === "lifetime"
    ? termLabel({ kind: "warranty", value: "lifetime" }, lang)
    : kind === "none"
    ? termLabel({ kind: "warranty", value: "none" }, lang)
    : valid
    ? termLabel({ kind: "warranty", value: { n: num, unit } }, lang)
    : "—";

  const presets: {
    label: string;
    apply: () => void;
  }[] = [
    {
      label: tFor(lang, "asstChat.warranty.preset.none"),
      apply: () => {
        setKind("none");
      },
    },
    {
      label: tFor(lang, "asstChat.warranty.preset.sixMonths"),
      apply: () => {
        setKind("term");
        setN("6");
        setUnit("months");
      },
    },
    {
      label: tFor(lang, "asstChat.warranty.preset.twelveMonths"),
      apply: () => {
        setKind("term");
        setN("12");
        setUnit("months");
      },
    },
    {
      label: tFor(lang, "asstChat.warranty.preset.twentyFourMonths"),
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
          <span class="dur__bossie-tag">{tFor(lang, "asstChat.bossie")}</span>
          <span class="dur__bossie-msg">
            {tFor(lang, "asstChat.warranty.bossieMsg")}
          </span>
        </div>
        <textarea
          class="cust-pick__search dur__textarea"
          placeholder={tFor(lang, "asstChat.warranty.placeholder")}
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
            {tFor(lang, "asstChat.setManually")}
          </button>
        </div>
        <div class="cust-create__actions">
          <button
            type="button"
            class="cust-create__btn cust-create__btn--primary"
            onClick={tryParseAndAdvance}
            disabled={sending || !freeText.trim()}
          >
            {tFor(lang, "asstChat.continue")}
          </button>
          <button
            type="button"
            class="cust-create__btn"
            onClick={onCancel}
            disabled={sending}
          >
            {tFor(lang, "common.back")}
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
            ? tFor(lang, "asstChat.warranty.titleFail")
            : confidence === "guess"
            ? tFor(lang, "asstChat.verify.titleGuess")
            : tFor(lang, "asstChat.verify.titleOk")}
        </strong>
        {heardFrom
          ? (
            <span class="dur__sub">
              {tFor(lang, "asstChat.verify.youSaid")} <em>"{heardFrom}"</em>
            </span>
          )
          : (
            <span class="dur__sub">
              {tFor(lang, "asstChat.warranty.subPick")}
            </span>
          )}
        {confidence === "guess"
          ? (
            <span class="dur__warn">
              {tFor(lang, "asstChat.verify.bestGuess")}
            </span>
          )
          : null}
        {parseFailed
          ? (
            <span class="dur__warn">
              {tFor(lang, "asstChat.warranty.warnFail")}
            </span>
          )
          : null}
      </div>
      <div class="dur__row">
        <select
          class="cust-pick__search dur__unit"
          value={kind}
          onChange={(e) =>
            setKind(
              (e.currentTarget as HTMLSelectElement).value as typeof kind,
            )}
          aria-label={tFor(lang, "asstChat.warranty.typeLabel")}
        >
          <option value="term">
            {tFor(lang, "asstChat.warranty.setTerm")}
          </option>
          <option value="lifetime">
            {tFor(lang, "asstChat.warranty.lifetime")}
          </option>
          <option value="none">
            {tFor(lang, "asstChat.warranty.none")}
          </option>
        </select>
      </div>
      {kind === "term"
        ? (
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
              aria-label={tFor(lang, "asstChat.verify.number")}
            />
            <select
              class="cust-pick__search dur__unit"
              value={unit}
              onChange={(e) => {
                const next = (e.currentTarget as HTMLSelectElement)
                  .value as typeof unit;
                const nextCap = next === "days"
                  ? 365
                  : next === "months"
                  ? 60
                  : 25;
                if (Number(n) > nextCap) setN(String(nextCap));
                setUnit(next);
              }}
              aria-label={tFor(lang, "asstChat.verify.unit")}
            >
              <option value="days">{tFor(lang, "asstChat.unit.days")}</option>
              <option value="months">
                {tFor(lang, "asstChat.unit.months")}
              </option>
              <option value="years">{tFor(lang, "asstChat.unit.years")}</option>
            </select>
          </div>
        )
        : null}
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
        <span class="dur__preview-label">
          {tFor(lang, "asstChat.verify.contractReads")}
        </span>
        <span class="dur__preview-val">{preview}</span>
      </div>
      <div class="cust-create__actions">
        <button
          type="button"
          class="cust-create__btn cust-create__btn--primary"
          onClick={() => onSubmit(preview)}
          disabled={!valid || sending}
        >
          {tFor(lang, "asstChat.lockIn")}
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
          {tFor(lang, "asstChat.tryDifferent")}
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
    /\b(on (completion|delivery|done|finish)|when (done|finished|complete)|same[\s-]?day|on the day|due on)\b/
      .test(
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
  lang?: Lang;
  onSubmit: (paymentStr: string) => void;
  onCancel: () => void;
}) {
  const { sending, lang = "en", onSubmit, onCancel } = props;
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
    Math.max(0, Math.min(100, Number(s) || 0))
  );
  const splitSum = splitNums.reduce((a, b) => a + b, 0);
  const splitsValid = splitNums.length >= 2 && splitSum === 100;

  // P-25: the fallback used to build "Net 30" / "Net 0 — due on completion"
  // and submit them verbatim into a Spanish contract. Preview AND submitted
  // value now go through termLabel ("Neto 30", "Neto 0 — se paga al
  // terminar").
  const preview = mode === "net"
    ? termLabel({ kind: "payment", value: { net: days } }, lang)
    : splitsValid
    ? termLabel({ kind: "payment", value: { splits: splitNums } }, lang)
    : "—";

  const valid = mode === "net" ? Number.isFinite(days) : splitsValid;

  const presets: { label: string; apply: () => void }[] = [
    {
      label: tFor(lang, "asstChat.payment.preset.onCompletion"),
      apply: () => {
        setMode("net");
        setNetDays("0");
      },
    },
    {
      label: tFor(lang, "asstChat.payment.preset.fiftyFifty"),
      apply: () => {
        setMode("split");
        setSplits(["50", "50"]);
      },
    },
    {
      label: tFor(lang, "asstChat.payment.preset.threeThreeForty"),
      apply: () => {
        setMode("split");
        setSplits(["30", "30", "40"]);
      },
    },
    {
      label: tFor(lang, "asstChat.payment.preset.depositBalance"),
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
    next[idx] = raw === ""
      ? ""
      : String(Math.max(0, Math.min(100, Number(raw) || 0)));
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
          <span class="dur__bossie-tag">{tFor(lang, "asstChat.bossie")}</span>
          <span class="dur__bossie-msg">
            {tFor(lang, "asstChat.payment.bossieMsg")}
          </span>
        </div>
        <textarea
          class="cust-pick__search dur__textarea"
          placeholder={tFor(lang, "asstChat.payment.placeholder")}
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
            {tFor(lang, "asstChat.setManually")}
          </button>
        </div>
        <div class="cust-create__actions">
          <button
            type="button"
            class="cust-create__btn cust-create__btn--primary"
            onClick={tryParseAndAdvance}
            disabled={sending || !freeText.trim()}
          >
            {tFor(lang, "asstChat.continue")}
          </button>
          <button
            type="button"
            class="cust-create__btn"
            onClick={onCancel}
            disabled={sending}
          >
            {tFor(lang, "common.back")}
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
            ? tFor(lang, "asstChat.payment.titleFail")
            : confidence === "guess"
            ? tFor(lang, "asstChat.verify.titleGuess")
            : tFor(lang, "asstChat.verify.titleOk")}
        </strong>
        {heardFrom
          ? (
            <span class="dur__sub">
              {tFor(lang, "asstChat.verify.youSaid")} <em>"{heardFrom}"</em>
            </span>
          )
          : (
            <span class="dur__sub">
              {tFor(lang, "asstChat.payment.subPick")}
            </span>
          )}
        {confidence === "guess"
          ? (
            <span class="dur__warn">
              {tFor(lang, "asstChat.verify.bestGuess")}
            </span>
          )
          : null}
        {parseFailed
          ? (
            <span class="dur__warn">
              {tFor(lang, "asstChat.payment.warnFail")}
            </span>
          )
          : null}
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
          {tFor(lang, "asstChat.payment.onePayment")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "split"}
          class={`pay__mode ${mode === "split" ? "pay__mode--active" : ""}`}
          onClick={() => setMode("split")}
          disabled={sending}
        >
          {tFor(lang, "asstChat.payment.splitPayments")}
        </button>
      </div>

      {mode === "net"
        ? (
          <div class="pay__net">
            <label class="pay__net-label">
              {tFor(lang, "asstChat.payment.due")}
              <input
                type="number"
                class="cust-pick__search pay__net-num"
                inputMode="numeric"
                min={0}
                max={180}
                value={netDays}
                onInput={(e) =>
                  setNetDays((e.target as HTMLInputElement).value)}
                onBlur={() => {
                  if (!netDays || Number(netDays) < 0) setNetDays("0");
                }}
                autoFocus
                aria-label={tFor(lang, "asstChat.payment.daysAfterInvoiceAria")}
              />
              {tFor(lang, "asstChat.payment.daysAfterInvoice")}
            </label>
            <span class="pay__net-hint">
              {days === 0 ? tFor(lang, "asstChat.payment.hintSameDay") : tFor(
                lang,
                `asstChat.payment.hintDays.${days === 1 ? "one" : "other"}`,
                { days },
              )}
            </span>
          </div>
        )
        : (
          <div class="pay__split">
            <div class="pay__split-rows">
              {splits.map((val, idx) => {
                const labelText = splits.length === 2
                  ? idx === 0
                    ? tFor(lang, "asstChat.payment.deposit")
                    : tFor(lang, "asstChat.payment.onCompletion")
                  : idx === 0
                  ? tFor(lang, "asstChat.payment.deposit")
                  : idx === splits.length - 1
                  ? tFor(lang, "asstChat.payment.onCompletion")
                  : tFor(lang, "asstChat.payment.milestoneN", { n: idx });
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
                        setSplitAt(idx, (e.target as HTMLInputElement).value)}
                      onBlur={() => {
                        if (val === "") setSplitAt(idx, "0");
                      }}
                      aria-label={tFor(lang, "asstChat.payment.pctAria", {
                        label: labelText,
                      })}
                    />
                    <span class="pay__split-pctsign">%</span>
                    <span class="pay__split-lbl">{labelText}</span>
                    {splits.length > 2
                      ? (
                        <button
                          type="button"
                          class="pay__split-del"
                          onClick={() => removeMilestone(idx)}
                          aria-label={tFor(
                            lang,
                            "asstChat.payment.removeAria",
                            {
                              label: labelText,
                            },
                          )}
                          disabled={sending}
                        >
                          ×
                        </button>
                      )
                      : null}
                  </div>
                );
              })}
            </div>
            <div class="pay__split-tools">
              {splits.length < 4
                ? (
                  <button
                    type="button"
                    class="dur__chip dur__chip--ghost"
                    onClick={addMilestone}
                    disabled={sending}
                  >
                    {tFor(lang, "asstChat.payment.addMilestone")}
                  </button>
                )
                : null}
              {!splitsValid
                ? (
                  <button
                    type="button"
                    class="dur__chip"
                    onClick={autoBalance}
                    disabled={sending}
                  >
                    {tFor(lang, "asstChat.payment.autoBalance")}
                  </button>
                )
                : null}
              <span
                class={`pay__split-sum ${
                  splitsValid ? "pay__split-sum--ok" : "pay__split-sum--bad"
                }`}
              >
                {tFor(lang, "asstChat.payment.total", { sum: splitSum })}
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
        <span class="dur__preview-label">
          {tFor(lang, "asstChat.verify.contractReads")}
        </span>
        <span class="dur__preview-val">{preview}</span>
      </div>

      <div class="cust-create__actions">
        <button
          type="button"
          class="cust-create__btn cust-create__btn--primary"
          onClick={() => onSubmit(preview)}
          disabled={!valid || sending}
        >
          {tFor(lang, "asstChat.lockIn")}
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
          {tFor(lang, "asstChat.tryDifferent")}
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
    if (p.status === "sent" && typeof p.totalCents === "number") {
      return p.totalCents;
    }
  }
  return 0;
}
