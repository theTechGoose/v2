/**
 * REQ-921 — services are the only thing a business offers. Every line on a
 * new invoice, an invoice being edited and a repeat visit is a row of
 * "service (picked from the Services catalogue) + price"; "+" adds a row,
 * "−" removes one. Pure helpers here; the islands wire them.
 */

/** a catalogue row as the islands see it (TaskType's shape, trimmed) */
export interface CatalogService {
  id: string;
  name: string;
  archived?: true;
}

/** one row of the service-line editor, as typed */
export interface ServiceRow {
  /** the picked catalogue id; "" = nothing picked yet */
  serviceId: string;
  /** the name the row bills under — the picked service's name, or a line's
   *  existing description (an invoice line saved before REQ-921) */
  name: string;
  /** the price as typed, in dollars */
  price: string;
}

export const emptyServiceRow = (): ServiceRow => ({
  serviceId: "",
  name: "",
  price: "",
});

/** the dropdown's choices: live services, A→Z. `keep` names a service that
 *  must stay listed (the row's own pick, even if archived since). */
export function serviceChoices(
  catalog: readonly CatalogService[],
  keep?: string,
): CatalogService[] {
  return catalog
    .filter((s) => !s.archived || s.id === keep)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** a row after the dropdown picked `serviceId` — the name follows the pick */
export function pickService(
  row: ServiceRow,
  serviceId: string,
  catalog: readonly CatalogService[],
): ServiceRow {
  const s = catalog.find((c) => c.id === serviceId);
  return s
    ? { ...row, serviceId: s.id, name: s.name }
    : { ...row, serviceId: "", name: "" };
}

/** dollars as typed → cents (0 for blank / junk) */
function cents(price: string): number {
  const n = Number(String(price).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** rows → invoice line items: one of each service at its price */
export function serviceRowsToLines(
  rows: readonly ServiceRow[],
): Array<{ description: string; quantity: number; price: number }> {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => ({
      description: r.name.trim(),
      quantity: 1,
      price: cents(r.price),
    }));
}

/** REQ-979 — the Amount box is locked (it shows the lines' subtotal) only
 *  while some row bills a service. An untouched empty row, or a price with no
 *  service picked yet, leaves the one-amount bill editable. Same test as
 *  serviceRowsToLines, so the lock and the totals never disagree. */
export function amountLocked(rows: readonly ServiceRow[]): boolean {
  return rows.some((r) => r.name.trim() !== "");
}

/** REQ-979 — the rows the form checks: a row with neither a service nor a
 *  price is an untouched blank, not a line, and never blocks a save */
export function touchedServiceRows(rows: readonly ServiceRow[]): ServiceRow[] {
  return rows.filter((r) => r.name.trim() || String(r.price).trim());
}

/** REQ-979 — a row carries a price but no service: say so beside the lines
 *  instead of a silent $0.00 subtotal */
export function pricedRowWithoutService(rows: readonly ServiceRow[]): boolean {
  return rows.some((r) => !r.name.trim() && String(r.price).trim() !== "");
}

/** the row-level problem, as an i18n key — null when every row bills */
export function serviceRowsError(
  rows: readonly ServiceRow[],
): "serviceLines.err.pick" | "serviceLines.err.price" | null {
  for (const r of rows) {
    if (!r.name.trim()) return "serviceLines.err.pick";
    if (!(cents(r.price) > 0)) return "serviceLines.err.price";
  }
  return null;
}

/** the invoice's name when the form no longer asks for one: the services
 *  billed, in order, each once ("Lawn mowing, Edging") */
export function jobNameFromServices(rows: readonly ServiceRow[]): string {
  const names: string[] = [];
  for (const r of rows) {
    const n = r.name.trim();
    if (n && !names.includes(n)) names.push(n);
  }
  return names.join(", ");
}
