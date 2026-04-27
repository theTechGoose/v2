import { useEffect, useState } from "preact/hooks";
import { langSignal, STRINGS } from "../lib/lang.ts";

export default function HeroRotor() {
  const [i, setI] = useState(0);
  const [, force] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), 2000);
    const unsub = langSignal.subscribe(() => force((n) => n + 1));
    return () => { clearInterval(id); unsub(); };
  }, []);

  const words = STRINGS[langSignal.value]["hero.rotor"] as readonly string[];
  const word = words[i % words.length];

  return <span class="rotor">{word}</span>;
}
