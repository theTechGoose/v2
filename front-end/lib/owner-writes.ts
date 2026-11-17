/**
 * REQ-754 (demo-loop cycle 5v1, issue M5) — the owner's own writes reach his
 * other tabs.
 *
 * The verifier: an open /customers tab stayed at "$100 currently owed", with
 * no card for the new customer, 15 s after INV-002 was issued in another tab;
 * only a reload updated it. The pages follow REQ-493's change feed, but that
 * feed heard only the notifications (client actions: a signature, a claim)
 * and the `pm:changes` channel the PUBLIC pages post on. Nothing announced
 * what the owner did himself.
 *
 * So every successful owner write of a quote, an invoice or a customer is
 * announced on that channel: lib/api's request calls `announceWrite`, and the
 * pages that fetch by hand use `announcingFetch`. The writing tab is marked,
 * so it does not re-read its own write (lib/change-announce.ts).
 */
import {
  announceChange,
  type ChangeEntity,
  type EntityChange,
} from "./change-announce.ts";

/** the collections an owner write can move, by their first path segment */
const COLLECTIONS: Record<string, ChangeEntity> = {
  invoices: "invoice",
  quotes: "quote",
  customers: "customer",
};

function pathOf(url: string): string {
  let p = url;
  try {
    if (/^https?:\/\//i.test(url)) p = new URL(url).pathname;
  } catch { /* keep as is */ }
  p = p.split(/[?#]/)[0];
  return p.replace(/^\/api(?=\/)/, "");
}

/** the collection a path writes to, and the document's id when it names one */
function writeTarget(
  url: string,
): { entityType: ChangeEntity; id?: string } | null {
  const [collection, id] = pathOf(url).split("/").filter(Boolean);
  const entityType = COLLECTIONS[collection ?? ""];
  return entityType ? { entityType, ...(id ? { id } : {}) } : null;
}

/** The document a successful write moved, or null: the quote, invoice or
 *  customer its path names (`/invoices/<id>/…`, with or without `/api`), or
 *  — for a create on the collection itself — the answer's `id`. Reads and
 *  every other path are no change. */
export function changeFromWrite(
  method: string,
  url: string,
  answer?: unknown,
): EntityChange | null {
  if (!method || method.toUpperCase() === "GET") return null;
  const target = writeTarget(url);
  if (!target) return null;
  const entityId = target.id ??
    (answer && typeof answer === "object"
      ? (answer as { id?: unknown }).id
      : undefined);
  if (typeof entityId !== "string" || entityId === "") return null;
  return { entityType: target.entityType, entityId };
}

/** Announce a successful owner write to this browser's other tabs. */
export function announceWrite(
  method: string,
  url: string,
  answer?: unknown,
): void {
  const c = changeFromWrite(method, url, answer);
  if (c) announceChange(c, { fromThisTab: true });
}

/** `fetch`, announcing a successful write. A create on a collection reads
 *  the new id from a copy of the answer; the caller's body is untouched. */
export async function announcingFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  try {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    const method = init?.method ??
      (typeof input === "object" && "method" in input ? input.method : "GET");
    const target = writeTarget(url);
    if (res.ok && target && method.toUpperCase() !== "GET") {
      if (target.id) {
        announceWrite(method, url);
      } else {
        res.clone().json().then(
          (answer) => announceWrite(method, url, answer),
          () => {/* no JSON answer, nothing to name */},
        );
      }
    }
  } catch { /* announcing never breaks the write */ }
  return res;
}
