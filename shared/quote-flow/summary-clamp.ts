/**
 * Summary clamp (UX-18) — the ONE way a quote summary is shortened. A
 * truncated summary is always visibly truncated ("…"), never a silent
 * mid-phrase cut ("Instalación de patio de adoquines 20x15 para la").
 *
 * Pure and deterministic; idempotent by construction (a clamped value is
 * ≤ maxWords words, so it passes through unchanged).
 */

export function clampSummary(raw: string, maxWords = 8): string {
  const words = raw.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}
