import { useEffect, useRef, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { assistantClient, type ContractLite, type CustomerLite, type Message } from "../clients/assistant.ts";
import { filesClient } from "../clients/files.ts";

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

interface ActionCardLineItem {
  description: string;
  amountCents: number;
}

interface ActionCardPayload {
  actionType?: string;
  status?: "draft" | "sent" | "void" | string;
  quoteId?: string;
  customerId?: string;
  lineItems?: ActionCardLineItem[];
  totalCents?: number;
}

function fmtUSD(cents: number): string {
  if (!Number.isFinite(cents)) return "$0";
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
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

/** Derive a stable 1-2 letter avatar string from whatever user fields we have.
 *  Order: full name → first+last initials. Single-token name → first 2 letters.
 *  No name → last 2 digits of phone. Nothing → "?". Used by the assistant chat
 *  bubble; the previous version hardcoded "DR" which surfaced on every account
 *  including users with no name set. */
export function deriveUserInitials(input: { name?: string; phoneNumber?: string }): string {
  const name = input.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  const phone = input.phoneNumber?.replace(/\D/g, "");
  if (phone && phone.length >= 2) return phone.slice(-2);
  return "?";
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
function buildPaymentMilestones(value: string, totalCents: number): PaymentMilestone[] | null {
  const v = value.trim().toLowerCase();
  if (!v || totalCents <= 0) return null;

  // Slash- or comma-separated percentages: "30 / 30 / 40", "50/50", "25, 25, 50".
  const parts = v.split(/[\/,]+/).map((s) => s.trim()).filter(Boolean);
  const numbers = parts.map((p) => parseFloat(p)).filter((n) => Number.isFinite(n));
  const sum = numbers.reduce((a, b) => a + b, 0);
  if (numbers.length >= 2 && Math.abs(sum - 100) <= 1) {
    const labels = numbers.length === 2
      ? ["Deposit", "On completion"]
      : numbers.length === 3
        ? ["Deposit", "Midpoint", "On completion"]
        : numbers.map((_, i) => i === 0 ? "Deposit" : i === numbers.length - 1 ? "On completion" : `Milestone ${i}`);
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
    return [{ label: `Due in full · net ${netMatch[1]}`, amountCents: totalCents }];
  }

  // "Deposit + balance" — small upfront, balance on completion. No
  // explicit split in the option label; default to 25/75 (matches the
  // wizard's deposit_bal preset hint).
  if (v.includes("deposit") && v.includes("balance")) {
    const deposit = Math.round(totalCents * 0.25);
    return [
      { label: "Deposit",              pct: 25, amountCents: deposit },
      { label: "Balance on completion", pct: 75, amountCents: totalCents - deposit },
    ];
  }

  // Custom / unrecognized — let the caller fall back to the single total.
  return null;
}

export default function AsstChat({ conversationId, initialMessages, initialCustomer, initialContract, userInitials = "?" }: Props) {
  const [convoId, setConvoId] = useState<string | undefined>(conversationId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [customer, setCustomer] = useState<CustomerLite | undefined>(initialCustomer);
  const [contract, setContract] = useState<ContractLite | undefined>(initialContract);
  const [quoteId, setQuoteId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  /**
   * Tracks `continue_cta` messages whose Review button has been clicked.
   * Drives the inline "Drafted ✓" confirmation state — replaces the
   * placeholder alert() that used to fire when the user reached the end
   * of the wizard. Real send flow (email + signature) is still pending,
   * but the user gets a clean acknowledgement instead of a system popup.
   */
  const [reviewedCtas, setReviewedCtas] = useState<Set<string>>(new Set());
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
  const [followUpPick, setFollowUpPick] = useState<{ messageId: string; optionId: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const [error, setError] = useState<string | undefined>();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStartRef = useRef<number>(0);
  const recTickRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setConvoId(conversationId);
    setMessages(initialMessages);
    setCustomer(initialCustomer);
    setContract(initialContract);
  }, [conversationId]);

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
      const distFromBottom = scroller!.scrollHeight - scroller!.scrollTop - scroller!.clientHeight;
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
    if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
  }, [previewCtaId]);

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
    optimistic: { role: "user" | "assistant"; kind: "text" | "voice" | "image"; content: string },
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
    setDraft("");
    autosize();
    await submitTurn(
      { role: "user", kind: "text", content: trimmed },
      () => assistantClient.chat({ conversationId: convoId, content: trimmed, kind: "text" }) as Promise<{
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
   * turn with kind=voice + payload.fileId. The backend transcribes via
   * AssemblyAI and returns the persisted user message with the transcript
   * as content — that replaces our "Transcribing…" stub bubble.
   */
  async function sendVoice(blob: Blob, elapsedSec: number) {
    await submitTurn(
      {
        role: "user",
        kind: "voice",
        content: `🎙️ Voice memo · ${elapsedSec}s · ${fmtKB(blob.size)} — transcribing…`,
      },
      async () => {
        const file = await filesClient.uploadBlob(blob, `voice-${Date.now()}.webm`);
        return await assistantClient.chat({
          conversationId: convoId,
          kind: "voice",
          payload: { fileId: file.id },
        }) as {
          conversation?: { id: string };
          newMessages?: Message[];
          message?: Message;
          conversationId?: string;
        };
      },
    );
  }

  function onSendClick() { sendText(draft); }

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
            { description: "Backsplash tile install (30 sqft)", quantity: 1, unit: "ea", price: 1200 },
          ],
          estimatedTotal: 1200,
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
        method: "POST", credentials: "include",
      });
      await fetch("/api/agents/wizard/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ conversationId: conv.id, stepId: "config", optionId: "standard_residential" }),
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
  async function submitContinueCta(message: Message) {
    if (sending) return;
    const payload = (message.payload ?? {}) as { toPhase?: string; contractId?: string };
    if (payload.toPhase === "terms") {
      if (!convoId) return;
      setError(undefined);
      setSending(true);
      // Optimistically drop the CTA so it doesn't linger after the click.
      setMessages((m) => m.filter((x) => x.id !== message.id));
      try {
        const res = await assistantClient.transitionToTerms(convoId) as {
          conversation?: { id: string };
          newMessages?: Message[];
        };
        if (Array.isArray(res.newMessages) && res.newMessages.length > 0) {
          setMessages((m) => [...m, ...res.newMessages!]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "couldn't advance to terms");
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
          const qId = (detail.conversation as { quoteId?: string } | undefined)?.quoteId
            ?? (detail.contract as { quoteId?: string } | undefined)?.quoteId;
          if (qId) setQuoteId(qId);
        } catch (err) {
          setError(err instanceof Error ? err.message : "couldn't load the contract");
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
        setError(err instanceof Error ? err.message : "couldn't send the invoice");
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
      setError(err instanceof Error ? err.message : "couldn't simulate acceptance");
    } finally {
      setSending(false);
    }
  }

  /**
   * Fire the post-wizard "Ready to send" CTA: emails the assembled
   * contract to the customer via the SendContract coordinator. The
   * quote was already emailed during lock-quote, so this surface is
   * now contract-only. Idempotent server-side (re-clicks redeliver),
   * so flipping local state optimistically is safe.
   */
  async function confirmSendContract(message: Message) {
    if (sending || !convoId) return;
    const payload = (message.payload ?? {}) as { contractId?: string };
    let id = payload.contractId ?? contract?.id;
    setError(undefined);
    setSending(true);
    try {
      if (!id) {
        const detail = await assistantClient.conversation(convoId);
        id = detail.contract?.id
          ?? (detail.conversation as { contractId?: string } | undefined)?.contractId;
        if (detail.contract) setContract(detail.contract);
      }
      if (!id) throw new Error("no contract bound to this conversation");
      const res = await assistantClient.sendContract(convoId, id);
      setReviewedCtas((prev) => {
        const next = new Set(prev);
        next.add(message.id);
        return next;
      });
      setContract((c) => c ? { ...c, status: "sent" } : c);
      setPreviewCtaId(null);
      if (res.newMessages?.length) {
        setMessages((m) => [...m, ...res.newMessages]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't send the contract");
    } finally {
      setSending(false);
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
        create?: { name: string; email?: string; phoneNumber?: string };
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
      customer?: { id?: string; create?: { name: string; email?: string; phoneNumber?: string } };
      followUpValues?: Record<string, string | number>;
    },
  ) {
    if (sending || !convoId) return;
    setError(undefined);
    setSending(true);
    setMessages((m) => m.filter((x) => x.id !== message.id));
    try {
      const res = await assistantClient.answerWizard({ conversationId: convoId, ...body });
      // Pick up the freshly-bound customer from the conversation patch
      // (the create_new and pick_existing flows mutate conv.customerId).
      if (res.conversation && typeof res.conversation === "object") {
        const newCustomerId = (res.conversation as { customerId?: string }).customerId;
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

  async function toggleRecord() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("microphone not available in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recTickRef.current) { clearInterval(recTickRef.current); recTickRef.current = null; }
        setRecording(false);
        const elapsed = Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000));
        const blob = new Blob(recChunksRef.current, { type: rec.mimeType || "audio/webm" });
        sendVoice(blob, elapsed);
      };
      rec.start();
      recorderRef.current = rec;
      recStartRef.current = Date.now();
      setRecElapsed(0);
      setRecording(true);
      recTickRef.current = globalThis.setInterval(() => {
        setRecElapsed(Math.round((Date.now() - recStartRef.current) / 1000));
      }, 250) as unknown as number;
    } catch {
      setError("microphone permission denied");
    }
  }

  const empty = messages.length === 0;

  return (
    <>
      <div class="chat__scroll" ref={scrollRef}>
        {empty
          ? (
            <div class="chat__empty">
              <div class="chat__empty-icon"><img src="/logo-monster.png" alt="" /></div>
              <h3 class="chat__empty-title">Start a conversation with Bossie</h3>
              <p class="chat__empty-sub">
                Tell me about a job — voice or text. I'll draft the quote, walk through contract terms, and have it ready to send.
              </p>
              <div class="chat__empty-prompts">
                <button type="button" class="chat__empty-prompt" onClick={() => sendText("Quote a 2-car garage epoxy floor, ~480 sqft, polyaspartic.")}>
                  Quote a garage epoxy floor
                </button>
                <button type="button" class="chat__empty-prompt" onClick={() => sendText("Need a quote for kitchen backsplash, ~30 sqft, white subway tile.")}>
                  Kitchen backsplash quote
                </button>
                <button type="button" class="chat__empty-prompt" onClick={() => sendText("Follow up on overdue invoice INV-204.")}>
                  Nudge an overdue invoice
                </button>
              </div>
              {typeof globalThis.location !== "undefined" && globalThis.location.hostname === "localhost"
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
          : (() => {
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
              const sid = (x.payload as { wizardStepId?: string } | undefined)?.wizardStepId;
              if (x.kind === "text" && sid) answeredStepIds.add(sid);
            }
            let activeWizardId: string | undefined;
            for (let i = messages.length - 1; i >= 0; i--) {
              const m = messages[i];
              if (m.kind !== "wizard") continue;
              const stepId = (m.payload as { stepId?: string } | undefined)?.stepId;
              if (!stepId || !answeredStepIds.has(stepId)) {
                activeWizardId = m.id;
                break;
              }
            }
            const visible = messages.filter((m) => {
              if (m.kind !== "wizard") return true;
              const stepId = (m.payload as { stepId?: string } | undefined)?.stepId;
              if (stepId && answeredStepIds.has(stepId)) return false;
              return m.id === activeWizardId;
            });
            return visible.map((m) => {
              const wizardStepId = (m.payload as { wizardStepId?: string } | undefined)?.wizardStepId;
              if (m.role === "user" && wizardStepId) {
                // Compact pick log — one line, no avatar, no bubble.
                return (
                  <div key={m.id} class="wiz-log">
                    <span class="wiz-log__check">✓</span>
                    <span class="wiz-log__text">{m.content}</span>
                  </div>
                );
              }
            // Phase divider — full-width separator with a label, no avatar/bubble.
            if (m.kind === "phase_divider") {
              const label = (m.payload as { label?: string } | undefined)?.label ?? m.content;
              return (
                <div key={m.id} class="phase-divider">
                  <div class="phase-divider__line" />
                  <div class="phase-divider__label">
                    <I d={ICN.contract} size={11} /> {label}
                  </div>
                  <div class="phase-divider__line" />
                </div>
              );
            }

            // Continue-CTA — clickable card that fires phase transition.
            // For toPhase=send (wizard complete), clicking the Review button
            // transitions the card itself into a calm "Drafted ✓" state
            // showing the contract id inline. No popup — the user gets a
            // visible acknowledgement that the action registered.
            if (m.kind === "continue_cta") {
              const payload = (m.payload ?? {}) as { toPhase?: string; summary?: string; contractId?: string };
              const reviewed = (payload.toPhase === "send" || payload.toPhase === "invoice")
                && reviewedCtas.has(m.id);
              const previewing = payload.toPhase === "send" && previewCtaId === m.id;
              if (previewing) {
                const contractId = payload.contractId ?? contract?.id ?? "";
                // Pull line items from the most recent locked/sent action_card
                // (status="sent" is the locked quote; fall back to "draft").
                const lockedCard = [...messages].reverse().find((x) =>
                  x.kind === "action_card" &&
                  ((x.payload as ActionCardPayload | undefined)?.status === "sent" ||
                    (x.payload as ActionCardPayload | undefined)?.status === "draft")
                );
                const lockedPayload = (lockedCard?.payload ?? {}) as ActionCardPayload;
                const lineItems = lockedPayload.lineItems ?? [];
                const lineTotalCents = lockedPayload.totalCents
                  ?? lineItems.reduce((sum, li) => sum + (li.amountCents ?? 0), 0);
                // Wizard terms — every text msg with a wizardStepId is one
                // answered step ("Start: ASAP", "Wraps: 1 week", ...). Skip
                // the customer step since we render the customer block below.
                const termAnswers = messages
                  .filter((x) => {
                    const p = x.payload as { wizardStepId?: string } | undefined;
                    return x.kind === "text" && !!p?.wizardStepId && p.wizardStepId !== "customer";
                  })
                  .map((x) => {
                    const raw = x.content ?? "";
                    const idx = raw.indexOf(":");
                    if (idx === -1) return { label: raw, value: "" };
                    return { label: raw.slice(0, idx).trim(), value: raw.slice(idx + 1).trim() };
                  });
                const totalAmount = typeof contract?.totalAmount === "number"
                  ? contract.totalAmount
                  : lineTotalCents / 100;
                const totalCentsForBreakdown = Math.round(totalAmount * 100);
                const totalStr = totalAmount.toLocaleString("en-US", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                });
                // Translate the picked payment terms into a milestone schedule
                // so the customer sees what they actually owe at each step,
                // not one big number that hides the deposit / balance split.
                const paymentTerm = termAnswers.find((t) => t.label.toLowerCase() === "payment terms");
                const milestones = paymentTerm
                  ? buildPaymentMilestones(paymentTerm.value, totalCentsForBreakdown)
                  : null;
                const draftedDate = new Date(m.createdAt).toLocaleDateString("en-US", {
                  month: "long", day: "numeric", year: "numeric",
                });
                return (
                  <div key={m.id} class="quote-review-wrap">
                    <article class="quote-review">
                      <header class="quote-review__head">
                        <div class="quote-review__head-left">
                          <div class="quote-review__kind">Quote</div>
                          {contractId
                            ? <div class="quote-review__num">#{contractId.slice(0, 8)}</div>
                            : null}
                        </div>
                        <div class="quote-review__head-right">
                          <span class="quote-review__chip">Draft</span>
                          <div class="quote-review__date">Drafted {draftedDate}</div>
                        </div>
                      </header>

                      {customer?.name
                        ? (
                          <section class="quote-review__hero">
                            <div class="quote-review__hero-label">Prepared for</div>
                            <div class="quote-review__hero-name">{customer.name}</div>
                            {(customer.email || customer.phoneNumber)
                              ? (
                                <div class="quote-review__hero-meta">
                                  {customer.email ? <span>{customer.email}</span> : null}
                                  {customer.email && customer.phoneNumber ? <span class="quote-review__dot">·</span> : null}
                                  {customer.phoneNumber ? <span>{customer.phoneNumber}</span> : null}
                                </div>
                              )
                              : null}
                          </section>
                        )
                        : null}

                      {lineItems.length > 0
                        ? (
                          <section class="quote-review__section">
                            <div class="quote-review__section-label">Scope of work</div>
                            <div class="quote-review__lines">
                              {lineItems.map((li, i) => (
                                <div key={`li-${i}`} class="quote-review__line">
                                  <span class="quote-review__line-desc">{li.description}</span>
                                  <span class="quote-review__line-amt">{fmtUSD(li.amountCents)}</span>
                                </div>
                              ))}
                            </div>
                            <div class="quote-review__subtotal">
                              <span>Subtotal</span>
                              <strong>{fmtUSD(lineTotalCents)}</strong>
                            </div>
                          </section>
                        )
                        : null}

                      {termAnswers.length > 0
                        ? (
                          <section class="quote-review__section">
                            <div class="quote-review__section-label">Terms</div>
                            <dl class="quote-review__terms">
                              {termAnswers.map((t, i) => (
                                <div key={`t-${i}`} class="quote-review__term">
                                  <dt>{t.label}</dt>
                                  <dd>{t.value}</dd>
                                </div>
                              ))}
                            </dl>
                          </section>
                        )
                        : null}

                      <section class="quote-review__total">
                        <div class="quote-review__total-label">Total due</div>
                        <div class="quote-review__total-amt">
                          <span class="quote-review__total-currency">$</span>{totalStr}
                        </div>
                        {milestones && milestones.length > 1
                          ? (
                            <ul class="quote-review__milestones">
                              {milestones.map((ms, i) => (
                                <li key={`ms-${i}`} class="quote-review__milestone">
                                  <span class="quote-review__milestone-label">
                                    {ms.label}
                                    {typeof ms.pct === "number"
                                      ? <span class="quote-review__milestone-pct"> · {ms.pct}%</span>
                                      : null}
                                  </span>
                                  <strong class="quote-review__milestone-amt">{fmtUSD(ms.amountCents)}</strong>
                                </li>
                              ))}
                            </ul>
                          )
                          : null}
                      </section>

                      <footer class="quote-review__cta">
                        <button
                          type="button"
                          class="quote-review__send"
                          onClick={() => confirmSendContract(m)}
                          disabled={sending}
                        >
                          <I d={ICN.send} size={13} sw={2.4} />
                          Send to client
                        </button>
                        <button
                          type="button"
                          class="quote-review__cancel"
                          onClick={() => setPreviewCtaId(null)}
                          disabled={sending}
                        >
                          Cancel
                        </button>
                      </footer>
                    </article>
                  </div>
                );
              }
              return (
                <div key={m.id} class="msg">
                  <div class="msg__avatar"><img src="/logo-monster.png" alt="" /></div>
                  <div style="flex:1;min-width:0">
                    <div class={`continue-cta ${reviewed ? "continue-cta--done" : ""}`}>
                      <div class="continue-cta__icon"><I d={reviewed ? ICN.check : ICN.contract} size={18} /></div>
                      <div class="continue-cta__txt">
                        <div class="continue-cta__title">
                          {reviewed
                            ? (payload.toPhase === "invoice" ? "Invoice sent" : "Contract sent")
                            : m.content}
                        </div>
                        {reviewed
                          ? (
                            <div class="continue-cta__sub">
                              {customer?.email
                                ? <>emailed to <code>{customer.email}</code></>
                                : <>no email on file — add one to <code>{customer?.name ?? "the customer"}</code> to deliver</>}
                            </div>
                          )
                          : payload.summary
                            ? <div class="continue-cta__sub">{payload.summary}</div>
                            : null}
                      </div>
                      {reviewed
                        ? null
                        : (
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
                                : payload.toPhase === "terms"
                                  ? "Continue"
                                  : "Start"}{" "}
                            <I d={ICN.arrow} size={11} sw={2.5} />
                          </button>
                        )}
                    </div>
                    {/* Dev-only trigger: simulate the customer accepting the
                        quote so the threads-sidebar notification UX can be
                        tested without a real signing webhook. */}
                    {reviewed
                      && payload.toPhase === "send"
                      && typeof globalThis.location !== "undefined"
                      && globalThis.location.hostname === "localhost"
                      ? (
                        <button
                          type="button"
                          class="dev-accept-btn"
                          onClick={() => simulateCustomerAccept(payload.contractId)}
                          disabled={sending}
                          title="Localhost-only: flip contract to accepted, bump conversation, set unread."
                        >
                          🔧 {sending ? "Simulating…" : "Simulate customer accepted"}
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
                  <div class="msg__avatar"><img src="/logo-monster.png" alt="" /></div>
                  <div style="flex:1;min-width:0">
                    <div class="wiz">
                      <div class="wiz__step">
                        {typeof payload.stepIdx === "number"
                          ? <div class="wiz__step-num">Step {payload.stepIdx + 1} of 10</div>
                          : null}
                        <h3 class="wiz__step-q">{m.content}</h3>
                        {payload.hint ? <div class="wiz__step-hint">{payload.hint}</div> : null}
                        {(() => {
                          if (isCustomerStep) {
                            return (
                              <CustomerStepPanel
                                boundCustomer={customer}
                                sending={sending}
                                onSubmit={(optionId, body) => submitCustomerStep(m, optionId, body)}
                              />
                            );
                          }
                          const activeFollowUp = followUpPick && followUpPick.messageId === m.id
                            ? opts.find((o) => o.id === followUpPick.optionId)
                            : null;
                          if (activeFollowUp && activeFollowUp.followUp) {
                            return (
                              <WizardFollowUpForm
                                option={activeFollowUp}
                                quoteTotalCents={latestSentQuoteCents(messages)}
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
                          return (
                            <div class="wiz__opts">
                              {opts.map((opt) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  class={`wiz-opt ${opt.isCustom ? "wiz-opt--custom" : ""}`}
                                  onClick={() => {
                                    if (opt.followUp) {
                                      setFollowUpPick({ messageId: m.id, optionId: opt.id });
                                      return;
                                    }
                                    submitWizardAnswer(m, opt);
                                  }}
                                  disabled={sending}
                                >
                                  {opt.label}
                                  {opt.sub ? <span class="wiz-opt__sub">{opt.sub}</span> : null}
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
              const totalCents = payload.totalCents
                ?? lineItems.reduce((sum, li) => sum + (li.amountCents ?? 0), 0);
              const statusLabel = (payload.status ?? "draft").replace(/^[a-z]/, (c) => c.toUpperCase());
              return (
                <div key={m.id} class="msg">
                  <div class="msg__avatar"><img src="/logo-monster.png" alt="" /></div>
                  <div style="flex:1;min-width:0">
                    <div class="action-card">
                      <div class="action-card__head">
                        <div class="action-card__icon"><I d={ICN.quote} size={16} /></div>
                        <div style="flex:1;min-width:0">
                          <div class="action-card__title">{m.content}</div>
                          {payload.quoteId
                            ? <div class="action-card__sub">#{payload.quoteId.slice(0, 8)}</div>
                            : null}
                        </div>
                        <span class="action-card__chip">{statusLabel}</span>
                      </div>
                      <div class="action-card__body">
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
                              <span style="font-weight:700;color:var(--brand-teal)">Total</span>
                              <strong style="font-size:15px">{fmtUSD(totalCents)}</strong>
                            </div>
                          )
                          : null}
                      </div>
                      {payload.status === "draft"
                        ? (
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
                              <I d={ICN.refresh} size={11} /> Re-open
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

            // Default chat bubble (text/voice/image).
            const fileId = (m.payload as { fileId?: string } | undefined)?.fileId;
            const filename = (m.payload as { filename?: string } | undefined)?.filename;
            // Skip ghost bubbles: a text/voice message with no content and
            // no attached media is something the LLM (or a buggy persist
            // path) emitted with no signal — rendering it as an empty pill
            // looks broken. Phase_divider / continue_cta / action_card /
            // wizard / image / file are handled above with their own UI.
            const hasMedia = !!fileId;
            const hasContent = !!m.content?.trim();
            if (!hasMedia && !hasContent) return null;
            return (
              <div key={m.id} class={`msg ${m.role === "user" ? "msg--user" : ""}`}>
                <div class="msg__avatar">
                  {m.role === "user" ? userInitials : <img src="/logo-monster.png" alt="" />}
                </div>
                <div>
                  {m.kind === "image" && fileId
                    ? (
                      <a class="msg__image" href={`/api/files/${fileId}`} target="_blank" rel="noopener">
                        <img src={`/api/files/${fileId}`} alt={filename ?? "attached image"} />
                      </a>
                    )
                    : null}
                  <div class="msg__bubble" style="white-space:pre-wrap">{m.content}</div>
                  <div class="msg__time">{fmtTime(m.createdAt)}</div>
                </div>
              </div>
            );
          });
          })()}
        {!empty && sending && messages.length > 0 && messages[messages.length - 1].role === "user"
          ? (
            <div class="msg" aria-live="polite" aria-label="Bossie is thinking">
              <div class="msg__avatar"><img src="/logo-monster.png" alt="" /></div>
              <div class="msg__bubble msg__bubble--typing">
                <span class="typing-dot" />
                <span class="typing-dot" />
                <span class="typing-dot" />
              </div>
            </div>
          )
          : null}
      </div>

      <div class="composer">
        {error ? <div class="composer__err">{error}</div> : null}
        <div class={`composer__inner ${recording ? "composer__inner--rec" : ""}`}>
          {recording
            ? (
              <div class="composer__rec">
                <span class="composer__rec-dot" />
                Recording · {recElapsed}s — tap mic to stop
              </div>
            )
            : (
              <textarea
                ref={taRef}
                class="composer__input"
                placeholder="Tell me what you need — or hit the mic and just talk."
                rows={1}
                value={draft}
                onInput={(e) => { setDraft((e.target as HTMLTextAreaElement).value); autosize(); }}
                onKeyDown={onKeyDown}
              />
            )}
          <div class="composer__tools">
            <button
              type="button"
              class={`composer__btn ${recording ? "composer__btn--rec" : ""}`}
              title={recording ? "Stop recording" : "Voice memo"}
              onClick={toggleRecord}
              disabled={sending}
            >
              <I d={ICN.mic} size={17} />
            </button>
            <button
              type="button"
              class="composer__send"
              title="Send"
              onClick={onSendClick}
              disabled={sending || recording || !draft.trim()}
            >
              <I d={ICN.arrow} size={16} sw={2.4} />
            </button>
          </div>
        </div>
      </div>
    </>
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
type CustomerStepMode = "list" | "creating";

function CustomerStepPanel(props: {
  boundCustomer?: CustomerLite;
  sending: boolean;
  onSubmit: (
    optionId: "use_active" | "pick_existing" | "create_new",
    body?: { customer?: { id?: string; create?: { name: string; email?: string; phoneNumber?: string } } },
  ) => Promise<void>;
}) {
  const { boundCustomer, sending, onSubmit } = props;
  const [mode, setMode] = useState<CustomerStepMode>("list");
  const [customers, setCustomers] = useState<CustomerLite[] | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState("");
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [localErr, setLocalErr] = useState<string | undefined>();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Eager load: the user came here to pick a customer, so render the list
  // immediately rather than asking them to type or click through a menu.
  useEffect(() => {
    let cancelled = false;
    assistantClient.listCustomers()
      .then((list) => { if (!cancelled) setCustomers(list); })
      .catch((err) => { if (!cancelled) setLocalErr(err instanceof Error ? err.message : "couldn't load customers"); })
      .finally(() => { if (!cancelled) setLoadingList(false); });
    return () => { cancelled = true; };
  }, []);

  // Pin the chat to the bottom when the panel grows (mode change, list loaded).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const scroller = el.closest(".chat__scroll") as HTMLElement | null;
    if (!scroller) return;
    requestAnimationFrame(() => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    });
  }, [mode, loadingList]);

  function openCreate() {
    setMode("creating");
    setLocalErr(undefined);
  }

  function backToList() {
    setMode("list");
    setLocalErr(undefined);
  }

  const filtered = customers?.filter((c) => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return c.name.toLowerCase().includes(needle)
      || (c.email ?? "").toLowerCase().includes(needle)
      || (c.phoneNumber ?? "").toLowerCase().includes(needle);
  }) ?? [];

  if (mode === "creating") {
    const trimmedName = createName.trim();
    const submitDisabled = sending || trimmedName.length === 0;
    return (
      <div ref={rootRef} class="cust-create">
        <div class="cust-create__row">
          <input
            type="text"
            class="cust-pick__search"
            placeholder="Name (required)"
            value={createName}
            onInput={(e) => setCreateName((e.target as HTMLInputElement).value)}
            autoFocus
          />
          <input
            type="email"
            class="cust-pick__search"
            placeholder="Email"
            value={createEmail}
            onInput={(e) => setCreateEmail((e.target as HTMLInputElement).value)}
          />
        </div>
        <input
          type="tel"
          class="cust-pick__search"
          placeholder="Phone (optional)"
          value={createPhone}
          onInput={(e) => setCreatePhone((e.target as HTMLInputElement).value)}
        />
        {localErr ? <div class="cust-pick__err">{localErr}</div> : null}
        <div class="cust-create__actions">
          <button
            type="button"
            class="cust-create__btn cust-create__btn--primary"
            disabled={submitDisabled}
            onClick={() => onSubmit("create_new", {
              customer: {
                create: {
                  name: trimmedName,
                  ...(createEmail.trim() ? { email: createEmail.trim() } : {}),
                  ...(createPhone.trim() ? { phoneNumber: createPhone.trim() } : {}),
                },
              },
            })}
          >
            Create &amp; use
          </button>
          <button type="button" class="cust-create__btn" onClick={backToList} disabled={sending}>Back</button>
        </div>
      </div>
    );
  }

  // Default — clickable list of customers, with "Use [Name] from chat" pinned
  // to the top when one is bound and a "Create new" row at the bottom.
  const showFilter = (customers?.length ?? 0) > 6;
  return (
    <div ref={rootRef} class="wiz__opts" style="flex-direction:column;align-items:stretch;gap:8px">
      {boundCustomer
        ? (
          <button
            type="button"
            class="wiz-opt"
            onClick={() => onSubmit("use_active")}
            disabled={sending}
          >
            Use {boundCustomer.name} from chat
            {boundCustomer.email
              ? <span class="wiz-opt__sub">{boundCustomer.email}</span>
              : null}
          </button>
        )
        : null}
      {showFilter
        ? (
          <input
            type="text"
            class="cust-pick__search"
            placeholder="Filter by name, email, or phone…"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
        )
        : null}
      {loadingList
        ? <div class="cust-pick__empty">Loading customers…</div>
        : customers && customers.length === 0
          ? <div class="cust-pick__empty">No customers yet — create one below.</div>
          : filtered.length === 0
            ? <div class="cust-pick__empty">No matches.</div>
            : (
              <div class="cust-pick__list">
                {filtered.slice(0, 50).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    class="cust-pick__row"
                    onClick={() => onSubmit("pick_existing", { customer: { id: c.id } })}
                    disabled={sending}
                  >
                    <span class="cust-pick__name">{c.name}</span>
                    {c.email || c.phoneNumber
                      ? <span class="cust-pick__meta">{c.email ?? c.phoneNumber}</span>
                      : null}
                  </button>
                ))}
              </div>
            )}
      {localErr ? <div class="cust-pick__err">{localErr}</div> : null}
      <button type="button" class="wiz-opt wiz-opt--custom" onClick={openCreate} disabled={sending}>
        + Create a new customer
      </button>
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
  const [values, setValues] = useState<Record<string, string | number>>(initial);

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
      case "percent":  return "%";
      case "days":     return "days";
      case "currency": return "$";
      default:         return "";
    }
  }

  // Submit-disabled rule: every numeric field must be a finite number, and
  // every required field must be non-empty. (Optional support if needed
  // later — for now treat all declared fields as required.)
  const submitDisabled = sending || fields.some((f) => {
    const v = values[f.id];
    if (v === undefined || v === null || v === "") return true;
    if (f.type !== "text" && !Number.isFinite(Number(v))) return true;
    if (f.type !== "text" && typeof f.min === "number" && Number(v) < f.min) return true;
    if (f.type !== "text" && typeof f.max === "number" && Number(v) > f.max) return true;
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
  const previewBalanceCents = showPreview ? quoteTotalCents - previewDepositCents : 0;

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
                onInput={(e) => setField(f.id, (e.target as HTMLInputElement).value, f.type)}
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
              Deposit · <strong>{fmtUSD(previewDepositCents)}</strong>
            </span>
            <span class="wiz-preview__sep">·</span>
            <span class="wiz-preview__row">
              Balance · <strong>{fmtUSD(previewBalanceCents)}</strong>
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
          Use {option.label}
        </button>
        <button type="button" class="cust-create__btn" onClick={onCancel} disabled={sending}>
          Back
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
    if (p.status === "sent" && typeof p.totalCents === "number") return p.totalCents;
  }
  return 0;
}
