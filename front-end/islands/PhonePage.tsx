/**
 * REQ-915/916 — /communications, the Phone page. With no line (409 no_line)
 * the page is the number shop; with one: the line card (Release), an Inbox
 * (threads newest first, a thread's texts and calls in one timeline, compose,
 * New text; the list re-read every 15 s), a Calls tab (the log, a call's AI
 * transcript and its recording), and the Softphone panel — Twilio's browser
 * Voice SDK loaded from the CDN at page open, registered with the token
 * endpoint and re-minted before expiry. When the phone cannot register it
 * says why in one line and the rest of the page works on. Data:
 * clients/communications.ts only. Strings: comms.*.
 */
import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import {
  type AvailableNumber,
  type Call,
  commsClient,
  type PublicLine,
  type TextMessage,
  type Thread,
  type ThreadDetail,
} from "../clients/communications.ts";
import FieldHead from "../components/FieldHead.tsx";
import { Toast, useToast } from "../components/hr/bits.tsx";
import { ApiError } from "../lib/api.ts";
import {
  callChip,
  callRow,
  formatDuration,
  formatPhone,
  isNoLine,
  shopQuery,
  shortTime,
  sortCalls,
  sortThreads,
  textChip,
  timeline,
  toE164,
} from "../lib/communications.ts";
import {
  formatTimer,
  initialPhone,
  KEYPAD,
  phoneReducer,
  type PhoneState,
  reasonDetail,
  reasonKey,
  refreshDelayMs,
  VOICE_SDK_URL,
} from "../lib/softphone.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { PHONE_PLACEHOLDER } from "../lib/field.ts";
import { t } from "../lib/i18n.ts";

/** REQ-915c — the inbox is re-read this often while the page is open (no websocket for texts yet) */
const POLL_MS = 15_000;

type Mode = "loading" | "shop" | "line" | "error";
type Tab = "inbox" | "calls";

/** an API error → one line for the person */
function friendly(e: unknown): string {
  if (e instanceof ApiError) {
    const code = e.body && typeof e.body === "object"
      ? String((e.body as { code?: unknown }).code ?? "")
      : "";
    if (code === "line_exists" || (e.status === 409 && !code)) {
      return t("comms.err.line_exists");
    }
    if (code === "no_line") return t("comms.err.no_line");
    if (e.status === 502) {
      // REQ-917: no Twilio keys on the server is not "pick another number"
      const reason = e.body && typeof e.body === "object"
        ? String((e.body as { reason?: unknown }).reason ?? "")
        : "";
      if (reason === "not_configured") return t("comms.err.not_configured");
      return t("comms.err.provisioning");
    }
    if (e.status === 400) {
      const msg = e.body && typeof e.body === "object"
        ? String((e.body as { message?: unknown }).message ?? "")
        : "";
      return msg ? t("comms.err.invalid", { msg }) : t("comms.err.generic");
    }
  }
  return t("comms.err.generic");
}

export default function PhonePage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [line, setLine] = useState<PublicLine | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [tab, setTab] = useState<Tab>("inbox");
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, say] = useToast();

  async function load() {
    try {
      const [l, th] = await Promise.all([
        commsClient.line().catch(() => ({ line: null })),
        commsClient.threads(),
      ]);
      setLine(l.line && l.line.status === "active" ? l.line : null);
      setThreads(sortThreads(th));
      setMode("line");
    } catch (e) {
      if (isNoLine(e)) {
        setLine(null);
        setThreads([]);
        setMode("shop");
      } else setMode("error");
    }
  }

  async function reloadThreads() {
    try {
      setThreads(sortThreads(await commsClient.threads()));
    } catch (e) {
      if (isNoLine(e)) await load();
    }
  }

  useEffect(() => {
    load();
  }, []);

  // REQ-915c — the 15 s poll, while the page is open and has a line
  useEffect(() => {
    if (mode !== "line") return;
    const id = setInterval(() => {
      if (globalThis.document?.visibilityState === "hidden") return;
      reloadThreads();
      setTick((n) => n + 1);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [mode]);

  async function release() {
    if (!globalThis.confirm(t("comms.line.confirmRelease"))) return;
    setBusy(true);
    setErr(null);
    try {
      await commsClient.release();
      say(t("comms.line.released"));
      await load();
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  const number = line?.number ?? threads[0]?.line ?? "";

  return (
    <div class="comms" data-cy="comms-page" data-mode={mode}>
      <FieldHead
        eyebrow={t("comms.eyebrow")}
        title={t("comms.title")}
        sub={mode === "shop" ? t("comms.shop.sub") : t("comms.sub")}
      />
      {err && <p class="alert" data-cy="comms-err">{err}</p>}
      {mode === "loading" && (
        <p class="hint" data-cy="comms-loading">{t("comms.loading")}</p>
      )}
      {mode === "error" && (
        <p class="alert" data-cy="comms-load-err">{t("comms.err.load")}</p>
      )}
      {mode === "shop" && (
        <NumberShop
          onBought={async (n) => {
            say(t("comms.shop.bought", { number: formatPhone(n) }));
            await load();
          }}
        />
      )}
      {mode === "line" && (
        <>
          <section class="panel comms-line" data-cy="comms-line">
            <span class="comms-line__icon">
              <I d={ICN.phone} size={18} />
            </span>
            <div class="comms-line__main">
              <div class="comms-line__label">{t("comms.line.label")}</div>
              <div class="comms-line__number" data-cy="comms-line-number">
                {number ? formatPhone(number) : t("comms.line.house")}
              </div>
            </div>
            <span
              class={`chip ${line ? "chip--green" : "chip--teal"}`}
              data-cy="comms-line-status"
            >
              {line ? t("comms.line.active") : t("comms.line.houseChip")}
            </span>
            {line && (
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                data-cy="comms-release"
                disabled={busy}
                onClick={release}
              >
                <I d={ICN.trash} size={14} /> {t("comms.line.release")}
              </button>
            )}
          </section>
          <div class="comms-grid">
            <div class="comms-main">
              <div class="comms-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "inbox"}
                  class={`comms-tab ${tab === "inbox" ? "is-on" : ""}`}
                  data-cy="comms-tab-inbox"
                  onClick={() => setTab("inbox")}
                >
                  <I d={ICN.msg} size={14} /> {t("comms.tab.inbox")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "calls"}
                  class={`comms-tab ${tab === "calls" ? "is-on" : ""}`}
                  data-cy="comms-tab-calls"
                  onClick={() => setTab("calls")}
                >
                  <I d={ICN.phone} size={14} /> {t("comms.tab.calls")}
                </button>
              </div>
              {tab === "inbox"
                ? (
                  <Inbox
                    threads={threads}
                    tick={tick}
                    reload={reloadThreads}
                  />
                )
                : <CallsTab tick={tick} />}
            </div>
            <Softphone />
          </div>
        </>
      )}
      <Toast msg={toast} />
    </div>
  );
}

// ── REQ-915a — the number shop ──────────────────────────────────────────────

function NumberShop({ onBought }: { onBought: (n: string) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AvailableNumber[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function search(e: Event) {
    e.preventDefault();
    const query = shopQuery(q);
    if (!query) {
      setErr(t("comms.shop.badQuery"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      setResults((await commsClient.availableNumbers(query)).numbers);
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  async function buy(n: AvailableNumber) {
    setBusy(true);
    setErr(null);
    try {
      await commsClient.buyNumber(n.phoneNumber);
      await onBought(n.phoneNumber);
    } catch (e) {
      setErr(friendly(e));
      setBusy(false);
    }
  }

  return (
    <section class="panel comms-shop" data-cy="comms-shop">
      <h2 class="panel__title">{t("comms.shop.title")}</h2>
      <p class="hint">{t("comms.shop.hint")}</p>
      <form class="comms-shop__form" onSubmit={search}>
        <input
          value={q}
          placeholder={t("comms.shop.placeholder")}
          aria-label={t("comms.shop.placeholder")}
          data-cy="comms-search"
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        <button
          type="submit"
          class="btn btn--teal btn--sm"
          data-cy="comms-search-go"
          disabled={busy || !q.trim()}
        >
          <I d={ICN.search} size={14} /> {t("comms.shop.search")}
        </button>
      </form>
      {err && <p class="alert" data-cy="comms-shop-err">{err}</p>}
      {results && results.length === 0 && (
        <p class="hint" data-cy="comms-shop-empty">{t("comms.shop.none")}</p>
      )}
      {results && results.length > 0 && (
        <ul class="comms-shop__list" data-cy="comms-shop-list">
          {results.map((n) => (
            <li
              class="comms-shop__row"
              key={n.phoneNumber}
              data-cy="comms-number"
              data-number={n.phoneNumber}
            >
              <div>
                <div class="comms-shop__num">{formatPhone(n.phoneNumber)}</div>
                <div class="hint">
                  {[n.locality, n.region].filter(Boolean).join(", ")}
                </div>
              </div>
              <div class="comms-caps">
                {n.capabilities.voice && (
                  <span class="chip chip--muted">{t("comms.cap.voice")}</span>
                )}
                {n.capabilities.sms && (
                  <span class="chip chip--muted">{t("comms.cap.sms")}</span>
                )}
                {n.capabilities.mms && (
                  <span class="chip chip--muted">{t("comms.cap.mms")}</span>
                )}
              </div>
              <button
                type="button"
                class="btn btn--green btn--sm"
                data-cy="comms-buy"
                disabled={busy}
                onClick={() => buy(n)}
              >
                {t("comms.shop.buy")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── REQ-915b — the inbox ────────────────────────────────────────────────────

function Inbox(
  { threads, tick, reload }: {
    threads: Thread[];
    tick: number;
    reload: () => Promise<void>;
  },
) {
  const [peer, setPeer] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  /** non-null: composing a New text to this (typed) number */
  const [newTo, setNewTo] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function open(p: string) {
    setNewTo(null);
    setPeer(p);
    setErr(null);
    try {
      setDetail(await commsClient.thread(p)); // reading it marks it read
      await reload();
    } catch (e) {
      setErr(friendly(e));
    }
  }

  // the poll re-reads the open thread, so queued → sent/delivered shows on its own
  useEffect(() => {
    if (!tick || !peer || newTo !== null) return;
    commsClient.thread(peer).then(setDetail).catch(() => {});
  }, [tick]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [detail]);

  async function send(e: Event) {
    e.preventDefault();
    const to = newTo !== null ? toE164(newTo) : peer;
    if (!to) {
      setErr(t("comms.inbox.badNumber"));
      return;
    }
    if (!body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const out = await commsClient.sendText(to, body.trim());
      setBody("");
      if (!out.ok) {
        setErr(t("comms.inbox.sendFailed", { reason: out.reason ?? "" }));
      }
      await open(out.message?.peer || to);
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  const items = detail && detail.thread.peer === peer
    ? timeline(detail.texts, detail.calls)
    : [];
  const composing = newTo !== null || peer !== null;

  return (
    <div class="comms-inbox" data-cy="comms-inbox">
      <aside class="comms-threads">
        <button
          type="button"
          class="btn btn--teal btn--sm comms-threads__new"
          data-cy="comms-new-text"
          onClick={() => {
            setNewTo("");
            setPeer(null);
            setDetail(null);
            setErr(null);
          }}
        >
          <I d={ICN.plus} size={14} /> {t("comms.inbox.newText")}
        </button>
        {threads.length === 0 && (
          <p class="hint comms-empty" data-cy="comms-inbox-empty">
            {t("comms.inbox.empty")}
          </p>
        )}
        <ul class="comms-threads__list">
          {threads.map((th) => (
            <li key={th.id}>
              <button
                type="button"
                class={`comms-thread ${th.peer === peer ? "is-on" : ""}`}
                data-cy="comms-thread"
                data-peer={th.peer}
                data-unread={th.unreadCount}
                onClick={() => open(th.peer)}
              >
                <span class="comms-thread__top">
                  <span class="comms-thread__peer">{formatPhone(th.peer)}</span>
                  <span class="comms-thread__time">
                    {shortTime(th.lastMessageAt)}
                  </span>
                </span>
                <span class="comms-thread__bottom">
                  <span class="comms-thread__preview">{th.lastPreview}</span>
                  {th.unreadCount > 0 && (
                    <span
                      class="comms-badge"
                      data-cy="comms-unread"
                      aria-label={t("comms.inbox.unread", {
                        n: th.unreadCount,
                      })}
                    >
                      {th.unreadCount}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section class="comms-convo" data-cy="comms-convo">
        {!composing && <p class="hint comms-empty">{t("comms.inbox.pick")}</p>}
        {newTo !== null && (
          <label class="comms-convo__to">
            <span>{t("comms.inbox.to")}</span>
            <input
              value={newTo}
              inputMode="tel"
              placeholder={PHONE_PLACEHOLDER}
              data-cy="comms-new-to"
              onInput={(e) => setNewTo((e.target as HTMLInputElement).value)}
            />
          </label>
        )}
        {peer && (
          <div class="comms-convo__head" data-cy="comms-convo-peer">
            {formatPhone(peer)}
          </div>
        )}
        {peer && (
          <div class="comms-timeline" data-cy="comms-timeline">
            {items.map((it) =>
              it.kind === "text"
                ? <Bubble key={`t${it.id}`} m={it.text} />
                : <CallLine key={`c${it.id}`} c={it.call} />
            )}
            <div ref={endRef} />
          </div>
        )}
        {err && <p class="alert" data-cy="comms-inbox-err">{err}</p>}
        {composing && (
          <form class="comms-compose" onSubmit={send}>
            <textarea
              rows={2}
              maxLength={1600}
              value={body}
              placeholder={t("comms.inbox.placeholder")}
              aria-label={t("comms.inbox.placeholder")}
              data-cy="comms-compose"
              onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  send(e);
                }
              }}
            />
            <button
              type="submit"
              class="btn btn--teal btn--sm"
              data-cy="comms-send"
              disabled={busy || !body.trim()}
            >
              <I d={ICN.send} size={14} /> {t("comms.inbox.send")}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function Bubble({ m }: { m: TextMessage }) {
  const out = m.direction === "outbound";
  const chip = textChip(m.status);
  return (
    <div
      class={`comms-bubble ${out ? "comms-bubble--out" : "comms-bubble--in"}`}
      data-cy="comms-msg"
      data-status={m.status}
      data-direction={m.direction}
    >
      {m.body && <div class="comms-bubble__body">{m.body}</div>}
      {m.mediaUrls?.map((u, i) => (
        <a
          key={u}
          class="comms-bubble__media"
          href={u}
          target="_blank"
          rel="noopener noreferrer"
        >
          <I d={ICN.img} size={12} /> {t("comms.inbox.media", { n: i + 1 })}
        </a>
      ))}
      <div class="comms-bubble__meta">
        <span>{shortTime(m.createdAt)}</span>
        {out && (
          <span class={`chip ${chip.cls}`} data-cy="comms-msg-status">
            {t(chip.key)}
          </span>
        )}
      </div>
    </div>
  );
}

function CallLine({ c }: { c: Call }) {
  const chip = callChip(c.status);
  return (
    <div class="comms-tl-call" data-cy="comms-tl-call">
      <I d={ICN.phone} size={13} />
      <span>{t(`comms.calls.dir.${c.direction}`)}</span>
      <span class={`chip ${chip.cls}`}>{t(chip.key)}</span>
      <span class="hint">{formatDuration(c.durationSec)}</span>
      <span class="hint">{shortTime(c.startedAt ?? c.createdAt)}</span>
    </div>
  );
}

// ── REQ-916b — the call log ─────────────────────────────────────────────────

function CallsTab({ tick }: { tick: number }) {
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [open, setOpen] = useState<Call | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setCalls(sortCalls(await commsClient.calls()));
    } catch (e) {
      setErr(friendly(e));
    }
  }
  useEffect(() => {
    load();
  }, [tick]);

  async function openCall(id: string) {
    setErr(null);
    try {
      setOpen(await commsClient.call(id));
    } catch (e) {
      setErr(friendly(e));
    }
  }

  return (
    <div class="comms-calls" data-cy="comms-calls">
      {err && <p class="alert">{err}</p>}
      {calls && calls.length === 0 && (
        <p class="hint comms-empty" data-cy="comms-calls-empty">
          {t("comms.calls.empty")}
        </p>
      )}
      {calls && calls.length > 0 && (
        <table class="comms-calls__table">
          <thead>
            <tr>
              <th>{t("comms.calls.col.when")}</th>
              <th>{t("comms.calls.col.dir")}</th>
              <th>{t("comms.calls.col.peer")}</th>
              <th>{t("comms.calls.col.status")}</th>
              <th>{t("comms.calls.col.handled")}</th>
              <th>{t("comms.calls.col.duration")}</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => {
              const r = callRow(c);
              return (
                <tr
                  key={c.id}
                  class={`comms-call-row ${open?.id === c.id ? "is-on" : ""}`}
                  data-cy="comms-call-row"
                  data-id={c.id}
                  tabIndex={0}
                  onClick={() => openCall(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") openCall(c.id);
                  }}
                >
                  <td>{shortTime(r.at)}</td>
                  <td>{t(r.dirKey)}</td>
                  <td>{r.peer}</td>
                  <td>
                    <span class={`chip ${r.status.cls}`}>
                      {t(r.status.key)}
                    </span>
                  </td>
                  <td>{t(r.handledKey)}</td>
                  <td>{r.duration}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {open && (
        <section class="comms-call" data-cy="comms-call-detail">
          <div class="comms-call__head">
            <strong>{formatPhone(open.peer)}</strong>
            <span class="hint">
              {t(`comms.calls.dir.${open.direction}`)} ·{" "}
              {t(`comms.handledBy.${open.handledBy}`)} ·{" "}
              {formatDuration(open.durationSec)}
            </span>
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              data-cy="comms-call-close"
              onClick={() => setOpen(null)}
            >
              {t("comms.calls.close")}
            </button>
          </div>
          {open.recordingUrl && (
            <div class="comms-call__rec">
              <div class="comms-call__label">{t("comms.calls.recording")}</div>
              <audio
                controls
                preload="none"
                src={open.recordingUrl}
                data-cy="comms-recording"
              />
            </div>
          )}
          <div class="comms-call__label">{t("comms.calls.transcript")}</div>
          {open.transcript.length === 0
            ? (
              <p class="hint" data-cy="comms-transcript-empty">
                {t("comms.calls.noTranscript")}
              </p>
            )
            : (
              <ol class="comms-transcript" data-cy="comms-transcript">
                {open.transcript.map((turn, i) => (
                  <li
                    key={i}
                    class={`comms-turn comms-turn--${turn.role}`}
                    data-role={turn.role}
                  >
                    <span class="comms-turn__who">
                      {turn.role === "caller"
                        ? t("comms.calls.caller")
                        : t("comms.calls.agent")}
                    </span>
                    <span>{turn.text}</span>
                  </li>
                ))}
              </ol>
            )}
        </section>
      )}
    </div>
  );
}

// ── REQ-916a — the softphone ────────────────────────────────────────────────

/** the slice of @twilio/voice-sdk this page uses */
interface TwilioCall {
  parameters: Record<string, string>;
  accept(): void;
  reject(): void;
  disconnect(): void;
  mute(on: boolean): void;
  sendDigits(d: string): void;
  on(ev: string, fn: (...a: unknown[]) => void): unknown;
}
interface TwilioDevice {
  register(): Promise<void>;
  destroy(): void;
  updateToken(token: string): void;
  connect(o: { params: Record<string, string> }): Promise<TwilioCall>;
  on(ev: string, fn: (...a: never[]) => void): unknown;
}
interface VoiceSdk {
  Device: new (token: string, opts?: Record<string, unknown>) => TwilioDevice;
}

async function loadVoiceSdk(): Promise<VoiceSdk> {
  const mod = await import(/* @vite-ignore */ VOICE_SDK_URL);
  const sdk = (mod.Device ? mod : mod.default) as VoiceSdk | undefined;
  if (!sdk?.Device) throw new Error("voice sdk: no Device export");
  return sdk;
}

function Softphone() {
  const [s, dispatch] = useReducer(phoneReducer, undefined, initialPhone);
  const state = useRef<PhoneState>(s);
  state.current = s;
  const device = useRef<TwilioDevice | null>(null);
  const call = useRef<TwilioCall | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [dial, setDial] = useState("");
  const [dialErr, setDialErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  function attach(c: TwilioCall) {
    call.current = c;
    c.on("accept", () => dispatch({ type: "accepted", at: Date.now() }));
    const end = () => {
      if (call.current === c) call.current = null;
      dispatch({ type: "ended" });
    };
    c.on("disconnect", end);
    c.on("cancel", end);
    c.on("reject", end);
    c.on("error", () => {
      if (call.current === c) call.current = null;
      dispatch({ type: "callFailed" });
    });
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (e: unknown, stage?: "sdk") => {
      if (!cancelled) {
        dispatch({
          type: "failed",
          reason: reasonKey(e, stage),
          detail: reasonDetail(e, stage),
        });
      }
    };
    const schedule = (expiresAt: string) => {
      clearTimeout(timer);
      timer = setTimeout(refresh, refreshDelayMs(expiresAt, Date.now()));
    };
    async function refresh() {
      try {
        const tk = await commsClient.voiceToken();
        device.current?.updateToken(tk.token);
        schedule(tk.expiresAt);
      } catch (e) {
        fail(e);
      }
    }
    (async () => {
      dispatch({ type: "register" });
      let tk;
      try {
        tk = await commsClient.voiceToken();
      } catch (e) {
        return fail(e);
      }
      let sdk: VoiceSdk;
      try {
        sdk = await loadVoiceSdk();
      } catch (e) {
        return fail(e, "sdk");
      }
      if (cancelled) return;
      try {
        const d = new sdk.Device(tk.token, {
          closeProtection: true,
          codecPreferences: ["opus", "pcmu"],
        });
        device.current = d;
        d.on("registered", () => dispatch({ type: "registered" }));
        d.on("error", (e: unknown) => {
          // a call's own error arrives on the call; a device error while idle means not registered
          if (!call.current) fail(e);
        });
        d.on("incoming", (c: TwilioCall) => {
          if (state.current.phase !== "ready") {
            c.reject();
            return;
          }
          attach(c);
          dispatch({ type: "incoming", from: c.parameters?.From ?? "" });
        });
        d.on("tokenWillExpire", () => {
          refresh();
        });
        await d.register();
        schedule(tk.expiresAt);
      } catch (e) {
        fail(e);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      try {
        device.current?.destroy();
      } catch { /* already gone */ }
      device.current = null;
      call.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (s.phase !== "in-call") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [s.phase]);

  async function placeCall(e: Event) {
    e.preventDefault();
    const to = toE164(dial);
    if (!to) {
      setDialErr(t("comms.inbox.badNumber"));
      return;
    }
    setDialErr(null);
    if (!device.current || s.phase !== "ready") return;
    dispatch({ type: "dial", to });
    try {
      attach(await device.current.connect({ params: { To: to } }));
    } catch {
      call.current = null;
      dispatch({ type: "callFailed" });
      setDialErr(t("comms.phone.callFailed"));
    }
  }

  const inCall = s.phase === "in-call" || s.phase === "dialing";

  return (
    <aside
      class="panel comms-phone"
      data-cy="comms-phone"
      data-phase={s.phase}
    >
      <h2 class="panel__title">
        <I d={ICN.phone} size={14} /> {t("comms.phone.title")}
      </h2>
      <p
        class={`comms-phone__status comms-phone__status--${s.phase}`}
        data-cy="comms-phone-status"
      >
        {s.phase === "error"
          ? t("comms.phone.notRegistered", {
            reason: t(s.reason ?? "comms.phone.reason.twilio") +
              (s.detail ? ` (${s.detail})` : ""), // REQ-919
          })
          : t(`comms.phone.phase.${s.phase}`)}
        {s.phase === "error" && (
          <button
            type="button"
            class="comms-phone__retry"
            data-cy="comms-phone-retry"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t("comms.phone.retry")}
          </button>
        )}
      </p>
      {s.phase === "ringing" && (
        <div class="comms-incoming" data-cy="comms-incoming" role="alert">
          <div>
            <div class="comms-call__label">{t("comms.phone.incoming")}</div>
            <strong>{formatPhone(s.peer) || t("comms.phone.unknown")}</strong>
          </div>
          <button
            type="button"
            class="btn btn--green btn--sm"
            data-cy="comms-answer"
            onClick={() =>
              call.current?.accept()}
          >
            {t("comms.phone.answer")}
          </button>
          <button
            type="button"
            class="btn btn--danger btn--sm"
            data-cy="comms-decline"
            onClick={() => {
              call.current?.reject();
              call.current = null;
              dispatch({ type: "declined" });
            }}
          >
            {t("comms.phone.decline")}
          </button>
        </div>
      )}
      {inCall
        ? (
          <div class="comms-incall" data-cy="comms-incall">
            <div class="comms-incall__peer">{formatPhone(s.peer)}</div>
            <div class="comms-incall__timer" data-cy="comms-timer">
              {s.phase === "in-call" && s.startedAt
                ? formatTimer(now - s.startedAt)
                : t("comms.phone.phase.dialing")}
            </div>
            <div class="comms-keypad">
              {KEYPAD.map((d) => (
                <button
                  type="button"
                  key={d}
                  class="comms-key"
                  data-cy="comms-dtmf"
                  data-digit={d}
                  disabled={s.phase !== "in-call"}
                  onClick={() => call.current?.sendDigits(d)}
                >
                  {d}
                </button>
              ))}
            </div>
            <div class="comms-incall__actions">
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                data-cy="comms-mute"
                aria-pressed={s.muted}
                disabled={s.phase !== "in-call"}
                onClick={() => {
                  call.current?.mute(!s.muted);
                  dispatch({ type: "mute", muted: !s.muted });
                }}
              >
                <I d={ICN.mic} size={14} />{" "}
                {s.muted ? t("comms.phone.unmute") : t("comms.phone.mute")}
              </button>
              <button
                type="button"
                class="btn btn--danger btn--sm"
                data-cy="comms-hangup"
                onClick={() => {
                  call.current?.disconnect();
                  dispatch({ type: "ended" });
                }}
              >
                {t("comms.phone.hangup")}
              </button>
            </div>
          </div>
        )
        : (
          <form class="comms-dial" onSubmit={placeCall}>
            <input
              value={dial}
              inputMode="tel"
              placeholder={PHONE_PLACEHOLDER}
              aria-label={t("comms.phone.number")}
              data-cy="comms-dial"
              onInput={(e) => setDial((e.target as HTMLInputElement).value)}
            />
            <div class="comms-keypad">
              {KEYPAD.map((d) => (
                <button
                  type="button"
                  key={d}
                  class="comms-key"
                  data-cy="comms-pad"
                  data-digit={d}
                  onClick={() => setDial((v) => v + d)}
                >
                  {d}
                </button>
              ))}
            </div>
            {dialErr && <p class="alert" data-cy="comms-dial-err">{dialErr}</p>}
            <button
              type="submit"
              class="btn btn--green btn--sm"
              data-cy="comms-call"
              disabled={s.phase !== "ready" || !dial.trim()}
            >
              <I d={ICN.phone} size={14} /> {t("comms.phone.call")}
            </button>
          </form>
        )}
    </aside>
  );
}
