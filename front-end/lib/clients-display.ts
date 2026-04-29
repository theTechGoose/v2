/**
 * Pure presentation helpers for /clients. Maps a backend `CustomerCard`
 * (analytics rollup) into the bits the editorial card UI needs:
 * gradient palette, status chip text, story line, CTA verb, etc.
 *
 * No fetching, no fake data — just translation logic the SSR view and the
 * island both share.
 */
import type {
  ClientSegmentKey,
  ClientStatus,
  CustomerCard,
} from "../clients/clients.ts";

export interface MoodPalette {
  from: string;
  to: string;
  shadow: string;
  statusFg: string;
  label: string;
}

export const STATUS_LABELS: Record<ClientStatus, string> = {
  active:  "Active job",
  lead:    "New lead",
  owes:    "Owes you",
  regular: "Regular",
  cold:    "Quiet",
};

export const SEGMENT_LABELS: Record<ClientSegmentKey, string> = {
  property_mgmt: "Property mgmt",
  homeowner:     "Homeowner",
  small_biz:     "Small biz",
  hoa:           "HOA",
  unsorted:      "Unsorted",
};

export function moodFor(c: CustomerCard): MoodPalette {
  if (c.vip)                        return { from: "#1A535C", to: "#0F3A40", shadow: "rgba(26,83,92,0.35)",  statusFg: "#1A535C", label: "On the books" };
  if (c.balanceCents > 0)           return { from: "#FF6B6B", to: "#D63F3F", shadow: "rgba(255,107,107,0.35)", statusFg: "#B23030", label: "Owes you" };
  if (c.status === "active")        return { from: "#5FA34F", to: "#3F7A33", shadow: "rgba(81,152,67,0.35)",  statusFg: "#3F7A33", label: "Active job" };
  if (c.status === "lead")          return { from: "#F7A893", to: "#E8704F", shadow: "rgba(232,112,79,0.35)", statusFg: "#A8431F", label: "New lead" };
  if (c.status === "cold")          return { from: "#9C8074", to: "#5C4034", shadow: "rgba(92,64,52,0.35)",   statusFg: "#5C4034", label: "Quiet" };
  return { from: "#7FA86F", to: "#4A7039", shadow: "rgba(74,112,57,0.32)", statusFg: "#3F7A33", label: "Regular" };
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface SinceBadgeData { tier: "warm" | "steady" | "cool" | "cold"; num: string; unit: string }

export function sinceBadge(days: number): SinceBadgeData {
  const tier =
    days <= 2  ? "warm"   :
    days <= 7  ? "steady" :
    days <= 21 ? "cool"   : "cold";
  if (days < 30) {
    return { tier, num: String(days).padStart(2, "0"), unit: days === 1 ? "day ago" : "days ago" };
  }
  const weeks = Math.max(1, Math.round(days / 7));
  return { tier, num: String(weeks), unit: weeks === 1 ? "week ago" : "weeks ago" };
}

export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export interface BalanceDisplay { cls: string; text: string }

export function balanceDisplay(c: CustomerCard): BalanceDisplay {
  if (c.balanceCents > 0) return { cls: "ccard2__bal-val--owe",  text: `${dollars(c.balanceCents)} due` };
  if (c.balanceCents < 0) return { cls: "ccard2__bal-val--cred", text: `${dollars(-c.balanceCents)} credit` };
  return { cls: "ccard2__bal-val--zero", text: "Settled" };
}

export function segmentLabel(key: CustomerCard["segment"]): string {
  return SEGMENT_LABELS[key ?? "unsorted"];
}

/** Address fallback when the customer record has none. */
export function addressFor(c: CustomerCard): string {
  if (c.address) return c.address;
  if (c.segment === "hoa")           return "Address on file";
  if (c.segment === "property_mgmt") return `${c.name.split(" ")[0]} property — multiple units`;
  if (c.segment === "small_biz")     return `${c.name} — main location`;
  return "Address on file";
}

/** One-line "what's going on" copy for the card body. */
export function storyLineFor(c: CustomerCard): string {
  if (c.notes && c.notes.trim()) return c.notes.trim();
  if (c.balanceCents > 0)        return `${dollars(c.balanceCents)} outstanding · ${c.balanceSub}.`;
  if (c.status === "active")     return `${c.activeJobs} active job${c.activeJobs === 1 ? "" : "s"} · ${c.jobsSub}.`;
  if (c.status === "lead")       return `New lead — last touch ${c.lastWhenRel}.`;
  if (c.status === "cold")       return `Quiet for ${c.daysSinceContact} day${c.daysSinceContact === 1 ? "" : "s"}. Worth a hello.`;
  if (c.status === "regular")    return `Regular client. Last activity ${c.lastWhenRel}.`;
  return `Last activity ${c.lastWhenRel}.`;
}

export function ctaFor(c: CustomerCard): string {
  if (c.balanceCents > 0)     return "Send a kind reminder";
  if (c.status === "active")  return "Send progress update";
  if (c.status === "lead")    return "Follow up";
  if (c.status === "cold")    return "Send a hello";
  return "Open card";
}

/** Editorial number → words for small counts; falls back to digits. */
const NUM_WORDS = [
  "zero", "one", "two", "three", "four", "five",
  "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

export function numberWord(n: number): string {
  if (n >= 0 && n < NUM_WORDS.length) return NUM_WORDS[n];
  return String(n);
}
