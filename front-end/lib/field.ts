/** Shared bits of the field pages (REQ-143): money, dates, the <em> in a title. */
import type { Lang } from "./lang.ts";

/** "$65.00" — cents to an exact dollar string; "—" when there is no number */
export function fmtMoneyExact(cents: number | undefined | null): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return `${cents < 0 ? "-" : ""}$${
    (Math.abs(cents) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/** the browser's local day as YYYY-MM-DD */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${
    String(now.getDate()).padStart(2, "0")
  }`;
}

/** YYYY-MM-DD ± n days */
export function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return todayIso(d);
}

/** "Mon, Oct 12" / "lun, 12 oct" */
export function fmtDay(iso: string, lang: Lang): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Split "Each client's <em>recurring</em> maintenance." into text and the emphasised run. */
export function splitEm(
  s: string,
): { before: string; em: string; after: string } | null {
  const m = /^(.*?)<em>(.*?)<\/em>(.*)$/s.exec(s);
  return m ? { before: m[1], em: m[2], after: m[3] } : null;
}

/** last 10 digits as (843) 555-0201; anything else as typed */
export function fmtCell(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(-10);
  return d.length === 10
    ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    : digits;
}

/**
 * REQ-144 — picking a customer on a new subscription fills the service
 * address with the customer's address on file. Never over what the owner
 * typed: only an empty box, or one still holding the previous pick's
 * address, is written; a pick with no address on file changes nothing.
 */
export function prefillAddress(
  current: string,
  previous: { address?: string } | undefined,
  next: { address?: string } | undefined,
): string {
  const picked = next?.address?.trim();
  if (!picked) return current;
  const untouched = !current.trim() ||
    (!!previous?.address && current.trim() === previous.address.trim());
  return untouched ? picked : current;
}

/** REQ-145 — the account's subscriptions by customer, oldest first; a customer with none is absent */
export function subscriptionsByCustomer<
  T extends { customerId: string; createdAt: string },
>(list: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (
    const s of [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  ) {
    const rows = m.get(s.customerId);
    if (rows) rows.push(s);
    else m.set(s.customerId, [s]);
  }
  return m;
}

/** REQ-145 — what one visit of a subscription bills: its items' sum */
export function perVisitCents(s: { items: { priceCents: number }[] }): number {
  return s.items.reduce((sum, i) => sum + i.priceCents, 0);
}
