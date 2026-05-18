/**
 * Phone-mockup island that drives both the live landing's demo section
 * and the `/stories/demo-phone-chat` design playground.
 *
 *   - Story mode:    `controls` toggles the Play/Reset/End buttons.
 *   - Landing mode:  `autoPlayOnView` plays the conversation once the
 *                    phone scrolls into view (matches the legacy
 *                    LandingScripts behavior).
 *   - Lang toggle:   when both `script`/`scriptEs` (and `quote`/`quoteEs`)
 *                    are provided, the island subscribes to `langSignal`
 *                    and swaps copy + replays.
 *
 * Animation timing mirrors the original `LandingScripts.startReveal`
 * exactly — typing 350ms in + 1100ms linger, bubbles 200ms initial /
 * 700ms thereafter — so the visual cadence is unchanged from prod.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { langSignal } from "../lib/lang.ts";

export interface Bubble {
  side: "left" | "right";
  kind: "bubble" | "meta" | "quote" | "typing";
  cls?: "me" | "them";
  text?: string;
  style?: string;
}

export interface QuoteCopy {
  hd: string;
  l1: string;
  l2: string;
  l3: string;
  total: string;
}

interface Props {
  script: Bubble[];
  scriptEs?: Bubble[];
  quote: QuoteCopy;
  quoteEs?: QuoteCopy;
  messageCopy?: string;
  messageCopyEs?: string;
  /** Default static lang when langSignal isn't being honored. */
  lang?: "en" | "es";
  /** When true, render Play/Reset/End buttons above the phone (story mode). */
  controls?: boolean;
  /** When true, start playback the first time the phone enters the
   *  viewport. Otherwise the phone shows the end state by default. */
  autoPlayOnView?: boolean;
}

function QuoteCard({ q }: { q: QuoteCopy }) {
  return (
    <div class="quote-card">
      <div class="qc-head"><span>{q.hd}</span><span class="pdf">PDF</span></div>
      <div class="row"><span>{q.l1}</span><strong>$ 4,200</strong></div>
      <div class="row"><span>{q.l2}</span><strong>$ 3,990</strong></div>
      <div class="row"><span>{q.l3}</span><strong>$ 2,800</strong></div>
      <div class="total"><span>{q.total}</span><span>$ 10,990</span></div>
    </div>
  );
}

export default function PhoneChat(props: Props) {
  const {
    script,
    scriptEs,
    quote,
    quoteEs,
    messageCopy = "Message",
    messageCopyEs = "Mensaje",
    lang: langProp = "en",
    controls = false,
    autoPlayOnView = false,
  } = props;

  // When both lang scripts are provided, treat langSignal as authoritative.
  const usesLangSignal = !!scriptEs;
  const [lang, setLang] = useState<"en" | "es">(
    usesLangSignal ? (langSignal.value as "en" | "es") : langProp,
  );

  const activeScript = lang === "es" && scriptEs ? scriptEs : script;
  const activeQuote = lang === "es" && quoteEs ? quoteEs : quote;
  const activeInputCopy = lang === "es" ? messageCopyEs : messageCopy;

  // `shown` = how many steps have the `.in` class. Default to all so static
  // design review lands on the final state. autoPlayOnView replays once the
  // phone scrolls into view.
  const [shown, setShown] = useState(activeScript.length);
  const [hidden, setHidden] = useState<Set<number>>(() => new Set());
  const cancelRef = useRef<{ cancel?: () => void }>({});
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const phoneRef = useRef<HTMLDivElement | null>(null);
  const playedRef = useRef(false);

  function cancel(): void {
    cancelRef.current.cancel?.();
    cancelRef.current.cancel = undefined;
  }

  function reset(): void {
    cancel();
    setShown(0);
    setHidden(new Set());
  }

  function showAll(): void {
    cancel();
    setShown(activeScript.length);
    setHidden(new Set());
  }

  function play(): void {
    cancel();
    setShown(0);
    setHidden(new Set());

    let cancelled = false;
    const timers: number[] = [];
    cancelRef.current.cancel = () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };

    let delay = 0;
    activeScript.forEach((step, i) => {
      const isTyping = step.kind === "typing";
      delay += isTyping ? 350 : (i === 0 ? 200 : 700);
      timers.push(
        globalThis.setTimeout(() => {
          if (cancelled) return;
          setShown(i + 1);
          if (!isTyping && i > 0 && activeScript[i - 1].kind === "typing") {
            setHidden((prev) => {
              const next = new Set(prev);
              next.add(i - 1);
              return next;
            });
          }
        }, delay) as unknown as number,
      );
      if (isTyping) delay += 1100;
    });
  }

  // Subscribe to langSignal when bilingual; replay if autoPlay is on.
  useEffect(() => {
    if (!usesLangSignal) return;
    const unsub = langSignal.subscribe((v) => {
      const next = v as "en" | "es";
      setLang(next);
      if (autoPlayOnView && playedRef.current) {
        // Restart in the new language.
        playedRef.current = false; // allow re-trigger
        // Defer the replay one frame so React state catches up first.
        globalThis.setTimeout(() => {
          play();
          playedRef.current = true;
        }, 0);
      }
    });
    return unsub;
  }, [usesLangSignal, autoPlayOnView]);

  // Auto-play on viewport entry (landing mode).
  useEffect(() => {
    if (!autoPlayOnView) return;
    const el = phoneRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !playedRef.current) {
          playedRef.current = true;
          play();
          break;
        }
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [autoPlayOnView]);

  // Keep latest message visible.
  useEffect(() => {
    const el = chatBodyRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [shown, hidden]);

  // Stop pending timers on unmount.
  useEffect(() => () => cancel(), []);

  return (
    <>
      {controls && (
        <div style="display: flex; gap: 8px; align-items: center; justify-content: center; font-family: var(--font-heading, system-ui); font-size: 13px; margin-bottom: 16px;">
          <button
            type="button"
            onClick={play}
            style="padding: 8px 16px; border-radius: 999px; border: none; background: var(--brand-pink, #FF6B6B); color: #fff; font-weight: 700; cursor: pointer;"
          >
            ▶ Play
          </button>
          <button
            type="button"
            onClick={reset}
            style="padding: 8px 16px; border-radius: 999px; border: 1px solid rgba(0,0,0,0.15); background: #fff; color: var(--brand-teal, #1A535C); font-weight: 600; cursor: pointer;"
          >
            ⟲ Reset
          </button>
          <button
            type="button"
            onClick={showAll}
            style="padding: 8px 16px; border-radius: 999px; border: 1px solid rgba(0,0,0,0.15); background: #fff; color: var(--brand-teal, #1A535C); font-weight: 600; cursor: pointer;"
          >
            ⏭ End state
          </button>
        </div>
      )}

      <div class="phone-wrap" style="position: relative;">
        <div class="phone-bg"></div>
        <div class="phone" ref={phoneRef}>
          <div class="phone-screen">
            <div class="phone-status">
              <span>9:41</span>
              <div class="icons"><span></span><span></span><span></span><span></span></div>
            </div>

            <div class="chat-header">
              <div class="av-pm"><img src="/logo-monster.png" alt="" /></div>
              <div class="meta">
                <strong>Paperwork Monster</strong>
                <span>{lang === "es" ? "En línea" : "Online"}</span>
              </div>
            </div>

            <div class="chat-body" ref={chatBodyRef}>
              {/* Only render up to `shown`; the chat-body's height grows
                  with each revealed step, keeping the latest flush with
                  the input bar via the auto-scroll effect. */}
              {activeScript.slice(0, shown).map((m, i) => {
                const sideClass = m.side === "right" ? "right" : "left";
                const isHidden = hidden.has(i);
                return (
                  <div
                    key={i}
                    class={`chat-step ${sideClass} in`}
                    style={`animation: bubble-in 360ms cubic-bezier(0.34, 1.4, 0.64, 1) both;${isHidden ? " display: none;" : ""}`}
                  >
                    {m.kind === "typing" && (
                      <div class="typing"><span></span><span></span><span></span></div>
                    )}
                    {m.kind === "bubble" && (
                      <div class={`bubble ${m.cls ?? ""}`.trim()} style={m.style}>{m.text}</div>
                    )}
                    {m.kind === "meta" && <div class="bubble-meta">{m.text}</div>}
                    {m.kind === "quote" && <QuoteCard q={activeQuote} />}
                  </div>
                );
              })}
            </div>

            <div class="chat-input">
              <div class="field">{activeInputCopy}</div>
              <div class="send">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
