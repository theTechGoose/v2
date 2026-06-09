import { useEffect } from "preact/hooks";
import {
  type Lang,
  langSignal,
  persistLang,
  writeLangToUrl,
} from "../lib/lang.ts";
import { t } from "../lib/i18n.ts";

interface Props {
  initial?: Lang;
}

export default function LangToggle({ initial }: Props) {
  useEffect(() => {
    // lib/lang.ts already seeds langSignal at module load (query > storage).
    // Re-resolve here so a server-provided `initial` can act as the lowest
    // fallback. Priority: ?lang= > localStorage > initial > "en".
    const qp = new URLSearchParams(globalThis.location?.search ?? "").get(
      "lang",
    );
    const fromQuery: Lang | null = qp === "en" || qp === "es" ? qp : null;
    const stored = globalThis.localStorage?.getItem("pm:lang") as Lang | null;
    langSignal.value = fromQuery ?? stored ?? initial ?? "en";
  }, []);

  function set(lang: Lang) {
    langSignal.value = lang;
    persistLang(lang);
    writeLangToUrl(lang);
  }

  return (
    <div
      class="lang-toggle"
      role="group"
      aria-label={t("langToggle.ariaLabel")}
    >
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
