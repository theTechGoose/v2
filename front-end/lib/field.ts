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

/** REQ-152 — the customers as SearchSelect rows: the name is the label, the address on file the hint */
export function customerOptions(
  customers: { id: string; name: string; address?: string }[],
): { id: string; label: string; hint?: string }[] {
  return customers.map((c) => {
    const hint = c.address?.trim();
    return hint
      ? { id: c.id, label: c.name, hint }
      : { id: c.id, label: c.name };
  });
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

/**
 * REQ-285 — the language the /worker screen switches to once a worker is
 * signed in: the worker's own (the backend answers it, REQ-155's rule), unless
 * the person already chose one (the EN/ES switch, or ?lang= in the address).
 * null = leave the screen as it is.
 */
export function workerScreenLang(
  who: { language?: string } | null,
  chosen: boolean,
): Lang | null {
  if (chosen || !who) return null;
  return who.language === "en" || who.language === "es" ? who.language : null;
}

/** REQ-288 — the continental US: the map's view when nothing better is known (never the dev seed's town) */
export const US_MAP_VIEW = { lat: 39.5, lng: -98.35, zoom: 4 } as const;

export type MapViewPlan =
  | { fit: [number, number][] }
  | { center: [number, number]; zoom: number };

/** REQ-288 — the assignments map: fit the subscriptions; with none, the business's
 *  own place (GET /field/regions/center); with neither, the whole US */
export function assignmentsMapView(
  pts: [number, number][],
  center: { lat: number; lng: number; zoom: number } | null,
): MapViewPlan {
  if (pts.length) return { fit: pts };
  const at = center ?? US_MAP_VIEW;
  return { center: [at.lat, at.lng], zoom: at.zoom };
}

/** "120" / "120.50" → cents, or null when it is not a price */
export function centsOf(raw: string): number | null {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** REQ-283 — the first thing the one-off "Add task" form is missing, by field, with its message key; null when it can be sent */
export function addTaskProblem(
  f: { customerId: string; typeName: string; price: string },
):
  | { field: "customer"; key: "field.tk.needCustomer" }
  | { field: "type"; key: "field.tk.needType" }
  | { field: "price"; key: "field.tk.badPrice" }
  | null {
  if (!f.customerId) return { field: "customer", key: "field.tk.needCustomer" };
  if (!f.typeName.trim()) return { field: "type", key: "field.tk.needType" };
  if (centsOf(f.price) === null) {
    return { field: "price", key: "field.tk.badPrice" };
  }
  return null;
}

/** REQ-283 — a server refusal of the one-off task that names a field of the form: "workerId required"
 *  is a customer with no staffed zone (a new one), so the office has to pick the worker */
export function addTaskServerProblem(
  error: string | undefined,
): { field: "worker"; key: "field.tk.needWorker" } | null {
  return error === "workerId required"
    ? { field: "worker", key: "field.tk.needWorker" }
    : null;
}
