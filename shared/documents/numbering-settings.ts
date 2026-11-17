/**
 * REQ-199 — the Settings "Document numbering" card's pure logic: what the
 * form sends and what each row says. Shared by the SettingsPage island and
 * the jest unit test; no I/O.
 */
import {
  DOC_KINDS,
  type DocKind,
  formatDocNumber,
  type NumberingStarts,
  parseStartingNumber,
  START_FIELD,
  startFor,
} from "./numbering.ts";

/** What GET /profile/numbering answers (mirrors backend users/dto/numbering.ts). */
export interface NumberingView {
  accountNumber: string;
  settings: NumberingStarts;
  /** per kind: the next number that will be issued ("INV-5001") */
  next: Record<DocKind, string>;
  /** per kind: true once the first number was issued — the start is locked */
  issued: Record<DocKind, boolean>;
  /** true once any kind has issued */
  locked: boolean;
}

/** The starting number typed per kind, as the input holds it. */
export type NumberingForm = Record<DocKind, string>;

/** What the inputs show for `view`: each kind's setting, else the default 1. */
export function startValueOf(view: NumberingView, kind: DocKind): string {
  return String(startFor(view.settings, kind));
}

export function formOf(view: NumberingView): NumberingForm {
  const form = {} as NumberingForm;
  for (const kind of DOC_KINDS) form[kind] = startValueOf(view, kind);
  return form;
}

/**
 * The PUT /profile/numbering body: only the kinds whose typed start is a
 * valid integer that differs from the current setting, and only the kinds
 * that have not issued yet (the server would 409 those).
 */
export function numberingPatch(
  view: NumberingView,
  form: NumberingForm,
): NumberingStarts {
  const patch: NumberingStarts = {};
  for (const kind of DOC_KINDS) {
    if (view.issued[kind]) continue;
    const n = parseStartingNumber(form[kind]);
    if (n === null) continue;
    if (n === startFor(view.settings, kind)) continue;
    patch[START_FIELD[kind]] = n;
  }
  return patch;
}

/** The kinds whose typed value is not a positive integer. Blank is untouched, not invalid. */
export function invalidStartKinds(form: NumberingForm): DocKind[] {
  return DOC_KINDS.filter((kind) => {
    const raw = form[kind] ?? "";
    return raw.trim() !== "" && parseStartingNumber(raw) === null;
  });
}

/** "Next: INV-5001" from a "{number}" template. */
export function nextLabel(
  view: NumberingView,
  kind: DocKind,
  template: string,
): string {
  return template.replace("{number}", view.next[kind]);
}

/**
 * The last number this kind issued: the one before `next` ("INV-5000" when
 * next is INV-5001). Null while nothing was issued.
 */
export function issuedNumberOf(
  view: NumberingView,
  kind: DocKind,
): string | null {
  if (!view.issued[kind]) return null;
  const seq = Number((view.next[kind] ?? "").replace(/^[A-Za-z]+-?/, ""));
  if (!Number.isInteger(seq) || seq < 2) return null;
  return formatDocNumber(kind, seq - 1);
}

/** "Locked — INV-5000 is already in use" (REQ-411: a scheduled, never-sent
 *  invoice holds a number too); "" when the kind is open. */
export function lockNote(
  view: NumberingView,
  kind: DocKind,
  template: string,
): string {
  const number = issuedNumberOf(view, kind);
  return number ? template.replace("{number}", number) : "";
}

/** The inline 409 error: "Already issued, locked: Invoices, Quotes". */
export function lockedKindsMessage(
  kinds: readonly string[],
  labels: Partial<Record<string, string>>,
  template: string,
): string {
  const names = kinds.map((k) => labels[k] ?? k).join(", ");
  return template.replace("{kinds}", names);
}
