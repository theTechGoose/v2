/**
 * REQ-627 / REQ-629 — the invoices page's multi-select: what a bulk Delete or
 * Void will do to each selected invoice (the same rules the server enforces),
 * how to sum up what it did, and the one-file batch PDF download.
 */
import { MAX_BULK_IDS, removalFor } from "../../shared/documents/removal.ts";

export type BulkAction = "delete" | "void";
export type SkipReason =
  | "must_void"
  | "must_delete"
  | "locked_paid"
  | "already_void"
  | "not_found";

export interface BulkInvoice {
  id: string;
  status?: string;
  sentAt?: string;
  paidCents?: number;
}

/** Which of the selection the action applies to, and why the rest are skipped. */
export function bulkPlan(
  invs: BulkInvoice[],
  action: BulkAction,
): { apply: string[]; skip: Array<{ id: string; reason: SkipReason }> } {
  const apply: string[] = [];
  const skip: Array<{ id: string; reason: SkipReason }> = [];
  for (const inv of invs) {
    const d = removalFor(inv, 0);
    if (d.action === "locked" || d.action === "none") {
      skip.push({ id: inv.id, reason: d.reason as SkipReason });
    } else if (d.action === action) apply.push(inv.id);
    else {
      skip.push({
        id: inv.id,
        reason: action === "delete" ? "must_void" : "must_delete",
      });
    }
  }
  return { apply, skip };
}

export interface BulkResult {
  id: string;
  outcome: string;
  reason?: string;
}

export function summarizeBulk(
  results: BulkResult[],
): { done: number; skipped: Partial<Record<string, number>> } {
  const skipped: Record<string, number> = {};
  let done = 0;
  for (const r of results) {
    if (r.outcome === "skipped") {
      const k = r.reason ?? "other";
      skipped[k] = (skipped[k] ?? 0) + 1;
    } else done++;
  }
  return { done, skipped };
}

/** "2 skipped: sent — void them instead (1), paid (1)" built by the caller's labels. */
export function bulkSkipNote(
  skipped: Partial<Record<string, number>>,
  label: (reason: string) => string,
): string {
  return Object.entries(skipped)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([reason, n]) => `${label(reason)} (${n})`)
    .join(" · ");
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** POST the ids to /api/invoices/pdf-batch and save the one PDF it returns. */
export async function downloadInvoicesPdf(
  ids: string[],
  deps: {
    fetch?: typeof fetch;
    save?: (blob: Blob, name: string) => void;
  } = {},
): Promise<{ ok: true } | { ok: false; status: number }> {
  if (ids.length === 0 || ids.length > MAX_BULK_IDS) {
    return { ok: false, status: 400 };
  }
  const doFetch = deps.fetch ?? fetch;
  let r: Response;
  try {
    r = await doFetch("/api/invoices/pdf-batch", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!r.ok) {
    await r.body?.cancel();
    return { ok: false, status: r.status };
  }
  const name = /filename="([^"]+)"/.exec(
    r.headers.get("content-disposition") ?? "",
  )?.[1] ?? "invoices.pdf";
  (deps.save ?? saveBlob)(await r.blob(), name);
  return { ok: true };
}
