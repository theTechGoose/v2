/**
 * REQ-634 (demo-loop cycle 5, m34) — the quote review's inline customer
 * email/phone inputs: what a key does. Enter commits (the input blurs and its
 * blur saves), Escape reverts; a key that confirms an IME composition is the
 * composition's, not ours.
 */
export type HeroFieldKeyAction = "commit" | "revert" | null;

export function heroFieldKeyAction(
  key: string,
  isComposing = false,
): HeroFieldKeyAction {
  if (isComposing) return null;
  if (key === "Enter") return "commit";
  if (key === "Escape") return "revert";
  return null;
}
