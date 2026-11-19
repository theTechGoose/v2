/**
 * REQ-974 — the dashboard setup checklist's counting, pure so it can be tested.
 *
 * An item marked `optional` (insurance) stays on the list (REQ-227(5)) but is
 * never a "thing left": the heading count and the progress bar use the
 * required items only. With only optional items open, the card reads as done
 * (`setupChecklist.heading.optionalOnly`, bar at 100%).
 */
export interface ChecklistCountable {
  done: boolean;
  optional?: boolean;
}

export interface SetupChecklistSummary {
  /** required items still open — the number the heading counts */
  requiredLeft: number;
  /** optional items still open — listed, never counted as missing */
  optionalLeft: number;
  /** 0–100, over the required items only */
  pct: number;
  /** the i18n key for the card's heading (takes `{ n: requiredLeft }`) */
  headingKey:
    | "setupChecklist.heading.one"
    | "setupChecklist.heading.other"
    | "setupChecklist.heading.optionalOnly";
}

export function setupChecklistSummary(
  items: readonly ChecklistCountable[],
): SetupChecklistSummary {
  const required = items.filter((i) => !i.optional);
  const requiredLeft = required.filter((i) => !i.done).length;
  const optionalLeft = items.filter((i) => i.optional && !i.done).length;
  const pct = required.length === 0 ? 100 : Math.round(
    ((required.length - requiredLeft) / required.length) * 100,
  );
  const headingKey = requiredLeft === 0
    ? "setupChecklist.heading.optionalOnly"
    : requiredLeft === 1
    ? "setupChecklist.heading.one"
    : "setupChecklist.heading.other";
  return { requiredLeft, optionalLeft, pct, headingKey };
}
