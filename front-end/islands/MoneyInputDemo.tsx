/**
 * REQ-280 — the dev page's harness: MoneyInput plus a line that prints the cents it reports.
 * REQ-329 — `anchorCents` (from /dev/money-input?anchor=<cents>) scales the quick chips.
 */
import { useState } from "preact/hooks";
import MoneyInput from "./MoneyInput.tsx";

export default function MoneyInputDemo(
  { anchorCents }: { anchorCents?: number | null },
) {
  const [cents, setCents] = useState<number | null>(null);
  return (
    <>
      <MoneyInput name="amount" onChange={setCents} anchorCents={anchorCents} />
      <p style="margin-top:20px;font-size:15px" data-cy="money-input-cents">
        {cents === null ? "No amount yet." : `Cents: ${cents}`}
      </p>
    </>
  );
}
