/**
 * Animated number — eases from 0 → target with requestAnimationFrame.
 * Direct port of the prototype's `useTicker` + `<Ticker/>`.
 */
import { useEffect, useState } from "preact/hooks";

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
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{prefix}{v.toLocaleString("en-US")}</>;
}
