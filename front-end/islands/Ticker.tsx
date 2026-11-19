/**
 * Animated number. Ported from the prototype's `useTicker` + `<Ticker/>`.
 *
 * REQ-957 (LOOP-007 q1-32): it STARTS at the real value — the server render and the first paint
 * say the number, never a count-up from $0 ("MONEY OWED TO YOU $0" beside "$4,650 1 open
 * invoice"). Only a later change of `value` eases, from the number on screen to the new one; and
 * not at all under prefers-reduced-motion or in a hidden tab, where rAF is throttled or stopped.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { tickerFrame } from "../lib/ticker-frame.ts";

interface Props {
  value: number;
  prefix?: string;
  duration?: number;
}

function animationAllowed(): boolean {
  if (typeof document !== "undefined" && document.hidden) return false;
  try {
    return !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")
      .matches;
  } catch {
    return true;
  }
}

export default function Ticker({ value, prefix = "", duration = 1400 }: Props) {
  const [v, setV] = useState(value);
  // the number currently on screen — the start of the next ease
  const shown = useRef(value);

  useEffect(() => {
    const from = shown.current;
    if (from === value) return;
    if (!animationAllowed() || duration <= 0) {
      shown.current = value;
      setV(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      // REQ-473: clamped to [0,1] and never -0 (the demo's "$-0").
      const next = from + tickerFrame(value - from, start, now, duration);
      const settled = now - start >= duration;
      shown.current = settled ? value : next;
      setV(settled ? value : next);
      if (!settled) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  return <>{prefix}{v.toLocaleString("en-US")}</>;
}
