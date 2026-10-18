import { useEffect, useRef, useState } from "preact/hooks";

/**
 * REQ-083 — the hero monster takes part in the signup: he leans toward the card when the phone
 * field is focused, turns to follow the cursor, and bounces when the code goes out and when it
 * opens the account. The signup island tells him through one DOM event (`l2:monster`, detail
 * "lean" | "rest" | "bounce"); the cursor is read here. A person who asked for reduced motion
 * gets the still monster: no listeners at all.
 */
export default function Landing2Monster(
  { src, alt }: { src: string; alt: string },
) {
  const ref = useRef<HTMLDivElement>(null);
  const [lean, setLean] = useState(false);
  const [bouncing, setBouncing] = useState(false);
  const [bounced, setBounced] = useState(false);

  useEffect(() => {
    const still =
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false;
    if (still) return;
    const onMood = (e: Event) => {
      const mood = (e as CustomEvent<string>).detail;
      if (mood === "bounce") {
        setBouncing(true);
        setBounced(true);
      } else setLean(mood === "lean");
    };
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const clamp = (v: number) => Math.max(-1, Math.min(1, v));
        const ty = clamp((e.clientX - cx) / (globalThis.innerWidth / 2)) * 10;
        const tx = clamp((cy - e.clientY) / (globalThis.innerHeight / 2)) * 6;
        el.style.setProperty("--l2-ty", `${ty.toFixed(1)}deg`);
        el.style.setProperty("--l2-tx", `${tx.toFixed(1)}deg`);
      });
    };
    document.addEventListener("l2:monster", onMood);
    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("l2:monster", onMood);
      document.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      class={`l2-hero__disc l2-monster ${lean ? "l2-monster--lean" : ""} ${
        bouncing ? "l2-monster--bounce" : ""
      }`}
      data-cy="l2-monster"
      data-motion={bounced ? "bounced" : undefined}
      onAnimationEnd={() => setBouncing(false)}
    >
      <img src={src} alt={alt} />
    </div>
  );
}
