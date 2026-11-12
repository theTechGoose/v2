/**
 * REQ-356 (demo-loop cycle 1, m8) — what pressing a plan card on the onboarding wizard does, said
 * on the card before it is pressed: a card IS the pick (a form posting /plan/pick, 303 to the
 * pay page), so the line under it (REQ-127's `note`) is the confirmation. A paid card names the
 * amount billed today, the monthly price after it, and that a secure payment page comes next;
 * the free card says nothing is paid. The amounts come from the one switch rule
 * (shared/quote-flow/plan-switch.ts) — the same rule the backend charges by.
 */
import {
  type SwitchCurrent,
  switchQuote,
} from "../../shared/quote-flow/plan-switch.ts";
import { dollars } from "../components/PlanCards.tsx";

type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export function wizardPlanNote(
  t: Translate,
  current: SwitchCurrent | null | undefined,
  targetId: string,
  now: string,
): string | null {
  const q = switchQuote(current, targetId, now);
  if (q.kind === "free") return t("welcome.plan.note.free");
  if (q.kind === "same") return null;
  return t("welcome.plan.note.paid", {
    due: dollars(q.dueCents),
    monthly: dollars(q.monthlyCents),
  });
}
