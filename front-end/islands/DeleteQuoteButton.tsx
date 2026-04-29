import { useState } from "preact/hooks";
import { quotesClient } from "../clients/quotes.ts";

interface Props {
  id: string;
  /** Visual variant: "btn" matches qcard__back-foot buttons; "icon" is a compact × for table rows. */
  variant?: "btn" | "icon";
  label?: string;
  confirmText?: string;
}

export default function DeleteQuoteButton({
  id,
  variant = "btn",
  label = "Delete",
  confirmText = "Delete this quote? This cannot be undone.",
}: Props) {
  const [busy, setBusy] = useState(false);

  async function onClick(e: MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    if (!globalThis.confirm(confirmText)) return;
    setBusy(true);
    try {
      await quotesClient.delete(id);
      globalThis.location.reload();
    } catch (err) {
      setBusy(false);
      globalThis.alert(`Couldn't delete quote: ${(err as Error).message}`);
    }
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        class="qdone__del"
        onClick={onClick}
        disabled={busy}
        aria-label="Delete quote"
        title="Delete quote"
      >×</button>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={busy}>
      {busy ? "Deleting…" : label}
    </button>
  );
}
