import { useEffect, useRef, useState } from "preact/hooks";

const PINK = "#FF6B6B";
const PINK_DARK = "#d94e4e";
const GREEN = "#519843";
const TEAL = "#144852";
const INK = "#1c2c30";

type Step = 0 | 1 | 2 | 3 | 4;
const TOTAL_STEPS: Step = 4;

interface Props {
  /** Server-rendered initial step so the dots don't flash empty. */
  initialStep?: Step;
}

/**
 * Onboarding progress strip — replaces the static "Quick setup" banner.
 *
 * - Shows 4 dots that fill as the user answers (name, business, state,
 *   address). The current step pulses.
 * - Fires a confetti burst once the user reaches step 4 (handoff).
 * - Fades itself out a few seconds after completion so the chat takes
 *   over the visual focus.
 *
 * Subscribes to the `pm:profile-updated` CustomEvent (dispatched by
 * AsstChat after every successful onboarding turn) and refetches
 * /api/profile to count filled fields. Self-gating means SSR can render
 * the initial step from the server-resolved profile and the island
 * just keeps it in sync as the chat progresses.
 */
export default function OnboardingProgress({ initialStep = 0 }: Props) {
  const [step, setStep] = useState<Step>(initialStep);
  const [done, setDone] = useState(initialStep >= TOTAL_STEPS);
  const [hidden, setHidden] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastConfettiAt = useRef<number>(0);

  useEffect(() => {
    if (typeof globalThis.window === "undefined") return;
    const computeStep = async () => {
      try {
        const r = await fetch("/api/profile", { credentials: "include" });
        if (!r.ok) return;
        const j = await r.json() as {
          user?: { name?: string };
          identity?: { businessName?: string; legalName?: string };
          address?: { state?: string; postal?: string };
        };
        let s: Step = 0;
        if (j.user?.name?.trim()) s = (s + 1) as Step;
        if ((j.identity?.businessName?.trim() || j.identity?.legalName?.trim())) s = (s + 1) as Step;
        if (j.address?.state?.trim()) s = (s + 1) as Step;
        if (j.address?.postal?.trim()) s = (s + 1) as Step;
        setStep(s);
        if (s >= TOTAL_STEPS) {
          setDone(true);
          // Throttle: only confetti once per 5s in case multiple events fire.
          if (Date.now() - lastConfettiAt.current > 5000) {
            lastConfettiAt.current = Date.now();
            fireConfetti();
            globalThis.setTimeout(() => setHidden(true), 4500);
          }
        }
      } catch { /* network blip — ignore */ }
    };
    const onEvt = () => computeStep();
    globalThis.addEventListener("pm:profile-updated", onEvt as EventListener);
    // First compute on mount in case server-rendered initialStep is stale.
    computeStep();
    return () => globalThis.removeEventListener("pm:profile-updated", onEvt as EventListener);
  }, []);

  function fireConfetti() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.scale(dpr, dpr);
    const colors = [PINK, GREEN, TEAL, "#f9c74f", "#f9844a"];
    interface Particle { x: number; y: number; vx: number; vy: number; rot: number; vrot: number; color: string; size: number; }
    const N = 80;
    const parts: Particle[] = [];
    for (let i = 0; i < N; i++) {
      parts.push({
        x: rect.width / 2 + (Math.random() - 0.5) * 60,
        y: 18,
        vx: (Math.random() - 0.5) * 6,
        vy: -Math.random() * 7 - 2,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.4,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + Math.random() * 4,
      });
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, rect.width, rect.height);
      for (const p of parts) {
        // Gravity + drift
        p.vy += 0.25;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (t < 1700) {
        globalThis.requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, rect.width, rect.height);
      }
    };
    globalThis.requestAnimationFrame(tick);
  }

  if (hidden) return null;

  function quickReply(text: string) {
    globalThis.dispatchEvent(new CustomEvent("pm:onboard-send-text", { detail: { text } }));
  }

  function skipSetup() {
    // Mark "skip" so the gate doesn't bounce them back on next visit
    // (best-effort — the FE doesn't currently persist a skip flag, so the
    // user will see onboarding again on next ?onboard=1 visit. Acceptable
    // for now; the dashboard checklist will catch them).
    globalThis.location.assign("/dashboard");
  }

  const pct = (step / TOTAL_STEPS) * 100;
  const message = done
    ? "🎉 You're set — let's draft your first quote!"
    : step === 0
      ? "Quick setup — 4 fast questions and you're in."
      : step === 1
        ? "Nice. Just a few more."
        : step === 2
          ? "Halfway."
          : step === 3
            ? "One left."
            : "Last bit.";

  return (
    <div
      style={`position:relative;padding:14px 22px 16px;background:linear-gradient(135deg,rgba(255,107,107,0.08) 0%,rgba(255,107,107,0.02) 100%);border-bottom:1px solid rgba(255,107,107,0.20);overflow:hidden;transition:opacity 600ms ease-out;opacity:${hidden ? 0 : 1}`}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style="position:absolute;inset:0;pointer-events:none;width:100%;height:100%"
      />
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;position:relative;z-index:1">
        <span aria-hidden="true" style={`display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:${done ? GREEN : PINK};color:#fff;font-weight:800;flex-shrink:0;font-size:15px;transition:background 280ms`}>
          {done ? "✓" : "👋"}
        </span>
        <div style="flex:1;min-width:160px">
          <div style={`font-size:13.5px;color:${INK};font-weight:600;line-height:1.35`}>
            <strong style={`color:${done ? GREEN : PINK_DARK};letter-spacing:.04em;text-transform:uppercase;font-size:11px;font-weight:800;margin-right:6px`}>
              {done ? "Setup complete" : "Quick setup"}
            </strong>
            {message}
          </div>
          {/* Dots + thin progress bar */}
          <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
            {[1, 2, 3, 4].map((i) => {
              const filled = step >= i;
              const pulsing = step === i - 1 && !done;
              return (
                <span
                  key={i}
                  style={`width:10px;height:10px;border-radius:50%;flex-shrink:0;transition:all 280ms ease;background:${filled ? (done ? GREEN : PINK) : "rgba(255,107,107,0.20)"};${pulsing ? `animation:pm-onb-pulse 1.4s ease-in-out infinite;` : ""}`}
                />
              );
            })}
            <div
              role="progressbar"
              aria-label="Onboarding progress"
              aria-valuemin={0}
              aria-valuemax={TOTAL_STEPS}
              aria-valuenow={step}
              style="flex:1;height:3px;border-radius:999px;background:rgba(255,107,107,0.15);overflow:hidden;margin-left:4px"
            >
              <div style={`height:100%;background:${done ? GREEN : `linear-gradient(90deg,${PINK} 0%,${PINK_DARK} 100%)`};width:${pct}%;transition:width 480ms cubic-bezier(0.34,1.56,0.64,1);border-radius:999px`} />
            </div>
            <span style={`font-size:11px;font-weight:800;color:${done ? GREEN : PINK_DARK};letter-spacing:.06em;min-width:30px;text-align:right`}>{step}/{TOTAL_STEPS}</span>
          </div>
          {/* Step-specific quick replies. Banner-level so they're discoverable
              regardless of which step the assistant is currently on, and
              non-blocking (you can still type your own answer below). */}
          {!done && (
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
              {step === 2 && (
                <>
                  <button type="button" onClick={() => quickReply("Yes")} style={`appearance:none;font:inherit;font-weight:700;font-size:11.5px;padding:5px 11px;border-radius:999px;border:1px solid ${GREEN};background:#fff;color:${GREEN};cursor:pointer`}>
                    Yes — sounds right
                  </button>
                  <button type="button" onClick={() => quickReply("different state")} style={`appearance:none;font:inherit;font-weight:700;font-size:11.5px;padding:5px 11px;border-radius:999px;border:1px solid rgba(20,72,82,0.20);background:#fff;color:${TEAL};cursor:pointer`}>
                    Different state
                  </button>
                </>
              )}
              {step === 3 && (
                <button type="button" onClick={() => quickReply("skip")} style={`appearance:none;font:inherit;font-weight:700;font-size:11.5px;padding:5px 11px;border-radius:999px;border:1px solid rgba(20,72,82,0.20);background:#fff;color:${TEAL};cursor:pointer`}>
                  Skip
                </button>
              )}
              <button type="button" onClick={skipSetup} style={`appearance:none;font:inherit;font-weight:600;font-size:11.5px;padding:5px 11px;border-radius:999px;border:1px dashed rgba(20,72,82,0.20);background:transparent;color:${INK};opacity:0.7;cursor:pointer;margin-left:auto`}>
                Skip setup · do this later
              </button>
            </div>
          )}
        </div>
      </div>
      <style>{`
        @keyframes pm-onb-pulse {
          0%, 100% { transform: scale(1);   box-shadow: 0 0 0 0 rgba(255,107,107,0.5); }
          50%      { transform: scale(1.35); box-shadow: 0 0 0 6px rgba(255,107,107,0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="pm-onb-pulse"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
