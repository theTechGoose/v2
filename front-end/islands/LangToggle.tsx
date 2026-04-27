import { useEffect } from "preact/hooks";
import { langSignal, type Lang } from "../lib/lang.ts";

interface Props {
  initial?: Lang;
}

export default function LangToggle({ initial }: Props) {
  useEffect(() => {
    const stored = globalThis.localStorage?.getItem("pm:lang") as Lang | null;
    langSignal.value = stored ?? initial ?? "en";
  }, []);

  function set(lang: Lang) {
    langSignal.value = lang;
    globalThis.localStorage?.setItem("pm:lang", lang);
  }

  return (
    <div class="lang-toggle" role="group" aria-label="Language">
      <button
        type="button"
        class={langSignal.value === "en" ? "active" : ""}
        onClick={() => set("en")}
        aria-pressed={langSignal.value === "en"}
      >
        EN
      </button>
      <button
        type="button"
        class={langSignal.value === "es" ? "active" : ""}
        onClick={() => set("es")}
        aria-pressed={langSignal.value === "es"}
      >
        ES
      </button>
    </div>
  );
}
