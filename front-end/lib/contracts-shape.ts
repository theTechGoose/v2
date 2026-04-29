/**
 * UI shape for the /contracts page.
 *
 * Adapter from the raw backend `Contract` (clients/contracts.ts) +
 * customer-name lookup into the seed-shaped `ContractCard` consumed by the
 * card / track / schedule components. Deterministic — picks mood colours
 * by index and projects dates into the strip's day-of-month coordinate.
 */
import type { Contract, ContractMood } from "../clients/contracts.ts";

export type ContractStatus =
  | "IN PROGRESS"
  | "TIGHT"
  | "SCHEDULED"
  | "WRAPPING UP"
  | "COMPLETED"
  | "DRAFT"
  | "STALE";

export interface ContractCard {
  id:        string;
  client:    string;
  initials:  string;
  title:     string;
  story:     string;
  status:    ContractStatus;
  mood:      ContractMood;
  /** Mood gradient + shadow + status fg, picked from a deterministic palette. */
  moodFrom:  string;
  moodTo:    string;
  moodShadow:string;
  statusColor:string;
  /** "Day 6 of 14" / "Starts Mon May 5" style human label. */
  when:      string;
  pct:       number;
  paid:      string;
  left:      string;
  total:     string;
  cta:       string;
  /** Numeric day-of-month coordinates used by the schedule strip
   *  (Apr 1 = 1, May 1 = 31, May 31 = 61). */
  scheduleStart: number;
  scheduleEnd:   number;
  /** True if the contract hasn't started yet (dashed strip bar). */
  scheduleScheduled: boolean;
  scheduleColor:  [string, string];
  /** ISO start/end so the card back can show dates. */
  startDate?:    string;
  completionDate?: string;
}

const MOOD_PALETTE: Record<ContractMood, { from: string; to: string; shadow: string; status: string }> = {
  "active":         { from: "#FF6B6B", to: "#C84A4A", shadow: "rgba(255,107,107,0.45)", status: "#C84A4A" },
  "wrapping-up":    { from: "#D9886F", to: "#A85A3A", shadow: "rgba(217,136,111,0.45)", status: "#7A3D24" },
  "starting-soon":  { from: "#9DBDC6", to: "#4F7A88", shadow: "rgba(157,189,198,0.5)",  status: "#3A5C68" },
  "completed":      { from: "#5FA34F", to: "#3F7A33", shadow: "rgba(81,152,67,0.4)",    status: "#2F5A26" },
  "draft":          { from: "#C8B89A", to: "#7E5A3F", shadow: "rgba(126,90,63,0.4)",    status: "#4A2F1E" },
  "stale":          { from: "#B89D90", to: "#785544", shadow: "rgba(120,85,68,0.4)",    status: "#5A3C2A" },
};

/** Alternate accent variants for "active" so a stack of contracts looks like
 *  the reference (mix of pinks, greens, oranges). Picked deterministically by id. */
const ACTIVE_VARIANTS: Array<{ from: string; to: string; shadow: string; status: string }> = [
  { from: "#FF6B6B", to: "#C84A4A", shadow: "rgba(255,107,107,0.45)", status: "#C84A4A" },
  { from: "#5FA34F", to: "#335D2A", shadow: "rgba(81,152,67,0.45)",   status: "#335D2A" },
  { from: "#E6A85C", to: "#B97A2E", shadow: "rgba(230,168,92,0.45)",  status: "#8B5A18" },
  { from: "#9DBDC6", to: "#4F7A88", shadow: "rgba(157,189,198,0.5)",  status: "#3A5C68" },
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function moodFor(mood: ContractMood, id: string): { from: string; to: string; shadow: string; status: string } {
  if (mood === "active") return ACTIVE_VARIANTS[hashId(id) % ACTIVE_VARIANTS.length];
  return MOOD_PALETTE[mood];
}

const STATUS_LABEL: Record<ContractMood, ContractStatus> = {
  "active":        "IN PROGRESS",
  "wrapping-up":   "WRAPPING UP",
  "starting-soon": "SCHEDULED",
  "completed":     "COMPLETED",
  "draft":         "DRAFT",
  "stale":         "STALE",
};

export function initialsFromName(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const MS_PER_DAY = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/**
 * Map a date into the schedule strip's day-of-month coordinate.
 * Centred on `now` so the same anchor renders all bars. Coordinate units are
 * "days since `now - 8 days`", i.e. day 8 == today. Returns NaN if no date.
 */
function stripCoord(d: Date | undefined, anchor: Date): number {
  if (!d) return NaN;
  return 8 + daysBetween(anchor, d);
}

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

interface BuildArgs {
  contract: Contract;
  /** Map of customerId → human name. */
  customerNames: Map<string, string>;
  /** Map of quoteId → quote title/summary, when available. */
  quoteSummaries?: Map<string, string>;
  now: Date;
  index: number;
}

export function toContractCard({ contract, customerNames, quoteSummaries, now, index }: BuildArgs): ContractCard {
  const name = (contract.customerId ? customerNames.get(contract.customerId) : undefined) ?? "Untitled customer";
  const summary = (contract.quoteId ? quoteSummaries?.get(contract.quoteId) : undefined) ?? "Signed contract";
  const mood: ContractMood = contract.mood ?? "active";
  const palette = moodFor(mood, contract.id);
  const start = contract.startDate ? new Date(contract.startDate) : undefined;
  const end   = contract.estimatedCompletionDate ? new Date(contract.estimatedCompletionDate) : undefined;

  const totalAmount = typeof contract.totalAmount === "number" ? contract.totalAmount : 0;

  // Progress: linearly interpolate days elapsed of [start..end] when both exist.
  let pct = 0;
  if (mood === "completed") pct = 100;
  else if (start && end) {
    const total = Math.max(1, daysBetween(start, end));
    const elapsed = Math.max(0, Math.min(total, daysBetween(start, now)));
    pct = Math.round((elapsed / total) * 100);
  } else if (mood === "wrapping-up") pct = 90;
  else if (mood === "starting-soon") pct = 0;

  const paid = totalAmount * (pct / 100);
  const left = totalAmount - paid;

  let when = "—";
  if (mood === "starting-soon" && start) {
    const dd = daysBetween(now, start);
    when = dd <= 0 ? "Starts today" : dd === 1 ? "Starts tomorrow" : `Starts in ${dd} days`;
  } else if (mood === "active" && start && end) {
    const total = Math.max(1, daysBetween(start, end));
    const elapsed = Math.max(0, Math.min(total, daysBetween(start, now)));
    when = `Day ${elapsed + 1} of ${total + 1}`;
  } else if (mood === "wrapping-up" && end) {
    const dd = Math.max(0, daysBetween(now, end));
    when = dd === 0 ? "Wraps today" : dd === 1 ? "Wraps tomorrow" : `Wraps in ${dd} days`;
  } else if (mood === "completed") {
    when = "Closed";
  } else if (mood === "draft") {
    when = "Draft";
  } else if (mood === "stale") {
    when = "Stale draft";
  }

  const cta =
    mood === "active"        ? "Send progress invoice" :
    mood === "starting-soon" ? "Confirm start time"     :
    mood === "wrapping-up"   ? "Draft final invoice"   :
    mood === "completed"     ? "View receipt"          :
    mood === "draft"         ? "Finish + send"         :
                               "Re-engage";

  const story =
    mood === "active"        ? `${name} signed and you're on the job. Next milestone keeps the train moving — send a quick update so they know.`
  : mood === "starting-soon" ? `${name} signed — block calendar and confirm the start window. Deposit clears the day work begins.`
  : mood === "wrapping-up"   ? `Final pass and the punch-list. Loop the last invoice with anything still owed so it's one tidy ask.`
  : mood === "completed"     ? `Closed and paid. Receipt sent automatically — kept here for the record.`
  : mood === "stale"         ? `Idle for over a month. A friendly check-in costs nothing and sometimes wins it back.`
                             : `Draft contract — finish terms and send for signature.`;

  // Schedule-strip anchor: day 8 = today, days 1..30 = -7 .. +22 days from now.
  const scheduleAnchor = new Date(now.getTime() - 7 * MS_PER_DAY);
  let scheduleStart = stripCoord(start, scheduleAnchor);
  let scheduleEnd   = stripCoord(end,   scheduleAnchor);
  if (Number.isNaN(scheduleStart) && Number.isNaN(scheduleEnd)) {
    // Best-effort fallback: rough bar around `today` so the contract still appears.
    scheduleStart = 8;
    scheduleEnd   = 12;
  } else if (Number.isNaN(scheduleStart)) {
    scheduleStart = Math.max(1, scheduleEnd - 7);
  } else if (Number.isNaN(scheduleEnd)) {
    scheduleEnd = Math.min(33, scheduleStart + 7);
  }

  return {
    id:           contract.id,
    client:       name,
    initials:     initialsFromName(name),
    title:        summary,
    story,
    status:       STATUS_LABEL[mood],
    mood,
    moodFrom:     palette.from,
    moodTo:       palette.to,
    moodShadow:   palette.shadow,
    statusColor:  palette.status,
    when,
    pct,
    paid:         fmtMoney(paid),
    left:         fmtMoney(left),
    total:        fmtMoney(totalAmount),
    cta,
    scheduleStart,
    scheduleEnd,
    scheduleScheduled: mood === "starting-soon" || mood === "draft",
    scheduleColor: [palette.from, palette.to],
    startDate:      contract.startDate,
    completionDate: contract.estimatedCompletionDate,
  };
}
