/**
 * REQ-403 (demo-loop cycle 2, issue m11): the line under "Signed and
 * binding" on the public agreement promises only a confirmation that can
 * arrive. The server says which channel can carry it (`confirmChannel` on
 * `GET /quotes/:id/public`): an email, a text to a number whose latest text
 * did not fail, or none — then the page says the contractor has the signed
 * copy and points at the PDF download.
 */
export type ConfirmChannel = "email" | "text" | "none";

export type SignedNoteKey =
  | "quoteDoc.signedNote"
  | "quoteDoc.signedNoteSms"
  | "quoteDoc.signedNoteKept";

export function signedNoteKey(q: {
  confirmChannel?: ConfirmChannel | string;
  customer?: { email?: string | null } | null;
}): SignedNoteKey {
  const ch = q.confirmChannel ??
    (q.customer?.email?.trim() ? "email" : "none");
  if (ch === "email") return "quoteDoc.signedNote";
  if (ch === "text") return "quoteDoc.signedNoteSms";
  return "quoteDoc.signedNoteKept";
}
