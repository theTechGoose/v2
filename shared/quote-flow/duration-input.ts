/**
 * REQ-390 (demo-loop cycle 2, m18) — the custom duration picker's number. The
 * picker used to clamp whatever was typed into 1–99 before checking it, so
 * "-3" read "1 day" in the agreement. The typed text is checked as typed: a
 * whole number from 1 to 99, else a message. Empty is not an error yet —
 * "Lock in" just waits for a number.
 */
export type DurationNumberErrorKey = "asstChat.duration.invalidNumber";

export interface DurationNumber {
  n: number | null;
  error: DurationNumberErrorKey | null;
}

export function parseDurationNumber(
  raw: string | null | undefined,
): DurationNumber {
  const s = (raw ?? "").trim();
  if (!s) return { n: null, error: null };
  if (!/^\d{1,2}$/.test(s)) {
    return { n: null, error: "asstChat.duration.invalidNumber" };
  }
  const n = Number(s);
  if (n < 1 || n > 99) {
    return { n: null, error: "asstChat.duration.invalidNumber" };
  }
  return { n, error: null };
}

/**
 * REQ-458 (demo-loop cycle 3, M38) — an EMPTY number (REQ-343 opens the picker
 * that way) used to preview as a bare "—", which read as a dead end. Empty
 * now asks for the number instead; a typed number gets no hint (the preview
 * or REQ-390's message speaks).
 */
export function durationPreviewHint(
  raw: string | null | undefined,
): "asstChat.duration.previewEmpty" | null {
  return (raw ?? "").trim() ? null : "asstChat.duration.previewEmpty";
}
