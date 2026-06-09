import { useState } from "preact/hooks";
import { quotesClient } from "../clients/quotes.ts";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";

interface Props {
  id: string;
  /** Visual variant: "btn" matches qcard__back-foot buttons; "icon" is a compact × for table rows. */
  variant?: "btn" | "icon";
  label?: string;
  confirmText?: string;
  /** Optional SSR seed only; the live language is read from langSignal. */
  lang?: Lang;
}

export default function DeleteQuoteButton({
  id,
  variant = "btn",
  label,
  confirmText,
}: Props) {
  const lang = langSignal.value;
  const [busy, setBusy] = useState(false);
  const resolvedLabel = label ?? tFor(lang, "deleteQuoteButton.label");
  const resolvedConfirm = confirmText ?? tFor(lang, "deleteQuoteButton.confirm");

  async function onClick(e: MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    if (!globalThis.confirm(resolvedConfirm)) return;
    setBusy(true);
    try {
      await quotesClient.delete(id);
      globalThis.location.reload();
    } catch (err) {
      setBusy(false);
      globalThis.alert(tFor(lang, "deleteQuoteButton.error", { message: (err as Error).message }));
    }
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        class="qdone__del"
        onClick={onClick}
        disabled={busy}
        aria-label={tFor(lang, "deleteQuoteButton.ariaLabel")}
        title={tFor(lang, "deleteQuoteButton.ariaLabel")}
      >
        ×
      </button>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={busy}>
      {busy ? tFor(lang, "deleteQuoteButton.deleting") : resolvedLabel}
    </button>
  );
}
