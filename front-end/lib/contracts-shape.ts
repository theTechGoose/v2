/**
 * UI shape for the /contracts page.
 *
 * Adapter from the raw backend `Contract` (clients/contracts.ts) +
 * customer-name lookup into the seed-shaped `ContractCard` consumed by the
 * card / track / schedule components. Deterministic — picks mood colours
 * by index and projects dates into the strip's day-of-month coordinate.
 */
import type { Contract, ContractMood } from "../clients/contracts.ts";
import { fmtMoney } from "./format.ts";
import { type Lang, tFor } from "./i18n.ts";

export type ContractStatus =
  | "IN PROGRESS"
  | "TIGHT"
  | "SCHEDULED"
  | "WRAPPING UP"
  | "COMPLETED"
  | "DRAFT"
  | "STALE";

export interface ContractCard {
  id: string;
  client: string;
  initials: string;
  title: string;
  story: string;
  status: ContractStatus;
  mood: ContractMood;
  /** Mood gradient + shadow + status fg, picked from a deterministic palette. */
  moodFrom: string;
  moodTo: string;
  moodShadow: string;
  statusColor: string;
  /** "Day 6 of 14" / "Starts Mon May 5" style human label. */
  when: string;
  pct: number;
  paid: string;
  left: string;
  total: string;
  cta: string;
  /** Destination for the primary CTA button. */
  ctaHref: string;
  /** Numeric day-of-month coordinates used by the schedule strip
   *  (Apr 1 = 1, May 1 = 31, May 31 = 61). */
  scheduleStart: number;
  scheduleEnd: number;
  /** True if the contract hasn't started yet (dashed strip bar). */
  scheduleScheduled: boolean;
  scheduleColor: [string, string];
  /** ISO start/end so the card back can show dates. */
  startDate?: string;
  completionDate?: string;
}

const MOOD_PALETTE: Record<
  ContractMood,
  { from: string; to: string; shadow: string; status: string }
> = {
  "active": {
    from: "#FF6B6B",
    to: "#C84A4A",
    shadow: "rgba(255,107,107,0.45)",
    status: "#C84A4A",
  },
  "wrapping-up": {
    from: "#D9886F",
    to: "#A85A3A",
    shadow: "rgba(217,136,111,0.45)",
    status: "#7A3D24",
  },
  "starting-soon": {
    from: "#9DBDC6",
    to: "#4F7A88",
    shadow: "rgba(157,189,198,0.5)",
    status: "#3A5C68",
  },
  "completed": {
    from: "#5FA34F",
    to: "#3F7A33",
    shadow: "rgba(81,152,67,0.4)",
    status: "#2F5A26",
  },
  "draft": {
    from: "#C8B89A",
    to: "#7E5A3F",
    shadow: "rgba(126,90,63,0.4)",
    status: "#4A2F1E",
  },
  "stale": {
    from: "#B89D90",
    to: "#785544",
    shadow: "rgba(120,85,68,0.4)",
    status: "#5A3C2A",
  },
};

/** Alternate accent variants for "active" so a stack of contracts looks like
 *  the reference (mix of pinks, greens, oranges). Picked deterministically by id. */
const ACTIVE_VARIANTS: Array<
  { from: string; to: string; shadow: string; status: string }
> = [
  {
    from: "#FF6B6B",
    to: "#C84A4A",
    shadow: "rgba(255,107,107,0.45)",
    status: "#C84A4A",
  },
  {
    from: "#5FA34F",
    to: "#335D2A",
    shadow: "rgba(81,152,67,0.45)",
    status: "#335D2A",
  },
  {
    from: "#E6A85C",
    to: "#B97A2E",
    shadow: "rgba(230,168,92,0.45)",
    status: "#8B5A18",
  },
  {
    from: "#9DBDC6",
    to: "#4F7A88",
    shadow: "rgba(157,189,198,0.5)",
    status: "#3A5C68",
  },
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function moodFor(
  mood: ContractMood,
  id: string,
): { from: string; to: string; shadow: string; status: string } {
  if (mood === "active") {
    return ACTIVE_VARIANTS[hashId(id) % ACTIVE_VARIANTS.length];
  }
  return MOOD_PALETTE[mood];
}

const STATUS_LABEL: Record<ContractMood, ContractStatus> = {
  "active": "IN PROGRESS",
  "wrapping-up": "WRAPPING UP",
  "starting-soon": "SCHEDULED",
  "completed": "COMPLETED",
  "draft": "DRAFT",
  "stale": "STALE",
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

interface BuildArgs {
  contract: Contract;
  /** Map of customerId → human name. */
  customerNames: Map<string, string>;
  /** Map of quoteId → quote title/summary, when available. */
  quoteSummaries?: Map<string, string>;
  now: Date;
  index: number;
  /** Contractor language for the human-facing labels (when/cta/story). */
  lang?: Lang;
}

export function toContractCard(
  { contract, customerNames, quoteSummaries, now, lang = "en" }: BuildArgs,
): ContractCard {
  const name =
    (contract.customerId
      ? customerNames.get(contract.customerId)
      : undefined) ?? tFor(lang, "contractsShape.untitledCustomer");
  const summary =
    (contract.quoteId ? quoteSummaries?.get(contract.quoteId) : undefined) ??
      tFor(lang, "contractsShape.signedContract");
  const mood: ContractMood = contract.mood ?? "active";
  const palette = moodFor(mood, contract.id);
  const start = contract.startDate ? new Date(contract.startDate) : undefined;
  const end = contract.estimatedCompletionDate
    ? new Date(contract.estimatedCompletionDate)
    : undefined;

  const totalAmount = typeof contract.totalAmount === "number"
    ? contract.totalAmount
    : 0;

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

  const plural = (key: string, n: number) =>
    tFor(lang, `${key}.${n === 1 ? "one" : "other"}`, { n });

  let when = "—";
  if (mood === "starting-soon" && start) {
    const dd = daysBetween(now, start);
    when = dd <= 0
      ? tFor(lang, "contractsShape.when.startsToday")
      : dd === 1
      ? tFor(lang, "contractsShape.when.startsTomorrow")
      : plural("contractsShape.when.startsInDays", dd);
  } else if (mood === "active" && start && end) {
    const total = Math.max(1, daysBetween(start, end));
    const elapsed = Math.max(0, Math.min(total, daysBetween(start, now)));
    when = tFor(lang, "contractsShape.when.dayOf", {
      day: elapsed + 1,
      total: total + 1,
    });
  } else if (mood === "wrapping-up" && end) {
    const dd = Math.max(0, daysBetween(now, end));
    when = dd === 0
      ? tFor(lang, "contractsShape.when.wrapsToday")
      : dd === 1
      ? tFor(lang, "contractsShape.when.wrapsTomorrow")
      : plural("contractsShape.when.wrapsInDays", dd);
  } else if (mood === "completed") {
    when = tFor(lang, "contractsShape.when.closed");
  } else if (mood === "draft") {
    when = tFor(lang, "contractsShape.when.draft");
  } else if (mood === "stale") {
    when = tFor(lang, "contractsShape.when.staleDraft");
  }

  const cta = mood === "active"
    ? tFor(lang, "contractsShape.cta.sendProgressInvoice")
    : mood === "starting-soon"
    ? tFor(lang, "contractsShape.cta.confirmStartTime")
    : mood === "wrapping-up"
    ? tFor(lang, "contractsShape.cta.draftFinalInvoice")
    : mood === "completed"
    ? tFor(lang, "contractsShape.cta.viewReceipt")
    : mood === "draft"
    ? tFor(lang, "contractsShape.cta.finishAndSend")
    : tFor(lang, "contractsShape.cta.reEngage");

  // Where the primary CTA actually goes (the buttons used to be dead stubs).
  // Invoice-related actions land on /invoices (send the scheduled invoice,
  // view the receipt); contract-shaping actions open the contract itself.
  const ctaHref = mood === "active" || mood === "wrapping-up" ||
      mood === "completed"
    ? "/invoices"
    : `/c/${contract.id}`;

  const story = mood === "active"
    ? tFor(lang, "contractsShape.story.active", { name })
    : mood === "starting-soon"
    ? tFor(lang, "contractsShape.story.startingSoon", { name })
    : mood === "wrapping-up"
    ? tFor(lang, "contractsShape.story.wrappingUp")
    : mood === "completed"
    ? tFor(lang, "contractsShape.story.completed")
    : mood === "stale"
    ? tFor(lang, "contractsShape.story.stale")
    : tFor(lang, "contractsShape.story.draft");

  // Schedule-strip anchor: day 8 = today, days 1..30 = -7 .. +22 days from now.
  const scheduleAnchor = new Date(now.getTime() - 7 * MS_PER_DAY);
  let scheduleStart = stripCoord(start, scheduleAnchor);
  let scheduleEnd = stripCoord(end, scheduleAnchor);
  if (Number.isNaN(scheduleStart) && Number.isNaN(scheduleEnd)) {
    // Best-effort fallback: rough bar around `today` so the contract still appears.
    scheduleStart = 8;
    scheduleEnd = 12;
  } else if (Number.isNaN(scheduleStart)) {
    scheduleStart = Math.max(1, scheduleEnd - 7);
  } else if (Number.isNaN(scheduleEnd)) {
    scheduleEnd = Math.min(33, scheduleStart + 7);
  }

  return {
    id: contract.id,
    client: name,
    initials: initialsFromName(name),
    title: summary,
    story,
    status: STATUS_LABEL[mood],
    mood,
    moodFrom: palette.from,
    moodTo: palette.to,
    moodShadow: palette.shadow,
    statusColor: palette.status,
    when,
    pct,
    paid: fmtMoney(paid),
    left: fmtMoney(left),
    total: fmtMoney(totalAmount),
    cta,
    ctaHref,
    scheduleStart,
    scheduleEnd,
    scheduleScheduled: mood === "starting-soon" || mood === "draft",
    scheduleColor: [palette.from, palette.to],
    startDate: contract.startDate,
    completionDate: contract.estimatedCompletionDate,
  };
}
