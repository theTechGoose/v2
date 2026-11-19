/**
 * REQ-1058 (LOOP-007 q2-47) — the New work order Quote picker's options: the
 * account's quotes, narrowed to the picked customer when there is one, and
 * never the onboarding sample quote (P-15 `isSample`; REQ-360, the same rule
 * as the New invoice picker's `!q.isSample`, REQ-474).
 */
export function workOrderQuoteOptions<
  Q extends { customerId?: string | null; isSample?: boolean },
>(quotes: readonly Q[], customerId: string | null | undefined): Q[] {
  return quotes.filter((q) =>
    q.isSample !== true && (!customerId || q.customerId === customerId)
  );
}
