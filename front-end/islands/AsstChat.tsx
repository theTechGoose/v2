import SendLangPreview from "../components/SendLangPreview.tsx";
import Backdrop from "../components/Backdrop.tsx";
import { Fragment } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useSignal } from "@preact/signals"; // REQ-670
import { I, ICN } from "../lib/dash-icons.tsx";
import { detailLines, fmtPhone } from "../lib/format.ts";
import {
  orderSendOutcomes,
  sentCtaTimestamp,
  settledSendCtaIds,
} from "../lib/send-cta-settled.ts";
import { hiddenOnReloadIds } from "../lib/thread-reload-prune.ts";
import {
  computePaymentSplit,
  depositBalanceSubVars,
  type MilestoneRole,
} from "../lib/payment-split.ts";
import { api, ApiError } from "../lib/api.ts";
import {
  assistantClient,
  type CustomerLite,
  type JobOption,
  type Message,
  type Quote as AsstQuote,
} from "../clients/assistant.ts";
import { filesClient } from "../clients/files.ts";
// REQ-670 (demo-loop cycle 5, p7): the reply as it is written.
import {
  type ChatStreamEvent,
  NO_REPLY_YET,
  pendingReply,
  type PendingReply,
} from "../lib/chat-stream.ts";
import { PendingReplyBubble } from "../components/PendingReplyBubble.tsx";
import {
  actionCardNumber,
  numberedLabel,
  reviewCardNumber,
} from "../../shared/documents/numbering.ts";
import { type QuoteCard, quotesClient } from "../clients/quotes.ts";
import { billedTotalCents } from "../../shared/quote-flow/milestone-reconcile.ts";
import { accountNetDays } from "../../shared/quote-flow/completion-schedule.ts"; // REQ-411
import {
  isExceedsAgreement,
  swapInvoiceCents,
} from "../../shared/documents/ledger.ts";
import { smsRecoveryAsk } from "../../shared/quote-flow/sms-failure.ts";
import { localizeChatMessage } from "../../shared/quote-flow/chat-i18n.ts"; // REQ-589
import {
  confirmedDescriptionByLang,
  descriptionLines,
  lineItemDescription,
  previewTranslationMissing,
} from "../../shared/quote-flow/quote-translations.ts";
import { clientsClient } from "../clients/clients.ts";
import { readCached, refreshDash, subscribeDash } from "../lib/dash-cache.ts";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";
import {
  cardShowsCustomerLink,
  copyCustomerLink,
  customerLinkPath,
  customerLinkOwnerIds,
  customerLinkUrl,
  dividerShowsCustomerLink,
  linkCopyOffersMarkSent,
  type LinkToast as LinkToastState,
  SHARED_BY_LINK_PATCH,
} from "../lib/customer-link.ts";
import { CustomerLinkRow, LinkToast } from "../components/CustomerLinkRow.tsx";
import { quoteSendLang } from "../../shared/quote-flow/share-link.ts"; // REQ-586
import StepComposer, { StepComposerOpen } from "../components/StepComposer.tsx"; // REQ-392
import {
  addStepExchange,
  type ChatStepHint,
  type ChatStepId,
  composerMode,
  echoWithCorrection, // REQ-442
  type StepLog, // REQ-442
  stepOwnsAnswer, // REQ-670
  stepScopeOf, // REQ-444
  withStepScope, // REQ-444
} from "../../shared/quote-flow/step-composer.ts"; // REQ-392
import { localizeTermValue } from "../lib/term-i18n.ts";
import {
  depositChoices,
  depositTermValue,
  isDepositPickerOption,
} from "../../shared/quote-flow/deposit-term.ts"; // REQ-678
import {
  mergeFreshTerms,
  previewTermRows,
} from "../../shared/quote-flow/wizard-terms.ts"; // REQ-347
import { quoteUpdatedBy } from "../lib/chat-quote-refresh.ts";
import { mergeTurnMessages } from "../lib/turn-messages.ts"; // REQ-585
import { attachBottomPin } from "../lib/chat-bottom-pin.ts";
import { chatChangeOrderLink, chatQuoteLink } from "../lib/chat-quote-link.ts";
import {
  liveDraftOffer,
  offerAmount,
} from "../../shared/quote-flow/chat-draft-offer.ts"; // REQ-388
import {
  arrivedInvoiceFlowOffer,
  type InvoiceFlowOffer,
  liveInvoiceFlowOffer,
} from "../../shared/quote-flow/chat-invoice-flow-offer.ts"; // REQ-656
import { quoteHasPrice } from "../../shared/quote-flow/quote-price-guard.ts";
import { polishOffer } from "../../shared/quote-flow/polish-offer.ts";
import {
  type ChipKey,
  chipReply,
} from "../../shared/quote-flow/starter-chips.ts";
import {
  activeWizardStepIdx,
  resolveAssistantBack,
  WIZARD_DONE,
  wizardCursor,
} from "../../shared/quote-flow/assistant-back.ts";
import {
  customerCreateBusinessName,
  customerCreateShape,
  customerStepEntryView,
  type CustomerStepView,
  formOffersPickExisting,
} from "../../shared/quote-flow/customer-step.ts";
import { customerMatchesQuery } from "../../shared/quote-flow/customer-search.ts";
import { termLabel } from "../../shared/quote-flow/terms-i18n.ts";
import {
  type ComposerFlow,
  composerFlowFor,
  composerPlaceholderKey,
  editHintKey,
} from "../../shared/quote-flow/trade-fit.ts"; // REQ-343, REQ-450, REQ-581
import { openOnboardingAsk } from "../../shared/quote-flow/onboarding-composer.ts"; // REQ-582
import type { ExtractedDuration } from "../../shared/quote-flow/quote-facts.ts";
import { reviewJobDetails } from "../../shared/quote-flow/review-job-details.ts";
import {
  versionStyleLabel,
  type VersionStyle,
  versionTitle,
} from "../../shared/quote-flow/version-titles.ts"; // REQ-446
import {
  becameSigned,
  cardChipKey,
  cardReopenAction,
  isLockedOrIssued,
  liveCardQuote,
  quoteAnswered,
} from "../../shared/quote-flow/quote-lock.ts";
import {
  deriveChatHeader,
  draftOwesDetails,
  headerTone,
} from "../../shared/quote-flow/chat-header.ts";
import { pendingRevisionNotice } from "../../shared/documents/versions.ts";
import {
  scopeBulletsFromRaw,
  scopeDescriptionFromRaw, // REQ-585
} from "../../shared/quote-flow/scope-from-raw.ts";
import { ownWordsOption } from "../../shared/quote-flow/own-words-option.ts";
import { redactMoney } from "../../shared/quote-flow/private-cost.ts"; // REQ-659
import {
  carryPickedOptionId,
  currentDetailsOption,
  customerFactsFrom,
  dedupeOptionsByBullets,
  groupedBullets,
  seedPickerOptions,
  stripCustomerDetails,
  widerBullets,
} from "../../shared/quote-flow/option-bullets.ts";
import { editJobDetailsSeed } from "../../shared/quote-flow/edit-job-details.ts";
import {
  type OptionTap,
  optionTap,
} from "../../shared/quote-flow/option-tap.ts";
import {
  acceptedJobChipLabel,
  extractQuickQuotePrefill,
  type PriceLine,
  quickQuoteNames,
  quoteLineItemsFromPrefill,
} from "../../shared/quote-flow/quick-quote-prefill.ts";
import {
  formatPhoneDisplay,
  formatPhoneInput,
  formatTermDate,
  websiteLabel,
} from "../../shared/quote-flow/format-helpers.ts";
import {
  jobNameCase,
  summarizeJobName,
} from "../../shared/quote-flow/job-name.ts";
import { formatClockTime } from "../../shared/quote-flow/locale-format.ts";
import {
  invoiceCardChipKey, // REQ-583
  invoiceCardHref,
  invoiceCardSendOffer, // REQ-583
  isInvoiceCardPayload,
  isQuoteCardPayload,
} from "../../shared/quote-flow/chat-invoice-card.ts"; // REQ-368
import {
  type AssistantDraft,
  maxBulletSeq,
  parseAssistantDraft,
  restorableDraft,
} from "../../shared/quote-flow/assistant-draft.ts";
import type { QuoteDelivery } from "../../shared/quote-flow/delivery.ts";
import {
  applySendOutcome,
  headerStatusKey,
  lastRecoveryDividerId,
  retryChannel,
  type SendDividerPayload,
  sendDividerFailed,
  sendOutcomePayload,
} from "../lib/send-delivery.ts";
import {
  addFieldLabelKey,
  channelNeedsKey,
  contactSaveErrorKey,
  defaultSendChannel,
  newSendRequestId,
  recommendedChannel,
  recoveryContactErrors,
  recoveryPhoneValue,
  runExclusive,
  sendDialogErrorKey,
  sendOpenLabelKey,
} from "../lib/send-dialog.ts";
import {
  customerStepPrefillView,
  extractQuoteFacts,
  factsSourceText,
  matchPrefillCustomer,
  type QuoteFacts,
  weekdayLabel,
  wizardPrefillFor,
} from "../../shared/quote-flow/quote-facts.ts";
import {
  duplicateNotice,
  findExistingCustomer,
  knownCustomerForStep,
  withSummaryCustomerName,
} from "../../shared/quote-flow/customer-dedupe.ts"; // REQ-331, REQ-390, REQ-576
import {
  dropBareEditSeed,
  editDraftSeed,
  isBareEditSeed,
  showEditHint,
} from "../../shared/quote-flow/draft-edit.ts";
import { customerStepFeedback } from "../../shared/quote-flow/customer-contact.ts"; // REQ-278, REQ-390
import {
  durationPreviewHint,
  parseDurationNumber,
  wholeDuration,
} from "../../shared/quote-flow/duration-input.ts"; // REQ-390, REQ-458, REQ-575
import { isPlaceholderName } from "../../shared/quote-flow/outbound-identity.ts";
import {
  TimeoutError,
  withChatTimeout,
} from "../../shared/quote-flow/chat-timeout.ts";
// REQ-369 (demo m2): the thread's one status names the quote cards too, and
// the conversation list shows it.
import { threadStatusKey } from "../../shared/quote-flow/chat-header.ts";
import {
  publishThreadStatus,
  publishThreadTurn,
  THREAD_SERVER_STATUS_EVENT,
  type ThreadStatusDetail,
} from "../lib/thread-status-sync.ts";
import {
  interpretSendResult,
  sendResultLangKey,
} from "../../shared/quote-flow/send-result.ts";
import MoneyInput from "./MoneyInput.tsx";
import {
  priceChipAnchorCents,
  selectedTierIndex,
} from "../lib/money-input.ts";
import { startPoll } from "../lib/poll.ts";
import { followChanges } from "../lib/change-feed.ts";
import { boundQuoteMoved } from "../lib/live-doc-refresh.ts";
import { Icon } from "../components/ui/Icon.tsx";
import { TermEditValue } from "../components/TermEditValue.tsx";

/**
 * REQ-024 (NW-18): the invoice's due date derives from the agreement the
 * wizard produced — the completion date (or today when the quote has none)
 * plus the payment terms: "Due Now" → the same day, "Payment upon
 * completion" → +15 days, anything else → +30 days.
 */
function invoiceDueDateFromQuote(
  quote:
    | {
      estimatedCompletionDate?: string;
      terms?: Array<{ stepId: string; value: string }>;
    }
    | null
    | undefined,
  today: string,
): string {
  const base = quote?.estimatedCompletionDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(quote.estimatedCompletionDate)
    ? quote.estimatedCompletionDate
    : today;
  const pay = (quote?.terms ?? []).find((t) => t.stepId === "payment_terms")
    ?.value?.toLowerCase() ?? "";
  const days = /due now|pago inmediato/.test(pay)
    ? 0
    : /upon completion|al finalizar/.test(pay)
    ? 15
    : 30;
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

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
  /** REQ-678: "Deposit + balance" opens the deposit amount picker. */
  amountPicker?: "deposit";
  followUp?: { fields: WizardFollowUpField[] };
}

/**
 * Term-edit picker fallback: a static map of stepId → preset options for
 * the terms wizard. Used when the term row is being edited
 * inline and no matching wizard message is in chat scope (older threads,
 * or threads where the wizard messages were pruned). Mirrors
 * `TERMS_WIZARD_V1` in the backend — keep in sync if that spec
 * grows new steps. The `customer` step is intentionally excluded since
 * its picker has its own dedicated panel.
 */
const TERM_OPTIONS_FALLBACK: Record<
  string,
  {
    labelKey: string;
    subKey?: string;
    subAmountsKey?: string;
    amountPicker?: "deposit";
  }[]
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
    { labelKey: "asstChat.terms.startDate.tbd" }, // REQ-046
  ],
  wraps: [
    { labelKey: "asstChat.duration.preset.oneDay" },
    { labelKey: "asstChat.duration.preset.twoThreeDays" },
    { labelKey: "asstChat.duration.preset.oneWeek" },
    { labelKey: "asstChat.duration.preset.twoWeeks" },
    { labelKey: "asstChat.duration.preset.tbd" }, // REQ-047
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
      // REQ-491 (demo m60): "20% upfront, rest when done · $90 / $360".
      subAmountsKey: "asstChat.terms.payment.depositBalanceSubAmounts",
      amountPicker: "deposit", // REQ-678: then "how much upfront?"
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
  /** REQ-446 (m13): the version's role (concise / standard / detailed). */
  style?: VersionStyle;
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
/** REQ-381: id of the option the confirm strip builds from the typed message. */
const OWN_WORDS_OPTION_ID = "__own_words__";

/** REQ-338: does the confirm strip's echo need a "show more" past its 3-line clamp? */
function isLongRawEcho(raw: string): boolean {
  return raw.length > 180 || raw.split("\n").length > 3;
}

let bulletSeq = 0;
function toOptionDrafts(options: JobOption[]): JobOptionDraft[] {
  return options.map((o) => ({
    id: o.id,
    jobName: o.jobName,
    summary: o.summary,
    ...(o.style ? { style: o.style } : {}),
    bullets: o.bullets.map((text) => ({
      id: `b${++bulletSeq}`,
      text,
      deleted: false,
    })),
    byLang: o.byLang,
  }));
}

/** Client-side last resort if the options endpoint itself errors (network
 *  / 5xx) — an ERROR path, never painted ahead of the request (REQ-027).
 *  REQ-026 (NW-05): the bullets are honest scope lines from the shared
 *  helper (intent opener and price clause stripped), never the typed
 *  sentence; `degraded` is true when nothing scope-like survived and the one
 *  bullet is the localized "New job". */
function localFallbackOptions(
  raw: string,
  lang: Lang,
): { options: JobOption[]; degraded: boolean } {
  const scoped = scopeBulletsFromRaw(raw, lang);
  // REQ-330 (M21): every scope line survives — no cap. REQ-400 (m32): a line
  // keeps its scope and loses the customer's name, phone and e-mail.
  const facts = customerFactsFrom(raw);
  const lines = scoped.degraded ? [] : scoped.bullets
    .map((line) => stripCustomerDetails(line, facts))
    .filter((line): line is string => !!line);
  const base = lines.length > 0 ? lines : [tFor(lang, "asstChat.newJob")];
  const summary = base[0].split(/\s+/).slice(0, 8).join(" ");
  const jobName = summary.split(/\s+/).slice(0, 3).join(" ");
  // P-24: the three versions must be distinguishable at a glance. They used
  // to share one jobName verbatim (and the server's old scheme numbered the
  // collisions "(2)" / "(3)"), so the picker looked like the same job three
  // times. Each variant now carries the qualifier that describes what it IS.
  const options: JobOption[] = [
    { id: "opt1", jobName, summary, bullets: base },
    {
      id: "opt2",
      jobName: versionTitle(jobName, "short", lang),
      summary,
      // REQ-400 (M21): every item, in fewer lines — never the first three.
      bullets: groupedBullets(base),
    },
    {
      id: "opt3",
      jobName: versionTitle(jobName, "wider", lang),
      summary,
      bullets: widerBullets(base, tFor(lang, "asstChat.jobsiteCleanup")),
    },
  ];
  // REQ-330 (p15-7): a short job makes the "short" version equal to the
  // full one — equal bullet sets collapse, never two cards alike.
  return {
    options: dedupeOptionsByBullets(options, { exact: true }),
    degraded: lines.length === 0,
  };
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
  status?: "draft" | "sent" | "viewed" | "accepted" | "void" | string;
  quoteId?: string;
  /** REQ-465 (m37): the quote's Q- number, stamped on draft / locked cards. */
  number?: string;
  customerId?: string;
  /** Polished narrative produced from the user's raw job-details input. */
  description?: string;
  lineItems?: ActionCardLineItem[];
  totalCents?: number;
  /** REQ-435 (demo-loop cycle 3, M4): the quote's job address. */
  serviceAddress?: string;
}

/** Compose the composer placeholder. While an onboarding ask is open (the
 *  latest assistant message IS that ask — REQ-582, demo cycle 4 m39) it
 *  echoes the question Bossie is asking; otherwise — any reply in any
 *  thread, however it mentions "email" or "payment" — the job example.
 *  REQ-343: the example of THIS business's trade (a cleaner never sees the
 *  concrete slab), the generic one when the name names no trade.
 *  REQ-450: and of THIS flow — "I know my price" shows a priced job, "help
 *  me price it" asks what to charge. */
function composerPlaceholder(
  msgs: Message[],
  lang: Lang,
  businessName?: string,
  flow: ComposerFlow = "ask",
): string {
  return tFor(
    lang,
    openOnboardingAsk(msgs, tFor) ?? composerPlaceholderKey(businessName, flow),
  );
}

/** Map a quote status to the human-facing chip label on the in-chat
 *  Quote+Agreement card. Keeps the chip in sync with the doc's
 *  lifecycle: Draft → Sent → Viewed → Accepted. */
/** REQ-265 (demo ai-assistant-m1): the text the user typed for THIS job —
 *  the quote's description (the starter-chip flow stores the raw sentence
 *  there) and the thread's own user text (the free-chat flow). Both are
 *  persisted, so the wizard's pre-fills survive a reload. REQ-575 (demo-loop
 *  cycle 4, M3): the user's own turns are read FIRST — pair 7's description
 *  "…for the Hendersons" won over her typed "Carol Henderson". */
function quoteFactsSource(
  quoteDescription: string | undefined,
  msgs: Message[],
): string {
  return factsSourceText(
    quoteDescription,
    msgs
      .filter((m) => m.role === "user" && (m.kind ?? "text") === "text")
      .map((m) => m.content ?? ""),
  );
}

function statusChipLabel(status: string | undefined, lang: Lang): string {
  // REQ-234 (demo M3): "locked" (price locked, not yet sent) has its own
  // chip — the shared map keeps it from ever reading "Sent".
  return tFor(lang, cardChipKey(status));
}

/**
 * REQ-248: the version state of a saved quote — status, sentAt, version and
 * the pending revision (absent when nothing waits). An issued quote's edit
 * comes back as a pendingRevision with the live content unchanged.
 */
function revisionStateOf(saved: unknown): {
  status?: string;
  sentAt?: string;
  version?: number;
  pendingRevision?: Record<string, unknown>;
} {
  const q = (saved ?? {}) as {
    status?: string;
    sentAt?: string;
    version?: number;
    pendingRevision?: Record<string, unknown>;
  };
  return {
    ...(q.status ? { status: q.status } : {}),
    ...(q.sentAt ? { sentAt: q.sentAt } : {}),
    ...(typeof q.version === "number" ? { version: q.version } : {}),
    pendingRevision: q.pendingRevision,
  };
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
  /** Quote (the agreement) bound to this conversation. */
  initialQuote?: AsstQuote;
  /** REQ-447 (cycle 3, p8-pair10-d): the conversation's stored title — the
   *  header falls back to it the way the thread list does. */
  initialTitle?: string;
  /** REQ-230 (demo M14): the in-flight flow stored on the conversation
   *  (options, pick, price, open panel) — seeds the view so ANY window's
   *  load, SSR included, rebuilds where the contractor is. */
  initialDraft?: AssistantDraft;
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
    /** REQ-038 (NW-06b): the business website, when provided. */
    website?: string;
  };
  /** Languages the contractor can send in (from Settings checkboxes). Drives
   *  the quote-review "Preview in" language toggle. Defaults to ["en"]. */
  sendLanguages?: string[];
  /** REQ-411 (demo-loop cycle 2, m35): the account's Settings "Days to pay an
   *  invoice" — the "Payment upon completion" sub-line names it. */
  invoiceNetDays?: number;
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

// REQ-276: the app language, not the browser locale ("8:55 p. m." in es).
function fmtTime(ts: number | string, lang: Lang): string {
  return formatClockTime(ts, lang);
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
  // preview matches the signed agreement, the PDF, and the actual invoices.
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
 *  the card chrome. Mirrors the customer-facing public quote page
 *  (routes/q/[id].tsx, quote-doc) so the contractor's preview matches what
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
  initialQuote,
  initialTitle,
  initialDraft,
  userInitials = "?",
  from,
  sendLanguages,
  invoiceNetDays,
}: Props) {
  // REQ-230 (demo M14): what a load paints from the server's copy of the
  // flow. Computed once (SSR included) and used as every flow state's seed.
  const [seed] = useState<AssistantDraft | null>(() => {
    if (!initialDraft) return null;
    const d = restorableDraft(initialDraft, {
      quoteBound: Boolean(initialQuote?.id),
      messageIds: initialMessages.map((m) => m.id),
    });
    bulletSeq = Math.max(bulletSeq, maxBulletSeq(d));
    return d;
  });
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
  // REQ-447 (cycle 3, p8-pair10-d): the stored conversation title, re-read
  // from every turn's conversation so the header names the thread the moment
  // its first message titles it — as the list does.
  const [convTitle, setConvTitle] = useState<string | undefined>(
    initialTitle,
  );
  const [customer, setCustomer] = useState<CustomerLite | undefined>(
    initialCustomer,
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
      /** REQ-198/241: "Q-001" — the number the documents carry. */
      number?: string;
      summary?: string;
      /** ≤3-word job title — the platform-wide identifier (roadmap p.10). */
      jobName?: string;
      description?: string;
      descriptionByLang?: Record<string, string>;
      /** REQ-333 (M24): the language the text was typed in. */
      lang?: string;
      lineItems?: {
        description: string;
        /** REQ-264 (M15): server-filled per-language text. */
        descriptionByLang?: Record<string, string>;
        quantity?: number;
        unit?: string;
        price?: number;
      }[];
      estimatedTotal?: number;
      /** Lifecycle — "accepted" once the customer signed on /q
       *  (UX-02: the thread must reflect it and stop offering re-sends). */
      status?: string;
      acceptedAt?: string | null;
      /** REQ-245: when it was sent / when its price was locked (REQ-234). */
      sentAt?: string | null;
      lockedAt?: string | null;
      /** Wizard-captured agreement terms — the quote IS the agreement. */
      terms?: { stepId: string; label: string; value: string }[];
      /** REQ-236: the latest send's outcome + first delivery time. */
      lastDelivery?: QuoteDelivery;
      deliveredAt?: string;
      /** REQ-572: "link" — the owner shared the link and marked it sent. */
      sentVia?: string;
      /** REQ-263: the job's service address. */
      serviceAddress?: string;
      /** REQ-248: an issued quote's edits wait here until a send publishes
       *  them (sentAt is declared above). */
      version?: number;
      pendingRevision?: Record<string, unknown>;
    }
    | undefined
  >();
  /** UX-02: the customer already accepted this deal on /q. */
  const quoteAccepted = quote?.status === "accepted" ||
    Boolean(quote?.acceptedAt);
  /** REQ-265: what the user already typed (customer, phone, email, start
   *  date, deposit) — the wizard pre-fills / pre-selects it, never re-asks. */
  const quoteFacts: QuoteFacts = useMemo(
    () =>
      extractQuoteFacts(
        quoteFactsSource(quote?.description, messages),
        new Date(),
      ),
    [quote?.description, messages],
  );
  /** REQ-576 (demo-loop cycle 4, m26): the customer step's facts — with no
   *  typed name, the quote summary's "— Bob Smith" fills it, so the step
   *  offers that saved customer or opens its create form already filled
   *  instead of a blank "Who is this for?". */
  const stepFacts: QuoteFacts = useMemo(
    () => withSummaryCustomerName(quoteFacts, quote?.summary),
    [quoteFacts, quote?.summary],
  );
  const [draft, setDraft] = useState("");
  // REQ-464 (demo-loop cycle 3, m33): the prompt Edit seeded the composer
  // with, so Lock it in / Re-open / send can drop it when nothing was typed
  // after it, and the composer can say what to type while it is there.
  const [editSeed, setEditSeed] = useState<string | null>(null);
  /** Inline price-capture flow opened by the "I already have my price"
   *  empty-state prompt. When set, renders the MoneyInput card in place
   *  of the three preset prompts. `priceCents` tracks the live value so
   *  Continue can hand the value to the phase-2 kickoff. */
  const [priceCaptureOpen, setPriceCaptureOpen] = useState(seed?.priceCaptureOpen ?? false);
  const [priceCents, setPriceCents] = useState<number | null>(seed?.priceCents ?? null);
  /** UX-04: the "para <Name>" candidate regex-extracted from the typed
   *  quick-quote sentence — prefills the customer step's name input. */
  const [prefillCustomerName, setPrefillCustomerName] = useState<
    string | null
  >(null);
  /** REQ-263 (demo ai-assistant-m2): the job address regex-extracted from the
   *  typed sentence ("…, 412 Oak St Austin, $350") — written on the quote
   *  when it is created, so the customer step and the agreement show it. */
  const [prefillServiceAddress, setPrefillServiceAddress] = useState<
    string | null
  >(null);
  /** REQ-259 (demo M23): the priced lines of an itemised sentence ("demo
   *  $2,500, cabinets $8,000, …") — they become the quote's line items when
   *  the confirmed price is still their sum. */
  const [prefillLines, setPrefillLines] = useState<PriceLine[]>([]);
  /** Set after the user clicks Continue on the price step. While true,
   *  the chat input no longer routes to the LLM chat — instead its
   *  next submission is treated as raw job-details, sent through the
   *  polish endpoint, then used to seed the new quote + phase 2 wizard. */
  const [awaitingJobDetails, setAwaitingJobDetails] = useState(seed?.awaitingJobDetails ?? false);
  /** Which starter chip opened the current flow (P-20). Drives the
   *  intent-appropriate first reply on the job-details screen — the
   *  "job done, need to invoice" chip must never be answered with quote
   *  copy. Null before any chip is tapped. */
  const [flowChip, setFlowChip] = useState<ChipKey | null>((seed?.flowChip as ChipKey | null) ?? null);
  const [pendingPriceCents, setPendingPriceCents] = useState<number | null>(
    null,
  );
  /** First-button flow is now "details first, price second." When the user
   *  taps "I know my price, write it up." we ask for the job details up
   *  front and stash the raw text here. After the user types it and
   *  submits, we flip to the price-capture screen with this populated,
   *  and the price-Continue handler combines both pieces to build the
   *  quote. (The other two flows ignore this — they go through the LLM.) */
  const [pendingJobDetailsRaw, setPendingJobDetailsRaw] = useState<string | null>(seed?.jobDetailsRaw ?? null);
  /** REQ-400 (M21): the message the contractor typed for this job, as typed
   *  (the confirm step overwrites pendingJobDetailsRaw with the picked
   *  bullets). "Edit job details" regenerates from it plus the current lines. */
  const [originalRaw, setOriginalRaw] = useState<string | null>(
    seed?.originalRaw ?? null,
  );
  /** REQ-338: the confirm strip's echo of the typed message, opened past its 3-line clamp */
  const [rawEchoOpen, setRawEchoOpen] = useState(false);
  /** Captures the raw text the user submitted at the job-details step
   *  so we can render an optimistic user bubble + "Polishing…" indicator
   *  while the polish + create-quote + transition chain runs. */
  const [submittedJobDetails, setSubmittedJobDetails] = useState<string | null>(seed?.submittedJobDetails ?? null);
  /** "Job Details" picker screen (the LLM-generated scope-of-work options).
   *  Shown at the END of phase 2, right before the quote review. */
  const [jobOptionsOpen, setJobOptionsOpen] = useState(seed?.jobOptionsOpen ?? false);
  // Roadmap p.10: "I know the job, help me price it." — when set, the
  // price-capture screen shows three LLM-suggested tiers (+ custom entry).
  const [suggestPricing, setSuggestPricing] = useState(seed?.suggestPricing ?? false);
  const [priceSuggestions, setPriceSuggestions] = useState<
    Array<
      { tier: "competitive" | "market" | "premium"; label: string; priceCents: number; rationale: string }
    > | null
  >(seed?.priceSuggestions ?? null);
  /** REQ-332 (m30): what the tiers include, as the server derived it from
   *  the job — never a fixed "labor and materials" claim. */
  const [priceBasis, setPriceBasis] = useState<
    "labor_and_materials" | "labor_materials_as_noted"
  >(seed?.priceBasis ?? "labor_and_materials");
  /** REQ-392 (demo-loop cycle 2, M7) + REQ-442 (cycle 3, M22): what was
   *  typed in the compact composer on Pick a price / the Job details picker
   *  and the assistant's answers — their panel covers the thread, so the
   *  exchange shows on the step. */
  const [stepLog, setStepLog] = useState<StepLog | null>(null);
  /** REQ-442 (m49): the step message in flight, shown on the step with its
   *  words ("Rewriting with your change…"). */
  const [stepPending, setStepPending] = useState<
    { step: ChatStepId; text: string } | null
  >(null);
  /** REQ-392: bumped when a correction names the price ("more like $28k") —
   *  remounts the price box with it. */
  const [priceSeedRev, setPriceSeedRev] = useState(0);
  /** REQ-392: the step whose compact box was opened from the step's own
   *  Continue row (Pick a price, the Job details picker — see stepBoxDocked);
   *  keyed by the step so the next step starts closed. */
  const [stepBoxOpenKey, setStepBoxOpenKey] = useState<string | null>(null);
  /** REQ-389 (demo m31): the amount the price pad was prefilled with — the
   *  "$18,500" typed in the quick-quote sentence — held apart from the live
   *  priceCents so the chips don't rescale while the contractor types. */
  const [prefillPriceCents, setPrefillPriceCents] = useState<number | null>(
    seed?.priceCents ?? null,
  );
  /** REQ-329 (demo p15-13) + REQ-389 (demo m31): the size of the job the
   *  amount pad scales its quick chips to — the market tier, else the
   *  prefilled amount (quick-quote / know-my-price paths ask for no tiers). */
  const priceAnchorCents = priceChipAnchorCents(
    priceSuggestions,
    prefillPriceCents,
  );
  const [optionsLoading, setOptionsLoading] = useState(false);
  /** REQ-027 (NW-11): the model could not draft the options — the cards
   *  are heuristic scope bullets and the picker says so. */
  const [optionsDegraded, setOptionsDegraded] = useState(seed?.optionsDegraded ?? false);
  const [jobOptions, setJobOptions] = useState<JobOptionDraft[] | null>(seed?.jobOptions ?? null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(seed?.selectedOptionId ?? null);
  /** Which bullet is open for inline edit, keyed by option+bullet id. */
  const [editingBullet, setEditingBullet] = useState<
    { optionId: string; bulletId: string } | null
  >(null);
  /** Which option's TITLE is open for inline edit (null = none). */
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  /** REQ-384 (m16): the inline "Polish this line?" offer under the bullet
   *  that was just edited or added — set only once the polished text is
   *  back AND differs from the line (before → after preview). */
  const [proOffer, setProOffer] = useState<
    {
      optionId: string;
      bulletId: string;
      before: string;
      after: string[];
    } | null
  >(null);
  /** Bumped per polish request so a stale reply never opens an offer. */
  const proReqRef = useRef(0);
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
  const [needsJobPolish, setNeedsJobPolish] = useState(
    () => !!seed?.polishRaw?.trim(), // REQ-369: the SSR header knows it too
  );
  /** Raw job-details text carried from phase 1, used to (re)generate the
   *  scope-of-work options in phase 2. */
  const jobPolishRawRef = useRef<string | null>(
    // REQ-369: with needsJobPolish, the first render's draft is the restored
    // one (REQ-230: a window that only restored the flow never writes).
    seed?.polishRaw?.trim() ? seed.polishRaw : null,
  );
  /** The "Ready to send" CTA whose review we deferred until the picker is
   *  done. Set when we intercept it; consumed by applyJobOption. */
  const pendingReviewCtaRef = useRef<string | null>(null);
  /** Inline contact-recovery inputs keyed by the failure phase_divider id.
   *  When SendQuote reports a missing/invalid email or phone, we let
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
  /** REQ-459 (demo m44): the channel the user picked in the ▾ menu — the
   *  main button names it ("Send by email…"); null until a pick, so the
   *  smart default alone keeps the neutral "Send…" (REQ-402). */
  const [pickedChannel, setPickedChannel] = useState<
    "email" | "sms" | "both" | null
  >(null);
  /** REQ-035 (NW-55): "Send to client" opens "How do you want to send to
   *  customer?" — Text / Email / Text + Email with Keep / Cancel. The draft
   *  choice lives here until Keep commits it (and sends). */
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [dialogChannel, setDialogChannel] = useState<"email" | "sms" | "both">(
    "both",
  );
  /** REQ-037 (NW-43b): the contact the chosen channel still lacks, typed
   *  inline in the dialog — saved to the customer on Keep, then both
   *  channels go out. */
  const [dialogEmail, setDialogEmail] = useState("");
  const [dialogPhone, setDialogPhone] = useState("");
  const [dialogErr, setDialogErr] = useState<string | undefined>(undefined);
  /** Transient "Link copied!" feedback for the send menu's copy-link action
   *  (roadmap: copy link alongside email / text / text+email). */
  // REQ-310 (demo m32): the copy-link confirmation — rendered at the island
  // root, outside the send menu; "copied" or "couldn't copy, here it is".
  const [linkToast, setLinkToast] = useState<LinkToastState | null>(null);
  const linkToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function copyLinkFor(quoteId: string, sendLang?: string) {
    // REQ-586 (cycle 4, M11): the link carries the send language.
    const out = await copyCustomerLink(
      customerLinkUrl(globalThis.location.origin, quoteId, sendLang),
    );
    // REQ-572 (demo-loop cycle 4, p4-p7c): copying proves nothing went out
    // (REQ-236), so a quote still on the owner's desk gets the question
    // "Link copied — mark as sent?" — the owner says they shared it.
    const offer = quote?.id === quoteId && linkCopyOffersMarkSent(quote);
    setLinkToast(offer ? { ...out, markQuoteId: quoteId } : out);
    if (linkToastTimer.current) clearTimeout(linkToastTimer.current);
    // a failure stays until dismissed so the url can be selected; the
    // mark-as-sent question stays long enough to be answered
    if (out.kind === "copied") {
      linkToastTimer.current = setTimeout(
        () => setLinkToast(null),
        offer ? 12000 : 2600,
      );
    }
  }
  /** REQ-572: "Mark as sent" — PUT {status:"sent", sentVia:"link"}; the
   *  header then reads "Shared by link". A failure says so in the toast. */
  async function markSharedByLink(quoteId: string) {
    if (linkToastTimer.current) clearTimeout(linkToastTimer.current);
    setLinkToast((t) => t && { ...t, marking: true, markFailed: false });
    try {
      const row = await api.put<
        { status?: string; sentAt?: string | null; sentVia?: string }
      >(`/quotes/${quoteId}`, SHARED_BY_LINK_PATCH);
      setQuote((q) =>
        q && q.id === quoteId
          ? {
            ...q,
            status: row?.status ?? SHARED_BY_LINK_PATCH.status,
            sentAt: row?.sentAt ?? q.sentAt,
            sentVia: row?.sentVia ?? SHARED_BY_LINK_PATCH.sentVia,
          }
          : q
      );
      setLinkToast(null);
    } catch {
      setLinkToast((t) => t && { ...t, marking: false, markFailed: true });
    }
  }
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
  const [pickerMode, setPickerMode] = useState<"polish" | "confirm">(seed?.pickerMode ?? "polish");
  /** The option confirmed in "confirm" mode — consumed by startQuoteFromRaw
   *  so the quote is created with the confirmed title/summary/bullets (and
   *  the end-of-flow picker is skipped). */
  const confirmedOptionRef = useRef<JobOptionDraft | null>(seed?.confirmedOption ?? null);
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
   *  divider lang key (sendQuote.divider.noEmail / .emailFailed) plus
   *  the server's reason text, rendered like the honest send divider.
   *  Null = everything requested was delivered. */
  const [swapSendFail, setSwapSendFail] = useState<
    { key: string; reason: string } | null
  >(null);
  const swapInvoiceIdRef = useRef<string | null>(null);
  const [swapLinkCopied, setSwapLinkCopied] = useState(false);
  /** "Job done, need to invoice." starter (roadmap p.3): marks the pre-quote
   *  details→price capture as invoice-bound. REQ-024: from the price screen
   *  it transitions with docKind=invoice and runs the SAME wizard as a quote
   *  (customer → completion date → payment terms → warranty) to the shared
   *  preview in invoice mode. */
  const [invoiceFlow, setInvoiceFlow] = useState(seed?.invoiceFlow ?? false);
  /** REQ-656 (demo-loop cycle 5, M9): a chat reply asked to open the invoice
   *  flow ("Trabajo terminado, necesito facturar…" typed) — opened once the
   *  turn has settled. */
  const [pendingInvoiceFlow, setPendingInvoiceFlow] = useState<
    InvoiceFlowOffer | null
  >(null);
  /** UX-31: the facturar flow REVIEWS before it saves — customer resolved,
   *  waiting on the contractor to confirm amount + an editable due date.
   *  Nothing is persisted until they confirm. */
  const [invoiceReview, setInvoiceReview] = useState<
    {
      customerId: string;
      customerName?: string;
      custEmail?: string;
      custPhone?: string;
      /** REQ-023 (NW-14/15): set when the invoice is derived from an
       *  accepted quote — the review is seeded, never asked. */
      quoteId?: string;
      jobName?: string;
      description?: string;
      lineItems?: Array<{ description: string; quantity?: number; unit?: string; price?: number }>;
      terms?: Array<{ stepId: string; label: string; value: string }>;
      agreementTotalCents?: number;
      billedCents?: number;
      paidCents?: number;
    } | null
  >(null);
  const [invoiceDueDate, setInvoiceDueDate] = useState<string>("");
  /** UX-32: the just-accepted job(s) offered as one-tap facturar chips. */
  const [acceptedJobChips, setAcceptedJobChips] = useState<
    Array<{
      /** REQ-023: the quote id + customer travel with the chip. */
      id: string;
      customerId?: string;
      jobName: string;
      customerName?: string | null;
      totalCents: number;
    }>
  >([]);
  const [invoiceResult, setInvoiceResult] = useState<
    { id: string; customerEmail?: string; customerPhone?: string } | null
  >(null);
  const [invLinkCopied, setInvLinkCopied] = useState(false);
  /** REQ-456: which reply's change-order link was just copied. */
  const [coLinkCopied, setCoLinkCopied] = useState<string | null>(null);
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
   * stepId of the agreement term currently being re-edited inline. Driving
   * a `null → stepId → null` cycle expands the term row into the wizard's
   * option buttons for that step, lets the user pick a new value, and
   * collapses back. Picking PUTs the quote directly (no rewinding the
   * wizard state) — the quote IS the source of truth post-wizard.
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
   * inline agreement preview card (total/customer/dates) so the user can
   * actually look the document over before clicking "Send to client".
   */
  const [previewCtaId, setPreviewCtaId] = useState<string | null>(seed?.previewCtaId ?? null);
  // REQ-024: after a reload the open CTA still says which wizard produced
  // it — keep the preview in invoice mode for the invoice wizard.
  useEffect(() => {
    if (!previewCtaId) return;
    const cta = messages.find((m) => m.id === previewCtaId);
    const kind = (cta?.payload as { docKind?: string } | undefined)?.docKind;
    if (kind === "invoice") setReviewDocType("invoice");
  }, [previewCtaId, messages]);

  // REQ-264 (M15): when the preview shows a language the quote is not yet
  // translated into, ask the SERVER to fill it — job-details description AND
  // line items (TranslateQuote, the same pass SendQuote runs before
  // dispatch). Chat-created quotes have no description, so the old
  // description-only client translate never ran and the notice never cleared.
  const descLangInFlight = useRef<Set<string>>(new Set<string>());
  /** UX-06: visible translation state per language — the preview must never
   *  silently fall back to the base language without saying so. */
  const [translationPendingLangs, setTranslationPendingLangs] = useState<
    Set<string>
  >(new Set<string>());
  async function ensureDescriptionLang(targetLang: "en" | "es") {
    const id = quoteId ?? quote?.id;
    if (!id || !previewTranslationMissing(quote, targetLang)) return;
    if (descLangInFlight.current.has(targetLang)) return;
    descLangInFlight.current.add(targetLang);
    setTranslationPendingLangs((s) => new Set(s).add(targetLang));
    try {
      const res = await assistantClient.translateQuote(id, [targetLang]);
      if (res) {
        setQuote((q) =>
          q
            ? {
              ...q,
              descriptionByLang: res.descriptionByLang ?? q.descriptionByLang,
              lineItems: res.lineItems ?? q.lineItems,
            }
            : q
        );
      }
    } catch {
      /* keep the base text — the preview's missing-translation notice
         (UX-06) says so instead of failing silently. */
    } finally {
      descLangInFlight.current.delete(targetLang);
      setTranslationPendingLangs((s) => {
        const next = new Set(s);
        next.delete(targetLang);
        return next;
      });
    }
  }

  // When the preview is open, make sure the current preview language is
  // translated (keyed on the base texts, not the caches, so filling the cache
  // doesn't re-trigger this effect).
  const lineItemTexts = (quote?.lineItems ?? []).map((li) => li.description)
    .join("\n");
  useEffect(() => {
    if (previewCtaId) ensureDescriptionLang(previewLang);
  }, [previewCtaId, previewLang, quote?.id, quote?.description, lineItemTexts]);
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
  /** REQ-678 (demo-loop cycle 5, c3-m60): "Deposit + balance" was picked on
   *  this wizard message — ask how much upfront before answering. */
  const [depositPick, setDepositPick] = useState<
    { messageId: string; optionId: string } | null
  >(null);
  /** REQ-678: the same picker on the preview's term-edit row. */
  const [depositEditStepId, setDepositEditStepId] = useState<string | null>(
    null,
  );
  // start_date "Pick a date" — when armed, renders an inline date picker
  // in place of the option grid for that wizard message.
  const [customDatePick, setCustomDatePick] = useState<
    {
      messageId: string;
      optionId: string;
    } | null
  >(null);
  // wraps "Custom" — structured number + unit picker so the agreement gets a
  // clean duration string ("3 weeks") without relying on free-text parsing.
  const [customDurationPick, setCustomDurationPick] = useState<
    {
      messageId: string;
      optionId: string;
    } | null
  >(null);
  // warranty "Custom" — same two-phase Bossie chat → verify pattern as the
  // duration picker, but tuned for warranty language (months/years/lifetime)
  // so the agreement reads cleanly ("12 months", "2 years", "Lifetime").
  const [customWarrantyPick, setCustomWarrantyPick] = useState<
    {
      messageId: string;
      optionId: string;
    } | null
  >(null);
  // payment_terms "Custom" — chat-with-verify Bossie flow that produces a
  // clean payment string ("Net 30", "30 / 30 / 40") that buildPaymentMilestones
  // can parse. Free-text never lands on the agreement directly.
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
  /** REQ-442 (demo-loop cycle 3, m49): a step-composer turn is in flight. Its
   *  own flag — on the shared `sending` the confirm strip and Continue read
   *  "Setting up…" over the ORIGINAL message while the correction was being
   *  rewritten. */
  const [stepSending, setStepSending] = useState(false);
  /** REQ-670 (demo-loop cycle 5, p7): what the pending reply bubble shows —
   *  the reply so far as the server streams it, else what the turn is doing.
   *  A signal only the bubble reads: a streamed piece re-renders the bubble,
   *  not this island. */
  const liveReply = useSignal<PendingReply>(NO_REPLY_YET);
  // REQ-399 (demo M16): the synchronous "a Send is in flight" lock — state
  // lags a render, so a double-click's second click read `sending` false.
  const sendInFlight = useRef(false);
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
  /** REQ-425 (demo-loop cycle 2, p13-b): true while the chat shows its
   *  welcome state (no messages, no step panel) — the mascot, the title and
   *  the four prompts. Set on every render; the auto-scroll effects read it so
   *  they open that block at its TOP instead of pinning it to the bottom,
   *  which scrolled the mascot out of view whenever the block was taller than
   *  the chat. */
  const welcomeRef = useRef(true);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  /** Wraps the price-capture MoneyInput so [data-cy=pricing-option-custom]
   *  can focus its (visually hidden) input without reaching into MoneyInput. */
  const moneyBoxRef = useRef<HTMLDivElement | null>(null);

  // ── Assistant history stack ──────────────────────────────────────
  // ONE mechanism for "back": every forward move pushes the state it is
  // leaving — the client view flags AND the server's wizard cursor — and
  // the header back pops the latest snapshot and restores it. If the
  // wizard advanced since that snapshot, the server is rewound to the
  // snapshot's step in one call. The stack is persisted per conversation
  // in sessionStorage so a reload keeps the user's path.
  interface ViewSnapshot {
    priceCaptureOpen: boolean;
    awaitingJobDetails: boolean;
    submittedJobDetails: string | null;
    pendingJobDetailsRaw: string | null;
    pendingPriceCents: number | null;
    priceCents: number | null;
    jobOptionsOpen: boolean;
    pickerMode: "polish" | "confirm";
    suggestPricing: boolean;
    writeMyselfOpen: boolean;
    flowChip: ChipKey | null;
    invoiceReview: typeof invoiceReview;
    invoiceResult: typeof invoiceResult;
    previewCtaId: string | null;
    /** Server wizard cursor at push time (see wizardCursor). */
    wizardStepIdx: number | null;
  }
  const historyStackRef = useRef<ViewSnapshot[]>([]);
  // Before the conversation exists (details / price on the empty state) the
  // stack lives under "draft"; it is migrated to the real id the moment the
  // conversation is minted, so the pre-wizard steps stay on the same stack
  // as the wizard across the navigation into the thread.
  const stackKey = (id: string) => `pm:asst-stack:${id}`;
  const DRAFT_STACK = "draft";

  function persistStackAs(id: string) {
    try {
      globalThis.sessionStorage?.setItem(
        stackKey(id),
        JSON.stringify(historyStackRef.current),
      );
    } catch { /* storage unavailable — the in-memory stack still works */ }
  }

  function persistStack() {
    persistStackAs(convoId ?? DRAFT_STACK);
  }

  /** The conversation just got its id: carry the draft-stage stack over. */
  function migrateDraftStack(id: string) {
    try {
      const raw = globalThis.sessionStorage?.getItem(stackKey(DRAFT_STACK));
      if (raw) {
        globalThis.sessionStorage?.setItem(stackKey(id), raw);
        globalThis.sessionStorage?.removeItem(stackKey(DRAFT_STACK));
      }
    } catch { /* noop */ }
  }

  function pushHistory() {
    historyStackRef.current.push({
      priceCaptureOpen,
      awaitingJobDetails,
      submittedJobDetails,
      pendingJobDetailsRaw,
      pendingPriceCents,
      priceCents,
      jobOptionsOpen,
      pickerMode,
      suggestPricing,
      writeMyselfOpen,
      flowChip,
      invoiceReview,
      invoiceResult,
      previewCtaId,
      wizardStepIdx: wizardCursor(messages),
    });
    persistStack();
  }

  function popHistory() {
    const snap = historyStackRef.current.pop();
    if (!snap) return;
    persistStack();
    // What was typed since the snapshot — kept as the composer prefill when
    // the snapshot lands on the job-details entry (editable, not blanked).
    const typedDetails = pendingJobDetailsRaw ?? submittedJobDetails ?? "";
    setPriceCaptureOpen(snap.priceCaptureOpen);
    setAwaitingJobDetails(snap.awaitingJobDetails);
    setSubmittedJobDetails(snap.submittedJobDetails);
    setPendingJobDetailsRaw(snap.pendingJobDetailsRaw);
    setPendingPriceCents(snap.pendingPriceCents);
    setPriceCents(snap.priceCents);
    setPrefillPriceCents(snap.priceCents);
    setJobOptionsOpen(snap.jobOptionsOpen);
    setPickerMode(snap.pickerMode);
    setSuggestPricing(snap.suggestPricing);
    setWriteMyselfOpen(snap.writeMyselfOpen);
    setFlowChip(snap.flowChip);
    setInvoiceReview(snap.invoiceReview);
    setInvoiceResult(snap.invoiceResult);
    setPreviewCtaId(snap.previewCtaId);
    if (snap.awaitingJobDetails && typedDetails) {
      setDraft(typedDetails);
      requestAnimationFrame(() => {
        taRef.current?.focus({ preventScroll: true });
        autosize();
      });
    }
    // The server moved past this snapshot's step → rewind it to match.
    const now = wizardCursor(messages);
    if (
      snap.wizardStepIdx !== null && now !== null && now > snap.wizardStepIdx
    ) {
      void goBackWizard(snap.wizardStepIdx);
      return;
    }
    // Invariant: a snapshot must be a VISIBLE state.
    const noPanel = !snap.previewCtaId && !snap.jobOptionsOpen &&
      !snap.priceCaptureOpen && !snap.awaitingJobDetails &&
      !snap.invoiceReview && !snap.invoiceResult;
    // With the wizard complete, "no preview and no panel" renders nothing
    // (the send CTA is suppressed once closed) — that is not a state, it is
    // the dead end. Treat it as the last term step: rewind one question.
    if (snap.wizardStepIdx === WIZARD_DONE && noPanel) {
      void goBackWizard();
      return;
    }
    // The blank starter page (before any flow was chosen) is only a state
    // while the thread is empty. Once a quote exists, "before the details"
    // means leaving the assistant — the earliest real step is the details
    // entry, which was the previous pop.
    if (snap.wizardStepIdx === null && noPanel && messages.length > 0) {
      // NW-19 (REQ-005): the snapshot is the CHAT state (action card /
      // "Ready" CTA) and the server sits on the wizard's first question —
      // undo the transition into terms so the card is visible again,
      // instead of leaving the assistant.
      const chatSurface = messages.some((m) =>
        m.kind === "action_card" || m.kind === "continue_cta"
      );
      if (chatSurface && wizardCursor(messages) === 0) {
        void goBackWizard(-1);
        return;
      }
      globalThis.location.href = "/dashboard";
    }
  }

  // The ONE back button (ChatHeaderLive) dispatches `pm:asst-back`. Back =
  // pop the latest snapshot and restore it (history stack above). The
  // shared resolver (shared/quote-flow/assistant-back.ts) only decides the
  // edges: a saved invoice is terminal; an EMPTY stack mid-flow (deep link
  // or hard reload) asks the server for one step back derived from the
  // transcript; nothing left exits to /dashboard.
  // No deps array (re-binds each render) so the closure reads current state.
  useEffect(() => {
    function onBack() {
      const action = resolveAssistantBack({
        previewOpen: previewCtaId !== null,
        invoiceResultOpen: invoiceResult !== null,
        activeWizardStepIdx: activeWizardStepIdx(messages),
        viewStackDepth: historyStackRef.current.length,
      });
      switch (action) {
        case "pop-view":
          popHistory();
          return;
        case "rewind-wizard":
          void goBackWizard();
          return;
        case "exit-dashboard":
          globalThis.location.href = "/dashboard";
          return;
      }
    }
    globalThis.addEventListener("pm:asst-back", onBack);
    return () => globalThis.removeEventListener("pm:asst-back", onBack);
  });
  // ── end history stack ───────────────────────────────────────────

  useEffect(() => {
    setConvoId(conversationId);
    // Restore this conversation's back-stack (persisted per tab) so a
    // reload doesn't forget the path the user took to get here.
    try {
      const raw = conversationId
        ? globalThis.sessionStorage?.getItem(stackKey(conversationId))
        : null;
      historyStackRef.current = raw ? (JSON.parse(raw) as ViewSnapshot[]) : [];
    } catch {
      historyStackRef.current = [];
    }
    setMessages(initialMessages);
    setCustomer(initialCustomer);
    setConvTitle(initialTitle); // REQ-447
    // Seed the quote from the route's SSR detail (when present) so the
    // quote-fetch effect below kicks in without waiting for a CTA click.
    if (initialQuote?.id) setQuoteId(initialQuote.id);
  }, [conversationId]);

  // If we still don't have a quoteId on the route (terms phase but no
  // quote bound yet — the "I know my price → job details" flow lands
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
            detail.quote?.id;
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
  // REQ-402 (demo m5): the same rule that tags "Recommended".
  useEffect(() => {
    setSendChannel(defaultSendChannel(customer));
    setPickedChannel(null);
  }, [customer?.email, customer?.phoneNumber]);

  /** REQ-035 / REQ-459 (demo m44): open "How do you want to send" on `ch` —
   *  the main button opens it on the current channel, a ▾ menu pick on the
   *  picked one. Nothing is sent until the dialog's Send (REQ-308). */
  const openSendDialog = (ch: "email" | "sms" | "both") => {
    setDialogChannel(ch);
    setDialogEmail("");
    setDialogPhone("");
    setDialogErr(undefined);
    setChannelMenuOpen(false);
    setSendDialogOpen(true);
  };

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
            number: (q as { number?: string }).number,
            summary: q.summary,
            jobName: q.jobName,
            description: q.description,
            lineItems: q.lineItems,
            estimatedTotal: q.estimatedTotal,
            // UX-02: the lifecycle fields — the thread must reflect a
            // customer acceptance and stop offering re-sends.
            status: (q as { status?: string }).status,
            acceptedAt: (q as { acceptedAt?: string | null }).acceptedAt,
            // REQ-245: the chat header reads the lock / send stamps.
            sentAt: (q as { sentAt?: string | null }).sentAt,
            lockedAt: (q as { lockedAt?: string | null }).lockedAt,
            terms: (q as {
              terms?: { stepId: string; label: string; value: string }[];
            }).terms,
            lastDelivery: q.lastDelivery,
            deliveredAt: q.deliveredAt,
            serviceAddress: q.serviceAddress,
            ...revisionStateOf(q),
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
    // REQ-230: another window (or a cleared tab) has no sessionStorage
    // marker — the server's copy of the flow carries it.
    if ((!raw || !raw.trim()) && convoId === conversationId) {
      raw = seed?.polishRaw ?? null;
    }
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

  // UX-04: the customer-name candidate extracted from the typed quick-quote
  // sentence survives the phase-2 hand-off page load the same way the raw
  // job details do (startQuoteFromRaw does a real navigation). Consumed by
  // the wizard's customer step; cleared once read.
  useEffect(() => {
    if (!convoId) return;
    try {
      const stored = globalThis.sessionStorage?.getItem(
        `pm:custprefill:${convoId}`,
      );
      if (stored && stored.trim()) {
        setPrefillCustomerName(stored.trim());
        globalThis.sessionStorage?.removeItem(`pm:custprefill:${convoId}`);
      }
    } catch { /* sessionStorage unavailable — no prefill */ }
  }, [convoId]);

  // ── REQ-230 (demo M14): the flow lives on the server ───────────────
  // Every change to the in-flight flow (options, pick, price, open panel)
  // is written to the conversation (debounced), so a reload in ANY window —
  // the contractor's own, the demo stage — rebuilds it from GET /:id instead
  // of the typed note alone. Compared in the server's canonical shape so an
  // unchanged flow (a plain chat, a window that only restored it) never
  // writes.
  function currentDraft(): AssistantDraft {
    return {
      flowChip,
      suggestPricing,
      invoiceFlow,
      awaitingJobDetails,
      jobDetailsRaw: pendingJobDetailsRaw,
      submittedJobDetails,
      jobOptionsOpen,
      pickerMode,
      jobOptions,
      optionsDegraded,
      selectedOptionId,
      confirmedOption: confirmedOptionRef.current,
      priceCaptureOpen,
      priceCents,
      priceSuggestions,
      priceBasis,
      previewCtaId,
      polishRaw: needsJobPolish ? jobPolishRawRef.current : null,
      originalRaw,
    };
  }
  const canonicalDraft = (d: unknown) => JSON.stringify(parseAssistantDraft(d));
  const savedDraftRef = useRef<string>(canonicalDraft(initialDraft ?? {}));
  /** Set while price Continue hands off (its own final write wins). */
  const draftFrozenRef = useRef(false);
  function saveDraft(id: string, d: AssistantDraft): Promise<unknown> {
    savedDraftRef.current = canonicalDraft(d);
    return api.post(`/agents/conversations/${id}/draft`, { draft: d })
      .catch(() => {
        savedDraftRef.current = "";
      });
  }
  const draftJson = canonicalDraft(currentDraft());
  useEffect(() => {
    if (!convoId || draftFrozenRef.current) return;
    if (draftJson === savedDraftRef.current) return;
    const d = currentDraft();
    const t = setTimeout(() => {
      if (!draftFrozenRef.current) void saveDraft(convoId, d);
    }, 300);
    return () => clearTimeout(t);
  }, [convoId, draftJson]);

  // A load that lands mid-request (options still generating, price tiers
  // not back yet) re-asks for them — the server holds the request's input,
  // not a promise.
  useEffect(() => {
    if (!seed) return;
    const raw = seed.jobDetailsRaw ?? seed.submittedJobDetails ?? "";
    if (
      seed.jobOptionsOpen && seed.pickerMode === "confirm" && !seed.jobOptions &&
      raw.trim()
    ) {
      void openJobPickerForConfirm(raw);
    }
    if (
      seed.priceCaptureOpen && seed.suggestPricing && !seed.priceSuggestions &&
      raw.trim()
    ) {
      void fetchPriceSuggestions(raw);
    }
  }, []);
  // ── end REQ-230 ─────────────────────────────────────────────────

  // ?seed=… pre-fills the composer from a deeplink (e.g. hero CTAs on
  // /payments / /invoices → "Ask Bossie to record a payment").
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
    queueMicrotask(() => taRef.current?.focus({ preventScroll: true }));
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
        // REQ-447: the thread's stored title, as the list shows it.
        setConvTitle(
          (detail.conversation as { title?: string } | undefined)?.title,
        );
        if (Array.isArray(detail.messages)) setMessages(detail.messages);
        if (detail.customer) setCustomer(detail.customer);
        const qId =
          (detail.conversation as { quoteId?: string } | undefined)?.quoteId ??
            detail.quote?.id;
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
  // the bound customer or quote status changes so a sibling island can
  // swap the title in place — no page reload needed.
  // REQ-369 (demo-loop cycle 1, m2): ONE status for this thread, computed
  // once per render — this header, the quote cards below and the
  // conversation list (pushed in the next effect) all name it. "Picking job
  // details" while the end-of-wizard job pick is still owed. Until the quote
  // row is fetched the rule reads the route's snapshot of it, so the first
  // paint already says what the page was served with (a card read "Locked ·
  // ready to send" under "Gathering a little more info" until the row came).
  const ruleQuote = quote ??
    (convoId === conversationId ? initialQuote : undefined);
  // REQ-385 (cycle 2, m6): the pencil's re-opened job picker owes the pick
  // too — the same rule the server reads off the parked draft.
  const threadHeader = deriveChatHeader({
    customerName: customer?.name,
    title: convTitle, // REQ-447: the list's fallback
    quote: ruleQuote,
    messages,
    detailsPending: needsJobPolish ||
      draftOwesDetails({ jobOptionsOpen, pickerMode }),
  });
  useEffect(() => {
    if (typeof globalThis.window === "undefined") return;
    // REQ-245 (demo m6): the header follows the quote's lifecycle and the
    // server's send record, not the last divider / card — see
    // shared/quote-flow/chat-header.ts for the precedence.
    const header = threadHeader;
    // REQ-236 (demo M8) on top of REQ-245: a send that reached nobody reads
    // "Not delivered" — the quote's persisted lastDelivery counts too, not
    // only the chat's send divider (reconciled on demo-fixes).
    const lastDivider = [...messages]
      .reverse()
      .find((m) => m.kind === "phase_divider");
    const lastQuoteCard = [...messages].reverse().find((m) => {
      if (m.kind !== "action_card") return false;
      const p = m.payload as ActionCardPayload | undefined;
      return p?.actionType === "quote" || p?.actionType == null;
    });
    const undelivered = header.status !== "accepted" &&
      header.status !== "declined" && // REQ-369: the customer's answer stands
      header.status !== "sharedByLink" && // REQ-572: the owner's mark stands
      headerStatusKey({
          quoteAccepted,
          quote: ruleQuote, // REQ-369: the rule's own quote
          lastDividerPayload: lastDivider?.payload as
            | SendDividerPayload
            | undefined,
          lastCardStatus: (
            lastQuoteCard?.payload as ActionCardPayload | undefined
          )?.status,
          hasQuoteCard: !!lastQuoteCard,
        }) === "asstChat.header.notDelivered";
    const statusKey = undelivered
      ? "asstChat.header.notDelivered"
      : header.statusKey;
    // REQ-465 (demo cycle 3, m37): "Q-001 · Quote locked" — the status line
    // names the thread quote's number from the moment it exists.
    const status = numberedLabel(header.number, tFor(lang, statusKey));
    const headerClient = header.clientName ??
      tFor(lang, header.clientKey ?? "asstChat.header.newConversation");
    // REQ-327: the tone rides with the status so "Not delivered" is red,
    // not the live green dot.
    globalThis.window.dispatchEvent(
      new CustomEvent("pm:asst-header", {
        detail: { client: headerClient, status, tone: headerTone(statusKey) },
      }),
    );
  }, [
    customer?.name,
    quote?.id,
    quote?.status,
    quote?.acceptedAt,
    quote?.lastDelivery,
    quote?.terms,
    quote?.lockedAt,
    quote?.sentAt,
    quote?.sentVia, // REQ-572
    quote?.jobName,
    quote?.number, // REQ-465
    convoId,
    messages.length,
    lang,
    convTitle, // REQ-447
    needsJobPolish, // REQ-369
    threadHeader.statusKey, // REQ-369: whatever moves the rule moves this
  ]);

  // REQ-369 (demo-loop cycle 1, m2): the conversation list shows this
  // thread's chip from the SAME status the header just named — pushed the
  // moment it changes, never left for the list's next poll ("Drafting"
  // under "Quote locked", "Terms" after the send).
  useEffect(() => {
    if (typeof globalThis.window === "undefined" || !convoId) return;
    publishThreadStatus({
      conversationId: convoId,
      status: threadHeader.status,
    });
  }, [convoId, threadHeader.status]);

  // REQ-369: the list's poll saw the server name this thread differently —
  // the customer signed or declined on the public page while the chat sat
  // open. Re-read the quote row so the header, the cards and the list say it
  // together (one read per hand-back, never two at once).
  useEffect(() => {
    if (typeof globalThis.window === "undefined") return;
    const rowId = quote?.id;
    if (!convoId || !rowId) return;
    let cancelled = false;
    let reading = false;
    const onServerStatus = (e: Event) => {
      const d = (e as CustomEvent<ThreadStatusDetail>).detail;
      if (!d || d.conversationId !== convoId || reading) return;
      reading = true;
      quotesClient.get(rowId)
        .then((fresh) => {
          if (cancelled) return;
          setQuote((cur) =>
            cur && cur.id === rowId ? { ...cur, ...fresh } as typeof cur : cur
          );
        })
        .catch(() => {/* the next hand-back retries */})
        .finally(() => {
          reading = false;
        });
    };
    globalThis.addEventListener(THREAD_SERVER_STATUS_EVENT, onServerStatus);
    return () => {
      cancelled = true;
      globalThis.removeEventListener(
        THREAD_SERVER_STATUS_EVENT,
        onServerStatus,
      );
    };
  }, [convoId, quote?.id]);

  // REQ-493 (demo-loop c3 m7): the row above moved only on that hand-back,
  // which waits for the list's poll — backed off to 60 s in a tab nobody
  // touches while the customer signs in another — or while the review is open
  // (its 8 s poll below). The chat kept "GATHERING A LITTLE MORE INFO" and
  // the "Save & resend" form after the signature. Follow the change feed: a
  // change naming this thread's quote re-reads the row, review open or not,
  // and a row whose lifecycle moved (signed, declined, a new version) is
  // taken — the header, the cards, the list chip and the recovery form say
  // what a reload says; a re-read with nothing new leaves the row alone.
  // REQ-563 (cycle 4, m3): a public signature also adds the server's
  // "… signed …" divider to the thread, so the row turning signed re-reads
  // the transcript too. The refs give the async re-read the row and thread
  // as they are now, not as they were when this effect ran.
  const quoteNow = useRef(quote);
  quoteNow.current = quote;
  const convoIdNow = useRef(convoId);
  convoIdNow.current = convoId;
  useEffect(() => {
    const rowId = quote?.id;
    if (typeof globalThis.window === "undefined" || !rowId) return;
    let cancelled = false;
    const stop = followChanges(
      (c) => c.entityType === "quote" && c.entityId === rowId,
      () =>
        quotesClient.get(rowId).then((fresh) => {
          if (cancelled) return;
          setQuote((cur) =>
            cur && cur.id === rowId && boundQuoteMoved(cur, fresh)
              ? { ...cur, ...fresh } as typeof cur
              : cur
          );
          // REQ-563 (cycle 4, m3): the signature wrote "… signed Q-001 ·
          // deposit INV-001 …" into this thread — show it now, not on reload.
          const thread = convoIdNow.current;
          if (thread && becameSigned(quoteNow.current, fresh)) {
            return assistantClient.conversation(thread).then((snap) => {
              if (!cancelled && Array.isArray(snap?.messages)) {
                setMessages(snap.messages);
              }
            });
          }
        }),
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, [quote?.id]);

  // Keep the composer focused: on first mount (so users can just start typing)
  // and again whenever the assistant finishes a turn (sending: true → false).
  // Without this the textarea was getting blurred whenever it was disabled,
  // forcing a click back into the input between every message.
  useEffect(() => {
    if (!sending) taRef.current?.focus({ preventScroll: true });
  }, [sending]);

  // Auto-focus the composer when the "awaiting job details" view appears
  // (user clicked "I know my price, write it up."). Without this the user
  // has to manually click the textarea before typing.
  useEffect(() => {
    if (awaitingJobDetails && !submittedJobDetails) {
      queueMicrotask(() => taRef.current?.focus({ preventScroll: true }));
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
        if (!cancelled) {
          setSampleQuoteUrl(customerLinkPath(r.quoteId, langSignal.value));
        }
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
    return attachBottomPin(scroller, { isWelcome: () => welcomeRef.current });
  }, []);

  // REQ-383 (demo M26, cycle 2): the job-options picker takes its natural
  // height and the chat panel scrolls (no squeezed inner list). The panel
  // pins to the bottom whenever its content grows, which would open a tall
  // picker on its last card — so once the options land, bring the picker's
  // head and first card into view instead; the strip and Continue follow
  // the cards in flow, a scroll away, never drawn over a card.
  const jobOptionsReady = jobOptionsOpen && !optionsLoading &&
    jobOptions !== null;
  useEffect(() => {
    if (!jobOptionsReady) return;
    return revealPicker(scrollRef.current);
  }, [jobOptionsReady]);

  // Belt-and-suspenders: explicit scroll on message arrivals (for the
  // "user clicked away then a reply lands" case, where they expect to
  // be brought back regardless of where they were). The ResizeObserver
  // above won't kick in if the user scrolled up to read history.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({
        top: welcomeRef.current ? 0 : el.scrollHeight,
        behavior: "smooth",
      });
    }
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

  // While the inline quote-review preview is open and the bound quote
  // hasn't reached a terminal state (accepted / declined), poll its row
  // every 8s so the status chip ticks forward as the customer interacts:
  //   Sent → Viewed (first public GET) → Accepted (sign).
  // No SSE channel exists today; polling here is scoped to the preview
  // surface to keep traffic minimal.
  useEffect(() => {
    if (previewCtaId === null) return;
    const qid = quote?.id;
    if (!qid) return;
    const TERMINAL = new Set(["accepted", "declined", "void", "lost"]);
    if (TERMINAL.has((quote?.status ?? "").toLowerCase())) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await quotesClient.get(qid);
        if (cancelled) return;
        setQuote((cur) => {
          if (!cur || cur.id !== qid) return cur;
          const freshStatus = (fresh as { status?: string }).status;
          if (cur.status === freshStatus) return cur;
          return { ...cur, ...fresh } as typeof cur;
        });
      } catch {
        /* swallow — next tick will retry */
      }
    };
    // REQ-221: not while the tab is hidden (the REQ-242 stage frame runs no scripts).
    const stop = startPoll(tick, 8_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [previewCtaId, quote?.id, quote?.status]);

  // Auto-open the editable quote-review when the wizard emits its
  // "Ready to send" CTA. The CTA banner itself is suppressed below
  // (felt redundant), so this effect is the single entry point. Tracked
  // per-message-id in a ref so cancelling the preview doesn't re-trigger.
  const autoOpenedCtasRef = useRef<Set<string>>(new Set());
  // REQ-244: a send CTA the thread itself shows as sent/signed (a later
  // phase-3/4 divider, or an accepted quote) counts as reviewed — the
  // in-memory set starts empty on every load, and re-opening the review
  // over a sent quote hid the message box (demo m5).
  const settledCtas = settledSendCtaIds(messages, quote);
  useEffect(() => {
    if (previewCtaId !== null) return;
    for (const m of messages) {
      if (m.kind !== "continue_cta") continue;
      const p = (m.payload ?? {}) as { toPhase?: string };
      if (p.toPhase !== "send") continue;
      if (reviewedCtas.has(m.id) || settledCtas.has(m.id)) continue;
      if (autoOpenedCtasRef.current.has(m.id)) continue;
      autoOpenedCtasRef.current.add(m.id);
      submitContinueCta(m).catch(() => {});
      break;
    }
  }, [messages, previewCtaId, reviewedCtas, quote?.status]);

  /**
   * REQ-246 (demo quote-invoice-money-m7): Edit on the draft quote card.
   * It used to be `setDraft("")` — it wiped the composer and showed nothing.
   * Now it seeds the composer with the edit prompt (keeping anything already
   * typed), focuses it and puts the caret at the end, so the contractor types
   * the correction and sends it to the assistant.
   */
  function openDraftEdit() {
    const prompt = tFor(lang, "asstChat.actionCard.editPrompt");
    const next = editDraftSeed(draft, prompt);
    setDraft(next);
    // REQ-464: remember the seed only when Edit put it there.
    setEditSeed(next === prompt ? prompt : null);
    // After the re-render has written `next` into the textarea.
    setTimeout(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      autosize();
    }, 0);
  }

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
   *
   * REQ-670 (demo-loop cycle 5, p7): `submit` gets `onEvent` — the turn's
   * stream — and the pending bubble shows the reply as it is written.
   */
  async function submitTurn(
    optimistic: {
      role: "user" | "assistant";
      kind: "text" | "voice" | "image";
      content: string;
    },
    submit: (onEvent: (event: ChatStreamEvent) => void) => Promise<{
      conversation?: { id: string };
      newMessages?: Message[];
      message?: Message;
      conversationId?: string;
    }>,
    onError?: () => void,
    /** REQ-442: the busy flag this turn holds — a step-composer turn holds
     *  `stepSending`, never the shared `sending`. */
    setBusy: (busy: boolean) => void = setSending,
  ) {
    if (sending || stepSending) return;
    setError(undefined);
    retryTurnRef.current = null;
    setCanRetryTurn(false);
    setBusy(true);
    // REQ-442 (M22): the thread's first turn names it — the list refreshes.
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
      liveReply.value = NO_REPLY_YET;
      const res = await withChatTimeout(
        submit((event) => {
          liveReply.value = pendingReply(liveReply.peek(), event);
        }),
      );
      const newConvoId = res.conversation?.id ?? res.conversationId;
      if (newConvoId && newConvoId !== convoId) {
        setConvoId(newConvoId);
        if (!convoId && typeof globalThis.history !== "undefined") {
          globalThis.history.replaceState(null, "", `/assistant/${newConvoId}`);
        }
      }
      const turnConvoId = newConvoId ?? convoId;
      // REQ-442 / REQ-580 (cycle 4, p4-p2d): every turn — not only the
      // first — hands the list the thread's new title and preview.
      if (turnConvoId && typeof globalThis.window !== "undefined") {
        publishThreadTurn(turnConvoId, res.conversation);
      }
      // REQ-331 (demo m7): the turn resolved "for <Name>" to one of the
      // contractor's customers and bound them — show them as known now, so
      // the lock CTA and the customer step offer "Use María López ✓".
      const boundId =
        (res.conversation as { id: string; customerId?: string } | undefined)
          ?.customerId;
      // REQ-447 (cycle 3, p8-pair10-d): the turn titled the thread (its
      // first message, or the job name of the quote it drafted).
      const turnTitle = (res.conversation as { title?: string } | undefined)
        ?.title;
      if (turnTitle) setConvTitle(turnTitle);
      if (boundId && boundId !== customer?.id) {
        clientsClient.get(boundId)
          .then((c) => setCustomer(c as unknown as CustomerLite))
          .catch(() => {/* the next load shows it */});
      }
      if (Array.isArray(res.newMessages) && res.newMessages.length > 0) {
        // REQ-585 (demo-loop cycle 4, M30): a pick the turn changed in place
        // (a start date typed in the chat) replaces that message where it
        // sits — never a second copy under the reply.
        setMessages((m) =>
          mergeTurnMessages(
            m.filter((msg) => msg.id !== tmpId),
            res.newMessages!,
          )
        );
        // REQ-656 (demo-loop cycle 5, M9): the server read "job done,
        // invoice X" — open the invoice flow the starter chip opens.
        const invoiceAsk = arrivedInvoiceFlowOffer(res.newMessages);
        if (invoiceAsk) setPendingInvoiceFlow(invoiceAsk);
        // REQ-262 (demo M25): the assistant rewrote / translated the quote's
        // job details — re-read it so the open preview shows the new text.
        const updatedQuoteId = quoteUpdatedBy(res.newMessages);
        if (updatedQuoteId) {
          quotesClient.get(updatedQuoteId).then((fresh) => {
            setQuote((cur) =>
              cur && cur.id === updatedQuoteId
                ? { ...cur, ...fresh } as typeof cur
                : cur
            );
          }).catch(() => {/* best-effort — the next load shows it */});
        }
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
      retryTurnRef.current = () =>
        void submitTurn(optimistic, submit, onError, setBusy);
      setCanRetryTurn(true);
      setMessages((m) => m.filter((msg) => msg.id !== tmpId));
      onError?.();
    } finally {
      liveReply.value = NO_REPLY_YET;
      setBusy(false);
    }
  }

  async function sendText(content: string) {
    const trimmed = content.trim();
    if (!trimmed) return;
    // REQ-464 (m33): the bare Edit seed is not a change — never send
    // "Change the quote:" on its own; clear it instead.
    if (isBareEditSeed(content, editSeed)) {
      setDraft("");
      setEditSeed(null);
      autosize();
      return;
    }
    setEditSeed(null);
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
    // NW-19 (REQ-005): a chat turn is a forward move like any other —
    // snapshot the state it leaves so back can return here.
    pushHistory();
    await submitTurn(
      { role: "user", kind: "text", content: trimmed },
      (onEvent) =>
        assistantClient.chatStream({
          conversationId: convoId,
          content: trimmed,
          kind: "text",
        }, onEvent) as Promise<{
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
      async (onEvent) => {
        const file = await filesClient.uploadBlob(
          blob,
          `voice-${Date.now()}.webm`,
        );
        return (await assistantClient.chatStream({
          conversationId: convoId,
          kind: "voice",
          payload: {
            fileId: file.id,
            ...(liveTranscript ? { transcript: liveTranscript } : {}),
          },
        }, onEvent)) as {
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
   * REQ-392 (demo-loop cycle 2, M7): a message typed in the compact composer
   * on a guided step goes to the assistant WITH the step, and the step takes
   * the answer — Pick a price its re-priced tiers and the price the
   * correction named, the Job details picker its rewritten versions. On a
   * wizard question / the review the answer lands in the thread, and a quote
   * the assistant changed is re-read by submitTurn (quoteUpdated). It amends
   * the step in place, so no history snapshot: Back still undoes the step.
   * Resolves true once the assistant answered.
   */
  async function sendStepText(
    text: string,
    step: ChatStepId,
    wizardStepId?: string,
  ): Promise<boolean> {
    const said = text.trim();
    if (!said || sending || stepSending) return false;
    const hint = stepHintFor(step, wizardStepId);
    let answered: Message[] | undefined;
    // REQ-442 (m49): the step shows the correction while it runs, on its own
    // `stepSending` — the confirm strip and Continue keep their labels.
    setStepPending({ step, text: said });
    try {
      await submitTurn(
        { role: "user", kind: "text", content: said },
        async (onEvent) => {
          const input = {
            conversationId: convoId,
            content: said,
            kind: "text" as const,
            step: hint,
          };
          // REQ-670: Pick a price and the Job details picker cover the
          // thread and say the turn on the step — nothing streamed into the
          // thread would be seen there, so they ask the JSON way; a wizard
          // question or the review answers in the thread, streamed.
          const res = await (stepOwnsAnswer(step)
            ? assistantClient.chat(input)
            : assistantClient.chatStream(input, onEvent)) as {
              conversation?: { id: string };
              newMessages?: Message[];
              message?: Message;
              conversationId?: string;
            };
          answered = res.newMessages ?? [];
          return res;
        },
        undefined,
        setStepSending,
      );
    } finally {
      setStepPending(null);
    }
    if (!answered) return false;
    applyStepAnswer(step, answered, said);
    return true;
  }

  /** REQ-392: what the server needs to act on the step — on the pre-quote
   *  steps the job as typed and what is on screen (no quote exists yet). */
  function stepHintFor(step: ChatStepId, wizardStepId?: string): ChatStepHint {
    if (step === "price") {
      const typed = (submittedJobDetails ?? pendingJobDetailsRaw ?? "").trim();
      const shown = (pendingJobDetailsRaw ?? "").trim();
      return {
        id: "price",
        ...(typed ? { job: typed } : {}),
        // help me price it: the confirmed bullets, priced beside the job
        ...(suggestPricing && shown && shown !== typed ? { scope: shown } : {}),
        ...(suggestPricing ? { tiers: true } : {}),
        // REQ-444 (M21): the tiers on screen and what they include — a
        // question about them is answered from what the contractor sees.
        ...(suggestPricing && priceSuggestions?.length
          ? {
            options: priceSuggestions.map((t) => ({
              label: t.label,
              priceCents: t.priceCents,
              ...(t.rationale ? { rationale: t.rationale } : {}),
            })),
            basis: priceBasis,
          }
          : {}),
      };
    }
    if (step === "job_details") {
      const typed = ((pickerMode === "confirm"
        ? submittedJobDetails ?? pendingJobDetailsRaw
        : jobPolishRawRef.current ?? submittedJobDetails ??
          quote?.description) ?? "").trim();
      const picked = jobOptions?.find((o) => o.id === selectedOptionId);
      const shown = (picked?.bullets ?? [])
        .filter((b) => !b.deleted && b.text.trim())
        .map((b) => b.text.trim())
        .join("\n");
      return {
        id: "job_details",
        ...(typed ? { job: typed } : {}),
        ...(shown ? { scope: shown } : {}),
      };
    }
    if (step === "wizard") {
      return { id: "wizard", ...(wizardStepId ? { wizardStepId } : {}) };
    }
    return { id: "review" };
  }

  /** REQ-392: the step takes the server's answer. REQ-442 (M22): what was
   *  said and the answer join the step's transcript. */
  function applyStepAnswer(
    step: ChatStepId,
    newMessages: Message[],
    said: string,
  ) {
    const answer = [...newMessages].reverse().find((m) =>
      m.role === "assistant" &&
      (m.payload as { step?: unknown } | undefined)?.step === step
    );
    const reply = answer ??
      [...newMessages].reverse().find((m) =>
        m.role === "assistant" && m.kind === "text"
      );
    setStepLog((log) =>
      addStepExchange(log, step, said, reply?.content ?? "")
    );
    if (!answer) return;
    const p = (answer.payload ?? {}) as {
      priceSuggestions?: {
        options?: NonNullable<typeof priceSuggestions>;
        basis?: "labor_and_materials" | "labor_materials_as_noted";
      };
      statedPriceCents?: number;
      jobOptions?: { options?: JobOption[]; degraded?: boolean };
    };
    if (step === "price") {
      const tiers = p.priceSuggestions?.options;
      if (tiers && tiers.length > 0) {
        setPriceBasis(p.priceSuggestions?.basis ?? "labor_and_materials");
        setPriceSuggestions(tiers);
      }
      if (typeof p.statedPriceCents === "number" && p.statedPriceCents > 0) {
        setPriceCents(p.statedPriceCents);
        // REQ-389 — a stated price sizes the pad's quick chips too
        setPrefillPriceCents(p.statedPriceCents);
        setPriceSeedRev((n) => n + 1);
      }
      // REQ-444 (M21): the assistant rewrote the job details on screen ("add
      // permit if not") — they show, and the quote is made from them; a
      // language it didn't rewrite leaves the confirmed option (the send
      // translates it again). The bump keeps the price box from re-focusing.
      const rewritten = stepScopeOf(answer.payload);
      if (rewritten) {
        setPendingJobDetailsRaw(rewritten.scope);
        if (confirmedOptionRef.current) {
          confirmedOptionRef.current = withStepScope(
            confirmedOptionRef.current,
            rewritten,
            lang,
          );
        }
        setPriceSeedRev((n) => n + 1);
      }
    }
    const opts = p.jobOptions?.options;
    if (step === "job_details" && opts && opts.length > 0) {
      const drafts = toOptionDrafts(opts);
      optionsTouchedRef.current = false;
      setEditingBullet(null);
      setEditingTitleId(null);
      // REQ-384 — a polish offer (or one still in flight) is for the old drafts
      proReqRef.current++;
      setProOffer(null);
      setOptionsDegraded(p.jobOptions?.degraded === true);
      setJobOptions(drafts);
      // REQ-446 (demo-loop cycle 3, m13): the contractor's pick follows the
      // rewrite — the same version, else the closest lines, else the same
      // place — never back to card 1.
      setSelectedOptionId((cur) => carryPickedOptionId(jobOptions, cur, opts));
    }
    // REQ-442 (m49): the confirm strip confirms what it echoes — the message
    // as typed AND the correction the versions were rewritten with.
    if (step === "job_details" && pickerMode === "confirm") {
      setPendingJobDetailsRaw((raw) => echoWithCorrection(raw, said));
    }
  }

  /**
   * Dev-only: spin up a phase-2 conversation in one shot. Bypasses the
   * LLM (which may be in stub mode) by creating a quote directly, binding
   * it to a fresh conversation, transitioning to terms, and answering the
   * config step — leaving the user on the customer step.
   */
  /**
   * REQ-449 (demo-loop cycle 3, m48): a tier tap on Pick a price SELECTS —
   * the tier's price fills the price box (remounted with it) and the card
   * reads selected; Continue is what moves on. It used to call
   * onPriceContinue and create the quote on the spot.
   */
  function selectPriceTier(cents: number) {
    if (sending || cents <= 0) return;
    setError(undefined);
    setPriceCents(cents);
    setPriceSeedRev((n) => n + 1);
  }

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
    // REQ-024 (NW-13/18): "Job done, need to invoice." runs the SAME wizard
    // as a quote (completion date instead of start date + duration) and
    // lands on the shared preview in invoice mode — no standalone card.
    if (pendingJobDetailsRaw && pendingJobDetailsRaw.trim().length > 0) {
      // Price + details in hand → create the quote now and hand off into the
      // terms wizard. The Job Details picker is deferred to the END of phase
      // 2 (right before the quote review): generation runs in the background
      // while the user answers wizard questions, so they never wait on it.
      // Keep the price screen mounted (its Continue flips to "Setting up…"
      // via `sending`) so we don't flash the prompts before navigating.
      void startQuoteFromRaw(pendingJobDetailsRaw, cents);
    } else {
      pushHistory();
      setPriceCaptureOpen(false);
      setAwaitingJobDetails(true);
    }
  }

  /**
   * Opens the "Job Details" picker at the end of phase 2. The generation
   * was kicked off on phase-2 mount and has been running the whole time the
   * user answered wizard questions, so it's almost always already resolved
   * → the picker opens instantly. REQ-027 (NW-11): until it resolves the
   * picker shows the honest "Writing up your options…" wait — never a
   * client-side echo of the sentence that the model's cards then replace.
   */
  /** REQ-330 (M23): the review card's CURRENT job details, seeded into the
   *  picker as a pre-selected, editable first option when the pencil
   *  reopens it — bullets verbatim, title kept — beside the regenerated
   *  alternatives. */
  interface PickerSeed {
    lines: string[];
    jobName?: string | null;
    summary?: string | null;
  }

  async function openJobPicker(seed?: PickerSeed) {
    const raw = (jobPolishRawRef.current ?? quote?.description ?? "").trim();
    optionsTouchedRef.current = false;
    // No snapshot here: this picker is the end-of-wizard "send step" (it
    // auto-opens right before the preview), not a state of its own. The
    // state to return to is the last term question — the snapshot pushed
    // when it was answered.
    setJobOptionsOpen(true);
    beginJobOptionsWait();
    // REQ-446 (demo-loop cycle 3, m13): the pencil edits the CURRENT card in
    // place — no regenerated, reworded alternatives beside it ("Tell the
    // assistant…" still rewrites it on request, REQ-392).
    if (seed && seed.lines.length > 0) {
      settleJobOptions(raw, null, seed);
      return;
    }
    const inflight = optionsInFlightRef.current ?? assistantClient
      .generateJobOptions(raw)
      .catch((err) => {
        console.warn(
          "[asst] job-options generation failed, using honest fallback:",
          err,
        );
        return null;
      });
    optionsInFlightRef.current = null;
    const res = await inflight;
    settleJobOptions(raw, res, seed);
  }

  /** REQ-027 (NW-11): the picker opens on the wait state — dots and
   *  "Writing up your options…" — with no card painted. */
  function beginJobOptionsWait() {
    setOptionsLoading(true);
    setJobOptions(null);
    setOptionsDegraded(false);
    setSelectedOptionId(null);
  }

  /**
   * REQ-027 (NW-11): settle the picker from a job-options response. A usable
   * answer paints the model's cards. A failed request, or a server answer
   * flagged `degraded` (REQ-026), paints honest scope bullets — never the
   * typed sentence — under a visible note, with the contractor's own words
   * waiting in the "Write it myself" tile. The honest cards stay the default
   * selection (a bare Continue must never submit the raw sentence); the tile
   * is pre-selected only when nothing scope-like survived their text.
   */
  function settleJobOptions(
    raw: string,
    res: { options: JobOption[]; degraded?: boolean } | null,
    seed?: PickerSeed,
  ) {
    const usable = res?.options && res.options.length > 0 ? res.options : null;
    // REQ-330 (M23): on an edit-reopen the current details are the first,
    // pre-selected card — never regenerated, capped or renamed; the model's
    // cards are alternatives beside it (and a degraded answer is not a
    // problem: the current card stands on its own).
    const current = seed && seed.lines.length > 0
      ? currentDetailsOption({
        lines: seed.lines,
        jobName: seed.jobName,
        summary: seed.summary,
      })
      : null;
    const generated = usable ??
      (current
        ? []
        : localFallbackOptions(raw || tFor(lang, "asstChat.newJob"), lang)
          .options);
    const drafts = toOptionDrafts(
      current ? seedPickerOptions(current, generated) : generated,
    );
    const degraded = !current && (!usable || res?.degraded === true);
    const noScope = degraded && scopeBulletsFromRaw(raw, lang).degraded;
    if (degraded) customDraftRef.current = raw;
    setOptionsDegraded(degraded);
    setJobOptions(drafts);
    setSelectedOptionId(noScope ? CUSTOM_OPTION_ID : (drafts[0]?.id ?? null));
    setOptionsLoading(false);
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
    beginJobOptionsWait();
    const res = await assistantClient.generateJobOptions(raw).catch((err) => {
      console.warn(
        "[asst] confirm-step option generation failed, using honest fallback:",
        err,
      );
      return null;
    });
    settleJobOptions(raw, res);
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

  /** REQ-332 (m30): a professionalized bullet that came back as several
   *  lines ("4 recesed lights + City of Austin permit" → two) replaces the
   *  one bullet with one bullet per line, in place; the first keeps its id. */
  function replaceBulletWithLines(
    optionId: string,
    bulletId: string,
    lines: string[],
  ) {
    const [first, ...rest] = lines;
    if (!first) return;
    const extra = rest.map((text) => ({
      id: `b${++bulletSeq}`,
      text,
      deleted: false,
    }));
    setJobOptions((prev) =>
      prev?.map((o) =>
        o.id === optionId
          ? {
            ...o,
            bullets: o.bullets.flatMap((b) =>
              b.id === bulletId ? [{ ...b, text: first }, ...extra] : [b]
            ),
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

  /** REQ-335 (M31): a tap anywhere inside a card chooses THAT card; only the
   *  pencils open inline editing (shared/quote-flow/option-tap.ts). `text` is
   *  the current title / bullet text the editor starts from. */
  function onOptionTap(tap: OptionTap, text = "") {
    const fx = optionTap(tap);
    setSelectedOptionId(fx.selectedOptionId);
    if (fx.editTitle) startTitleEdit(tap.optionId, text);
    if (fx.editBullet) startBulletEdit(tap.optionId, fx.editBullet, text);
    if (fx.toggleDeleted) toggleBulletDeleted(tap.optionId, fx.toggleDeleted);
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
    void offerPolish(optionId, bulletId, next);
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
    void offerPolish(optionId, id, text);
  }

  /** REQ-384 (m16): polish the line FIRST, then offer the result inline
   *  under it as a before → after preview — and only when it is a real
   *  rewrite (an already-clean line gets no offer). */
  async function offerPolish(optionId: string, bulletId: string, text: string) {
    const req = ++proReqRef.current;
    setProOffer(null);
    const option = jobOptions?.find((o) => o.id === optionId);
    try {
      // REQ-332 (m30): send the JOB with the bullet — the original message
      // and the option's other bullets — so the rewrite never re-scopes a
      // job-wide item ("City of Austin permit") onto the item it shares a
      // line with; an "A + B" bullet comes back as two lines.
      const siblings = (option?.bullets ?? [])
        .filter((x) => x.id !== bulletId && !x.deleted)
        .map((x) => x.text);
      const res = await assistantClient.professionalizeBullet(text, {
        raw: pendingJobDetailsRaw ?? submittedJobDetails ?? undefined,
        siblings,
      });
      if (req !== proReqRef.current) return;
      const offer = polishOffer(
        text,
        res?.lines ?? (res?.text ? [res.text] : []),
      );
      if (offer) setProOffer({ optionId, bulletId, ...offer });
    } catch (err) {
      console.warn("[asst] professionalize failed, keeping text:", err);
    }
  }

  /** Yes: apply exactly the previewed rewrite — unless the line changed
   *  since (then the preview is stale and nothing is applied). */
  function acceptPolish() {
    if (!proOffer) return;
    const { optionId, bulletId, before, after } = proOffer;
    setProOffer(null);
    const b = jobOptions?.find((o) => o.id === optionId)?.bullets.find((x) =>
      x.id === bulletId
    );
    if (!b || b.deleted || b.text !== before) return;
    if (after.length > 1) replaceBulletWithLines(optionId, bulletId, after);
    else setBulletText(optionId, bulletId, after[0]);
  }

  function dismissPolish() {
    proReqRef.current++;
    setProOffer(null);
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
      // UX-29: the shared lang-aware derivation — a bare 3-word slice
      // produced titles like "El patio de". REQ-579 (cycle 4, M14): named in
      // the language the details were TYPED in, and the single line is the
      // job's name, never the raw 8-word slice.
      const names = quickQuoteNames({
        raw,
        lang,
        fallback: tFor(lang, "asstChat.newJob"),
        confirmed,
      });
      const { summary, jobName } = names;
      const byLang = confirmed?.byLang;
      // REQ-441 (cycle 3, M23): reuse a pre-generated translation only when
      // the confirmed bullets are unedited — a line added with "Add your
      // own…" (or any edit) makes the other languages stale, so translate
      // the live lines for them; on failure leave them out for
      // TranslateQuote to fill, never the pre-edit copy.
      let descriptionByLang: Record<string, string> = {};
      if (byLang) {
        const picked = confirmedDescriptionByLang(byLang, lang, raw);
        descriptionByLang = picked.descriptionByLang;
        const liveLines = descriptionLines(raw);
        for (const ol of picked.stale) {
          try {
            const res = await assistantClient.translate(
              liveLines,
              ol as "en" | "es",
            );
            if (res?.texts && res.texts.length === liveLines.length) {
              descriptionByLang[ol] = res.texts.map((t) => t.trim()).join(
                "\n",
              );
            }
          } catch { /* TranslateQuote fills it on preview / send */ }
        }
      }
      const byLangFields = byLang
        ? {
          jobNameByLang: Object.fromEntries(
            Object.entries(byLang).map((
              [l, v],
            ) => [
              l,
              // REQ-276: an LLM's pre-generated name arrives Title Cased.
              l === lang ? jobName : jobNameCase(v.jobName, l as Lang),
            ]),
          ),
          summaryByLang: Object.fromEntries(
            Object.entries(byLang).map((
              [l, v],
            ) => [l, l === lang ? summary : v.summary]),
          ),
          descriptionByLang,
        }
        : {};
      // Use the api helper (same base as quotesClient/assistantClient) — NOT
      // a raw /api/* fetch. In prod the api helper hits the standalone backend
      // directly while /api/* bounces through the Fresh proxy; mixing the two
      // creates the quote on one backend and reads/updates it on another, so
      // the later GET/PUT /quotes/:id 404s. Keep all quote ops on one path.
      // REQ-585 (demo-loop cycle 4, M30): a quick quote (nothing confirmed)
      // starts from the message's scope lines — never the message itself as
      // its one job line, which every later chat edit echoed back.
      const scoped = confirmed
        ? raw.trim()
        : scopeDescriptionFromRaw(raw, lang);
      const quoteFields = {
        summary,
        jobName,
        ...(scoped ? { description: scoped } : {}),
        ...byLangFields,
        // REQ-259 (demo M23): the lines the user typed, priced, when they
        // still add up to the confirmed price; else one summary line.
        lineItems: quoteLineItemsFromPrefill(prefillLines, cents, names.line),
        estimatedTotal: cents,
        // REQ-263: the job address typed in the sentence rides on the quote.
        ...(prefillServiceAddress
          ? { serviceAddress: prefillServiceAddress }
          : {}),
      };

      let convId: string;
      let boundQuoteId: string | undefined;
      if (quoteId && convoId) {
        // Back brought the user to the price (or details) step of a quote
        // that already exists: this is an EDIT of that quote, not a second
        // one. The server stays where it is (terms, first question); the
        // navigation below re-enters the wizard with the new numbers.
        await quotesClient.update(quoteId, quoteFields);
        convId = convoId;
        boundQuoteId = quoteId;
      } else {
        // NW-10 (REQ-003): a quote is BORN a draft — the store defaults
        // status to "draft"; only a real dispatch (send-quote) flips it.
        const quote = await api.post<{ id?: string }>("/quotes", quoteFields);
        if (!quote?.id) throw new Error("failed to create quote");
        boundQuoteId = quote.id;

        // P-22: reuse the conversation minted when the details were
        // submitted (its id is already in the URL) instead of orphaning it
        // behind a second one. Falls back to creating one when the early
        // mint failed.
        const conv = convoId
          ? await api.post<{ id?: string }>(
            `/agents/conversations/${convoId}/draft`,
            { quoteId: quote.id },
          )
          : await api.post<{ id?: string }>("/agents/conversations", {
            quoteId: quote.id,
          });
        if (!conv?.id) throw new Error("failed to start conversation");
        if (!convoId) migrateDraftStack(conv.id);
        convId = conv.id;

        // REQ-024: the invoice starter runs the invoice wizard.
        await api.post(
          `/agents/conversations/${convId}/transition-to-terms?docKind=${
            invoiceFlow ? "invoice" : "quote"
          }`,
        );
      }
      const conv = { id: convId };

      // REQ-230 (demo M14): the pick and the price outlive the page load
      // below — on the server, for every window. The pre-quote panels are
      // closed in this copy: the next load is the wizard.
      draftFrozenRef.current = true;
      await saveDraft(convId, {
        ...currentDraft(),
        awaitingJobDetails: false,
        jobDetailsRaw: raw.trim(),
        submittedJobDetails: raw.trim(),
        jobOptionsOpen: false,
        confirmedOption: confirmed,
        priceCaptureOpen: false,
        priceCents: cents,
        polishRaw: confirmed ? null : raw.trim(),
      });

      // Leaving the price step for the wizard is a forward move like any
      // other: snapshot it, persisted under the thread id so a later reload
      // of the thread keeps the path.
      pushHistory();
      persistStackAs(convId);

      if (!confirmed) {
        try {
          globalThis.sessionStorage?.setItem(
            `pm:jobpolish:${conv.id}`,
            raw.trim(),
          );
        } catch { /* sessionStorage unavailable — picker just won't auto-open */ }
      }

      // REQ-449 (demo-loop cycle 3, m48): hand off into the wizard IN PLACE —
      // no page load (it re-fetched the shell, re-synced the demo stage and
      // replaced every element). Paint what /assistant/<id> would: the
      // thread's messages (the wizard's first question), its customer and
      // quote, the pre-quote panels closed (restorableDraft with a quote
      // bound), and the end-of-wizard Job Details polish owed.
      const detail = await assistantClient.conversation(convId).catch(
        () => null,
      );
      if (!detail || !Array.isArray(detail.messages)) {
        // Couldn't read the thread back: fall back to loading its page.
        // UX-04: carry the extracted customer-name candidate across it
        // (island state does not survive a page load).
        if (prefillCustomerName) {
          try {
            globalThis.sessionStorage?.setItem(
              `pm:custprefill:${conv.id}`,
              prefillCustomerName,
            );
          } catch { /* sessionStorage unavailable — no prefill */ }
        }
        globalThis.location.href = `/assistant/${conv.id}`;
        return;
      }
      setMessages(detail.messages);
      if (detail.customer) setCustomer(detail.customer);
      const detailQuoteId =
        (detail.conversation as { quoteId?: string } | undefined)?.quoteId ??
          detail.quote?.id ?? boundQuoteId;
      if (detailQuoteId) setQuoteId(detailQuoteId);
      setAwaitingJobDetails(false);
      setJobOptionsOpen(false);
      setPriceCaptureOpen(false);
      setPriceCents(cents);
      if (!confirmed) {
        jobPolishRawRef.current = raw.trim();
        setNeedsJobPolish(true);
        // Fresh for THESE details, as the page load did (Back may have
        // re-edited them since an earlier run).
        optionsInFlightRef.current = assistantClient
          .generateJobOptions(raw.trim())
          .catch((err) => {
            console.warn("[asst] phase-2 job-options generation failed:", err);
            return null;
          });
      }
      setConvoId(convId);
      if (typeof globalThis.history !== "undefined") {
        globalThis.history.replaceState(null, "", `/assistant/${convId}`);
      }
      draftFrozenRef.current = false;
      setSending(false);
    } catch (err) {
      draftFrozenRef.current = false;
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
  function applyJobOption() {
    return applyOption(null);
  }

  /** REQ-381 (demo M20): the confirm strip echoes the message the contractor
   *  typed, so clicking it confirms THAT message — run through the shared
   *  scope pass — never the pre-selected generated card (version 1).
   *  Continue keeps confirming the selected card. */
  function confirmOwnWords() {
    const own = ownWordsOption(pendingJobDetailsRaw ?? "", lang);
    if (!own) {
      setError(tFor(lang, "asstChat.jobOpts.customEmpty"));
      return;
    }
    return applyOption({
      id: OWN_WORDS_OPTION_ID,
      jobName: own.jobName,
      summary: own.summary,
      bullets: own.bullets.map((text, i) => ({
        id: `w${i}`,
        text,
        deleted: false,
      })),
    });
  }

  /** `picked` set: apply that option (the confirm strip's own words);
   *  null: apply the card the contractor selected. */
  async function applyOption(picked: JobOptionDraft | null) {
    if (sending || stepSending) return;
    let opt = picked ?? jobOptions?.find((o) => o.id === selectedOptionId);
    // "Write it myself" — synthesize a draft from the free-text box: each
    // non-empty line becomes a bullet, the first line seeds the title/summary.
    // No byLang, so the customer-language copy is filled lazily on preview.
    if (!picked && selectedOptionId === CUSTOM_OPTION_ID) {
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
      // REQ-260 (M24): the message the contractor TYPED — still held in
      // pendingJobDetailsRaw until the line below overwrites it with the
      // bullets. Pricing reads it beside the confirmed bullets: the bullets
      // alone drop every stated cost and size, and a full bathroom gut came
      // back priced as a small job.
      const typedRaw = (pendingJobDetailsRaw ?? "").trim();
      confirmedOptionRef.current = {
        ...opt,
        jobName,
        summary,
        bullets: live,
      };
      // Confirm picker → price capture: snapshot the picker so back reopens it.
      pushHistory();
      setPendingJobDetailsRaw(description || summary);
      setJobOptionsOpen(false);
      setPickerMode("polish");
      setPriceCaptureOpen(true);
      setPriceSuggestions(null);
      void fetchPriceSuggestions(
        typedRaw || description || summary,
        description || summary,
      );
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
        // REQ-276: a translated / pre-generated name is stored in its
        // language's casing ("Corte de césped", never "Corte De Césped").
        if (!nameEdited && b?.jobName?.trim()) {
          nameByLang[ol] = jobNameCase(b.jobName, ol as Lang);
        } else if (jobName) {
          try {
            const res = await assistantClient.translate(
              [jobName],
              ol as "en" | "es",
            );
            nameByLang[ol] = jobNameCase(
              res?.texts?.[0] ?? jobName,
              ol as Lang,
            );
          } catch {
            nameByLang[ol] = jobName;
          }
        }
      }
      const hasName = Object.keys(nameByLang).length > 0;
      const hasSumm = Object.keys(summByLang).length > 0;
      if (quoteId) {
        // The picked summary renames the quote's lone summary line; an
        // itemised quote (REQ-259) keeps the lines the user typed.
        const items = quote?.lineItems?.length === 1
          ? [{ ...quote.lineItems[0], description: summary }]
          : undefined;
        const saved = await quotesClient.update(quoteId, {
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
              // REQ-579 (cycle 4, m7): the picked name is the job's one
              // name — the header reads it now, as the list does.
              jobName,
              ...(hasName ? { jobNameByLang: nameByLang } : {}),
              description: description || summary,
              ...(hasByLang ? { descriptionByLang: descByLang } : {}),
              lineItems: items ?? q.lineItems,
              ...revisionStateOf(saved), // REQ-248
            }
            : q
        );
      }
      // REQ-579 (cycle 4, m7): the server re-titles the thread from the
      // quote's new jobName (REQ-447 bindQuote) — one name in the header,
      // the list and the thread title.
      if (quoteId && convoId) {
        const conv = await api.post<{ title?: string }>(
          `/agents/conversations/${convoId}/draft`,
          { quoteId },
        ).catch(() => undefined);
        if (conv?.title) setConvTitle(conv.title);
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
      migrateDraftStack(id);
      if (typeof globalThis.history !== "undefined") {
        globalThis.history.replaceState(null, "", `/assistant/${id}`);
      }
      const saved = await api.post<{ title?: string; preview?: string }>(
        `/agents/conversations/${id}/draft`,
        { note },
      );
      // REQ-580 (demo-loop cycle 4, p4-p7b): the note titled the thread —
      // the list names it now, never "New conversation —".
      publishThreadTurn(id, saved);
    } catch {
      // Best-effort: a failed mint must never block the flow the user is in.
    }
  }

  function submitJobDetails(
    raw: string,
    /** REQ-656: what the server already read from the words (amount, who
     *  to bill) and the flow's own pricing mode — the caller's state may
     *  not have rendered yet. */
    given: {
      priceCents?: number;
      customerName?: string;
      suggestPricing?: boolean;
    } = {},
  ) {
    const trimmed = raw.trim();
    if (sending || !trimmed) return;
    const pricingFirst = given.suggestPricing ?? suggestPricing;
    setError(undefined);
    void ensureConversationForDraft(trimmed);
    pushHistory();
    setPendingJobDetailsRaw(trimmed);
    setSubmittedJobDetails(trimmed);
    setOriginalRaw(trimmed);
    setAwaitingJobDetails(false);
    // UX-04/UX-32: the sentence often already answers the next questions
    // ("…para la familia Nguyen, $3,700 todo incluido") — seed the price
    // picker and the customer step instead of asking again from $0.
    const extracted = extractQuickQuotePrefill(trimmed);
    const prefill = {
      ...extracted,
      priceCents: given.priceCents ?? extracted.priceCents,
      customerName: given.customerName ?? extracted.customerName,
    };
    if (prefill.priceCents && !pricingFirst) {
      setPriceCents(prefill.priceCents);
    }
    // REQ-389 (demo m31): the typed amount sizes the pad's quick chips.
    setPrefillPriceCents(pricingFirst ? null : prefill.priceCents ?? null);
    setPrefillCustomerName(prefill.customerName);
    setPrefillServiceAddress(prefill.serviceAddress);
    setPrefillLines(prefill.lines);
    if (pricingFirst) {
      // "Help me price it" (roadmap p.18): confirm the job details FIRST,
      // then price the confirmed scope. The picker's Continue advances to
      // the pricing screen via applyJobOption's confirm branch.
      void openJobPickerForConfirm(trimmed);
    } else {
      setPriceCaptureOpen(true);
    }
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
      quoteId?: string;
    };
    if (payload.toPhase === "terms") {
      if (!convoId) return;
      pushHistory(); // NW-19 (REQ-005): entering the wizard is a forward move.
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
      // look the agreement over before sending. Hydrate quote+customer
      // state if we don't already have them (mid-session wizard runs land
      // here without page-load quote data).
      const ctaQuoteId = payload.quoteId ?? quote?.id ?? quoteId;
      if (!convoId || !ctaQuoteId) {
        setError("quote is not ready yet");
        return;
      }
      if (!quote || quote.id !== ctaQuoteId || !customer) {
        setError(undefined);
        setSending(true);
        try {
          const detail = await assistantClient.conversation(convoId);
          if (detail.customer) setCustomer(detail.customer);
          const qId = (detail.conversation as { quoteId?: string } | undefined)
            ?.quoteId ?? detail.quote?.id ?? ctaQuoteId;
          if (qId) setQuoteId(qId);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "couldn't load the quote",
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
      // REQ-024: an invoice wizard's CTA opens the preview in invoice mode.
      if ((payload as { docKind?: string }).docKind === "invoice") {
        setReviewDocType("invoice");
      }
      if (needsJobPolish) {
        pendingReviewCtaRef.current = message.id;
        void openJobPicker();
        return;
      }
      setPreviewCtaId(message.id);
      return;
    }
    if (payload.toPhase === "invoice") {
      // Closing handoff: quote is accepted, draft + send the invoice.
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
   * Dev-only: flip the quote to "accepted" via AcceptQuote — the
   * single customer-facing acceptance event in the chain. The server
   * appends a phase_divider ("Accepted by client") + a
   * "Continue to invoice" CTA, sets hasUnreadEvent, and bumps preview;
   * we splice those into the chat in-place so the user can see the
   * progression without a navigation jump.
   */
  async function simulateCustomerAccept(targetQuoteId: string | undefined) {
    if (sending || !convoId || !targetQuoteId) return;
    setError(undefined);
    setSending(true);
    try {
      const res = await assistantClient.acceptQuote(convoId, targetQuoteId);
      if (res.newMessages?.length) {
        setMessages((m) => [...m, ...res.newMessages]);
      }
      setQuote((q) => (q ? { ...q, status: "accepted" } : q));
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
   * then re-fire SendQuote on the same channel so the doc actually
   * reaches the client. Used by the recovery form rendered below a
   * delivery-failure phase_divider.
   */
  async function saveContactAndRetry(
    dividerId: string,
    args: { quoteId: string; channel: "email" | "sms" | "both" },
  ) {
    if (!convoId || !customer?.id) return;
    const draft = recoveryDraft[dividerId] ?? {};
    const email = draft.email?.trim();
    const phone = draft.phone?.trim();
    if (!email && !phone) return;
    // REQ-603 (demo M23): check before the PUT — a letter or a short number
    // is shown under its box (and Save is disabled), never sent to the server.
    const fieldErrs = recoveryContactErrors({ email, phone });
    if (fieldErrs.phone || fieldErrs.email) return;

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
      const res = await assistantClient.sendQuoteFlow(
        convoId,
        args.quoteId,
        args.channel,
      );
      // REQ-236: the resend's outcome — "sent" only if it delivered.
      setQuote((q) =>
        q ? applySendOutcome(q, sendOutcomePayload(res.newMessages)) : q
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
      // REQ-603 (demo M23, as REQ-399): copy, never lib/api's transport line.
      setError(tFor(lang, contactSaveErrorKey(err)));
    } finally {
      setRecoverySavingId(null);
    }
  }

  /**
   * Fire the post-wizard "Ready to send" CTA: dispatches the assembled
   * Quote + Agreement to the customer via the SendQuote coordinator on the
   * requested channel (text, email, or both). State is idempotent
   * server-side; delivery is once per `requestId` (REQ-399). Runs only under
   * keepAndSend's `sendInFlight` lock.
   */
  async function sendQuoteNow(
    message: Message,
    channel: "email" | "sms" | "both",
    language: "en" | "es" | undefined,
    requestId: string,
  ) {
    if (!convoId) return;
    const payload = (message.payload ?? {}) as { quoteId?: string };
    let id = payload.quoteId ?? quote?.id ?? quoteId;
    setError(undefined);
    setSending(true);
    try {
      if (!id) {
        const detail = await assistantClient.conversation(convoId);
        id = detail.quote?.id ??
          (detail.conversation as { quoteId?: string } | undefined)?.quoteId;
      }
      if (!id) throw new Error("no quote bound to this conversation");
      const res = await assistantClient.sendQuoteFlow(
        convoId,
        id,
        channel,
        language,
        requestId,
      );
      setReviewedCtas((prev) => {
        const next = new Set(prev);
        next.add(message.id);
        return next;
      });
      // REQ-236 (demo M8): a 200 is not a delivery — the quote reads "sent"
      // only when the divider says a channel delivered it.
      // REQ-248: the send published whatever was pending
      const publishedVersion = (res.newMessages ?? [])
        .map((m) =>
          (m.payload as { publishedVersion?: number } | undefined)
            ?.publishedVersion
        )
        .find((v) => typeof v === "number");
      setQuote((q) => {
        if (!q) return q;
        const next = applySendOutcome(q, sendOutcomePayload(res.newMessages));
        return publishedVersion
          ? { ...next, pendingRevision: undefined, version: publishedVersion }
          : next;
      });
      setPreviewCtaId(null);
      if (res.newMessages?.length) {
        setMessages((m) => [...m, ...res.newMessages]);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "couldn't send the quote",
      );
    } finally {
      setSending(false);
    }
  }

  /**
   * Save an inline edit to the grand total. The user types a money value
   * into the `.quote-review__total-amt` span; strip non-numeric chars and
   * convert to cents. Persistence:
   *   - PUT /quotes/:id  — `estimatedTotal` is the canonical agreement
   *     total the preview reads from (`totalCentsForBreakdown`), so
   *     updating it refreshes the displayed total + recomputes payment
   *     milestones.
   *   - Also patch the action_card payload's `totalCents` so the
   *     on-screen total reflects the edit.
   * Line items are NOT touched — the Subtotal row keeps showing the line
   * sum so the user sees the override delta.
   */
  async function onEditTotal(
    quoteId: string | undefined,
    actionCardId: string | undefined,
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
      // REQ-248: an issued quote's edit is a pending revision — keep what
      // the server says so the card can say it is not published yet.
      const saved = await quotesClient.update(quoteId, {
        estimatedTotal: nextCents,
      });
      setQuote((cur) =>
        cur
          ? ({
            ...cur,
            estimatedTotal: nextCents,
            ...revisionStateOf(saved),
          } as typeof cur)
          : cur
      );
      if (actionCardId) {
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

  /**
   * REQ-037 (NW-43b) / REQ-308: the send dialog's Send. Saves any contact typed inline
   * to the customer (so this send AND every later alert have both channels),
   * refuses to send a channel the customer still can't receive, then sends
   * on the chosen channel.
   */
  function keepAndSend(
    m: Message,
    previewLang: Lang,
    totalCents: number,
  ) {
    // REQ-399 (demo M16): checked and set before the first await, so the
    // second click of a double-click does nothing — no second PUT, no second
    // send. sendQuoteNow / sendInvoiceSwapNow run only under this lock; the
    // requestId lets the server drop a repeat that still gets through.
    return runExclusive(sendInFlight, async () => {
      const ch = dialogChannel;
      const email = dialogEmail.trim();
      const phone = dialogPhone.trim();
      const needsEmail = ch !== "sms" && !customer?.email;
      const needsPhone = ch !== "email" && !customer?.phoneNumber;
      // REQ-308 (demo M3): name the contact that is actually missing, in the
      // app's language — previewLang is the document's, not the dialog's.
      // REQ-399 (demo M17): then the format of what was typed, so
      // "bob at gmail" never reaches PUT /customers.
      const invalid = sendDialogErrorKey(ch, customer ?? undefined, {
        email,
        phone,
      });
      if (invalid) {
        setDialogErr(tFor(lang, invalid));
        return;
      }
      setDialogErr(undefined);
      setSending(true);
      try {
        if (customer?.id && (email || phone)) {
          try {
            const patch: Record<string, unknown> = {
              ...(needsEmail && email ? { email } : {}),
              ...(needsPhone && phone ? { phoneNumber: phone } : {}),
            };
            await clientsClient.update(customer.id, patch);
            setCustomer((c) => c ? { ...c, ...patch } as typeof c : c);
          } catch (err) {
            // REQ-399 (demo M17): dictionary copy — never lib/api's
            // "PUT /customers/<id> failed: 400".
            setDialogErr(tFor(lang, contactSaveErrorKey(err)));
            return;
          }
        }
        setSendChannel(ch);
        setSendDialogOpen(false);
        if (reviewDocType === "invoice") {
          await sendInvoiceSwapNow(ch, totalCents);
        } else {
          await sendQuoteNow(m, ch, previewLang, newSendRequestId());
        }
      } finally {
        setSending(false);
      }
    });
  }

  // Pick a new option for an already-answered wizard term. Patches the
  // quote's terms[] entry by stepId and PUTs the quote — does NOT
  // rewind the wizard state. The chat-history wizard answer message stays
  // as-is (historical record); the quote reflects the latest pick and
  // the preview reads from quote.terms going forward.
  async function pickTermOption(
    targetQuoteId: string | undefined,
    stepId: string,
    label: string,
    optionLabel: string,
  ) {
    if (!targetQuoteId) return;
    setEditingTermStepId(null);
    try {
      const q = await quotesClient.get(targetQuoteId);
      const rawTerms = (q as unknown as {
        terms?: { stepId: string; label: string; value: string }[];
      }).terms;
      const existing = Array.isArray(rawTerms) ? [...rawTerms] : [];
      const idx = existing.findIndex((t) => t.stepId === stepId);
      const nextTerm = { stepId, label, value: optionLabel };
      const terms = idx === -1
        ? [...existing, nextTerm]
        : existing.map((t, i) => (i === idx ? nextTerm : t));
      await quotesClient.update(targetQuoteId, { terms });
      // Reflect the pick on local quote state so the preview re-renders
      // without a reload. Don't append a synthetic chat message — that
      // would render as an out-of-order "Payment terms: 50/50 ✓" log
      // *after* the sent CTA, which looks like a bug.
      setQuote((cur) => (cur ? ({ ...cur, terms } as typeof cur) : cur));
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
    pushHistory(); // NW-19 (REQ-005): "Lock it in" is a forward move.
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
      // REQ-464 (m33): the card Edit targeted is locked now — a composer
      // still holding only "Change the quote: " is cleared.
      setDraft((d) => dropBareEditSeed(d, editSeed));
      setEditSeed(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't lock the quote");
    } finally {
      setSending(false);
    }
  }

  /**
   * REQ-334 (demo-loop cycle 1, M25): the locked card's "Re-open" — the
   * inverse of lockActionCard. It used to post the chat text "Re-open the
   * quote." which nothing handled (the terms prompt answered it with "Tap
   * \"Re-open the quote\" to go back to phase 1"). Now a locked quote is
   * re-opened for real on the server (leave the wizard, drop the locked card
   * + CTA, clear lockedAt) and the transcript reloads on the draft card with
   * Lock it in / Edit. A quote already SENT can't be un-sent: the change
   * goes down the revision path, so Re-open seeds the composer with the
   * "Change the quote: " prompt (REQ-238).
   */
  async function reopenActionCard(message: Message, payload: ActionCardPayload) {
    if (sending || !convoId || !payload.quoteId) return;
    // REQ-563 (cycle 4, m3): the live quote decides, not the card's snapshot
    // — a "locked" card whose quote went out revises; a signed one does nothing.
    const action = cardReopenAction(
      payload.status,
      liveCardQuote(payload, ruleQuote),
    );
    if (action === "revise") {
      openDraftEdit();
      return;
    }
    if (action !== "unlock") return;
    setError(undefined);
    setSending(true);
    setPreviewCtaId(null);
    try {
      const res = await assistantClient.reopenQuote(convoId, payload.quoteId);
      const snap = await assistantClient.conversation(convoId);
      if (snap && Array.isArray(snap.messages)) {
        setMessages(snap.messages);
      } else {
        const gone = new Set([message.id, ...res.removedMessageIds]);
        setMessages((m) => [...m.filter((x) => !gone.has(x.id)), ...res.newMessages]);
      }
      // The chat header reads quote.lockedAt — drop the stamp locally too.
      setQuote((cur) =>
        cur && cur.id === payload.quoteId ? { ...cur, lockedAt: null } : cur
      );
      // REQ-464 (m33): a stale Edit seed doesn't carry across the re-open.
      setDraft((d) => dropBareEditSeed(d, editSeed));
      setEditSeed(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't re-open the quote");
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
      /** REQ-263: the job address from the step's form. */
      serviceAddress?: string;
      customer?: {
        id?: string;
        create?: {
          name: string;
          email?: string;
          phoneNumber?: string;
          isBusiness?: boolean;
          businessName?: string;
          allowDuplicate?: boolean; // REQ-331
        };
      };
    },
  ) {
    await postWizardAnswer(message, {
      stepId: "customer",
      optionId,
      ...(payload ?? {}),
    });
    // REQ-263: the step may have set the job address (typed, or the picked
    // customer's own) — reflect it in the preview without a reload.
    const qid = quote?.id;
    if (qid) {
      quotesClient.get(qid).then((q) =>
        setQuote((cur) =>
          cur && cur.id === qid
            ? { ...cur, serviceAddress: q.serviceAddress }
            : cur
        )
      ).catch(() => {/* preview keeps what it had */});
    }
  }

  /** Shared post-and-replace flow for any wizard answer. */
  async function postWizardAnswer(
    message: Message,
    body: {
      stepId: string;
      optionId: string;
      customValue?: string;
      /** REQ-263: the customer step's job address. */
      serviceAddress?: string;
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
    // Leaving this step: snapshot it (view flags + server cursor) so back
    // restores it — the server is rewound to this step on pop.
    pushHistory();
    setMessages((m) => m.filter((x) => x.id !== message.id));
    try {
      const res = await assistantClient.answerWizard({
        conversationId: convoId,
        ...body,
      });
      // REQ-580 (demo-loop cycle 4, p4-p2d): the answer is the thread's new
      // preview — the list shows it now, not one answer behind.
      publishThreadTurn(convoId, res.conversation);
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
      // REQ-347 (demo M16): the last answer persists the terms onto the
      // quote — re-read it so the send card that opens next renders the
      // stored (English-base) terms, not the stale pre-wizard copy.
      const qid = quote?.id;
      if (qid) {
        quotesClient.get(qid).then((fresh) =>
          setQuote((cur) => mergeFreshTerms(cur, fresh))
        ).catch(() => {/* the transcript fallback still resolves by id */});
      }
    } catch (err) {
      // Prefer the server's own message ("customer contact must not match…",
      // "expected answer for…") over the transport line ("POST … failed: 500")
      // — this strip is user-facing.
      const serverMsg = err instanceof ApiError &&
          err.body && typeof err.body === "object" &&
          typeof (err.body as { message?: unknown }).message === "string"
        ? (err.body as { message: string }).message
        : undefined;
      setError(
        serverMsg ??
          (err instanceof Error ? err.message : "wizard answer failed"),
      );
      // Re-sync from the server instead of restoring the local card. The
      // local wizard card can be STALE (a lost response that actually
      // landed, a double tap, a second tab) — restoring it traps the user
      // in a loop where every answer is rejected as out-of-order while the
      // error stays invisible. The snapshot renders the step the server is
      // actually on; if the snapshot itself fails (offline), fall back to
      // restoring the card so the step isn't lost entirely.
      try {
        const snap = await assistantClient.conversation(convoId);
        if (snap && Array.isArray(snap.messages)) {
          setMessages(snap.messages);
          if (snap.customer) setCustomer(snap.customer);
        } else {
          setMessages((m) => [...m, message]);
        }
      } catch {
        setMessages((m) => [...m, message]);
      }
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
  async function goBackWizard(toStepIdx?: number) {
    if (sending || !convoId) return;
    setError(undefined);
    setSending(true);
    // From the review stage the preview IS the step being left: close it
    // here (the server deletes its send CTA) so the re-asked term question
    // is what the user lands on — never an empty thread.
    setPreviewCtaId(null);
    try {
      const res = await assistantClient.rewindWizard(convoId, {}, toStepIdx);
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
    taRef.current?.focus({ preventScroll: true });
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
    taRef.current?.focus({ preventScroll: true });
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
    taRef.current?.focus({ preventScroll: true });
  }

  /**
   * "Job done, need to invoice." (roadmap p.3): the work already happened —
   * same easy details-first capture as the first starter, then the amount,
   * then a quick customer pick, and out comes a standalone invoice (no
   * signature, no terms).
   */
  function startInvoiceFlow(
    /** REQ-656 (demo-loop cycle 5, M9): the chat reply's offer — the typed
     *  words go straight in as the job details, with the amount and who to
     *  bill, so the flow opens at the price step prefilled. */
    prefill?: InvoiceFlowOffer,
  ) {
    pushHistory();
    setFlowChip("invoiceDone");
    setInvoiceFlow(true);
    setSuggestPricing(false);
    setPriceSuggestions(null);
    setPendingJobDetailsRaw(null);
    setAwaitingJobDetails(true);
    // UX-32: the app often already KNOWS what to invoice — offer the
    // accepted job(s) as tappable chips instead of opening with a cold
    // "¿De qué trabajo es la factura?".
    setAcceptedJobChips([]);
    void api.get<
      Array<{
        id?: string;
        customerId?: string | null;
        jobName?: string | null;
        summary?: string | null;
        customerName?: string | null;
        estimatedTotal?: number | null;
        stage?: string;
        status?: string;
        acceptedAt?: string | null;
        isSample?: boolean;
      }>
    >("/quotes").then((cards) => {
      const list = (Array.isArray(cards) ? cards : [])
        .filter((c) => c.isSample !== true)
        .filter((c) =>
          c.stage === "won" ||
          c.status === "accepted" || Boolean(c.acceptedAt)
        )
        .filter((c) => typeof c.id === "string" && c.id.length > 0)
        .slice(0, 3)
        .map((c) => ({
          id: c.id as string,
          ...(c.customerId ? { customerId: c.customerId } : {}),
          jobName: (c.jobName ?? c.summary ?? "").trim(),
          customerName: c.customerName ?? null,
          totalCents: c.estimatedTotal ?? 0,
        }))
        .filter((j) => j.jobName.length > 0);
      setAcceptedJobChips(list);
    }).catch(() => {});
    taRef.current?.focus({ preventScroll: true });
    if (prefill) {
      submitJobDetails(prefill.details, {
        ...(prefill.amountCents ? { priceCents: prefill.amountCents } : {}),
        ...(prefill.customerName
          ? { customerName: prefill.customerName }
          : {}),
        suggestPricing: false,
      });
    }
  }

  // REQ-656 (demo-loop cycle 5, M9): open the flow a reply asked for once
  // the turn is done (submitJobDetails ignores a busy chat).
  useEffect(() => {
    if (!pendingInvoiceFlow || sending || stepSending) return;
    const offer = pendingInvoiceFlow;
    setPendingInvoiceFlow(null);
    startInvoiceFlow(offer);
  }, [pendingInvoiceFlow, sending, stepSending]);

  /** UX-31: the reviewed save — fires only after the contractor confirmed
   *  the amount + due date on the review step. */
  /**
   * REQ-023 (NW-14 / NW-15): picking an accepted job never asks for the
   * price or the customer again. Seed the review straight from the quote —
   * customer, line items, terms, agreement total — plus what has already
   * been billed and paid against it, with THIS invoice's amount editable
   * (default: the unbilled remainder).
   */
  async function openInvoiceFromAcceptedQuote(j: {
    id: string;
    customerId?: string;
    jobName: string;
    customerName?: string | null;
    totalCents: number;
  }) {
    if (sending) return;
    pushHistory();
    setError(undefined);
    setSending(true);
    try {
      const q = await quotesClient.get(j.id) as QuoteCard & {
        terms?: Array<{ stepId: string; label: string; value: string }>;
      };
      const customerId = q.customerId ?? j.customerId;
      let customerName = q.customerName ?? j.customerName ?? undefined;
      let custEmail: string | undefined;
      let custPhone: string | undefined;
      if (customerId) {
        // GET /customers/:id — the list endpoint answers one page (REQ-135),
        // which has no .find; the old call always fell through to undefined.
        const picked = await clientsClient.get(customerId)
          .catch(() => undefined);
        custEmail = picked?.email ?? undefined;
        custPhone = picked?.phoneNumber ?? undefined;
        customerName = picked?.name ?? customerName;
      }
      const existing = await api
        .get<Array<{ quoteId?: string; amount?: number; status?: string }>>("/invoices")
        .catch(() => []);
      const siblings = (Array.isArray(existing) ? existing : [])
        .filter((i) => i.quoteId === q.id);
      const billed = billedTotalCents(siblings);
      const paid = siblings
        .filter((i) => i.status === "paid")
        .reduce((sum, i) => sum + Math.round(i.amount ?? 0), 0);
      const agreementTotal = q.estimatedTotal ?? j.totalCents;
      const remaining = Math.max(agreementTotal - billed, 0);
      const jobName = q.jobName ?? j.jobName;
      setSubmittedJobDetails(jobName);
      setPendingJobDetailsRaw(q.description ?? jobName);
      setAwaitingJobDetails(false);
      setPriceCaptureOpen(false);
      setPendingPriceCents(remaining > 0 ? remaining : agreementTotal);
      setInvoiceDueDate(
        new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      );
      setInvoiceReview({
        customerId: customerId ?? "",
        ...(customerName ? { customerName } : {}),
        ...(custEmail ? { custEmail } : {}),
        ...(custPhone ? { custPhone } : {}),
        quoteId: q.id,
        jobName,
        ...(q.description ? { description: q.description } : {}),
        ...(q.lineItems ? { lineItems: q.lineItems } : {}),
        ...(q.terms ? { terms: q.terms } : {}),
        agreementTotalCents: agreementTotal,
        billedCents: billed,
        paidCents: paid,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't load the quote");
    } finally {
      setSending(false);
    }
  }

  async function saveInvoiceFromReview() {
    if (sending || !invoiceReview) return;
    const cents = pendingPriceCents ?? 0;
    if (cents <= 0) {
      setError(tFor(lang, "asstChat.invoiceFlow.noAmount"));
      return;
    }
    setError(undefined);
    setSending(true);
    try {
      const raw = (pendingJobDetailsRaw ?? "").trim();
      // UX-29: the shared lang-aware derivation — never a bare 3-word slice
      // ("El patio de") headlining the customer's invoice.
      const jobName = (raw
        ? summarizeJobName(raw.split("\n")[0] ?? raw, lang)
        : "") || tFor(lang, "asstChat.newJob");
      const today = new Date().toISOString().slice(0, 10);
      // REQ-023: an invoice derived from an accepted quote carries the link
      // (quoteId) plus the quote's line items and job details, so /i/:id
      // renders the terms and the signed-agreement link.
      const fromQuote = invoiceReview.quoteId
        ? {
          quoteId: invoiceReview.quoteId,
          ...(invoiceReview.lineItems && invoiceReview.lineItems.length > 0
            ? { lineItems: invoiceReview.lineItems }
            : {}),
        }
        : {};
      const inv = await api.post<{ id?: string }>("/invoices", {
        ...(invoiceReview.customerId
          ? { customerId: invoiceReview.customerId }
          : {}),
        ...fromQuote,
        amount: cents,
        ...(invoiceDueDate ? { dueDate: invoiceDueDate } : {}),
        issuedDate: today,
        // The invoice send endpoints do not stamp invoice status (unlike the
        // quote send path), so the flow marks it sent up front as before.
        status: "sent",
        jobName: invoiceReview.jobName ?? jobName,
        ...(invoiceReview.description
          ? { description: invoiceReview.description }
          : raw
          ? { description: raw }
          : {}),
      });
      if (!inv?.id) throw new Error("failed to create invoice");
      setInvoiceReview(null);
      setInvoiceResult({
        id: inv.id,
        ...(invoiceReview.custEmail
          ? { customerEmail: invoiceReview.custEmail }
          : {}),
        ...(invoiceReview.custPhone
          ? { customerPhone: invoiceReview.custPhone }
          : {}),
      });
    } catch (err) {
      setError(
        isExceedsAgreement(err)
          ? tFor(lang, "asstChat.invoiceFlow.alreadyBilled")
          : err instanceof Error
          ? err.message
          : "couldn't create the invoice",
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
  async function sendInvoiceSwapNow(
    channel: "email" | "sms" | "both",
    totalCents: number,
  ) {
    setError(undefined);
    setSending(true);
    try {
      let invId = swapInvoiceIdRef.current;
      if (!invId) {
        const today = new Date().toISOString().slice(0, 10);
        // REQ-024: the wizard just wrote the terms + completion date onto the
        // quote — read the LIVE row, never the copy loaded before the last step.
        const live = quote?.id
          ? await quotesClient.get(quote.id).catch(() => quote)
          : quote;
        const q = live as
          | (typeof quote & {
            estimatedCompletionDate?: string;
            terms?: Array<{ stepId: string; value: string }>;
          })
          | null;
        // REQ-233 (demo B2): bill only what the agreement still has
        // unbilled — a signed 50/50 quote already carries its deposit and
        // balance invoices, so the swap must never mint a full-total third.
        let amount = totalCents;
        if (q?.id) {
          const ledger = await api
            .get<{ remainingToInvoiceCents?: number }>(
              `/quotes/${q.id}/ledger`,
            )
            .catch(() => null);
          if (typeof ledger?.remainingToInvoiceCents === "number") {
            const left = swapInvoiceCents(
              totalCents,
              ledger.remainingToInvoiceCents,
            );
            if (left === null) {
              setError(tFor(lang, "asstChat.invoiceFlow.alreadyBilled"));
              return;
            }
            amount = left;
          }
        }
        const inv = await api.post<{ id?: string }>("/invoices", {
          ...(customer?.id ? { customerId: customer.id } : {}),
          // REQ-023: the swapped invoice is derived from the reviewed quote.
          ...(q?.id ? { quoteId: q.id } : {}),
          ...(q?.lineItems && q.lineItems.length > 0
            ? { lineItems: q.lineItems }
            : {}),
          amount,
          // REQ-024: due date from the wizard — completion date + payment
          // terms (Due Now → that day; payment upon completion → +15;
          // anything else → +30). Never "today" by default.
          dueDate: invoiceDueDateFromQuote(q, today),
          issuedDate: today,
          status: "sent",
          ...(q?.jobName ? { jobName: q.jobName } : {}),
          ...(q?.description ? { description: q.description } : {}),
        });
        if (!inv?.id) throw new Error("couldn't create the invoice");
        invId = inv.id;
        swapInvoiceIdRef.current = invId;
      }
      // P-09: the invoice send endpoints report logical failure as HTTP 200
      // + {ok:false, reason} — interpret the BODY, never just Response.ok
      // (the old `await` chain read every 200 as delivered). A failed leg
      // surfaces the same honest divider the quote-send path renders.
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
        isExceedsAgreement(err)
          ? tFor(lang, "asstChat.invoiceFlow.alreadyBilled")
          : err instanceof Error
          ? err.message
          : "couldn't send the invoice",
      );
    } finally {
      setSending(false);
    }
  }

  async function fetchPriceSuggestions(raw: string, scope?: string) {
    try {
      const res = await assistantClient.suggestPrices(raw, scope);
      setPriceBasis(res.basis ?? "labor_and_materials");
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

  // REQ-392 (demo-loop cycle 2, M7): which composer shows — the full one, the
  // compact "Tell the assistant…" box on a tap step, or none (invoice screens).
  const composer = composerMode({
    priceCaptureOpen,
    jobOptionsOpen,
    invoiceReviewOpen: invoiceReview !== null,
    invoiceResultOpen: invoiceResult !== null,
    awaitingJobDetails,
    previewOpen: previewCtaId !== null,
    messages,
  });
  const composerStepKey = composer.kind === "step"
    ? `${composer.step}:${composer.wizardStepId ?? ""}`
    : composer.kind;
  // A new step starts without the last step's answer and with its own price
  // box focus (REQ-041 NW-53f).
  useEffect(() => {
    setStepLog(null);
    setPriceSeedRev(0);
    setStepBoxOpenKey((k) => (k === composerStepKey ? k : null));
  }, [composerStepKey]);
  // Pick a price and the Job details picker own the panel and are bounded to
  // it (REQ-338: the picker fits at 1280×720), so their closed box is a
  // button in their own Continue row — no bar under the panel until tapped.
  const stepBoxDocked = composer.kind === "step" &&
    (composer.step === "price" || composer.step === "job_details");
  const stepBoxOpen = stepBoxOpenKey === composerStepKey;
  const stepBoxOpenButton = stepBoxDocked && !stepBoxOpen &&
      composer.kind === "step"
    ? (
      <StepComposerOpen
        step={composer.step}
        lang={lang}
        onOpen={() => setStepBoxOpenKey(composerStepKey)}
      />
    )
    : null;

  const empty = messages.length === 0;
  // A step panel restored by back (price capture, details entry, picker,
  // invoice steps) takes over the scroll area even on a thread that already
  // has messages — otherwise a popped pre-wizard snapshot would show nothing.
  const panelOpen = priceCaptureOpen || awaitingJobDetails || jobOptionsOpen ||
    invoiceReview !== null || invoiceResult !== null;
  welcomeRef.current = empty && !panelOpen;

  return (
    <>
      <LinkToast
        toast={linkToast}
        lang={lang}
        onDismiss={() => setLinkToast(null)}
        onMarkSent={(id) => void markSharedByLink(id)}
      />
      <div class="chat__scroll" ref={scrollRef}>
        {(empty || panelOpen)
          ? (
            <div
              class={`chat__empty${
                jobOptionsOpen ? " chat__empty--picker" : ""
              }`}
            >
              {!priceCaptureOpen && !awaitingJobDetails && !jobOptionsOpen &&
                !invoiceReview && !invoiceResult && (
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
                    {
                      /* REQ-577 (cycle 4, m38): this panel replaces the
                        message list, so in "help me price it" the message
                        she just sent would vanish while the options are
                        written. Her words open the panel as a user bubble,
                        in the loading and the loaded state alike. */
                    }
                    {pickerMode === "confirm" && submittedJobDetails
                      ? (
                        <div class="chat__details-user">
                          <div
                            class="chat__details-user-bubble"
                            data-cy="picker-user-bubble"
                          >
                            {submittedJobDetails}
                          </div>
                        </div>
                      )
                      : null}
                    <div class="chat__jobopts-head">
                      {
                        /* Single-back rule: no in-widget back button. The
                          header's universal back (pm:asst-back) undoes this
                          view — confirm mode returns to the details entry
                          with the typed text restored; polish mode closes
                          the picker (re-openable from the review CTA). */
                      }
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
                          {optionsDegraded
                            ? (
                              <p
                                class="chat__jobopts-degraded"
                                data-cy="jobopts-degraded"
                                role="status"
                              >
                                {tFor(lang, "asstChat.jobOpts.degraded")}
                              </p>
                            )
                            : null}
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
                                            {opt.style
                                              ? (
                                                // REQ-446 (m13): which version this is
                                                <span
                                                  class="chat__jobopt-style"
                                                  data-cy="jobopt-style"
                                                >
                                                  {versionStyleLabel(
                                                    opt.style,
                                                    lang,
                                                  )}
                                                </span>
                                              )
                                              : null}
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
                                              onOptionTap(
                                                {
                                                  kind: "titlePencil",
                                                  optionId: opt.id,
                                                },
                                                opt.jobName,
                                              );
                                            }}
                                          >
                                            <Icon name="pencil" size={14} style="display:block" />
                                          </button>
                                        </>
                                      )}
                                  </div>
                                  <ul class="chat__jobopt-bullets">
                                    {opt.bullets.map((b) => {
                                      const isEditing =
                                        editingBullet?.optionId === opt.id &&
                                        editingBullet?.bulletId === b.id;
                                      const offer =
                                        proOffer?.optionId === opt.id &&
                                          proOffer.bulletId === b.id &&
                                          !isEditing && !b.deleted
                                          ? proOffer
                                          : null;
                                      return (
                                        <Fragment key={b.id}>
                                        <li
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
                                                aria-pressed={selected}
                                                onClick={(e) => {
                                                  // REQ-335 (M31): a bullet
                                                  // tap SELECTS its card —
                                                  // editing lives on the
                                                  // pencil beside it.
                                                  e.stopPropagation();
                                                  onOptionTap({
                                                    kind: "bullet",
                                                    optionId: opt.id,
                                                    bulletId: b.id,
                                                  });
                                                }}
                                              >
                                                {b.text}
                                              </button>
                                            )}
                                          {isEditing || b.deleted ? null : (
                                            <button
                                              type="button"
                                              class="chat__jobopt-pencil"
                                              title={tFor(
                                                lang,
                                                "asstChat.jobOpts.editBullet",
                                              )}
                                              aria-label={tFor(
                                                lang,
                                                "asstChat.jobOpts.editBullet",
                                              )}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onOptionTap(
                                                  {
                                                    kind: "bulletPencil",
                                                    optionId: opt.id,
                                                    bulletId: b.id,
                                                    deleted: b.deleted,
                                                  },
                                                  b.text,
                                                );
                                              }}
                                            >
                                              <Icon name="pencil" size={14} style="display:block" />
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
                                              onOptionTap({
                                                kind: "delete",
                                                optionId: opt.id,
                                                bulletId: b.id,
                                              });
                                            }}
                                          >
                                            {b.deleted ? "↺" : "×"}
                                          </button>
                                        </li>
                                        {offer
                                          ? (
                                            // REQ-384 (m16): the offer sits
                                            // right under its line — never
                                            // a modal covering it.
                                            <li
                                              class="chat__pro-row"
                                              data-cy="polish-offer"
                                              onClick={(e) =>
                                                e.stopPropagation()}
                                            >
                                              <span class="chat__pro-row-msg">
                                                {tFor(
                                                  lang,
                                                  "asstChat.proPopup.msg",
                                                )}
                                              </span>
                                              <span class="chat__pro-row-diff">
                                                <s
                                                  class="chat__pro-row-before"
                                                  data-cy="polish-offer-before"
                                                >
                                                  {offer.before}
                                                </s>
                                                <span
                                                  class="chat__pro-row-arrow"
                                                  aria-hidden="true"
                                                >
                                                  →
                                                </span>
                                                <span
                                                  class="chat__pro-row-after"
                                                  data-cy="polish-offer-after"
                                                >
                                                  {offer.after.join("\n")}
                                                </span>
                                              </span>
                                              <span class="chat__pro-row-actions">
                                                <button
                                                  type="button"
                                                  class="chat__pro-row-no"
                                                  onClick={dismissPolish}
                                                >
                                                  {tFor(
                                                    lang,
                                                    "asstChat.proPopup.no",
                                                  )}
                                                </button>
                                                <button
                                                  type="button"
                                                  class="chat__pro-row-yes"
                                                  onClick={acceptPolish}
                                                >
                                                  {tFor(
                                                    lang,
                                                    "asstChat.proPopup.yes",
                                                  )}
                                                </button>
                                              </span>
                                            </li>
                                          )
                                          : null}
                                        </Fragment>
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
                                 click, advancing to the pricing options.
                                 REQ-381 (demo M20): the strip confirms the
                                 message it echoes (the contractor's own
                                 words), never the selected card — that is
                                 Continue's job.
                                 UX-41: the summary strip stays, but the
                                 standard button-styled advance control every
                                 other step renders comes back below it — the
                                 green strip alone read as a passive summary,
                                 not the step's way forward. */
                              <>
                                <button
                                  type="button"
                                  data-cy="confirm-details"
                                  class="chat__confirm-details"
                                  disabled={sending || stepSending}
                                  onClick={confirmOwnWords}
                                >
                                  <span class="chat__confirm-details-label">
                                    {sending
                                      ? tFor(lang, "asstChat.settingUp")
                                      : tFor(
                                        lang,
                                        "asstChat.confirmDetails.cta",
                                      )}
                                  </span>
                                  {pendingJobDetailsRaw
                                    ? (
                                      <span
                                        class={`chat__confirm-details-text${
                                          rawEchoOpen ? " is-open" : ""
                                        }`}
                                      >
                                        {/* REQ-659 (cycle 5, c1-M22): the
                                            echo never re-shows a private
                                            cost — amounts are masked. */}
                                        {redactMoney(pendingJobDetailsRaw)}
                                      </span>
                                    )
                                    : null}
                                  {/* REQ-338 (demo m31): the echo is clamped
                                      to three lines; this opens/closes it
                                      without confirming (the strip is the
                                      confirm button, so the click must not
                                      bubble). A span, not a button — a
                                      button inside a button is invalid. */}
                                  {pendingJobDetailsRaw &&
                                      isLongRawEcho(pendingJobDetailsRaw)
                                    ? (
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        data-cy="confirm-details-more"
                                        class="chat__confirm-details-more"
                                        aria-expanded={rawEchoOpen}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setRawEchoOpen((v) => !v);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setRawEchoOpen((v) => !v);
                                          }
                                        }}
                                      >
                                        {rawEchoOpen
                                          ? tFor(
                                            lang,
                                            "asstChat.confirmDetails.showLess",
                                          )
                                          : tFor(
                                            lang,
                                            "asstChat.confirmDetails.showMore",
                                          )}
                                      </span>
                                    )
                                    : null}
                                </button>
                                <div class="chat__step-actions">
                                  {stepBoxOpenButton}
                                  <button
                                    type="button"
                                    class="chat__price-continue"
                                    disabled={sending || stepSending}
                                    onClick={applyJobOption}
                                  >
                                    {sending
                                      ? (
                                        <>
                                          <span
                                            class="spinner"
                                            aria-hidden="true"
                                          />{" "}
                                          {tFor(lang, "asstChat.settingUp")}
                                        </>
                                      )
                                      : tFor(lang, "asstChat.continue")}
                                  </button>
                                </div>
                              </>
                            )
                            : (
                              <div class="chat__step-actions">
                                {stepBoxOpenButton}
                                <button
                                  type="button"
                                  class="chat__price-continue"
                                  disabled={!selectedOptionId || sending ||
                                    stepSending}
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
                              </div>
                            )}
                        </>
                      )}
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
                    {/* UX-32: one-tap chips for the accepted job(s) — the
                        facturar flow uses what the app already knows. */}
                    {flowChip === "invoiceDone" && !submittedJobDetails &&
                      acceptedJobChips.length > 0 && (
                      <div
                        class="chat__accepted-jobs"
                        style="display:flex;flex-direction:column;gap:8px;margin:10px 0 0"
                      >
                        {acceptedJobChips.map((j, i) => (
                          <button
                            type="button"
                            key={`${j.jobName}-${i}`}
                            class="chat__empty-prompt chat__accepted-job"
                            onClick={() => void openInvoiceFromAcceptedQuote(j)}
                          >
                            {acceptedJobChipLabel(j, lang)}
                          </button>
                        ))}
                      </div>
                    )}
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
                          {/* NW-17 (REQ-010): the pill is a sentence under the
                              prompt bubble — it ends with a period. The picker
                              tile keeps the period-less customTitle. */}
                          <Icon name="pencil" size={14} style="vertical-align:-2px" />{" "}
                          {tFor(lang, "asstChat.jobOpts.customCta")}
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
                : invoiceReview
                ? (
                  // UX-31: review BEFORE save — amount, customer, and an
                  // editable due date (+30-day default, like the /invoices
                  // modal). Nothing is persisted until the confirm click.
                  <div class="chat__price-capture">
                    {/* Single-back rule: the header back undoes this view
                      (invoice review → customer step). */}
                    <h3 class="chat__price-title">
                      {tFor(lang, "asstChat.invoiceFlow.reviewTitle")}
                    </h3>
                    {/* REQ-023 (NW-14/15): derived from an accepted quote —
                        the review already knows the job, the customer, the
                        terms, and the money so far. */}
                    {invoiceReview.quoteId && (
                      <div
                        data-cy="invoice-quote-summary"
                        style="margin:10px 0 0;padding:12px 14px;border:1px solid var(--border,#d8dcd5);border-radius:12px;background:rgba(0,0,0,0.02);font-size:13.5px;line-height:1.6"
                      >
                        <div style="font-weight:800;font-size:15px;color:var(--fg,#144852)">
                          {invoiceReview.jobName}
                        </div>
                        {invoiceReview.customerName && (
                          <div>
                            {tFor(lang, "asstChat.preview.for")}: {invoiceReview.customerName}
                          </div>
                        )}
                        {(invoiceReview.lineItems ?? []).length > 0 && (
                          <ul style="margin:6px 0 0;padding-left:18px">
                            {(invoiceReview.lineItems ?? []).map((li, i) => (
                              <li key={i}>
                                {li.description}
                                {" — $"}
                                {(((li.price ?? 0) * (li.quantity ?? 1)) / 100)
                                  .toLocaleString("en-US")}
                              </li>
                            ))}
                          </ul>
                        )}
                        {(invoiceReview.terms ?? []).filter((t) => t.stepId !== "customer").length > 0 && (
                          <div style="margin-top:6px">
                            <div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--fg-muted,#6b7560)">
                              {tFor(lang, "asstChat.invoiceFlow.terms")}
                            </div>
                            {(invoiceReview.terms ?? [])
                              .filter((t) => t.stepId !== "customer")
                              .map((t) => (
                                <div key={t.stepId}>
                                  {t.label}: {localizeTermValue(t.value, lang)}
                                </div>
                              ))}
                          </div>
                        )}
                        <div style="margin-top:6px;border-top:1px solid var(--border,#d8dcd5);padding-top:6px">
                          <div>
                            {tFor(lang, "asstChat.invoiceFlow.agreementTotal")}:{" "}
                            <strong>
                              ${((invoiceReview.agreementTotalCents ?? 0) / 100).toLocaleString("en-US")}
                            </strong>
                          </div>
                          <div data-cy="invoice-billed-so-far">
                            {tFor(lang, "asstChat.invoiceFlow.billedSoFar")}:{" "}
                            ${((invoiceReview.billedCents ?? 0) / 100).toLocaleString("en-US")}
                          </div>
                          <div data-cy="invoice-paid-so-far">
                            {tFor(lang, "asstChat.invoiceFlow.paidSoFar")}:{" "}
                            ${((invoiceReview.paidCents ?? 0) / 100).toLocaleString("en-US")}
                          </div>
                        </div>
                      </div>
                    )}
                    <div style="margin:10px 0;font-size:14px;line-height:1.6">
                      {invoiceReview.quoteId
                        ? (
                          <label style="display:block;font-size:12px;font-weight:700;color:var(--fg-muted,#6b7560)">
                            {tFor(lang, "asstChat.invoiceFlow.thisInvoice")}
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              data-cy="invoice-flow-amount"
                              value={String((pendingPriceCents ?? 0) / 100)}
                              onInput={(e) => {
                                const n = Number((e.target as HTMLInputElement).value);
                                setPendingPriceCents(Number.isFinite(n) ? Math.round(n * 100) : 0);
                              }}
                              style="display:block;margin-top:6px;padding:10px 12px;border:1px solid var(--border,#d8dcd5);border-radius:10px;font:inherit;font-size:16px;font-weight:800;width:100%;box-sizing:border-box"
                            />
                          </label>
                        )
                        : (
                          <div>
                            <strong>
                              ${((pendingPriceCents ?? 0) / 100).toLocaleString(
                                "en-US",
                              )}
                            </strong>
                            {invoiceReview.customerName
                              ? ` — ${invoiceReview.customerName}`
                              : ""}
                          </div>
                        )}
                      <label style="display:block;margin-top:10px;font-size:12px;font-weight:700;color:var(--fg-muted,#6b7560)">
                        {tFor(lang, "asstChat.invoiceFlow.dueDateLabel")}
                        <input
                          type="date"
                          data-cy="invoice-flow-due"
                          value={invoiceDueDate}
                          onInput={(e) =>
                            setInvoiceDueDate(
                              (e.target as HTMLInputElement).value,
                            )}
                          style="display:block;margin-top:6px;padding:10px 12px;border:1px solid var(--border,#d8dcd5);border-radius:10px;font:inherit"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      class="chat__price-continue"
                      data-cy="invoice-flow-save"
                      disabled={sending || !invoiceDueDate}
                      onClick={() => void saveInvoiceFromReview()}
                    >
                      {sending
                        ? (
                          <>
                            <span class="spinner" aria-hidden="true" />{" "}
                            {tFor(lang, "asstChat.settingUp")}
                          </>
                        )
                        : tFor(lang, "asstChat.invoiceFlow.saveCta")}
                    </button>
                  </div>
                )
                : priceCaptureOpen
                ? (
                  <div class="chat__price-capture">
                    <div class="chat__price-capture-head">
                      {/* Single-back rule: the header back undoes this view
                        (price capture → details entry, wizardStepBack). */}
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
                          {/* REQ-387 (demo M25): on the know-my-price path
                              these are the raw words — the Job Details
                              picker rewrites them at the end of the
                              wizard, before the review. Say so. */}
                          {!suggestPricing && !confirmedOptionRef.current
                            ? (
                              <span
                                class="chat__price-details-recap-note"
                                data-cy="price-details-tidy-note"
                              >
                                {tFor(lang, "asstChat.price.tidyNote")}
                              </span>
                            )
                            : null}
                        </div>
                      )
                      : null}
                    {/* Roadmap p.10: three suggested tiers (+ custom input). */}
                    {suggestPricing && (
                      <div
                        class="chat__price-tiers"
                        style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px"
                      >
                        {/* REQ-017 (NW-12): say what the numbers include. */}
                        <div
                          data-cy="pricing-basis"
                          class="chat__price-basis"
                          style="font-size:12px;color:var(--fg-muted,#6b7560);padding:0 2px"
                        >
                          {tFor(
                            lang,
                            priceBasis === "labor_materials_as_noted"
                              ? "suggestPrices.basis.laborMaterialsAsNoted"
                              : "suggestPrices.basis.laborAndMaterials",
                          )}
                        </div>
                        {priceSuggestions === null
                          ? (
                            <div style="font-size:13px;color:var(--fg-muted,#6b7560);padding:6px 2px">
                              {tFor(lang, "asstChat.price.pricing")}
                            </div>
                          )
                          : priceSuggestions.map((t, i) => {
                            // REQ-449 (m48): a tap selects; Continue moves on.
                            const picked = i ===
                              selectedTierIndex(priceSuggestions, priceCents);
                            return (
                            <button
                              key={t.tier}
                              type="button"
                              data-cy="pricing-option"
                              class={picked
                                ? "chat__price-tier is-selected"
                                : "chat__price-tier"}
                              aria-pressed={picked}
                              disabled={sending || stepSending}
                              onClick={() => selectPriceTier(t.priceCents)}
                              style={`display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;padding:12px 14px;border-radius:12px;cursor:pointer;font:inherit;${
                                picked
                                  ? "border:2px solid var(--brand-green,#519843);background:var(--brand-green-50,#eef6ec)"
                                  : "border:1px solid var(--border,#d8dcd5);background:#fff"
                              }`}
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
                            );
                          })}
                        {/* 4th option (roadmap p.16): custom price — clicking
                            focuses the MoneyInput below so the contractor can
                            type their own number and press Enter. */}
                        <button
                          type="button"
                          data-cy="pricing-option-custom"
                          class="chat__price-custom-cta"
                          disabled={sending || stepSending}
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
                        // UX-04: seed the picker with the $-amount the user
                        // already typed; key remounts it per details text so
                        // a re-entered flow never shows a stale value.
                        // REQ-392: and with the price a correction named.
                        key={`${pendingJobDetailsRaw ?? "blank"}#${priceSeedRev}`}
                        initialCents={priceCents ?? 0}
                        // REQ-329 (demo p15-13): the quick chips scale to the
                        // AI's market price instead of a fixed $50…$5k.
                        anchorCents={priceAnchorCents}
                        // REQ-041 (NW-53f): the number field is focused in
                        // the help-me-price flow too — when the step opens,
                        // not when a correction re-seeds it (REQ-392: the
                        // contractor is typing in the step composer then).
                        autoFocus={priceSeedRev === 0}
                        onChange={setPriceCents}
                        onSubmit={(cents) => {
                          if (sending || stepSending) return;
                          onPriceContinue(cents);
                        }}
                      />
                    </div>
                    <div class="chat__step-actions">
                      {stepBoxOpenButton}
                      <button
                        type="button"
                        class="chat__price-continue"
                        disabled={(priceCents ?? 0) <= 0 || sending ||
                          stepSending}
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
                      onClick={() => startInvoiceFlow()}
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
              // REQ-318 (demo m50): the live view drops the draft card on
              // "Lock it in" and the terms CTA once Business/Person is
              // answered; the server keeps both, so hide them on reload
              // too instead of showing a dimmed "Superseded" card and live
              // buttons for an already-answered question.
              const hiddenOnReload = hiddenOnReloadIds(messages);
              // REQ-589 (demo-loop cycle 4, M15 / m15): a server-written
              // line (wizard question + options, pick line, dividers, the
              // send reason) re-renders from its i18n key in the live
              // language; rows without a key render as stored.
              const visible = messages.map((m) =>
                localizeChatMessage(m, lang, tFor)
              ).filter((m) => {
                if (hiddenOnReload.has(m.id)) return false;
                if (m.kind !== "wizard") return true;
                const stepId = (m.payload as { stepId?: string } | undefined)
                  ?.stepId;
                if (stepId && answeredStepIds.has(stepId)) return false;
                return m.id === activeWizardId;
              });
              // The recovery form should appear ONLY on the most recent
              // failure-divider — otherwise older failures duplicate the
              // form everywhere and clutter the thread.
              // REQ-236: only the NEWEST send divider can carry it — a good
              // resend retires the older failure and its form.
              // REQ-403 (m11): and none once the customer has signed.
              const recoveryDividerId = lastRecoveryDividerId(
                visible,
                customer,
                { accepted: quoteAccepted },
              );
              // REQ-388 (demo-loop cycle 2, M23): a pricing answer offers
              // the draft — on the newest message, while no quote is bound.
              const draftOffer = liveDraftOffer(visible, quoteId);
              // REQ-656 (demo-loop cycle 5, M9): "job done, invoice X" —
              // the reply's invoice flow, on the newest message, while no
              // job is bound (it opened on arrival; this reopens it).
              const invoiceFlowOffer = liveInvoiceFlowOffer(visible, quoteId);
              // REQ-452 (demo cycle 3, p8-pair7-b): a sent / "Couldn't send"
              // CTA is drawn at its send divider, not where the wizard left
              // it — below anything typed on the review step before the send.
              // The CTA still reads its outcome from `visible` (unchanged).
              const ordered = orderSendOutcomes(
                visible,
                (x) => reviewedCtas.has(x.id) || settledCtas.has(x.id),
              );
              // REQ-571 (demo cycle 4, p4-p2c): one customer-link row per
              // quote — on the newest divider / sent card that carries it,
              // never one on the card AND one under the send divider.
              const linkOwners = customerLinkOwnerIds(
                ordered,
                (p: ActionCardPayload) =>
                  cardShowsCustomerLink(
                    p.status,
                    ruleQuote && p.quoteId === ruleQuote.id
                      ? ruleQuote
                      : undefined,
                  ),
              );
              return ordered.map((m) => {
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
                    quoteId?: string;
                    channel?: "email" | "sms" | "both";
                    emailedTo?: string;
                    textedTo?: string;
                    emailFailureReason?: string;
                    smsFailureReason?: string;
                    smsFailureCode?: string;
                    /** REQ-586: the language this send went out in. */
                    lang?: string;
                  };
                  const label = dp.label ?? m.content;
                  // Show the recovery form when this divider belongs to a
                  // send-quote attempt that failed (or partially failed)
                  // due to missing/invalid contact info, AND we still have
                  // a customer bound (we need a row to patch).
                  // REQ-568 (m44): the resend retries ONLY the channel(s)
                  // that failed, read from the outcome — never the original
                  // send's channel, or fixing a bad phone number on a "both"
                  // send would email the customer again.
                  const inferredChannel = retryChannel(dp);
                  const emailMissing = !dp.emailedTo &&
                    !!dp.emailFailureReason &&
                    !customer?.email;
                  // REQ-226: "add" (no phone on file) vs "check" (the phone on
                  // file can't take texts) — from the send's structured code,
                  // never a regex over the translated reason.
                  const phoneAsk = smsRecoveryAsk(dp, customer?.phoneNumber);
                  const phoneMissing = !!phoneAsk;
                  const needRecovery = !!dp.quoteId && !!customer?.id &&
                    !!inferredChannel &&
                    (emailMissing || phoneMissing) &&
                    m.id === recoveryDividerId;
                  const draft = recoveryDraft[m.id] ?? {};
                  const saving = recoverySavingId === m.id;
                  const askEmail = needRecovery && emailMissing;
                  const askPhone = needRecovery && phoneMissing;
                  // REQ-603 (demo M23): per-field check of what was typed.
                  const recoveryErrs = recoveryContactErrors({
                    email: askEmail ? draft.email : "",
                    phone: askPhone ? draft.phone : "",
                  });
                  return (
                    <div key={m.id}>
                      <div class="phase-divider">
                        <div class="phase-divider__line" />
                        <div class="phase-divider__label">
                          <I
                            d={sendDividerFailed(dp) ? ICN.alert : ICN.contract}
                            size={11}
                          />{" "}
                          {label}
                        </div>
                        <div class="phase-divider__line" />
                      </div>
                      {dividerShowsCustomerLink(dp) && dp.quoteId &&
                          linkOwners.has(m.id) // REQ-571: once per quote
                        ? (
                          // REQ-310 (m13): the customer's link stays one
                          // click away after the send, outside the menu.
                          <CustomerLinkRow
                            quoteId={dp.quoteId}
                            quoteNumber={quote?.id === dp.quoteId
                              ? quote.number
                              : undefined}
                            // REQ-586 (cycle 4, M11): in the language this
                            // send went out in.
                            sendLang={dp.lang ??
                              (quote?.id === dp.quoteId
                                ? quoteSendLang(quote)
                                : undefined)}
                            lang={lang}
                            onCopy={copyLinkFor}
                          />
                        )
                        : null}
                      {needRecovery
                        ? (
                          <div class="recovery-card">
                            <div class="recovery-card__head">
                              <strong>
                                {askEmail && askPhone
                                  ? tFor(
                                    lang,
                                    phoneAsk === "check"
                                      ? "asstChat.recovery.addEmailCheckPhone"
                                      : "asstChat.recovery.addBoth",
                                  )
                                  : askEmail
                                  ? tFor(lang, "asstChat.recovery.addEmail")
                                  : phoneAsk === "check"
                                  ? tFor(lang, "asstChat.recovery.checkPhone")
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
                                    aria-invalid={recoveryErrs.email
                                      ? "true"
                                      : undefined}
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
                                    value={recoveryPhoneValue(
                                      draft.phone ??
                                        (phoneAsk === "check"
                                          ? customer?.phoneNumber ?? ""
                                          : ""),
                                    )} /* NW-34 (REQ-012); REQ-226: "check" pre-fills the number on file; REQ-603: a typed letter stays visible */
                                    disabled={saving}
                                    aria-invalid={recoveryErrs.phone
                                      ? "true"
                                      : undefined}
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
                                    !draft.phone?.trim()) ||
                                  !!recoveryErrs.phone || !!recoveryErrs.email}
                                onClick={() =>
                                  saveContactAndRetry(m.id, {
                                    quoteId: dp.quoteId!,
                                    channel: inferredChannel ?? "email",
                                  })}
                              >
                                {saving
                                  ? tFor(lang, "asstChat.recovery.saving")
                                  : tFor(lang, "asstChat.recovery.saveResend")}
                              </button>
                            </div>
                            {recoveryErrs.phone
                              ? (
                                <p
                                  class="recovery-card__error"
                                  role="alert"
                                  data-cy="recovery-phone-error"
                                >
                                  {tFor(lang, recoveryErrs.phone)}
                                </p>
                              )
                              : null}
                            {recoveryErrs.email
                              ? (
                                <p
                                  class="recovery-card__error"
                                  role="alert"
                                  data-cy="recovery-email-error"
                                >
                                  {tFor(lang, recoveryErrs.email)}
                                </p>
                              )
                              : null}
                          </div>
                        )
                        : null}
                    </div>
                  );
                }

                // Continue-CTA — clickable card that fires phase transition.
                // For toPhase=send (wizard complete), clicking the Review button
                // transitions the card itself into a calm "Drafted ✓" state
                // showing the document id inline. No popup — the user gets a
                // visible acknowledgement that the action registered.
                if (m.kind === "continue_cta") {
                  const payload = (m.payload ?? {}) as {
                    toPhase?: string;
                    summary?: string;
                    quoteId?: string;
                  };
                  const reviewed = (payload.toPhase === "send" ||
                    payload.toPhase === "invoice") &&
                    (reviewedCtas.has(m.id) || settledCtas.has(m.id));
                  // Pull the actual delivery outcome from the phase_divider
                  // the server emits AFTER this CTA fires. Falls back to the
                  // local customer.email when no divider is in scope yet
                  // (older threads). Without this the banner can read
                  // "no email on file" even when the dispatch actually
                  // succeeded with a `to:` override.
                  const ctaIdx = visible.indexOf(m);
                  let dispatchedTo: string | undefined;
                  let dispatchedChannel: "email" | "sms" | undefined;
                  let dispatchFailReason: string | undefined;
                  if (reviewed && ctaIdx >= 0) {
                    for (let i = ctaIdx + 1; i < visible.length; i++) {
                      const next = visible[i];
                      if (next.kind !== "phase_divider") continue;
                      // UX-03: read BOTH channels — an SMS-only success used
                      // to leave dispatchedTo empty, so the card claimed
                      // sent-✓ while its sub demanded an email "to deliver".
                      const np = (next.payload ?? {}) as {
                        emailedTo?: string;
                        textedTo?: string;
                        emailFailureReason?: string;
                        smsFailureReason?: string;
                      };
                      if (
                        np.emailedTo || np.textedTo ||
                        np.emailFailureReason || np.smsFailureReason
                      ) {
                        // Latest outcome wins (no break): a failed first
                        // attempt followed by a successful retry must show
                        // the retry, and vice versa.
                        if (np.emailedTo) {
                          dispatchedTo = np.emailedTo;
                          dispatchedChannel = "email";
                        } else if (np.textedTo) {
                          dispatchedTo = np.textedTo;
                          dispatchedChannel = "sms";
                        } else {
                          dispatchedTo = undefined;
                          dispatchedChannel = undefined;
                        }
                        dispatchFailReason = np.emailFailureReason ??
                          np.smsFailureReason;
                      }
                    }
                  }
                  // A divider that reports a failure with no successful
                  // channel means the dispatch did NOT go out — never fall
                  // back to the customer's email in that case, or the card
                  // claims "emailed to …" above the very error that says
                  // it wasn't (e.g. "sender name required").
                  const dispatchFailed = reviewed && !dispatchedTo &&
                    !!dispatchFailReason;
                  const sentRecipient = dispatchedTo ??
                    (reviewed && !dispatchFailed ? customer?.email : undefined);
                  const previewing = payload.toPhase === "send" &&
                    previewCtaId === m.id;
                  if (previewing) {
                    const docId = payload.quoteId ?? quote?.id ?? quoteId ?? "";
                    // Pull line items from the most recent locked/sent action_card
                    // (REQ-234: "locked", or "sent" on older threads; fall
                    // back to "draft").
                    const lockedCard = [...messages]
                      .reverse()
                      .find(
                        (x) =>
                          x.kind === "action_card" &&
                          // REQ-368: an invoice card's line is not the quote's.
                          isQuoteCardPayload(x.payload) &&
                          (isLockedOrIssued(
                            (x.payload as ActionCardPayload | undefined)
                              ?.status,
                          ) ||
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
                      // REQ-264 (M15): in the preview language. REQ-333
                      // (M24): the quote's own language is the typed text.
                      description: lineItemDescription(
                        li,
                        previewLang,
                        quote?.lang,
                      ),
                      amountCents: Math.round(
                        (li.price ?? 0) * (li.quantity ?? 1),
                      ),
                    }));
                    // REQ-264 (M15): a card line still matching the quote's
                    // line renders that line's preview-language text.
                    const lineItems = lockedPayload.lineItems?.length
                      ? lockedPayload.lineItems.map((li, i) => {
                        const ql = quote?.lineItems?.[i];
                        return ql && ql.description === li.description
                          ? {
                            ...li,
                            description: lineItemDescription(
                              ql,
                              previewLang,
                              quote?.lang,
                            ),
                          }
                          : li;
                      })
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
                    // REQ-237 (M17): resolved in shared/quote-flow so the
                    // tests drive the same rule the card renders.
                    const jobDetailRows = reviewJobDetails({
                      previewLang,
                      descriptionByLang: quote?.descriptionByLang,
                      lockedDescription: lockedPayload.description,
                      description: quote?.description,
                      lineItems,
                    });
                    // Wizard terms (REQ-347, demo M16): quote.terms (English,
                    // the agreement's own base) when present, else the wizard
                    // picks resolved from their step/option ids — never the
                    // transcript text, which is in the contractor's UI language.
                    // Localized into the preview language like the public doc.
                    const termAnswers = previewTermRows({
                      quoteTerms: quote?.terms,
                      messages,
                      previewLang,
                      t: tFor,
                      localize: localizeTermValue,
                    });
                    // REQ-302 (demo B1): the TOTAL is the sum of the lines
                    // this card renders — `quote.estimatedTotal` is loaded
                    // once per quoteId and went stale after a chat reprice
                    // (lines said -$500, TOTAL said $0.00).
                    const totalCentsForBreakdown = lineItems.length
                      ? lineItems.reduce(
                        (sum, li) => sum + (li.amountCents ?? 0),
                        0,
                      )
                      : typeof quote?.estimatedTotal === "number"
                      ? quote.estimatedTotal
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
                              {docId
                                ? (
                                  <div class="quote-review__num">
                                    {reviewCardNumber(docId, quote)}
                                  </div>
                                )
                                : null}
                            </div>
                            <div class="quote-review__head-right">
                              <span class="quote-review__chip">
                                {tFor(
                                  lang,
                                  // REQ-369: the thread's one status — what
                                  // the header and the list say.
                                  threadStatusKey(threadHeader.status),
                                )}
                              </span>
                              <button
                                type="button"
                                class="quote-review__close"
                                aria-label={tFor(
                                  lang,
                                  "asstChat.preview.closePreview",
                                )}
                                // Same as the header back: leaving the
                                // preview re-asks the last term step. Just
                                // hiding the card stranded the chat with no
                                // step and no way to re-open the review.
                                onClick={() => goBackWizard()}
                                disabled={sending}
                              >
                                <I d={ICN.x} size={14} sw={2.4} />
                              </button>
                            </div>
                          </header>

                          {
                            /* Preview-language toggle — re-renders the DOCUMENT
                              (and sets the send language) in each language the
                              contractor enabled in Settings. The card's own
                              controls stay in the app language `lang`
                              (REQ-490, demo M19). Hidden when only one
                              language is configured. */
                          }
                          {sendLangs.length > 1
                            ? (
                              <div
                                class="quote-review__langtoggle"
                                role="group"
                                aria-label={tFor(
                                  lang,
                                  "asstChat.preview.languageGroup",
                                )}
                              >
                                <span class="quote-review__langtoggle-label">
                                  {tFor(
                                    lang,
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
                                        lang,
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
                              lang,
                              "asstChat.preview.docTypeGroup",
                            )}
                          >
                            <span class="quote-review__langtoggle-label">
                              {tFor(lang, "asstChat.preview.sendAs")}
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
                              {tFor(lang, "asstChat.preview.kind")}
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
                              // REQ-233 (B2): signing already billed the
                              // agreement (deposit + balance) — no swap.
                              disabled={sending || quoteAccepted}
                            >
                              {tFor(
                                lang,
                                "asstChat.preview.docTypeInvoice",
                              )}
                            </button>
                          </div>
                          {reviewDocType === "invoice"
                            ? (
                              <div style="margin:10px 14px 0;padding:10px 14px;background:var(--coffee-50,#f5f0e8);border:1px dashed var(--border,#d8dcd5);border-radius:10px;font-size:12.5px;color:var(--fg-muted,#6b7560)">
                                {tFor(
                                  lang,
                                  "asstChat.preview.invoiceModeNote",
                                )}
                              </div>
                            )
                            : null}
                          {/* UX-06: never silently show the base language —
                              surface the live translation state when the
                              toggled language's details aren't ready (in
                              flight, failed, or never produced at all). */}
                          {translationPendingLangs.has(previewLang)
                            ? (
                              <div
                                class="quote-review__translation-state"
                                role="status"
                                style="margin:10px 14px 0;padding:8px 12px;background:var(--mint-100,#e8f3e0);border-radius:10px;font-size:12.5px;color:var(--fg-muted,#6b7560)"
                              >
                                {tFor(
                                  lang,
                                  "asstChat.preview.translationPending",
                                )}
                              </div>
                            )
                            : previewLang !== lang &&
                                previewTranslationMissing(quote, previewLang)
                            ? (
                              <div
                                class="quote-review__translation-state"
                                role="alert"
                                style="margin:10px 14px 0;padding:8px 12px;background:rgba(255,107,107,0.08);border:1px solid rgba(255,107,107,0.25);border-radius:10px;font-size:12.5px;color:var(--pink-700,#d94e4e)"
                              >
                                {tFor(
                                  lang,
                                  "asstChat.preview.translationMissing",
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
                                {/* UX-26(b)/UX-27: the placeholder account
                                    name is not a finished identity — warn
                                    and invite the fix instead of presenting
                                    "Nuevo usuario" as the sender. */}
                                {!from.business?.trim() &&
                                  isPlaceholderName(from.name) && (
                                  <a
                                    href="/settings"
                                    class="quote-review__from-warn"
                                    style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;font-weight:700;color:var(--pink-700,#d94e4e);text-decoration:none"
                                  >
                                    ⚠ {tFor(
                                      lang,
                                      "asstChat.preview.fromNeedsName",
                                    )}
                                  </a>
                                )}
                                {/* NW-06 (REQ-007): the client expects the
                                    email on the From block — when Settings
                                    has none, say so instead of silently
                                    rendering nothing. */}
                                {!from.email?.trim() && (
                                  <a
                                    href="/settings"
                                    class="quote-review__from-warn"
                                    data-cy="review-from-needs-email"
                                    style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;font-weight:700;color:var(--pink-700,#d94e4e);text-decoration:none"
                                  >
                                    ⚠ {tFor(
                                      lang,
                                      "asstChat.preview.fromNeedsEmail",
                                    )}
                                  </a>
                                )}
                                <div class="quote-review__hero-meta">
                                  {from.name && from.business
                                    ? <span>{from.name}</span>
                                    : null}
                                  {from.phone
                                    ? (
                                      <>
                                        <span class="quote-review__dot">·</span>
                                        {/* UX-15: one phone formatter
                                            everywhere — never raw E.164. */}
                                        <span>
                                          {formatPhoneDisplay(from.phone)}
                                        </span>
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
                                  {from.website?.trim()
                                    ? (
                                      <>
                                        <span class="quote-review__dot">·</span>
                                        <span data-cy="review-from-website">
                                          {websiteLabel(from.website)}
                                        </span>
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
                                    lang,
                                    "asstChat.preview.switchCustomer",
                                  )}
                                  title={tFor(
                                    lang,
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
                                      lang,
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
                                      lang,
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
                                    {/* UX-15: display-formatted, not the
                                        raw stored digits. */}
                                    {customer.phoneNumber
                                      ? formatPhoneDisplay(
                                        customer.phoneNumber,
                                      )
                                      : ""}
                                  </span>
                                </div>
                                {/* REQ-263: where the job is. */}
                                {quote?.serviceAddress
                                  ? (
                                    <div
                                      class="quote-review__hero-meta"
                                      data-cy="quote-review-service-address"
                                    >
                                      {tFor(
                                        previewLang,
                                        "asstChat.preview.serviceAddress",
                                      )}: {quote.serviceAddress}
                                    </div>
                                  )
                                  : null}
                                {customerPickerOpen
                                  ? (
                                    <div class="quote-review__swap-panel">
                                      <input
                                        type="text"
                                        class="cust-pick__search"
                                        placeholder={customerPickerList &&
                                            customerPickerList.length > 5
                                          ? tFor(
                                            lang,
                                            "asstChat.searchNCustomers",
                                            { n: customerPickerList.length },
                                          )
                                          : tFor(
                                            lang,
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
                                              lang,
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
                                                    lang,
                                                    "common.noMatches",
                                                  )
                                                  : tFor(
                                                    lang,
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
                                        {tFor(lang, "common.cancel")}
                                      </button>
                                    </div>
                                  )
                                  : null}
                              </section>
                            )
                            : null}

                          {(() => {
                            const lines = jobDetailRows.map((r) => r.text);
                            // NW-19b (REQ-006): Job Details is editable on the
                            // review card like every other field — the pencil
                            // reopens the job picker on the CURRENT details and
                            // applyJobOption lands the pick back here. The
                            // section renders even with no details yet, so
                            // they can be added from the card.
                            const editJobDetails = () => {
                              if (sending) return;
                              // The state to return to is this review card:
                              // snapshot it so the header back closes the picker.
                              pushHistory();
                              pendingReviewCtaRef.current = previewCtaId ?? m.id;
                              // REQ-400 (M5, M21): the current card is the
                              // quote's OWN lines — never the preview
                              // language's rows, which applyJobOption would
                              // store as the description — and the options
                              // are regenerated from the typed message plus
                              // those lines, not the lines alone.
                              const editSeed = editJobDetailsSeed({
                                description: quote?.description,
                                lockedDescription: lockedPayload.description,
                                lineItems: quote?.lineItems?.length
                                  ? quote.lineItems
                                  : lockedPayload.lineItems,
                                originalRaw,
                                fallback: quote?.summary ?? quote?.jobName,
                              });
                              jobPolishRawRef.current = editSeed.raw;
                              // REQ-330 (M23): the current lines, title and
                              // summary are the first, pre-selected card;
                              // the regenerated options sit beside it.
                              void openJobPicker({
                                lines: editSeed.lines,
                                jobName: quote?.jobName,
                                summary: quote?.summary,
                              });
                            };
                            return (
                              <section class="quote-review__section">
                                <div class="quote-review__section-label quote-review__section-label--editable">
                                  {tFor(
                                    previewLang,
                                    "asstChat.preview.jobDetails",
                                  )}
                                  <button
                                    type="button"
                                    class="quote-review__section-edit"
                                    data-cy="review-job-details-edit"
                                    disabled={sending || !quoteId}
                                    title={tFor(
                                      lang,
                                      "asstChat.preview.editJobDetails",
                                    )}
                                    aria-label={tFor(
                                      lang,
                                      "asstChat.preview.editJobDetails",
                                    )}
                                    onClick={editJobDetails}
                                  >
                                    <Icon name="pencil" size={14} style="display:block" />
                                  </button>
                                </div>
                                {jobDetailRows.some((r) =>
                                    r.amountCents !== undefined
                                  )
                                  ? (
                                    // REQ-237 (M17): a chat-drafted quote's
                                    // scope is its line items — each with
                                    // its amount, like the action card.
                                    <ul class="quote-review__details">
                                      {jobDetailRows.map((r, i) => (
                                        <li
                                          key={i}
                                          data-cy="review-job-detail-line"
                                        >
                                          {r.text}
                                          {r.amountCents !== undefined
                                            ? (
                                              <strong
                                                data-cy="review-job-detail-amount"
                                                style="float:right;margin-left:12px"
                                              >
                                                {fmtUSD(r.amountCents)}
                                              </strong>
                                            )
                                            : null}
                                        </li>
                                      ))}
                                    </ul>
                                  )
                                  : lines.length > 1
                                  ? (
                                    <ul class="quote-review__details">
                                      {lines.map((l, i) => (
                                        <li key={i}>{l}</li>
                                      ))}
                                    </ul>
                                  )
                                  : lines.length === 1
                                  ? (
                                    <p class="quote-review__details-text">
                                      {lines[0]}
                                    </p>
                                  )
                                  : (
                                    <p class="quote-review__details-text quote-review__details-text--empty">
                                      {tFor(
                                        previewLang,
                                        "asstChat.preview.jobDetailsEmpty",
                                      )}
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
                                    // docId from the parent scope defaults to "" via `?? ""`,
                                    // so use || not ?? to fall back to quote.id when empty.
                                    const cid = docId || quote?.id;
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
                                    // REQ-491 (m60): {pct}, and the $ split
                                    // once this card has a total.
                                    const depVars = depositBalanceSubVars(
                                      totalCentsForBreakdown,
                                    );
                                    const wizOpts: WizardOption[] =
                                      wizOptsRaw.length > 0 ? wizOptsRaw : (
                                        TERM_OPTIONS_FALLBACK[t.stepId] ?? []
                                      ).map((o, i) => ({
                                        id: `fallback-${i}`,
                                        ...(o.amountPicker
                                          ? { amountPicker: o.amountPicker }
                                          : {}),
                                        label: tFor(previewLang, o.labelKey),
                                        sub: o.subAmountsKey && depVars.deposit
                                          ? tFor(
                                            previewLang,
                                            o.subAmountsKey,
                                            depVars,
                                          )
                                          : o.subKey
                                          ? tFor(previewLang, o.subKey, {
                                            n: accountNetDays(invoiceNetDays),
                                            ...depVars,
                                          })
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
                                              {depositEditStepId === t.stepId
                                                ? (
                                                  <DepositAmountPicker
                                                    totalCents={totalCentsForBreakdown}
                                                    sending={sending}
                                                    lang={lang}
                                                    onPick={(value) => {
                                                      setDepositEditStepId(
                                                        null,
                                                      );
                                                      pickTermOption(
                                                        cid,
                                                        t.stepId,
                                                        t.label,
                                                        value,
                                                      );
                                                    }}
                                                    onCancel={() =>
                                                      setDepositEditStepId(
                                                        null,
                                                      )}
                                                  />
                                                )
                                                : customTermDraft &&
                                                  customTermDraft.stepId ===
                                                    t.stepId
                                                ? (
                                                  <div style="display:flex;flex-direction:column;gap:8px">
                                                    <input
                                                      type="text"
                                                      class="cust-pick__search"
                                                      placeholder={tFor(
                                                        lang,
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
                                                          lang,
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
                                                          lang,
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
                                                            // REQ-678: ask the
                                                            // deposit amount.
                                                            isDepositPickerOption(
                                                                t.stepId,
                                                                opt,
                                                              )
                                                              ? setDepositEditStepId(
                                                                t.stepId,
                                                              )
                                                              : pickTermOption(
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
                                                        lang,
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
                                                        lang,
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
                                                  lang,
                                                  "common.edit",
                                                )}
                                              >
                                                {
                                                  /* Value is already localized +
                                                    "Estimated"-wrapped (for
                                                    durations) by the termAnswers
                                                    map above — render as-is to
                                                    avoid double-wrapping.
                                                    REQ-617: the pencil rides
                                                    with the last word. */
                                                }
                                                <TermEditValue value={t.value} />
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
                                    lockedPayload.quoteId ?? quote?.id,
                                    lockedCard?.id,
                                    totalCentsForBreakdown,
                                    e.currentTarget as HTMLElement,
                                  )}
                              >
                                {totalStr}
                              </span>
                            </div>
                            {(() => {
                              // REQ-248: an issued quote's edit is not live
                              // until a send publishes it — say so.
                              const notice = pendingRevisionNotice(quote);
                              return notice
                                ? (
                                  <p
                                    class="quote-review__unpublished"
                                    data-cy="quote-review-unpublished"
                                    style="margin:6px 0 0;font-size:12.5px;font-weight:600;color:var(--amber-700,#9a5b00)"
                                  >
                                    {tFor(
                                      lang,
                                      "asstChat.preview.unpublishedChange",
                                      { version: String(notice.nextVersion) },
                                    )}
                                  </p>
                                )
                                : null;
                            })()}
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
                                      // the same divider chip the quote-
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
                                          lang,
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
                                          lang,
                                          "asstChat.preview.linkCopied",
                                        )
                                        : tFor(
                                          lang,
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
                                        lang,
                                        "asstChat.invoiceFlow.viewInvoice",
                                      )}
                                    </a>
                                  </div>
                                </div>
                              )
                              : (
                                <div class="quote-review__send-split">
                                  {/* REQ-035 (NW-55): Send asks HOW first —
                                      the dialog's Send is the actual send (REQ-308). */}
                                  {sendDialogOpen
                                    ? (
                                      <Backdrop
                                        class="send-dialog__backdrop"
                                        onClose={() => setSendDialogOpen(false)}
                                      >
                                        <div
                                          class="send-dialog"
                                          role="dialog"
                                          aria-modal="true"
                                          aria-labelledby="send-dialog-title"
                                          data-cy="send-dialog"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <h4
                                            id="send-dialog-title"
                                            class="send-dialog__title"
                                          >
                                            {/* REQ-402 (demo m5): name who it goes to. */}
                                            {customer?.name
                                              ? tFor(
                                                lang,
                                                "asstChat.send.howTitle",
                                                { name: customer.name },
                                              )
                                              : tFor(
                                                lang,
                                                "asstChat.send.howTitleNoName",
                                              )}
                                          </h4>
                                          <div
                                            class="send-dialog__options"
                                            role="radiogroup"
                                          >
                                            {([
                                              ["both", "asstChat.preview.menuBoth", ICN.send],
                                              ["sms", "asstChat.preview.menuSms", ICN.phone],
                                              ["email", "asstChat.preview.menuEmail", ICN.mail],
                                            ] as const).map(([ch, key, icon]) => (
                                              <button
                                                key={ch}
                                                type="button"
                                                role="radio"
                                                aria-checked={dialogChannel === ch
                                                  ? "true"
                                                  : "false"}
                                                data-cy={`send-option-${ch}`}
                                                class={`send-dialog__option${
                                                  dialogChannel === ch
                                                    ? " is-current"
                                                    : ""
                                                }`}
                                                onClick={() =>
                                                  setDialogChannel(ch)}
                                              >
                                                <I d={icon} size={13} sw={2.4} />
                                                <span>{tFor(lang, key)}</span>
                                                {/* REQ-402 (demo m5): say what this channel still lacks. */}
                                                {channelNeedsKey(ch, customer)
                                                  ? (
                                                    <span
                                                      class="send-dialog__needs"
                                                      data-cy={`send-needs-${ch}`}
                                                    >
                                                      {tFor(
                                                        lang,
                                                        channelNeedsKey(ch, customer)!,
                                                      )}
                                                    </span>
                                                  )
                                                  : null}
                                                {ch === recommendedChannel(customer)
                                                  ? (
                                                    <span class="quote-review__send-menu-tag">
                                                      {tFor(
                                                        lang,
                                                        "asstChat.preview.recommended",
                                                      )}
                                                    </span>
                                                  )
                                                  : null}
                                              </button>
                                            ))}
                                          </div>
                                          {/* REQ-461 (demo m8): the language the quote goes out
                                              in — the same previewLang the Send uses — and
                                              what the client gets, before Send. */}
                                          {reviewDocType !== "invoice"
                                            ? (
                                              <SendLangPreview
                                                quoteId={(m.payload as { quoteId?: string } | undefined)
                                                  ?.quoteId ?? quote?.id ?? quoteId}
                                                channel={dialogChannel}
                                                sendLang={previewLang}
                                                langs={sendLangs}
                                                uiLang={lang}
                                                onPickLang={(l) => {
                                                  previewLangPickedRef.current = true;
                                                  setPreviewLang(l);
                                                }}
                                              />
                                            )
                                            : null}
                                          {/* REQ-037 (NW-43b): "both, always" —
                                              collect what the chosen channel
                                              still lacks, right here. */}
                                          {(dialogChannel !== "sms") &&
                                              !customer?.email
                                            ? (
                                              <label
                                                class="send-dialog__add"
                                                data-cy="send-add-email"
                                              >
                                                <span>
                                                  {tFor(
                                                    lang,
                                                    addFieldLabelKey("email", dialogChannel),
                                                  )}
                                                </span>
                                                <input
                                                  type="email"
                                                  class="cust-pick__search"
                                                  placeholder={tFor(
                                                    lang,
                                                    "asstChat.send.emailPlaceholder",
                                                  )}
                                                  value={dialogEmail}
                                                  onInput={(e) =>
                                                    setDialogEmail(
                                                      (e.currentTarget as HTMLInputElement).value,
                                                    )}
                                                />
                                              </label>
                                            )
                                            : null}
                                          {(dialogChannel !== "email") &&
                                              !customer?.phoneNumber
                                            ? (
                                              <label
                                                class="send-dialog__add"
                                                data-cy="send-add-phone"
                                              >
                                                <span>
                                                  {tFor(
                                                    lang,
                                                    addFieldLabelKey("phone", dialogChannel),
                                                  )}
                                                </span>
                                                <input
                                                  type="tel"
                                                  class="cust-pick__search"
                                                  placeholder={tFor(
                                                    lang,
                                                    "asstChat.customerStep.phonePlaceholder",
                                                  )}
                                                  value={formatPhoneInput(dialogPhone)}
                                                  onInput={(e) =>
                                                    setDialogPhone(
                                                      (e.currentTarget as HTMLInputElement).value,
                                                    )}
                                                />
                                              </label>
                                            )
                                            : null}
                                          {dialogErr
                                            ? <div class="cust-pick__err">{dialogErr}</div>
                                            : null}
                                          <div class="send-dialog__actions">
                                            <button
                                              type="button"
                                              class="send-dialog__cancel"
                                              data-cy="send-cancel"
                                              onClick={() =>
                                                setSendDialogOpen(false)}
                                            >
                                              {tFor(lang, "asstChat.send.cancel")}
                                            </button>
                                            <button
                                              type="button"
                                              class="send-dialog__keep"
                                              data-cy="send-keep"
                                              disabled={sending}
                                              onClick={() => {
                                                void keepAndSend(
                                                  m,
                                                  previewLang,
                                                  totalCentsForBreakdown,
                                                );
                                              }}
                                            >
                                              {tFor(lang, "asstChat.send.keep")}
                                            </button>
                                          </div>
                                        </div>
                                      </Backdrop>
                                    )
                                    : null}
                                  <button
                                    type="button"
                                    class="quote-review__send-main"
                                    onClick={() => openSendDialog(sendChannel)}
                                    // UX-02: an accepted deal offers no live
                                    // re-send of the same agreement — and
                                    // (REQ-233, B2) no invoice swap either:
                                    // signing already billed it.
                                    disabled={sending || quoteAccepted}
                                  >
                                    <I d={ICN.send} size={14} sw={2.4} />
                                    {sending
                                      ? tFor(
                                        lang,
                                        "asstChat.preview.sending",
                                      )
                                      : reviewDocType === "invoice"
                                      ? tFor(
                                        lang,
                                        "asstChat.preview.sendInvoice",
                                      )
                                      // REQ-402 (demo m5): this opens the
                                      // "How do you want to send" chooser,
                                      // so it never promises "by Text" —
                                      // REQ-459 (m44): unless the user
                                      // picked a channel in the ▾ menu.
                                      : pickedChannel
                                      ? tFor(
                                        lang,
                                        sendOpenLabelKey(pickedChannel),
                                      )
                                      : tFor(
                                        lang,
                                        "asstChat.preview.sendOpen",
                                      )}
                                  </button>
                              <button
                                type="button"
                                class="quote-review__send-caret"
                                aria-label={tFor(
                                  lang,
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
                                    {/* REQ-402 (demo m5): the menu tags
                                        Recommended and the missing contact
                                        exactly as the dialog does. */}
                                    {([
                                      ["both", "asstChat.preview.menuBoth", ICN.send],
                                      ["sms", "asstChat.preview.menuSms", ICN.phone],
                                      ["email", "asstChat.preview.menuEmail", ICN.mail],
                                    ] as const).map(([ch, key, icon]) => (
                                      <button
                                        key={ch}
                                        type="button"
                                        role="menuitem"
                                        data-cy={`send-menu-${ch}`}
                                        class={`quote-review__send-menu-item${
                                          sendChannel === ch
                                            ? " is-current"
                                            : ""
                                        }`}
                                        // REQ-459 (demo m44): a pick opens
                                        // the send dialog on that channel.
                                        onClick={() => {
                                          setSendChannel(ch);
                                          setPickedChannel(ch);
                                          openSendDialog(ch);
                                        }}
                                      >
                                        <I d={icon} size={13} sw={2.4} />
                                        <span class="quote-review__send-menu-label">
                                          {tFor(lang, key)}
                                        </span>
                                        {channelNeedsKey(ch, customer)
                                          ? (
                                            <span class="send-dialog__needs">
                                              {tFor(
                                                lang,
                                                channelNeedsKey(ch, customer)!,
                                              )}
                                            </span>
                                          )
                                          : null}
                                        {recommendedChannel(customer) === ch
                                          ? (
                                            <span class="quote-review__send-menu-tag">
                                              {tFor(
                                                lang,
                                                "asstChat.preview.recommended",
                                              )}
                                            </span>
                                          )
                                          : null}
                                      </button>
                                    ))}
                                    {/* REQ-570 (demo m41): see it as the
                                        customer will — /q/<id>, new tab. */}
                                    {reviewDocType !== "invoice" && (docId || quote?.id)
                                      ? (
                                        <a
                                          role="menuitem"
                                          class="quote-review__send-menu-item"
                                          data-cy="send-menu-preview"
                                          href={customerLinkPath(docId || quote?.id || "")}
                                          target="_blank"
                                          rel="noopener"
                                          onClick={() =>
                                            setChannelMenuOpen(false)}
                                        >
                                          <I d={ICN.eye} size={13} sw={2.4} />
                                          <span class="quote-review__send-menu-label">
                                            {tFor(
                                              lang,
                                              "asstChat.preview.menuPreview",
                                            )}
                                          </span>
                                        </a>
                                      )
                                      : null}
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
                                      onClick={() => {
                                        const cid = docId || quote?.id;
                                        if (!cid) return;
                                        // REQ-310 (m32): the outcome shows
                                        // as a toast outside this menu —
                                        // copied, or couldn't-copy with the
                                        // url; the menu closes either way.
                                        setChannelMenuOpen(false);
                                        void copyLinkFor(cid);
                                      }}
                                    >
                                      <I d={ICN.clip} size={13} sw={2.4} />
                                      <span class="quote-review__send-menu-label">
                                        {tFor(
                                          lang,
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
                  // success state ("Sent") still renders below.
                  if (payload.toPhase === "send" && !reviewed && !previewing) {
                    return null;
                  }
                  // Per audit #19: surface the upcoming phase label as an eyebrow
                  // *before* the CTA, so users see the phase-2 eyebrow at
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
                            reviewed && !dispatchFailed
                              ? "continue-cta--done"
                              : ""
                          }`}
                        >
                          <div class="continue-cta__icon">
                            <I
                              d={reviewed && !dispatchFailed
                                ? ICN.check
                                : dispatchFailed
                                ? ICN.alert
                                : ICN.contract}
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
                                ? dispatchFailed
                                  ? tFor(lang, "asstChat.cta.sendFailed")
                                  : payload.toPhase === "invoice"
                                  ? tFor(lang, "asstChat.cta.invoiceSent")
                                  : tFor(lang, "asstChat.cta.sent")
                                : m.content}
                            </div>
                            {reviewed
                              ? (
                                <div class="continue-cta__sub">
                                  {sentRecipient
                                    ? (
                                      <>
                                        {tFor(
                                          lang,
                                          dispatchedChannel === "sms"
                                            ? "asstChat.cta.textedTo"
                                            : "asstChat.cta.emailedTo",
                                        )}
                                        {" "}
                                        <code>
                                          {dispatchedChannel === "sms"
                                            ? fmtPhone(sentRecipient)
                                            : sentRecipient}
                                        </code>
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
                            : payload.toPhase === "terms" &&
                                !(payload as { customerName?: string })
                                  .customerName && !customer
                            ? (
                              /* REQ-331 (demo m7/m44): Business / Person is
                                 only asked when nobody is known yet — a
                                 bound customer gets a single Continue. */
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
                                simulateCustomerAccept(
                                  payload.quoteId ?? quote?.id,
                                )}
                              disabled={sending}
                              title="Localhost-only: flip quote to accepted, bump conversation, set unread."
                            >
                              🔧 {sending
                                ? "Simulating…"
                                : "Simulate customer accepted"}
                            </button>
                          )
                          : null}
                        {/* REQ-339 (demo p2): a sent card is stamped with
                            the dispatch time (the phase-3 divider), not
                            the moment the wizard finished. */}
                        <div class="msg__time">
                          {fmtTime(
                            reviewed
                              ? sentCtaTimestamp(messages, m, quote)
                              : m.createdAt,
                            lang,
                          )}
                        </div>
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
                    /** REQ-258 (demo M22): the option the chat already
                     *  named ("half deposit" → 50/50), shown pre-selected. */
                    suggestedOptionId?: string;
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
                              /* Single-back rule: no step-level Back. The
                                header's universal back (pm:asst-back) rewinds
                                the active wizard step via the shared
                                resolver. */
                            }
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
                                    initialName={stepFacts.customerName ??
                                      prefillCustomerName ??
                                      undefined}
                                    initialPhone={quoteFacts.customerPhone ??
                                      undefined}
                                    initialEmail={quoteFacts.customerEmail ??
                                      undefined}
                                    prefillFacts={stepFacts}
                                    initialServiceAddress={quote
                                      ?.serviceAddress}
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
                              // REQ-678 (demo-loop cycle 5, c3-m60): "Deposit
                              // + balance" asks how much upfront — 10/20/30/
                              // 50 % or a custom $ — and answers with
                              // "Deposit 30% + balance".
                              if (
                                depositPick && depositPick.messageId === m.id
                              ) {
                                return (
                                  <DepositAmountPicker
                                    totalCents={latestSentQuoteCents(
                                      messages,
                                    ) ||
                                      (typeof quote?.estimatedTotal === "number"
                                        ? quote.estimatedTotal
                                        : 0)}
                                    sending={sending}
                                    lang={lang}
                                    onPick={(value) => {
                                      const optionId = depositPick.optionId;
                                      setDepositPick(null);
                                      postWizardAnswer(m, {
                                        stepId: payload.stepId!,
                                        optionId,
                                        customValue: value,
                                      });
                                    }}
                                    onCancel={() => setDepositPick(null)}
                                  />
                                );
                              }
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
                                    initial={quoteFacts.duration &&
                                      wholeDuration(quoteFacts.duration)}
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
                                    // REQ-387 (demo M25): the schedule the
                                    // message stated opens ready to verify.
                                    initialSplits={wizardPrefillFor(
                                      payload.stepId,
                                      quoteFacts,
                                      lang,
                                    )?.splits}
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
                              // REQ-265: what the job sentence already
                              // said for this step ("start Dec 1", "half
                              // deposit") is pre-selected — one tap confirms
                              // it, any option still overrides. A rewind's
                              // previous choice wins over the sentence.
                              const prefill = wizardPrefillFor(
                                payload.stepId,
                                quoteFacts,
                                lang,
                              );
                              const prefillOpt = prefill
                                ? opts.find((o) => o.id === prefill.optionId)
                                : undefined;
                              const showPrefill = !!(prefill && prefillOpt) &&
                                !(rewindAnswer &&
                                  rewindAnswer.stepId === payload.stepId);
                              return (
                                <>
                                {showPrefill && prefill && prefillOpt
                                  ? (
                                    <div
                                      class="wiz-prefill"
                                      data-testid="wiz-prefill"
                                    >
                                      <span class="wiz-prefill__label">
                                        {tFor(lang, "asstChat.wiz.fromMessage")}
                                        {": "}
                                        <strong>
                                          {prefill.customValue
                                            ? formatTermDate(
                                              prefill.customValue,
                                              lang,
                                            )
                                            : prefillOpt.label}
                                        </strong>
                                        {
                                          /* REQ-575 (demo-loop cycle 4, M3):
                                            the typed date wins over the
                                            typed weekday ("monday nov 24") —
                                            and says which day it is. */
                                        }
                                        {payload.stepId === "start_date" &&
                                            quoteFacts.startDate
                                              ?.weekdayMismatch
                                          ? (
                                            <span data-testid="wiz-prefill-weekday">
                                              {" — "}
                                              {tFor(
                                                lang,
                                                "asstChat.wiz.weekdayMismatch",
                                                {
                                                  weekday: weekdayLabel(
                                                    quoteFacts.startDate.iso,
                                                    lang,
                                                  ),
                                                },
                                              )}
                                            </span>
                                          )
                                          : null}
                                      </span>
                                      <button
                                        type="button"
                                        class="cust-create__btn cust-create__btn--primary"
                                        disabled={sending}
                                        onClick={() =>
                                          postWizardAnswer(m, {
                                            stepId: payload.stepId!,
                                            optionId: prefill.optionId,
                                            ...(prefill.customValue
                                              ? {
                                                customValue:
                                                  prefill.customValue,
                                              }
                                              : {}),
                                          })}
                                      >
                                        {tFor(lang, "asstChat.wiz.usePrefill")}
                                      </button>
                                    </div>
                                  )
                                  : null}
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
                                          : rewindAnswer?.stepId !==
                                                payload.stepId &&
                                              payload.suggestedOptionId === opt.id
                                          ? "wiz-opt--suggested"
                                          : ""
                                      } ${
                                        showPrefill &&
                                          prefillOpt?.id === opt.id
                                          ? "wiz-opt--prev wiz-opt--prefill"
                                          : ""
                                      }`}
                                      title={rewindAnswer &&
                                          rewindAnswer.stepId ===
                                            payload.stepId &&
                                          rewindAnswer.optionId === opt.id
                                        ? tFor(lang, "asstChat.wiz.prevChoice")
                                        : rewindAnswer?.stepId !==
                                              payload.stepId &&
                                            payload.suggestedOptionId === opt.id
                                        ? tFor(lang, "asstChat.wiz.fromYourMessage")
                                        : undefined}
                                      onClick={() => {
                                        if (
                                          isDepositPickerOption(
                                            payload.stepId,
                                            opt,
                                          )
                                        ) {
                                          setDepositPick({
                                            messageId: m.id,
                                            optionId: opt.id,
                                          });
                                          return;
                                        }
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
                                </>
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
                        <div class="msg__time">{fmtTime(m.createdAt, lang)}</div>
                      </div>
                    </div>
                  );
                }

                // REQ-368 (demo-loop cycle 1, M32): an invoice card — the
                // assistant's answer to "send him the deposit invoice", and
                // SendInvoice's sent card — links to that invoice. It never
                // takes the quote card's buttons below: "Re-open" posted
                // "Re-open the quote." against the signed quote.
                if (
                  m.kind === "action_card" && isInvoiceCardPayload(m.payload)
                ) {
                  const payload = (m.payload ?? {}) as ActionCardPayload;
                  const href = invoiceCardHref(m.payload);
                  // REQ-583 (demo-loop cycle 4, M2): an invoice not sent yet
                  // offers "Send now" — until a later card for it (sent, or
                  // offered again) retires the button. It posts its own
                  // words ("Send INV-001 now"); the server sends THAT one.
                  const at = messages.findIndex((x) => x.id === m.id);
                  const sendOffer = invoiceCardSendOffer(
                    m.payload,
                    messages.slice(at + 1).map((x) => x.payload),
                  );
                  return (
                    <div key={m.id} class="msg">
                      <div class="msg__avatar">
                        <img src="/logo-monster.png" alt="" />
                      </div>
                      <div style="flex:1;min-width:0">
                        <div class="action-card" data-cy="chat-invoice-card">
                          <div class="action-card__head">
                            <div class="action-card__icon">
                              <I d={ICN.invoice} size={16} />
                            </div>
                            <div style="flex:1;min-width:0">
                              <div class="action-card__title">{m.content}</div>
                            </div>
                            <span class="action-card__chip">
                              {tFor(lang, invoiceCardChipKey(payload.status))}
                            </span>
                          </div>
                          <div class="action-card__body">
                            {(payload.lineItems ?? []).map((li, i) => (
                              <div key={i} class="action-card__row">
                                <span>{li.description}</span>
                                <strong>{fmtUSD(li.amountCents)}</strong>
                              </div>
                            ))}
                          </div>
                          {href || sendOffer
                            ? (
                              <div class="action-card__cta">
                                {sendOffer
                                  ? (
                                    <button
                                      type="button"
                                      class="action-card__btn action-card__btn--primary"
                                      data-cy="chat-invoice-card-send"
                                      disabled={sending}
                                      onClick={() =>
                                        void sendText(
                                          tFor(
                                            lang,
                                            "asstChat.invoiceCard.sendNowText",
                                            { number: sendOffer.number },
                                          ),
                                        )}
                                    >
                                      <I d={ICN.send} size={11} />{" "}
                                      {tFor(lang, "asstChat.invoiceCard.sendNow")}
                                    </button>
                                  )
                                  : null}
                                {href
                                  ? (
                                    <a
                                      class="action-card__btn"
                                      style="text-decoration:none"
                                      href={href}
                                      data-cy="chat-invoice-card-open"
                                    >
                                      <I d={ICN.invoice} size={11} /> {tFor(
                                        lang,
                                        "asstChat.invoiceFlow.viewInvoice",
                                      )}
                                    </a>
                                  )
                                  : null}
                              </div>
                            )
                            : null}
                        </div>
                        <div class="msg__time">
                          {fmtTime(m.createdAt, lang)}
                        </div>
                      </div>
                    </div>
                  );
                }

                // Action card — currently the only actionType is "quote", but
                // the renderer is structured so other types (invoice, etc.)
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
                  // REQ-369 (demo m2): the card of this thread's quote names
                  // the thread's ONE status — the header's words — not the
                  // status it was appended with ("Locked · ready to send"
                  // forever). A card for another quote keeps its own.
                  const statusLabel = payload.quoteId && ruleQuote &&
                      payload.quoteId === ruleQuote.id &&
                      payload.actionType !== "invoice"
                    ? tFor(lang, threadStatusKey(threadHeader.status))
                    : statusChipLabel(payload.status, lang);
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
                  // REQ-465 (demo cycle 3, m37): "Q-001 · Quote locked" from
                  // the first card — the card's own number, else the fetched
                  // quote's when it is this card's quote.
                  const cardNumber = actionCardNumber(payload, ruleQuote);
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
                            <span
                              class="action-card__chip"
                              data-cy="action-card-chip"
                            >
                              {numberedLabel(
                                cardNumber,
                                isSuperseded
                                  ? tFor(lang, "asstChat.actionCard.superseded")
                                  : statusLabel,
                              )}
                            </span>
                          </div>
                          <div class="action-card__body">
                            {payload.serviceAddress
                              ? (
                                <div
                                  class="action-card__row"
                                  data-cy="action-card-address"
                                >
                                  <span>
                                    {tFor(
                                      lang,
                                      "asstChat.actionCard.jobAddress",
                                    )}
                                  </span>
                                  <span>{payload.serviceAddress}</span>
                                </div>
                              )
                              : null}
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
                          {payload.status === "draft" && !isSuperseded &&
                              // REQ-563: no Lock/Edit on a quote already answered
                              !quoteAnswered(liveCardQuote(payload, ruleQuote))
                            ? (
                              <div class="action-card__cta">
                                <button
                                  type="button"
                                  class="action-card__btn action-card__btn--primary"
                                  onClick={() => lockActionCard(m, payload)}
                                  // REQ-302 (demo M29): no lock on a draft
                                  // with no price ("price abc" → $0.00)
                                  disabled={sending || !payload.quoteId ||
                                    !quoteHasPrice(lineItems, totalCents)}
                                >
                                  <I d={ICN.bolt} size={11} />{" "}
                                  {tFor(lang, "asstChat.actionCard.lockIn")}
                                </button>
                                <button
                                  type="button"
                                  class="action-card__btn"
                                  onClick={openDraftEdit}
                                  disabled={sending}
                                >
                                  {tFor(lang, "common.edit")}
                                </button>
                              </div>
                            )
                            : null}
                          {
                              // REQ-563 (cycle 4, m3): Re-open follows the
                              // live quote — none once the customer signed.
                              cardReopenAction(
                                  payload.status,
                                  liveCardQuote(payload, ruleQuote),
                                ) !== "none"
                            ? (
                              <div class="action-card__cta">
                                <button
                                  type="button"
                                  class="action-card__btn"
                                  onClick={() => reopenActionCard(m, payload)}
                                  disabled={sending || !payload.quoteId}
                                >
                                  <I d={ICN.refresh} size={11} />{" "}
                                  {tFor(lang, "asstChat.actionCard.reopen")}
                                </button>
                              </div>
                            )
                            : null}
                          {payload.quoteId &&
                              // REQ-571 (c4 p4-p2c): unless a later send
                              // divider already carries this quote's row.
                              linkOwners.has(m.id) &&
                              // REQ-460 (c3 M16): only once the quote went
                              // out — a locked quote is still being finished.
                              cardShowsCustomerLink(
                                payload.status,
                                ruleQuote && payload.quoteId === ruleQuote.id
                                  ? ruleQuote
                                  : undefined,
                              )
                            ? (
                              // REQ-310 (m13): the sent card carries the
                              // customer's link too.
                              <CustomerLinkRow
                                quoteId={payload.quoteId}
                                quoteNumber={quote?.id === payload.quoteId
                                  ? quote.number
                                  : undefined}
                                // REQ-586 (cycle 4, M11): the quote's last
                                // send language.
                                sendLang={quote?.id === payload.quoteId
                                  ? quoteSendLang(quote)
                                  : undefined}
                                lang={lang}
                                onCopy={copyLinkFor}
                              />
                            )
                            : null}
                        </div>
                        <div class="msg__time">{fmtTime(m.createdAt, lang)}</div>
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
                                const url = customerLinkPath(
                                  r.quoteId,
                                  langSignal.value,
                                );
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
                        <div class="msg__time">{fmtTime(m.createdAt, lang)}</div>
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
                      {(() => {
                        // REQ-315 (m49): a reply that changed a quote links to it.
                        const ql = m.role === "assistant"
                          ? chatQuoteLink(m.payload)
                          : undefined;
                        if (!ql) return null;
                        const number = ql.quoteNumber ??
                          tFor(lang, "asstChat.theQuote");
                        return (
                          <a
                            data-cy="msg-quote-link"
                            href={`/quotes?open=${
                              encodeURIComponent(ql.quoteId)
                            }`}
                            style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:7px 12px;border-radius:999px;background:#144852;color:#fff;font-size:12.5px;font-weight:800;text-decoration:none"
                          >
                            {tFor(
                              lang,
                              ql.publish
                                ? "asstChat.openQuotePublish"
                                : "asstChat.openQuote",
                              { number },
                            )}
                          </a>
                        );
                      })()}
                      {(() => {
                        // REQ-456 (M25): a reply that created a change order
                        // names it and links the customer's approval page.
                        const co = m.role === "assistant"
                          ? chatChangeOrderLink(m.payload)
                          : undefined;
                        if (!co) return null;
                        const number = co.number ?? "CO";
                        const pill =
                          "display:inline-flex;align-items:center;gap:6px;margin-top:6px;margin-right:6px;padding:7px 12px;border-radius:999px;font-size:12.5px;font-weight:800;text-decoration:none;cursor:pointer";
                        return (
                          <div data-cy="msg-co-link">
                            <a
                              data-cy="msg-co-open"
                              href={co.path}
                              target="_blank"
                              rel="noopener"
                              style={`${pill};border:0;background:#144852;color:#fff`}
                            >
                              {tFor(lang, "asstChat.changeOrderLink.open", {
                                number,
                              })}
                            </a>
                            <button
                              type="button"
                              data-cy="msg-co-copy"
                              style={`${pill};border:1px solid #144852;background:#fff;color:#144852`}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(
                                    `${globalThis.location.origin}${co.path}`,
                                  );
                                  setCoLinkCopied(m.id);
                                  setTimeout(() => setCoLinkCopied(null), 1500);
                                } catch { /* clipboard unavailable */ }
                              }}
                            >
                              {coLinkCopied === m.id
                                ? tFor(lang, "asstChat.preview.linkCopied")
                                : tFor(lang, "asstChat.changeOrderLink.copy", {
                                  number,
                                })}
                            </button>
                          </div>
                        );
                      })()}
                      {(() => {
                        // REQ-388 (M23): the button sends its own words
                        // ("Draft a quote at $1,500"), which the server
                        // reads as the ask and drafts from this offer.
                        if (draftOffer?.id !== m.id) return null;
                        const label = tFor(lang, "asstChat.draftOffer", {
                          amount: offerAmount(draftOffer.offer.amountCents),
                        });
                        return (
                          <button
                            type="button"
                            data-cy="msg-draft-offer"
                            disabled={sending}
                            onClick={() => void sendText(label)}
                            style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:7px 12px;border:0;border-radius:999px;background:#144852;color:#fff;font-size:12.5px;font-weight:800;cursor:pointer"
                          >
                            {label}
                          </button>
                        );
                      })()}
                      {invoiceFlowOffer?.id === m.id && (
                        <button
                          type="button"
                          data-cy="msg-invoice-flow-offer"
                          disabled={sending}
                          onClick={() =>
                            startInvoiceFlow(invoiceFlowOffer.offer)}
                          style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:7px 12px;border:0;border-radius:999px;background:#144852;color:#fff;font-size:12.5px;font-weight:800;cursor:pointer"
                        >
                          {tFor(lang, "asstChat.invoiceFlowOffer")}
                        </button>
                      )}
                      <div class="msg__time">{fmtTime(m.createdAt, lang)}</div>
                    </div>
                  </div>
                );
              });
            })()
          )}
        {!empty &&
            (sending || stepSending) &&
            messages.length > 0 &&
            messages[messages.length - 1].role === "user"
          ? (
            // REQ-670 (demo-loop cycle 5, p7): the reply as the server
            // streams it; until then the dots say in words what the turn is
            // doing ("Assistant is thinking…", "Pricing the job…").
            <PendingReplyBubble reply={liveReply} lang={lang} />
          )
          : null}
      </div>

      {(() => {
        // Roadmap p.2 / REQ-041 NW-53b: the big composer stays off the
        // "tapping-only" steps — the price screen, the Job details picker,
        // an unanswered wizard question, the Ready-to-send review — where a
        // text box underneath invited stray typing. REQ-392 (demo-loop cycle
        // 2, M7): but those steps are where the contractor needs to say
        // "that's wrong, it's the whole job", so each keeps the compact
        // "Tell the assistant…" box, whose message goes WITH the step
        // (sendStepText). The invoice review / result screens keep none.
        // The error strip survives either way: wizard-step failures
        // (customer create rejected, network flake) land in `error`, and
        // swallowing the banner made them read as "the button did nothing".
        if (composer.kind === "none") {
          return error
            ? (
              <div class="composer">
                <div class="composer__err">{error}</div>
              </div>
            )
            : null;
        }
        if (composer.kind === "step") {
          return (
            <StepComposer
              key={composerStepKey}
              step={composer.step}
              lang={lang}
              sending={sending || stepSending}
              error={error}
              onRetry={canRetryTurn && retryTurnRef.current
                ? () => {
                  const fn = retryTurnRef.current;
                  retryTurnRef.current = null;
                  setCanRetryTurn(false);
                  setError(undefined);
                  fn?.();
                }
                : undefined}
              log={stepLog?.step === composer.step ? stepLog.exchanges : null}
              pending={stepPending?.step === composer.step
                ? stepPending.text
                : null}
              onSend={(text) =>
                sendStepText(text, composer.step, composer.wizardStepId)}
              {...(stepBoxDocked
                ? {
                  open: stepBoxOpen,
                  onOpenChange: (o: boolean) =>
                    setStepBoxOpenKey(o ? composerStepKey : null),
                }
                : {})}
            />
          );
        }
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
                      placeholder={composerPlaceholder(
                        messages,
                        lang,
                        from?.business,
                        composerFlowFor(flowChip),
                      )}
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
                    {showEditHint(draft, editSeed)
                      ? tFor(lang, editHintKey(from?.business)) // REQ-581
                      : tFor(lang, "asstChat.composer.hint")}
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
  /** UX-04: the name candidate extracted from the typed quick-quote
   *  sentence ("para la familia Nguyen" → "Familia Nguyen") — prefills the
   *  create-form name input so the user isn't asked what they already said. */
  initialName?: string;
  /** REQ-265: the phone / email typed in the job sentence. */
  initialPhone?: string;
  initialEmail?: string;
  /** REQ-265: every typed fact — a typed customer the account already has
   *  is offered on the pick list; a new one opens the create form, filled
   *  (the demo got "Elige un cliente" and lost what was typed). */
  prefillFacts?: QuoteFacts;
  /** REQ-263 (demo ai-assistant-m2): the job address already on the quote
   *  (extracted from the typed sentence) — prefills the address input. */
  initialServiceAddress?: string;
  sending: boolean;
  lang?: Lang;
  onSubmit: (
    optionId: "use_active" | "pick_existing" | "create_new",
    body?: {
      serviceAddress?: string;
      customer?: {
        id?: string;
        create?: {
          name: string;
          email?: string;
          phoneNumber?: string;
          isBusiness?: boolean;
          businessName?: string;
          allowDuplicate?: boolean; // REQ-331
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
    initialName,
    initialPhone,
    initialEmail,
    prefillFacts,
    initialServiceAddress,
    sending,
    lang = "en",
    onSubmit,
  } = props;
  // Two views (shared/quote-flow/customer-step.ts): the pick LIST whenever
  // there is anyone to pick — existing customers must be pickable, never
  // buried — and the create FORM directly when there is nobody to pick.
  // `initialKind` is supplied by the lock-quote CTA. On the rare edge
  // case of a page reload with no precommit, we fall back to "person"
  // (the most common kind) rather than blocking the user.
  const [view, setView] = useState<CustomerStepView>(
    customerStepEntryView(null, !!boundCustomer),
  );
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
  const [createName, setCreateName] = useState(initialName ?? "");
  // The prefill candidate can arrive after mount (sessionStorage hand-off
  // effect) — adopt it only while the field is still untouched.
  useEffect(() => {
    if (initialName && createName.trim().length === 0) {
      setCreateName(initialName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialName]);
  /** Roadmap p.7: the "Who is this for?" step also collects a Business
   *  Name. Optional — an empty value never blocks Next. REQ-532 (demo
   *  p8-pair5-b): for a person it hides behind "+ Add a business name";
   *  for a business the required name field IS the business name. */
  const [createBusiness, setCreateBusiness] = useState("");
  const [addBusinessOpen, setAddBusinessOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState(initialEmail ?? "");
  const [createPhone, setCreatePhone] = useState(initialPhone ?? "");
  // REQ-265: like the name, the typed contact can arrive after mount (the
  // quote loads after the step renders) — adopt it while untouched.
  useEffect(() => {
    if (initialEmail && createEmail.trim().length === 0) {
      setCreateEmail(initialEmail);
    }
    if (initialPhone && createPhone.trim().length === 0) {
      setCreatePhone(initialPhone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEmail, initialPhone]);
  /** REQ-263: the job address — pre-filled from the quote, editable. */
  const [createAddress, setCreateAddress] = useState(
    initialServiceAddress ?? "",
  );
  // The quote can load after mount — adopt its address while untouched.
  useEffect(() => {
    if (initialServiceAddress && createAddress.trim().length === 0) {
      setCreateAddress(initialServiceAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialServiceAddress]);
  const [localErr, setLocalErr] = useState<string | undefined>();
  // REQ-331 (demo m7/m44): the one customer the step can offer with a tap —
  // the thread's bound customer, else the existing customer the typed facts
  // name. Rendered as "Use María López ✓ / Change" instead of a pick list
  // (or "Business or person?") the contractor has to work through again.
  const known = useMemo(
    () => knownCustomerForStep(boundCustomer, customers, prefillFacts),
    [boundCustomer, customers, prefillFacts],
  );
  const [changed, setChanged] = useState(false);
  // REQ-265: once the account's customers AND the typed facts are known,
  // decide once — a typed customer the account has is offered as the known
  // customer above; a new one opens the create form (already filled). A
  // customer already bound to the thread wins.
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (prefillAppliedRef.current || boundCustomer) return;
    if (!customers || !prefillFacts) return;
    if (
      !prefillFacts.customerName && !prefillFacts.customerPhone &&
      !prefillFacts.customerEmail
    ) return;
    prefillAppliedRef.current = true;
    const match = matchPrefillCustomer(customers, prefillFacts);
    if (match) return;
    setView((v) => customerStepPrefillView(v, prefillFacts, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, prefillFacts]);
  // REQ-331 (demo m44): the contractor saw "<name> already exists" on the
  // create form and chose to create a second one anyway.
  const [createAnyway, setCreateAnyway] = useState(false);
  // REQ-390 (demo m19): the missing-contact reason is a neutral hint until a
  // contact field was typed in or left; the name's message waits for the
  // name field to be left.
  const [nameTouched, setNameTouched] = useState(false);
  const [contactTouched, setContactTouched] = useState(false);
  // REQ-524 (demo-loop cycle 3, p8-pair7-a): a phone / email FORMAT error
  // waits for that field to be left — not after the first digit typed.
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
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
          // (Only ever downgrade list→form here: forcing "list" could yank
          // a user who already opened the create form themselves.)
          if (customerStepEntryView(list.length, !!boundCustomer) === "form") {
            setView("form");
          }
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
  // REQ-279 (demo M32): accent-blind — "Maria" finds "María", not an offer to create her twice
  const filtered = (customers ?? []).filter((c) =>
    customerMatchesQuery(c, search)
  );

  // ---- View: form ----
  if (view === "form") {
    const trimmedName = createName.trim();
    const trimmedEmail = createEmail.trim();
    const trimmedPhone = createPhone.trim();
    // REQ-278 / REQ-390 (demo m18, m19): one rule, one message PER FIELD —
    // a bad phone AND a bad email are both named, each under its own input;
    // the contractor's own phone / email is refused (the "every customer
    // carries my email/phone, and the agreement sends to me" bug); no
    // contact at all is REQ-029's visible-from-the-start reason, a neutral
    // hint until a contact field was touched. The inputs sit outside a
    // <form>, so the browser's own type=email check never ran.
    const feedback = customerStepFeedback(
      { name: trimmedName, email: trimmedEmail, phoneNumber: trimmedPhone },
      {
        ownerEmail,
        ownerPhone,
        nameTouched,
        contactTouched,
        phoneTouched, emailTouched, // REQ-524
      },
    );
    const submitDisabled = sending || !feedback.canSubmit;
    // REQ-331 (demo m44): live-search what is typed against the account's
    // customers — the same phone / email / accent-folded name rule the
    // server applies — and offer the existing one before a second "x" is
    // made. "Create anyway" sends allowDuplicate.
    const dupe = createAnyway ? null : findExistingCustomer(customers, {
      name: trimmedName,
      email: trimmedEmail,
      phoneNumber: trimmedPhone,
    });
    // REQ-390 (demo M18): the warning shows WHICH customer exists ("Bob ·
    // (512) 555-0142"), and a name-only match with another phone/email reads
    // as "another Bob".
    const dupeNotice = dupe
      ? duplicateNotice(dupe, {
        name: trimmedName,
        email: trimmedEmail,
        phoneNumber: trimmedPhone,
      })
      : null;
    const formHeading = tFor(lang, "asstChat.customerStep.whoFor");
    // REQ-532 (demo p8-pair5-b): the Business / Person pick shapes the form.
    const shape = customerCreateShape(kind, addBusinessOpen);
    const namePlaceholder = tFor(lang, shape.nameKey);
    const businessName = customerCreateBusinessName(
      kind,
      trimmedName,
      createBusiness,
    );
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
            onBlur={() => setNameTouched(true)}
            aria-invalid={feedback.name ? "true" : undefined}
            aria-describedby={feedback.name ? "cust-name-err" : undefined}
            autoFocus
          />
          {feedback.name
            ? (
              <div
                id="cust-name-err"
                class="cust-pick__err"
                data-cy="cust-name-err"
              >
                {tFor(lang, feedback.name)}
              </div>
            )
            : null}
          {shape.showBusinessField
            ? (
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
                autoFocus
              />
            )
            : shape.offerAddBusiness
            ? (
              <button
                type="button"
                class="cust-create__add"
                data-cy="wizard-add-business-name"
                onClick={() => setAddBusinessOpen(true)}
              >
                {tFor(lang, "asstChat.customerStep.addBusinessName")}
              </button>
            )
            : null}
          <div class="cust-create__row">
            <input
              type="tel"
              class="cust-pick__search"
              placeholder={tFor(lang, "asstChat.customerStep.phonePlaceholder")}
              aria-label={tFor(lang, "asstChat.customerStep.phonePlaceholder")} /* REQ-289 */
              value={formatPhoneInput(createPhone)} /* NW-34 (REQ-012) */
              onInput={(e) => {
                setCreatePhone((e.target as HTMLInputElement).value);
                setContactTouched(true);
              }}
              onBlur={() => {
                setContactTouched(true);
                setPhoneTouched(true); // REQ-524
              }}
              aria-invalid={feedback.phone ? "true" : undefined}
              aria-describedby={feedback.phone ? "cust-phone-err" : undefined}
            />
            <input
              type="email"
              class="cust-pick__search"
              placeholder={tFor(lang, "asstChat.customerStep.emailPlaceholder")}
              aria-label={tFor(lang, "asstChat.customerStep.emailPlaceholder")} /* REQ-289 */
              value={createEmail}
              onInput={(e) => {
                setCreateEmail((e.target as HTMLInputElement).value);
                setContactTouched(true);
              }}
              onBlur={() => {
                setContactTouched(true);
                setEmailTouched(true); // REQ-524
              }}
              aria-invalid={feedback.email ? "true" : undefined}
              aria-describedby={feedback.email ? "cust-email-err" : undefined}
            />
          </div>
          {
            /* REQ-575 (demo-loop cycle 4, M3): pair 10's typed phone "555"
              was dropped without a word — while the phone box is empty, the
              form says the number in the message is not a full one. */
          }
          {prefillFacts?.unusablePhone && !trimmedPhone
            ? (
              <div class="cust-pick__hint" data-cy="cust-phone-unusable">
                {tFor(lang, "asstChat.customerStep.phoneUnusable", {
                  phone: prefillFacts.unusablePhone,
                })}
              </div>
            )
            : null}
          {feedback.phone
            ? (
              <div
                id="cust-phone-err"
                class="cust-pick__err"
                data-cy="cust-phone-err"
              >
                {tFor(lang, feedback.phone)}
              </div>
            )
            : null}
          {feedback.email
            ? (
              <div
                id="cust-email-err"
                class="cust-pick__err"
                data-cy="cust-email-err"
              >
                {tFor(lang, feedback.email)}
              </div>
            )
            : null}
          <input
            type="text"
            data-cy="wizard-service-address"
            class="cust-pick__search"
            autocomplete="street-address"
            placeholder={tFor(
              lang,
              "asstChat.customerStep.serviceAddressPlaceholder",
            )}
            aria-label={tFor(
              lang,
              "asstChat.customerStep.serviceAddressPlaceholder",
            )}
            value={createAddress}
            onInput={(e) =>
              setCreateAddress((e.target as HTMLInputElement).value)}
          />
          {localErr
            ? <div class="cust-pick__err">{localErr}</div>
            : feedback.contact
            ? (
              /* REQ-029 visible from the start; REQ-390 (m19) a hint until touched */
              <div
                class={feedback.contact.tone === "error"
                  ? "cust-pick__err"
                  : "cust-pick__hint"}
                data-cy="cust-contact-hint"
                role={feedback.contact.tone === "error" ? "alert" : undefined}
              >
                {tFor(lang, feedback.contact.key)}
              </div>
            )
            : null}
          {dupe && dupeNotice
            ? (
              <div class="cust-pick__err" data-cy="cust-already-exists">
                {tFor(lang, dupeNotice.key, dupeNotice.params)}
              </div>
            )
            : null}
          <div class="cust-create__actions">
            {dupe
              ? (
                <>
                  <button
                    type="button"
                    class="cust-create__btn cust-create__btn--primary"
                    data-cy="cust-use-existing"
                    disabled={sending}
                    onClick={() =>
                      onSubmit("pick_existing", {
                        ...(createAddress.trim()
                          ? { serviceAddress: createAddress.trim() }
                          : {}),
                        customer: { id: dupe.id },
                      })}
                  >
                    {tFor(lang, "asstChat.customerStep.useExisting", {
                      name: dupe.name,
                    })}
                  </button>
                  <button
                    type="button"
                    class="cust-create__btn"
                    data-cy="cust-create-anyway"
                    disabled={sending}
                    onClick={() => setCreateAnyway(true)}
                  >
                    {tFor(lang, "asstChat.customerStep.createAnyway")}
                  </button>
                </>
              )
              : null}
            <button
              type="button"
              class="cust-create__btn cust-create__btn--primary"
              style={dupe ? "display:none" : undefined}
              disabled={submitDisabled}
              onClick={() =>
                onSubmit("create_new", {
                  ...(createAddress.trim()
                    ? { serviceAddress: createAddress.trim() }
                    : {}),
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
                      ...(businessName ? { businessName } : {}), // REQ-532
                      ...(createAnyway ? { allowDuplicate: true } : {}), // REQ-331
                    },
                  },
                })}
            >
              {tFor(lang, "common.next")}
            </button>
            {/* Single-back rule: no back button inside the widget. When
                there is anyone to pick, offer the pick list as a FORWARD
                affordance instead — existing customers must be pickable,
                never buried behind an "Atrás". */}
            {formOffersPickExisting(
              customers?.length ?? null,
              !!boundCustomer,
            ) && (
              <button
                type="button"
                class="cust-create__btn"
                data-cy="customer-pick-existing"
                onClick={backToList}
                disabled={sending}
              >
                {tFor(lang, "asstChat.customerStep.existingTrigger")}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---- View: known customer (REQ-331) — one tap, or "Change" to the list ----
  if (known && !changed) {
    const k = known.customer;
    return (
      <div ref={rootRef}>
        <h3 class="wiz__step-q">
          {tFor(lang, "asstChat.customerStep.whoFor")}
        </h3>
        <div class="wiz__step-hint">
          {tFor(
            lang,
            known.source === "bound"
              ? "asstChat.customerStep.knownFromChat"
              : "asstChat.customerStep.knownFromTyped",
          )}
        </div>
        <div
          class="wiz__opts"
          style="flex-direction:column;align-items:stretch;gap:8px;margin-top:8px"
        >
          <button
            type="button"
            class="wiz-opt"
            data-cy="customer-use-known"
            onClick={() =>
              known.source === "bound"
                ? onSubmit("use_active")
                : onSubmit("pick_existing", { customer: { id: k.id } })}
            disabled={sending}
          >
            {tFor(lang, "asstChat.customerStep.useKnown", { name: k.name })}
            {/* REQ-366: the check is an SVG icon, never a Dingbat glyph */}
            {" "}
            <Icon name="check" size={14} style="vertical-align:-2px" />
            {k.email || k.phoneNumber
              ? <span class="wiz-opt__sub">{k.email ?? k.phoneNumber}</span>
              : null}
          </button>
          {localErr ? <div class="cust-pick__err">{localErr}</div> : null}
          <button
            type="button"
            class="wiz-opt wiz-opt--custom"
            data-cy="customer-change"
            onClick={() => setChanged(true)}
            disabled={sending}
          >
            {tFor(lang, "asstChat.customerStep.change")}
          </button>
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
                          {/* REQ-029 (NW-22 / NW-35): the search box is a
                              filter — a no-match must not be a dead end.
                              Offer to create exactly what was typed. */}
                          {search.trim().length > 0
                            ? (
                              <button
                                type="button"
                                class="cust-pick__row cust-pick__row--create"
                                data-cy="cust-create-from-search"
                                disabled={sending}
                                onClick={() => {
                                  setCreateName(search.trim());
                                  setSearch("");
                                  setPickerOpen(false);
                                  openCreate();
                                }}
                              >
                                {tFor(lang, "asstChat.customerStep.createNamed", {
                                  name: search.trim(),
                                })}
                              </button>
                            )
                            : null}
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
 * DepositAmountPicker — REQ-678 (demo-loop cycle 5, c3-m60).
 *
 * "Deposit + balance" used to bill a silent 20%. Picking it now swaps the
 * option list for "How much upfront?": one chip per DEPOSIT_PCT_CHOICES
 * (each naming its dollars once the total is known) and a custom $ amount.
 * onPick gets the stored English term — "Deposit 30% + balance" /
 * "Deposit $500 + balance" — which computePaymentSplit bills.
 * =========================================================================== */
function DepositAmountPicker(props: {
  totalCents: number;
  sending: boolean;
  lang?: Lang;
  onPick: (value: string) => void;
  onCancel: () => void;
}) {
  const { totalCents, sending, lang = "en", onPick, onCancel } = props;
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const chips = depositChoices(totalCents);
  const raw = custom.replace(/[$,\s]/g, "");
  const customCents = raw === "" ? NaN : Math.round(Number(raw) * 100);
  const overTotal = totalCents > 0 && Number.isFinite(customCents) &&
    customCents >= totalCents;
  const customValid = Number.isFinite(customCents) && customCents > 0 &&
    !overTotal;
  const submitCustom = () => {
    if (customValid) onPick(depositTermValue({ cents: customCents }));
  };
  return (
    <div class="cust-create" data-testid="deposit-pick">
      <div class="wiz-field__label">
        {tFor(lang, "asstChat.depositPick.question")}
      </div>
      <div class="wiz__opts">
        {chips.map((c) => (
          <button
            key={c.pct}
            type="button"
            class="wiz-opt"
            data-testid={`deposit-pick-${c.pct}`}
            disabled={sending}
            onClick={() => onPick(c.value)}
          >
            {`${c.pct}%`}
            {c.deposit && c.balance
              ? (
                <span class="wiz-opt__sub">
                  {tFor(lang, "asstChat.depositPick.chipSub", {
                    deposit: c.deposit,
                    balance: c.balance,
                  })}
                </span>
              )
              : null}
          </button>
        ))}
        <button
          type="button"
          class="wiz-opt wiz-opt--custom"
          data-testid="deposit-pick-custom"
          disabled={sending}
          onClick={() => setCustomOpen(true)}
        >
          {tFor(lang, "asstChat.depositPick.custom")}
        </button>
      </div>
      {customOpen
        ? (
          <div class="cust-create__row">
            <label class="wiz-field">
              <span class="wiz-field__input">
                <span class="wiz-field__suffix">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step="0.01"
                  class="cust-pick__search"
                  data-testid="deposit-pick-amount"
                  placeholder={tFor(
                    lang,
                    "asstChat.depositPick.customPlaceholder",
                  )}
                  value={custom}
                  autoFocus
                  onInput={(e) =>
                    setCustom((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCustom();
                  }}
                />
              </span>
            </label>
            {overTotal
              ? (
                <p class="recovery-card__error" role="alert">
                  {tFor(lang, "asstChat.depositPick.overTotal", {
                    total: fmtUSD(totalCents),
                  })}
                </p>
              )
              : null}
            <button
              type="button"
              class="cust-create__btn cust-create__btn--primary"
              data-testid="deposit-pick-use"
              disabled={sending || !customValid}
              onClick={submitCustom}
            >
              {tFor(lang, "asstChat.depositPick.use")}
            </button>
          </div>
        )
        : null}
      <div class="cust-create__actions">
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

  // REQ-495 (m17): the picker speaks the app's language, not the browser's.
  const dateLocale = lang === "es" ? "es-MX" : "en-US";
  const monthLabel = viewMonth.toLocaleString(dateLocale, {
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
  const longLabel = picked.toLocaleDateString(dateLocale, {
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
          // REQ-495 (m17): the start term is stored ISO; every reader
          // formats it in its own language (localizeTermValue).
          onClick={() => onSubmit(toIso(picked))}
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
  unit: "hours" | "days" | "weeks" | "months";
  confidence: "ok" | "guess";
} | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;
  let unit: "hours" | "days" | "weeks" | "months";
  if (/\bmonths?\b|\bmos?\b|\bmo\b/.test(t)) unit = "months";
  else if (/\bweeks?\b|\bwks?\b/.test(t)) unit = "weeks";
  else if (/\bdays?\b|\bd\b/.test(t)) unit = "days";
  // REQ-343: service jobs are quoted in hours.
  else if (/\bhours?\b|\bhrs?\b|\bhoras?\b/.test(t)) unit = "hours";
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
 *  agreement value always comes from the verify form so an LLM/parser miss
 *  never propagates — the user has the final word. */
function CustomDurationPickerForm(props: {
  /** REQ-343: the duration the user already typed into the job, if any. */
  initial?: ExtractedDuration | null;
  sending: boolean;
  lang?: Lang;
  onSubmit: (durationStr: string) => void;
  onCancel: () => void;
}) {
  const { sending, lang = "en", onSubmit, onCancel } = props;
  // P-25/P-24: "Personalizado" opens the STRUCTURED picker (number + unit +
  // presets + a live agreement preview) straight away. It used to land on a
  // chat-style free-text ask that popped the keyboard for what is literally
  // a number and a unit; describing it in words is still one tap away via
  // "Probar de otra forma".
  const [phase, setPhase] = useState<"ask" | "verify">("verify");
  const [freeText, setFreeText] = useState("");
  const [parseFailed, setParseFailed] = useState(false);
  // REQ-343 (p6): open on the duration the job already names, else an EMPTY
  // number — never a made-up "3 weeks".
  const [n, setN] = useState(
    props.initial?.n != null ? String(props.initial.n) : "",
  );
  const [unit, setUnit] = useState<"hours" | "days" | "weeks" | "months">(
    props.initial?.unit ?? "days",
  );
  const [confidence, setConfidence] = useState<"ok" | "guess" | "fail">("ok");
  const [heardFrom, setHeardFrom] = useState("");

  // REQ-390 (demo m18): the number is checked as typed — "-3" used to be
  // clamped to 1 first and read "1 day" in the agreement.
  const parsedNum = parseDurationNumber(n);
  const num = parsedNum.n ?? 0;
  const valid = parsedNum.n !== null;
  // P-25: the manual duration control used to build the EN string
  // ("3 weeks") and submit it verbatim into a Spanish agreement. Preview AND
  // submitted value now go through termLabel, so an ES contractor locks in
  // "3 semanas".
  // REQ-458 (demo M38): an empty number asks for one ("Type a number")
  // instead of a bare "—" that read as a dead end.
  const emptyHint = durationPreviewHint(n);
  const preview = valid
    ? termLabel({ kind: "duration", value: { n: num, unit } }, lang)
    : emptyHint
    ? tFor(lang, emptyHint)
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
        {/* REQ-458 (demo M38): visible labels + an "e.g. 3" placeholder so
            the empty number box reads as the thing to fill in. */}
        <label class="dur__label" for="dur-num">
          {tFor(lang, "asstChat.duration.numberLabel")}
        </label>
        <label class="dur__label" for="dur-unit">
          {tFor(lang, "asstChat.duration.unitLabel")}
        </label>
        <input
          id="dur-num"
          type="number"
          class="cust-pick__search dur__num"
          placeholder={tFor(lang, "asstChat.duration.numberPlaceholder")}
          inputMode="numeric"
          min={1}
          max={99}
          step={1}
          value={n}
          onInput={(e) => {
            // REQ-390 (m18): keep what was typed; the rule below explains a
            // bad number instead of silently turning it into another one.
            // REQ-343: an untouched empty number stays empty.
            setN((e.target as HTMLInputElement).value);
          }}
          autoFocus
          aria-invalid={parsedNum.error ? "true" : undefined}
          aria-describedby={parsedNum.error ? "dur-num-err" : undefined}
        />
        <select
          id="dur-unit"
          class="cust-pick__search dur__unit"
          value={unit}
          onChange={(e) =>
            setUnit(
              (e.currentTarget as HTMLSelectElement).value as typeof unit,
            )}
        >
          <option value="hours">{tFor(lang, "asstChat.unit.hours")}</option>
          <option value="days">{tFor(lang, "asstChat.unit.days")}</option>
          <option value="weeks">{tFor(lang, "asstChat.unit.weeks")}</option>
          <option value="months">{tFor(lang, "asstChat.unit.months")}</option>
        </select>
      </div>
      {parsedNum.error
        ? (
          <div id="dur-num-err" class="cust-pick__err" data-cy="dur-num-err">
            {tFor(lang, parsedNum.error)}
          </div>
        )
        : null}
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
          {tFor(lang, "asstChat.verify.agreementReads")}
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
 *  "lifetime" / "no warranty" extremes that read naturally on an agreement.
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

  // Normalise unwieldy values to a unit that reads better on an agreement:
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
 *  chat, parse, then a structured verify form so the agreement value is
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
  // months" and submit them verbatim into a Spanish agreement. Preview AND
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
          {tFor(lang, "asstChat.verify.agreementReads")}
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
 *  splits). The agreement value always comes from the verify form's preview
 *  string so a parser miss never propagates downstream. */
function CustomPaymentPickerForm(props: {
  sending: boolean;
  lang?: Lang;
  /** REQ-387 (demo M25): a schedule the job message stated ("30% deposit,
   *  40% at cabinets install, 30% at completion") — opens on verify. */
  initialSplits?: number[];
  onSubmit: (paymentStr: string) => void;
  onCancel: () => void;
}) {
  const { sending, lang = "en", initialSplits, onSubmit, onCancel } = props;
  const seeded = !!initialSplits && initialSplits.length >= 2 &&
    initialSplits.length <= 4;
  const [phase, setPhase] = useState<"ask" | "verify">(
    seeded ? "verify" : "ask",
  );
  const [freeText, setFreeText] = useState("");
  const [parseFailed, setParseFailed] = useState(false);
  const [mode, setMode] = useState<"net" | "split">(seeded ? "split" : "net");
  const [netDays, setNetDays] = useState("30");
  const [splits, setSplits] = useState<string[]>(
    seeded ? initialSplits!.map(String) : ["50", "50"],
  );
  const [confidence, setConfidence] = useState<"ok" | "guess" | "fail">("ok");
  const [heardFrom, setHeardFrom] = useState(
    seeded ? initialSplits!.join(" / ") : "",
  );

  const days = Math.max(0, Math.min(180, Number(netDays) || 0));
  const splitNums = splits.map((s) =>
    Math.max(0, Math.min(100, Number(s) || 0))
  );
  const splitSum = splitNums.reduce((a, b) => a + b, 0);
  const splitsValid = splitNums.length >= 2 && splitSum === 100;

  // P-25: the fallback used to build "Net 30" / "Net 0 — due on completion"
  // and submit them verbatim into a Spanish agreement. Preview AND submitted
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
          {tFor(lang, "asstChat.verify.agreementReads")}
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
    if (!isQuoteCardPayload(p)) continue; // REQ-368: an invoice card's total
    if (isLockedOrIssued(p.status) && typeof p.totalCents === "number") {
      return p.totalCents;
    }
  }
  return 0;
}

/**
 * REQ-383 (demo M26): scroll the chat panel so the job-options picker opens
 * on its head and first card — the head at the panel's top, or, when the head
 * and a tall first card do not both fit, as far down as shows that whole card
 * (never past the card's own top). Two frames late, so it lands after the
 * panel's own pin-to-bottom (a ResizeObserver → rAF) for the same growth; an
 * instant scroll cancels that smooth one. A picker that fits is a no-op.
 * Returns a cleanup that cancels the pending frames.
 */
function revealPicker(scroller: HTMLElement | null): () => void {
  let raf = 0;
  if (!scroller) return () => {};
  raf = requestAnimationFrame(() => {
    raf = requestAnimationFrame(() => {
      const picker = scroller.querySelector<HTMLElement>(".chat__jobopts");
      if (!picker) return;
      const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
      const pad = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      let top = picker.getBoundingClientRect().top - base - pad;
      const card = picker.querySelector<HTMLElement>(".chat__jobopt");
      if (card) {
        const r = card.getBoundingClientRect();
        const cardTop = r.top - base - 8;
        const cardBottom = r.bottom - base + 8;
        if (cardBottom - top > scroller.clientHeight) {
          top = Math.min(cardTop, cardBottom - scroller.clientHeight);
        }
      }
      scroller.scrollTo({ top: Math.max(0, top), behavior: "instant" });
    });
  });
  return () => cancelAnimationFrame(raf);
}
