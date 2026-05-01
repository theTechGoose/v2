import { useEffect, useState } from "preact/hooks";

const STORAGE_KEY = "pm:assistant-coachmark-shown";
const PINK = "#FF6B6B";
const PINK_DARK = "#d94e4e";
const TEAL = "#144852";

/**
 * One-shot dashboard coachmark — shows on the user's FIRST visit to the
 * dashboard after onboarding completes. Masks the rest of the app with a
 * dark backdrop and cuts a hole over the "My assistant" sidebar button so
 * it's the only visible affordance.
 *
 * Entrance choreography (timing tuned to read as a single beat, not a slow
 * staged reveal — total intro ~700ms before the bubble fully lands):
 *
 *   t=0      — backdrop starts fading in (opacity + slight backdrop blur)
 *   t=120ms  — spotlight ring spring-pops to 1.0 from scale(0.6)
 *   t=240ms  — two sonar ripples emit outward from the button
 *   t=320ms  — speech bubble slides in from the right + scales 0.85→1
 *              with a subtle rotate(2°→0°), arrow notch wiggles
 *   t=520ms  — "click anywhere to dismiss" fades in at bottom
 *
 * After mount: the spotlight halo breathes (continuous pulse), the bubble's
 * arrow nudges left/right, and 4 tiny pink sparkles orbit the button. All
 * paused under prefers-reduced-motion.
 *
 * Click anywhere → fade out + persist to localStorage. The coachmark never
 * re-appears.
 */
export default function AssistantCoachmark() {
  const [visible, setVisible] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [fadingOut, setFadingOut] = useState(false);
  const [phase, setPhase] = useState<0 | 1 | 2>(0); // 0 = pre-mount, 1 = entering, 2 = settled

  useEffect(() => {
    if (typeof globalThis.window === "undefined") return;
    let alreadyShown = false;
    try { alreadyShown = globalThis.localStorage.getItem(STORAGE_KEY) === "1"; } catch { /* SSR-safe */ }
    if (alreadyShown) return;
    let tries = 0;
    const find = () => {
      tries++;
      const el = document.querySelector('a[href="/assistant"].sb__textus, .sb__textus[href="/assistant"]');
      if (el instanceof HTMLElement) {
        measure(el);
        setVisible(true);
        // Kick off the entrance — defer one frame so the initial paint
        // has the elements at their start state, then animate to settled.
        globalThis.requestAnimationFrame(() => {
          globalThis.requestAnimationFrame(() => setPhase(1));
        });
        // Mark "settled" after the staged entrance completes (matches
        // the longest delay in the sequence, ~720ms total).
        globalThis.setTimeout(() => setPhase(2), 800);
        return;
      }
      if (tries < 30) globalThis.setTimeout(find, 120);
    };
    find();
    const onResize = () => {
      const el = document.querySelector('a[href="/assistant"].sb__textus, .sb__textus[href="/assistant"]');
      if (el instanceof HTMLElement) measure(el);
    };
    globalThis.addEventListener("resize", onResize);
    return () => globalThis.removeEventListener("resize", onResize);
  }, []);

  function measure(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
  }

  function dismiss() {
    setFadingOut(true);
    try { globalThis.localStorage.setItem(STORAGE_KEY, "1"); } catch { /* SSR-safe */ }
    globalThis.setTimeout(() => setVisible(false), 320);
  }

  if (!visible || !box) return null;

  const padding = 8;
  const holeTop = box.top - padding;
  const holeLeft = box.left - padding;
  const holeW = box.width + padding * 2;
  const holeH = box.height + padding * 2;
  const holeCx = holeLeft + holeW / 2;
  const holeCy = holeTop + holeH / 2;

  // Tooltip position: to the right of the hole, vertically centered.
  const tipLeft = holeLeft + holeW + 24;
  const tipTop = holeTop + holeH / 2 - 50;

  // Two sonar ripples staggered. Diameters scale up to ~3x the button
  // height; opacity fades to 0 by the end. Pure CSS via keyframes so we
  // don't need rAF.
  const rippleR = Math.max(holeW, holeH) / 2;

  return (
    <div
      onClick={dismiss}
      style={`position:fixed;inset:0;z-index:9999;cursor:pointer;transition:opacity 320ms ease-out, backdrop-filter 320ms ease-out;opacity:${fadingOut ? 0 : 1};backdrop-filter:${fadingOut ? "blur(0px)" : "blur(2px)"};-webkit-backdrop-filter:${fadingOut ? "blur(0px)" : "blur(2px)"}`}
      aria-label="Onboarding hint — click anywhere to dismiss"
      role="dialog"
    >
      {/* SVG mask: dark overlay everywhere EXCEPT a rounded rect
          around the assistant button. Uses evenodd fill rule so the
          inner rectangle becomes a transparent cut-out. The whole SVG
          fades in via the wrapper opacity. The spotlight ring scale
          springs from 0.6 → 1.0 by tying transform-origin to the hole
          center (set inline below on the ring rect group). */}
      <svg
        width="100%"
        height="100%"
        style="position:absolute;inset:0;pointer-events:none"
        aria-hidden="true"
      >
        <defs>
          <mask id="coachmark-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect
              x={holeLeft}
              y={holeTop}
              width={holeW}
              height={holeH}
              rx="14"
              ry="14"
              fill="black"
            />
          </mask>
          <radialGradient id="coachmark-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="rgba(255,107,107,0.35)" />
            <stop offset="60%" stop-color="rgba(255,107,107,0.05)" />
            <stop offset="100%" stop-color="rgba(255,107,107,0)" />
          </radialGradient>
        </defs>

        {/* Dark backdrop — fades in over 320ms via wrapper opacity.
            Mask cuts the hole around the button. */}
        <rect
          x="0" y="0" width="100%" height="100%"
          fill="rgba(15,28,33,0.74)"
          mask="url(#coachmark-mask)"
          style={`transition:opacity 320ms ease-out;opacity:${phase === 0 ? 0 : 1}`}
        />

        {/* Soft radial bloom under the button — ambient glow that warms
            up as the spotlight settles. */}
        <ellipse
          cx={holeCx}
          cy={holeCy}
          rx={holeW * 1.2}
          ry={holeH * 1.4}
          fill="url(#coachmark-glow)"
          style={`transition:opacity 480ms ease-out 240ms;opacity:${phase === 0 ? 0 : 1}`}
        />

        {/* Sonar ripples — two concentric circles spring outward from
            the button. Pure CSS @keyframes scale + opacity. Staggered
            240ms apart. */}
        {phase >= 1 && (
          <>
            <circle
              cx={holeCx}
              cy={holeCy}
              r={rippleR}
              fill="none"
              stroke={PINK}
              stroke-width="2"
              style="transform-origin:center;transform-box:fill-box;animation:coach-ripple 1.6s ease-out 0.24s 2;opacity:0"
            />
            <circle
              cx={holeCx}
              cy={holeCy}
              r={rippleR}
              fill="none"
              stroke={PINK}
              stroke-width="2"
              style="transform-origin:center;transform-box:fill-box;animation:coach-ripple 1.6s ease-out 0.48s 2;opacity:0"
            />
          </>
        )}

        {/* Spotlight ring — the always-visible pink stroke around the
            button. Scales from 0.6 → 1 with overshoot on entrance, then
            breathes continuously to keep attention. transform-origin is
            the button center (set via transform-box on the rect). */}
        <rect
          x={holeLeft - 2}
          y={holeTop - 2}
          width={holeW + 4}
          height={holeH + 4}
          rx="16"
          ry="16"
          fill="none"
          stroke={PINK}
          stroke-width="2.5"
          style={`filter:drop-shadow(0 0 14px rgba(255,107,107,0.75));transform-origin:${holeCx}px ${holeCy}px;transform-box:view-box;transition:transform 520ms cubic-bezier(0.34, 1.56, 0.64, 1) 120ms, opacity 320ms ease-out 120ms;transform:${phase === 0 ? "scale(0.6)" : "scale(1)"};opacity:${phase === 0 ? 0 : 1};animation:${phase === 2 ? "coach-breathe 2.6s ease-in-out infinite 800ms" : "none"}`}
        />

        {/* Orbital sparkles — 4 tiny pink dots that drift around the
            button after settle. Subtle, not loud. */}
        {phase === 2 && (
          <>
            {[0, 1, 2, 3].map((i) => (
              <circle
                key={i}
                cx={holeCx}
                cy={holeCy - holeH / 2 - 14}
                r="2.5"
                fill={PINK}
                style={`transform-origin:${holeCx}px ${holeCy}px;animation:coach-orbit 5.2s linear infinite;animation-delay:${i * 1.3}s;opacity:0.85;filter:drop-shadow(0 0 6px rgba(255,107,107,0.7))`}
              />
            ))}
          </>
        )}
      </svg>

      {/* Speech bubble — slides in from the right of the button with a
          subtle scale + tilt. After settle, the arrow nudges as a
          breathing micro-animation. */}
      <div
        style={`position:absolute;top:${tipTop}px;left:${tipLeft}px;background:linear-gradient(135deg, ${PINK} 0%, ${PINK_DARK} 100%);color:#fff;padding:14px 18px;border-radius:14px;max-width:280px;box-shadow:0 14px 40px rgba(255,107,107,0.45), 0 2px 8px rgba(0,0,0,0.18);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;transition:transform 460ms cubic-bezier(0.34, 1.56, 0.64, 1) 320ms, opacity 320ms ease-out 320ms;transform-origin:left center;transform:${phase === 0 ? "translateX(-24px) scale(0.85) rotate(2deg)" : "translateX(0) scale(1) rotate(0deg)"};opacity:${phase === 0 ? 0 : 1}`}
      >
        <div style="font-weight:800;font-size:14px;letter-spacing:.01em;display:flex;align-items:center;gap:6px">
          <span style="display:inline-block;animation:coach-wave 2.8s ease-in-out infinite;transform-origin:70% 80%">👋</span>
          <span>Click here to talk to your assistant</span>
        </div>
        <div style="margin-top:6px;font-size:12px;opacity:0.92;line-height:1.4">Bossie drafts quotes, sends contracts, chases invoices. Tap to start.</div>
        {/* Arrow notch pointing left toward the highlighted button —
            subtle nudge animation while idle. */}
        <div
          style={`position:absolute;left:-8px;top:50%;transform:translateY(-50%);width:0;height:0;border-top:8px solid transparent;border-bottom:8px solid transparent;border-right:8px solid ${PINK};animation:${phase === 2 ? "coach-arrow-nudge 1.6s ease-in-out infinite 800ms" : "none"}`}
        />
      </div>

      {/* Dismiss hint */}
      <div
        style={`position:absolute;bottom:32px;left:50%;color:#fff;font-size:12px;opacity:${phase === 0 ? 0 : 0.65};letter-spacing:.04em;text-align:center;transition:opacity 320ms ease-out 520ms, transform 460ms cubic-bezier(0.34, 1.56, 0.64, 1) 520ms;transform:translateX(-50%) translateY(${phase === 0 ? "8px" : "0"})`}
      >
        click anywhere to dismiss
      </div>

      <style>{`
        @keyframes coach-ripple {
          0%   { transform: scale(0.7); opacity: 0.55; }
          80%  { opacity: 0; }
          100% { transform: scale(2.6); opacity: 0; }
        }
        @keyframes coach-breathe {
          0%, 100% { filter: drop-shadow(0 0 14px rgba(255,107,107,0.75)); transform: scale(1); }
          50%      { filter: drop-shadow(0 0 22px rgba(255,107,107,0.95)); transform: scale(1.025); }
        }
        @keyframes coach-orbit {
          0%   { transform: rotate(0deg)   translateY(0) scale(1); opacity: 0; }
          15%  { opacity: 0.95; }
          50%  { transform: rotate(180deg) translateY(0) scale(1.15); opacity: 0.95; }
          85%  { opacity: 0.95; }
          100% { transform: rotate(360deg) translateY(0) scale(1); opacity: 0; }
        }
        @keyframes coach-wave {
          0%, 60%, 100% { transform: rotate(0deg); }
          70%           { transform: rotate(14deg); }
          80%           { transform: rotate(-8deg); }
          90%           { transform: rotate(10deg); }
        }
        @keyframes coach-arrow-nudge {
          0%, 100% { transform: translateY(-50%) translateX(0); }
          50%      { transform: translateY(-50%) translateX(4px); }
        }
        @media (prefers-reduced-motion: reduce) {
          [role=dialog] *,
          [role=dialog] *::before,
          [role=dialog] *::after {
            animation: none !important;
            transition-duration: 80ms !important;
          }
        }
      `}</style>
    </div>
  );
}
