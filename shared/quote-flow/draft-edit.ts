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

/**
 * REQ-464 (demo-loop cycle 3, demo issue m33) — the Edit seed must not
 * outlive the draft card it targets. "Lock it in" used to leave
 * "Change the quote: " in the composer, asking for a change to a quote that
 * was now locked.
 *
 * A "bare" seed is a composer holding only the seed the island put there
 * (whitespace aside) — nothing typed after it. `seed` is the prompt the
 * island remembered from Edit, or null when Edit did not seed the composer.
 */
export function isBareEditSeed(current: string, seed: string | null): boolean {
  if (!seed || !seed.trim()) return false;
  return current.trim() === seed.trim();
}

/** The composer text once the seed's card has left the draft state: a bare
 *  seed is cleared, anything the contractor typed is kept. */
export function dropBareEditSeed(current: string, seed: string | null): string {
  return isBareEditSeed(current, seed) ? "" : current;
}

/** Show the "Type the change, e.g. tile $3,600" hint while the remembered
 *  seed still opens the composer text. */
export function showEditHint(current: string, seed: string | null): boolean {
  if (!seed || !seed.trim()) return false;
  return current.trimStart().startsWith(seed.trim());
}
