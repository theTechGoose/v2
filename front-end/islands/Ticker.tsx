/**
 * Animated number — eases from 0 → target with requestAnimationFrame.
 * Direct port of the prototype's `useTicker` + `<Ticker/>`.
 */
import { useEffect, useState } from "preact/hooks";
import { tickerFrame } from "../lib/ticker-frame.ts";

interface Props {
  value: number;
  prefix?: string;
  duration?: number;
}

export default function Ticker({ value, prefix = "", duration = 1400 }: Props) {
  const [v, setV] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      // REQ-473: clamped to [0,1] and never -0 (the demo's "$-0").
      setV(tickerFrame(value, start, now, duration));
      if (now - start < duration) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{prefix}{v.toLocaleString("en-US")}</>;
}
