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
}

function fmtTime(ts: number | string): string {
  const d = typeof ts === "string" ? new Date(ts) : new Date(ts);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtKB(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export default function AsstChat({ conversationId, initialMessages, initialCustomer, initialContract }: Props) {
  const [convoId, setConvoId] = useState<string | undefined>(conversationId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [customer, setCustomer] = useState<CustomerLite | undefined>(initialCustomer);
  const [contract, setContract] = useState<ContractLite | undefined>(initialContract);
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
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setConvoId(conversationId);
    setMessages(initialMessages);
    setCustomer(initialCustomer);
    setContract(initialContract);
  }, [conversationId]);

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
    optimistic: { role: "user" | "assistant"; kind: "text" | "voice" | "image" | "file"; content: string },
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

  function pickImage() { imageInputRef.current?.click(); }
  function pickFile()  { fileInputRef.current?.click(); }

  /**
   * Dev-only: spin up a phase-2 conversation in one shot — quote, lock,
   * transition to terms, answer the config step — and navigate to it.
   * Lands the user on the customer step so the wizard UI can be poked
   * without walking the whole pre-amble each time.
   *
   * Gated to localhost in the render pass; the function itself just runs
   * the API calls and redirects.
   */
  async function seedPhase2() {
    if (sending) return;
    setError(undefined);
    setSending(true);
    try {
      const r1 = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: "Quote a kitchen backsplash, 30 sqft." }),
      }).then((r) => r.json());
      const id = r1.conversation.id;
      const card = r1.newMessages.find((m: Message) => m.kind === "action_card");
      const quoteId = (card?.payload as { quoteId?: string } | undefined)?.quoteId;
      if (!quoteId) throw new Error("seed: no quote drafted by the LLM");
      await fetch(`/api/agents/conversations/${id}/lock-quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ quoteId }),
      });
      await fetch(`/api/agents/conversations/${id}/transition-to-terms`, {
        method: "POST", credentials: "include",
      });
      await fetch("/api/agents/wizard/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ conversationId: id, stepId: "config", optionId: "standard_residential" }),
      });
      globalThis.location.href = `/assistant/${id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "seed failed");
      setSending(false);
    }
  }

  function onImagePicked(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    sendImage(file);
    input.value = "";
  }
  function onFilePicked(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    sendFile(file);
    input.value = "";
  }

  /**
   * Picture path: upload to /files, then post a chat turn with kind=image
   * + payload.fileId. The backend base64-encodes the bytes and ships them
   * to gpt-4o-mini as a vision attachment, so the assistant can actually
   * see what was sent. Optimistic bubble shows "uploading…" until the
   * server responds with the persisted message + assistant reply.
   */
  async function sendImage(file: File) {
    await submitTurn(
      {
        role: "user",
        kind: "image",
        content: `🖼️ ${file.name} · ${fmtKB(file.size)} — uploading…`,
      },
      async () => {
        const uploaded = await filesClient.uploadBlob(file, file.name);
        return await assistantClient.chat({
          conversationId: convoId,
          kind: "image",
          payload: { fileId: uploaded.id },
        }) as {
          conversation?: { id: string };
          newMessages?: Message[];
          message?: Message;
          conversationId?: string;
        };
      },
    );
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
        } catch (err) {
          setError(err instanceof Error ? err.message : "couldn't load the contract");
          return;
        } finally {
          setSending(false);
        }
      }
      setPreviewCtaId(message.id);
    }
  }

  /**
   * Dev-only: flip the contract to "accepted" via the AcceptContract
   * coordinator so the threads-sidebar notification UX can be exercised
   * without a real signing webhook. The conversation gets bumped to the
   * top of the list and `hasUnreadEvent` is set; navigating to /assistant
   * shows the green pulsing dot until the user reopens the thread.
   */
  async function simulateCustomerAccept(contractId: string | undefined) {
    if (sending || !convoId || !contractId) return;
    setError(undefined);
    setSending(true);
    try {
      await assistantClient.acceptContract(convoId, contractId);
      // The unread badge surfaces in the THREADS list, not on this page,
      // so jump there so the user can see the bump-to-top + dot.
      globalThis.location.href = "/assistant";
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't simulate acceptance");
      setSending(false);
    }
  }

  /**
   * Fires the actual SendContract from the inline preview card. Idempotent
   * server-side — re-clicks are safe. Flips the CTA into the calmed-down
   * "Contract sent" state on success.
   */
  async function confirmSendContract(message: Message, contractId: string) {
    if (sending || !convoId) return;
    setError(undefined);
    setSending(true);
    try {
      const res = await assistantClient.sendContract(convoId, contractId);
      setReviewedCtas((prev) => {
        const next = new Set(prev);
        next.add(message.id);
        return next;
      });
      setContract((c) => c ? { ...c, status: "sent" } : c);
      setPreviewCtaId(null);
      if (Array.isArray(res.newMessages) && res.newMessages.length > 0) {
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

  /**
   * Generic file path: upload to /files, then post a chat turn with
   * kind=file. Backend doesn't parse contents — it just notes the file
   * exists by name so the assistant can acknowledge / reference it. The
   * bubble renders a download chip.
   */
  async function sendFile(file: File) {
    await submitTurn(
      {
        role: "user",
        kind: "file",
        content: `📎 ${file.name} · ${fmtKB(file.size)} — uploading…`,
      },
      async () => {
        const uploaded = await filesClient.uploadBlob(file, file.name);
        return await assistantClient.chat({
          conversationId: convoId,
          kind: "file",
          payload: { fileId: uploaded.id },
        }) as {
          conversation?: { id: string };
          newMessages?: Message[];
          message?: Message;
          conversationId?: string;
        };
      },
    );
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
              const reviewed = payload.toPhase === "send" && reviewedCtas.has(m.id);
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
                const totalStr = totalAmount.toLocaleString("en-US", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                });
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
                      </section>

                      <footer class="quote-review__cta">
                        <button
                          type="button"
                          class="quote-review__send"
                          onClick={() => confirmSendContract(m, contractId)}
                          disabled={sending || !contractId}
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
                          {reviewed ? "Contract sent" : m.content}
                        </div>
                        {reviewed
                          ? (
                            <div class="continue-cta__sub">
                              {customer?.email
                                ? <>emailed to <code>{customer.email}</code></>
                                : payload.contractId
                                  ? <>contract <code>{payload.contractId.slice(0, 8)}</code> sent</>
                                  : "sent"}
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
                            {payload.toPhase === "send" ? "Review" : "Start"} <I d={ICN.arrow} size={11} sw={2.5} />
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

            // Default chat bubble (text/voice/image/file).
            const fileId = (m.payload as { fileId?: string } | undefined)?.fileId;
            const filename = (m.payload as { filename?: string } | undefined)?.filename;
            const sizeBytes = (m.payload as { sizeBytes?: number } | undefined)?.sizeBytes;
            return (
              <div key={m.id} class={`msg ${m.role === "user" ? "msg--user" : ""}`}>
                <div class="msg__avatar">
                  {m.role === "user" ? "DR" : <img src="/logo-monster.png" alt="" />}
                </div>
                <div>
                  {m.kind === "image" && fileId
                    ? (
                      <a class="msg__image" href={`/api/files/${fileId}`} target="_blank" rel="noopener">
                        <img src={`/api/files/${fileId}`} alt={filename ?? "attached image"} />
                      </a>
                    )
                    : null}
                  {m.kind === "file" && fileId
                    ? (
                      <a class="msg__file" href={`/api/files/${fileId}`} target="_blank" rel="noopener" download={filename}>
                        <I d={ICN.clip} size={14} />
                        <span class="msg__file-name">{filename ?? "attachment"}</span>
                        {typeof sizeBytes === "number" ? <span class="msg__file-size">{fmtKB(sizeBytes)}</span> : null}
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
                disabled={sending}
              />
            )}
          <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={onImagePicked} />
          <input ref={fileInputRef}  type="file" hidden onChange={onFilePicked} />
          <div class="composer__tools">
            <button type="button" class="composer__btn" title="Attach photo" onClick={pickImage} disabled={recording || sending}>
              <I d={ICN.img} size={17} />
            </button>
            <button type="button" class="composer__btn" title="Attach file" onClick={pickFile} disabled={recording || sending}>
              <I d={ICN.clip} size={17} />
            </button>
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
type CustomerStepMode = "menu" | "picking" | "creating";

function CustomerStepPanel(props: {
  boundCustomer?: CustomerLite;
  sending: boolean;
  onSubmit: (
    optionId: "use_active" | "pick_existing" | "create_new",
    body?: { customer?: { id?: string; create?: { name: string; email?: string; phoneNumber?: string } } },
  ) => Promise<void>;
}) {
  const { boundCustomer, sending, onSubmit } = props;
  const [mode, setMode] = useState<CustomerStepMode>("menu");
  const [customers, setCustomers] = useState<CustomerLite[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [search, setSearch] = useState("");
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [localErr, setLocalErr] = useState<string | undefined>();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The chat container only auto-scrolls on messages.length change, so
  // expanding the inline picker/create form leaves the new content below
  // the fold. Walk up to the chat scroller and pin it to the bottom on
  // any mode change AND on loading-finished (the list grows once fetched,
  // so we need a second pass).
  useEffect(() => {
    if (mode === "menu") return;
    const el = rootRef.current;
    if (!el) return;
    const scroller = el.closest(".chat__scroll") as HTMLElement | null;
    if (!scroller) return;
    requestAnimationFrame(() => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    });
  }, [mode, loadingList]);

  async function openPick() {
    setMode("picking");
    setLocalErr(undefined);
    if (customers !== null) return;
    setLoadingList(true);
    try {
      const list = await assistantClient.listCustomers();
      setCustomers(list);
    } catch (err) {
      setLocalErr(err instanceof Error ? err.message : "couldn't load customers");
    } finally {
      setLoadingList(false);
    }
  }

  function openCreate() {
    setMode("creating");
    setLocalErr(undefined);
  }

  function backToMenu() {
    setMode("menu");
    setLocalErr(undefined);
  }

  const filtered = customers?.filter((c) => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return c.name.toLowerCase().includes(needle)
      || (c.email ?? "").toLowerCase().includes(needle)
      || (c.phoneNumber ?? "").toLowerCase().includes(needle);
  }) ?? [];

  if (mode === "picking") {
    return (
      <div ref={rootRef} class="wiz__opts" style="flex-direction:column;align-items:stretch;gap:10px">
        <input
          type="text"
          class="cust-pick__search"
          placeholder="Search customers by name, email, or phone…"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          autoFocus
        />
        {loadingList
          ? <div class="cust-pick__empty">Loading…</div>
          : filtered.length === 0
            ? (
              <div class="cust-pick__empty">
                {customers?.length === 0
                  ? "You haven't created any customers yet."
                  : "No matches."}
              </div>
            )
            : (
              <div class="cust-pick__list">
                {filtered.slice(0, 20).map((c) => (
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
        <div class="cust-pick__back">
          <button type="button" class="wiz-opt wiz-opt--ghost" onClick={backToMenu} disabled={sending}>← Back</button>
        </div>
      </div>
    );
  }

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
          <button type="button" class="cust-create__btn" onClick={backToMenu} disabled={sending}>Back</button>
        </div>
      </div>
    );
  }

  // Default menu — three options (or two when nothing is bound yet).
  return (
    <div class="wiz__opts">
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
      <button type="button" class="wiz-opt" onClick={openPick} disabled={sending}>
        Pick an existing customer
        <span class="wiz-opt__sub">Search your CRM</span>
      </button>
      <button type="button" class="wiz-opt wiz-opt--custom" onClick={openCreate} disabled={sending}>
        Create a new customer
        <span class="wiz-opt__sub">Inline form — name, email, phone</span>
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
