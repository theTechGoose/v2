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
  raw: VisitLine[] | undefined | null,
  /** REQ-791: the bill's service period (or any date on it) — the year a
   *  "Oct 2 — Lawn — 845 Frederick Rd" line read back from its text falls in */
  period?: VisitPeriod,
): VisitGroup[] | null {
  if (!raw?.length) return null;
  const lines = raw.map((l) =>
    l.date && l.service && l.address ? l : readVisitLine(l, period)
  );
  if (!lines.every((l) => l && l.date && l.service && l.address)) return null;
  const byAddress = new Map<string, Visit[]>();
  for (const l of lines as VisitLine[]) {
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

/** REQ-791: the dates on a bill that pin the year of a visit read from its text. */
export interface VisitPeriod {
  from?: string;
  to?: string;
}

/** The period of an invoice: its service dates, else the day it was made. */
export function visitPeriodOf(
  inv: {
    serviceDateFrom?: string;
    serviceDateTo?: string;
    createdAt?: string;
  },
): VisitPeriod {
  const from = inv.serviceDateFrom || inv.createdAt?.slice(0, 10);
  const to = inv.serviceDateTo || from;
  return { from, to };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  ene: 1,
  abr: 4,
  ago: 8,
  dic: 12,
  set: 9,
};

/** "Oct 2" / "2 oct" → [month, day] */
function readDay(s: string): [number, number] | null {
  const t = s.trim().toLowerCase().replace(".", "");
  let m = /^([a-z]{3,4}) (\d{1,2})$/.exec(t);
  if (m && MONTHS[m[1]]) return [MONTHS[m[1]], Number(m[2])];
  m = /^(\d{1,2}) ([a-z]{3,4})$/.exec(t);
  if (m && MONTHS[m[2]]) return [MONTHS[m[2]], Number(m[1])];
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * REQ-791 — a batch line's text is "Oct 2 — Lawn — 845 Frederick Rd…"
 * (batch-lines `lineText`; "Nov 16 – Nov 18 — …" for a job of several days).
 * A line saved without its date / service / address is read back from it;
 * anything else is not a visit (null).
 */
export function readVisitLine(
  l: VisitLine,
  period?: VisitPeriod,
): VisitLine | null {
  const parts = (l.description ?? "").split(" — ");
  if (parts.length < 3) return null;
  const [when, service, ...rest] = parts;
  const day = readDay(when.split(" – ")[0]);
  const address = rest.join(" — ").trim();
  if (!day || !service.trim() || !address) return null;
  const [month, d] = day;
  const fromY = Number(period?.from?.slice(0, 4)) ||
    new Date().getUTCFullYear();
  const toY = Number(period?.to?.slice(0, 4)) || fromY;
  const fromM = Number(period?.from?.slice(5, 7)) || 1;
  // a period across new year: a month before the period's first is next year's
  const year = toY > fromY && month < fromM ? toY : fromY;
  return {
    ...l,
    date: `${year}-${pad(month)}-${pad(d)}`,
    service: service.trim(),
    address,
  };
}

/**
 * REQ-791 — editing a draft on /invoices re-saves its lines; a line whose
 * text did not change is still that visit, so it keeps its date / service /
 * address (a rewritten or new line keeps none).
 */
export function keepVisitFields<T extends { description?: string }>(
  before: VisitLine[] | undefined | null,
  after: T[],
): (T & Partial<Pick<VisitLine, "date" | "service" | "address">>)[] {
  return after.map((l, i) => {
    const was = before?.[i];
    if (
      !was || !was.date || !was.service || !was.address ||
      (was.description ?? "").trim() !== (l.description ?? "").trim()
    ) return l;
    return { ...l, date: was.date, service: was.service, address: was.address };
  });
}
