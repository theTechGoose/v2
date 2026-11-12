/**
 * REQ-266 (demo issue ai-assistant-p7-options) / REQ-330 (demo cycle 1:
 * M21, M23, p15-7) — what one job option's bullets are allowed to be, and
 * how a set of options is kept honest. Shared by the options coordinator
 * (model reply + heuristic fallback) and the island's last-resort fallback
 * and edit-reopen, so no path quietly cuts a long job or paints two cards
 * with the same scope.
 *
 * There is NO bullet cap (REQ-330): a fourteen-item gut job keeps all
 * fourteen lines. The prompt asks the model to GROUP related items past
 * twelve, never to drop one; the picker scrolls.
 */

/** The "· Wider scope" version: EVERY bullet plus jobsite cleanup (once) —
 *  never fewer items than the full version. */
export function widerBullets(bullets: string[], cleanup: string): string[] {
  const key = cleanup.toLowerCase();
  const has = bullets.some((b) => b.toLowerCase() === key);
  return has ? bullets.slice() : [...bullets, cleanup];
}

/** One bullet's identity: case, inner spacing and trailing punctuation are
 *  not scope differences. */
export function bulletKey(bullet: string): string {
  return bullet.trim().replace(/\s+/g, " ").replace(/[.;:,!]+$/, "")
    .toLowerCase();
}

/** True when two bullet lists describe the same scope (same lines, same
 *  order, modulo case / spacing / trailing punctuation). */
export function sameBullets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (bulletKey(a[i]) !== bulletKey(b[i])) return false;
  }
  return true;
}

/** REQ-330 (p15-7): options whose bullet sets are equal collapse to the
 *  first one — the picker never shows "Shingle Replacement" and "Roof
 *  Shingle Installation" with the identical list. Order is kept. */
export function dedupeOptionsByBullets<T extends { bullets: string[] }>(
  options: readonly T[],
): T[] {
  const out: T[] = [];
  for (const o of options) {
    if (out.some((k) => sameBullets(k.bullets, o.bullets))) continue;
    out.push(o);
  }
  return out;
}

/** Shape of one picker option as both the server and the island see it. */
export interface PickerOption {
  id: string;
  jobName: string;
  summary: string;
  bullets: string[];
  byLang?: Record<
    string,
    { jobName: string; summary: string; bullets: string[] }
  >;
}

/** Stable id of the "what you have now" option on an edit-reopen. */
export const CURRENT_OPTION_ID = "current";

/**
 * REQ-330 (M23): the review card's current job details as a picker option —
 * every line verbatim, the title and summary kept, never regenerated or
 * capped. Seeded first and pre-selected when the pencil reopens the picker,
 * so an edit starts from what the contractor already has.
 */
export function currentDetailsOption(input: {
  lines: readonly string[];
  jobName?: string | null;
  summary?: string | null;
  byLang?: PickerOption["byLang"];
}): PickerOption {
  const bullets = input.lines.map((l) => l.trim()).filter((l) => l.length > 0);
  const jobName = (input.jobName ?? "").trim() ||
    (bullets[0] ?? "").split(/\s+/).slice(0, 3).join(" ");
  const summary = (input.summary ?? "").trim() || jobName;
  const out: PickerOption = {
    id: CURRENT_OPTION_ID,
    jobName,
    summary,
    bullets,
  };
  if (input.byLang) out.byLang = input.byLang;
  return out;
}

/** The seeded picker: the current option first, then every generated
 *  alternative whose bullets differ from it (and from each other). */
export function seedPickerOptions<T extends PickerOption>(
  current: T,
  generated: readonly T[] | null | undefined,
): T[] {
  return dedupeOptionsByBullets([current, ...(generated ?? [])]);
}
