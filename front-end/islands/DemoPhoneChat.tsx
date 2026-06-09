import { useEffect, useRef, useState } from "preact/hooks";
import { langSignal } from "../lib/lang.ts";
import { t } from "../lib/i18n.ts";

const SCRIPT: { from: "in" | "out"; key: string }[] = [
  { from: "in", key: "demoChat.bubble1" },
  { from: "out", key: "demoChat.bubble2" },
  { from: "in", key: "demoChat.bubble3" },
  { from: "out", key: "demoChat.bubble4" },
];

export default function DemoPhoneChat() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [, force] = useState(0);

  useEffect(() => {
    const unsub = langSignal.subscribe(() => force((n) => n + 1));
    if (!ref.current) return () => unsub();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          let n = 0;
          const id = setInterval(() => {
            n += 1;
            setShown(n);
            if (n >= 4) clearInterval(id);
          }, 700);
          io.disconnect();
          break;
        }
      }
    }, { threshold: 0.4 });
    io.observe(ref.current);
    return () => {
      io.disconnect();
      unsub();
    };
  }, []);

  return (
    <div ref={ref} class="phone">
      <div class="phone__screen">
        {SCRIPT.slice(0, shown).map((m, i) => (
          <div class={`bubble bubble--${m.from}`} key={i}>{t(m.key)}</div>
        ))}
      </div>
    </div>
  );
}
