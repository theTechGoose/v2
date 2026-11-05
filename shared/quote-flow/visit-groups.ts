/**
 * REQ-173 — a batch invoice's line items are structured (date / service /
 * address, next to the flat `description` kept for compatibility). Every
 * surface — the public page, the email, the PDF — shows them as the address
 * for a heading with one row per visit (date · service · price). Pure; shared
 * by the front end and the backend.
 */

export interface VisitLine {
  description: string;
  quantity?: number;
  unit?: string;
  price: number;
  /** ISO yyyy-mm-dd */
  date?: string;
  service?: string;
  address?: string;
}

export interface Visit {
  date: string;
  service: string;
  price: number;
}

export interface VisitGroup {
  address: string;
  visits: Visit[];
  subtotal: number;
}

/** The groups, first address first, visits by date then service — or null when
 *  any line is not a visit (an ordinary invoice keeps its ordinary rendering). */
export function groupVisits(
  lines: VisitLine[] | undefined | null,
): VisitGroup[] | null {
  if (!lines?.length) return null;
  if (!lines.every((l) => l.date && l.service && l.address)) return null;
  const byAddress = new Map<string, Visit[]>();
  for (const l of lines) {
    const key = l.address!.trim();
    if (!byAddress.has(key)) byAddress.set(key, []);
    byAddress.get(key)!.push({
      date: l.date!,
      service: l.service!,
      price: (l.price ?? 0) * (l.quantity ?? 1),
    });
  }
  return [...byAddress.entries()].map(([address, visits]) => {
    const sorted = visits.slice().sort((a, b) =>
      a.date.localeCompare(b.date) || a.service.localeCompare(b.service)
    );
    return {
      address,
      visits: sorted,
      subtotal: sorted.reduce((s, v) => s + v.price, 0),
    };
  });
}

/** "Oct 2" / "2 oct" — the visit's date, short, in the bill's language. */
export function fmtVisitDate(iso: string, lang: "en" | "es"): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleDateString(lang === "es" ? "es-ES" : "en-US", {
    month: "short",
    timeZone: "UTC",
  }).replace(".", "");
  return lang === "es"
    ? `${d.getUTCDate()} ${month}`
    : `${month.charAt(0).toUpperCase() + month.slice(1)} ${d.getUTCDate()}`;
}
