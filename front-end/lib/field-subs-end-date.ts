/**
 * REQ-1145 — AMENDMENT of REQ-1004 (LOOP-007 q3, q3-76): the one rule for the
 * New repeat visit form's optional "Ends on" date. It may not come before
 * First visit; a blank end means "no end". Both dates are ISO yyyy-mm-dd, so a
 * string compare is a date compare. The island derives its inline error from
 * this on every render, so editing either date re-checks it, and submit()
 * refuses with the same rule (the server's parseEndDate refuses it too).
 */
export function endDateError(
  start: string,
  end: string,
): "field.subs.endBeforeStart" | null {
  if (!end || !start) return null;
  return end < start ? "field.subs.endBeforeStart" : null;
}
