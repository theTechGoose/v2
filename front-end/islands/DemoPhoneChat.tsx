import { useEffect, useRef, useState } from "preact/hooks";
import { langSignal } from "../lib/lang.ts";

const SCRIPT_EN: { from: "in" | "out"; text: string }[] = [
  { from: "in",  text: "Hey Bossie — kitchen remodel for the Riveras. Got pics." },
  { from: "out", text: "Got 'em. Want me to draft a quote at $14,200?" },
  { from: "in",  text: "Yeah send it." },
  { from: "out", text: "Sent. They opened it. I'll nudge if no reply by Friday." },
];

const SCRIPT_ES: { from: "in" | "out"; text: string }[] = [
  { from: "in",  text: "Bossie — remodelación de cocina para los Rivera. Tengo fotos." },
  { from: "out", text: "Listo. ¿Cotización a $14,200?" },
  { from: "in",  text: "Sí, mándalo." },
  { from: "out", text: "Enviado. Ya lo abrieron. Si no contestan el viernes, los empujo." },
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
    return () => { io.disconnect(); unsub(); };
  }, []);

  const script = langSignal.value === "es" ? SCRIPT_ES : SCRIPT_EN;

  return (
    <div ref={ref} class="phone">
      <div class="phone__screen">
        {script.slice(0, shown).map((m, i) => (
          <div class={`bubble bubble--${m.from}`} key={i}>{m.text}</div>
        ))}
      </div>
    </div>
  );
}
