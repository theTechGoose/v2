/**
 * REQ-401 — the batch page's and the worker screen's wording, kept pure so it is
 * tested against the real dictionaries (jest/unit/field-batch-send-copy.test.ts).
 *
 *  - demo M30: a send that sent nothing never says "each client got theirs";
 *    a failure the backend codes (`noRecipient`) is translated, with its fix.
 *  - demo m45: a task on an unsent draft is "on a draft invoice", not
 *    "invoiced"; the batch row's counts are plural-aware.
 */
type Vars = Record<string, string | number>;
type Tr = (key: string, vars?: Vars) => string;

export interface SendFailure {
  invoiceId: string;
  reason: string;
  /** REQ-401: set when the page can word the failure itself */
  code?: "noRecipient";
  customerId?: string;
}

export interface SendFailureLine {
  text: string;
  /** the fix, worded as a link ("Add an email or phone to Johnson"), or null */
  fix: string | null;
  customerId?: string;
}

/** "{n} invoice(s)" → "1 invoice" / "3 invoices" (the lang files carry the "(s)") */
export function pluralParens(text: string, n: number): string {
  return text.replace(/\((s|es)\)/g, (_m, x: string) => (n === 1 ? "" : x));
}

export function describeSend(
  r: { sent: number; failed: SendFailure[] },
  invoices: { id: string; customerId?: string; customerName: string }[],
  t: Tr,
): { flash: string; failures: SendFailureLine[] } {
  const flash = r.sent > 0
    ? pluralParens(t("field.lt.sent", { n: r.sent }), r.sent)
    : "";
  const failures = r.failed.map((f): SendFailureLine => {
    const inv = invoices.find((i) => i.id === f.invoiceId);
    const name = inv?.customerName ?? f.invoiceId;
    const customerId = f.customerId ?? inv?.customerId;
    if (f.code === "noRecipient") {
      return {
        text: t("field.lt.noRecipient", { name }),
        fix: t("field.lt.addContact", { name }),
        customerId,
      };
    }
    return { text: `${name}: ${f.reason}`, fix: null, customerId };
  });
  return { flash, failures };
}

/** "1 draft · 0 sent · 2 paid" — each count through its own plural key */
export function batchCounts(
  invoices: { status: string }[],
  tn: (key: string, n: number) => string,
): string {
  const count = (s: string) => invoices.filter((i) => i.status === s).length;
  return [
    tn("field.lt.drafts", count("draft")),
    tn("field.lt.sentCount", count("sent")),
    tn("field.lt.paidCount", count("paid")),
  ].join(" · ");
}

/** the worker's lock label: a draft not sent yet is not "invoiced" */
export function lockLabelKey(
  lockState: "draft" | "invoiced" | null | undefined,
): "worker.onDraft" | "worker.invoiced" {
  return lockState === "draft" ? "worker.onDraft" : "worker.invoiced";
}

/**
 * REQ-608 (demo m47, cycle 4) — the ticks a batch opens with. Ticks the office already
 * made are kept; with none, the batch's draft invoices are ticked — the same rule a
 * pull uses — so a reload (or opening the batch from the list) does not leave the
 * drafts unticked and "Send selected" disabled.
 */
export function defaultBatchChecks(
  batch: { invoices: { id: string; status: string }[] } | null | undefined,
  checked: Set<string>,
): Set<string> {
  if (checked.size > 0 || !batch) return checked;
  return new Set(
    batch.invoices.filter((i) => i.status === "draft").map((i) => i.id),
  );
}

/**
 * REQ-608 (demo m47, cycle 4) — how long the worker's "Note saved" line stays (unless the
 * note is edited again first), counted from AFTER the save's reload.
 */
export const NOTE_SAVED_MS = 6000;

/** REQ-810 — the guard a line's × sends: its task, else its text (the server 409s a row that no longer matches) */
export function lineKey(l: { taskId?: string; description: string }): string {
  return l.taskId || l.description;
}

/** REQ-810 — the batch list after one batch changed in place: the same order, that batch replaced */
export function replaceBatch<B extends { id: string }>(all: B[], next: B): B[] {
  return all.map((b) => (b.id === next.id ? next : b));
}
