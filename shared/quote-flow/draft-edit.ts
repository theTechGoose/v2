/**
 * REQ-246 (demo issue quote-invoice-money-m7) — "Edit" on the draft quote
 * card opens the composer for a correction instead of silently clearing it.
 *
 * What the composer holds after Edit: anything the contractor already typed
 * stays as it is (Edit must never wipe it); an empty composer gets the
 * localized edit prompt, so the next thing typed is the change to send.
 */
export function editDraftSeed(current: string, prompt: string): string {
  return current.trim().length > 0 ? current : prompt;
}
