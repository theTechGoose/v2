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
import { type Lang, tFor } from "./i18n.ts";
import { hasAddress } from "../../shared/quote-flow/format-helpers.ts";

export interface MoodPalette {
  from: string;
  to: string;
  shadow: string;
  statusFg: string;
  label: string;
}

const STATUS_LABEL_KEYS: Record<ClientStatus, string> = {
  active: "clientsDisplay.status.active",
  lead: "clientsDisplay.status.lead",
  owes: "clientsDisplay.status.owes",
  regular: "clientsDisplay.status.regular",
  cold: "clientsDisplay.status.cold",
};

const SEGMENT_LABEL_KEYS: Record<ClientSegmentKey, string> = {
  property_mgmt: "clientsDisplay.segment.propertyMgmt",
  homeowner: "clientsDisplay.segment.homeowner",
  small_biz: "clientsDisplay.segment.smallBiz",
  hoa: "clientsDisplay.segment.hoa",
  unsorted: "clientsDisplay.segment.unsorted",
};

export function statusLabel(status: ClientStatus, lang: Lang = "en"): string {
  return tFor(lang, STATUS_LABEL_KEYS[status]);
}

export function moodFor(c: CustomerCard, lang: Lang = "en"): MoodPalette {
  if (c.vip) {
    return {
      from: "#1A535C",
      to: "#0F3A40",
      shadow: "rgba(26,83,92,0.35)",
      statusFg: "#1A535C",
      label: tFor(lang, "clientsDisplay.mood.onTheBooks"),
    };
  }
  if (c.balanceCents > 0) {
    return {
      from: "#FF6B6B",
      to: "#D63F3F",
      shadow: "rgba(255,107,107,0.35)",
      statusFg: "#B23030",
      label: tFor(lang, "clientsDisplay.status.owes"),
    };
  }
  if (c.status === "active") {
    return {
      from: "#5FA34F",
      to: "#3F7A33",
      shadow: "rgba(81,152,67,0.35)",
      statusFg: "#3F7A33",
      label: tFor(lang, "clientsDisplay.status.active"),
    };
  }
  if (c.status === "lead") {
    return {
      from: "#F7A893",
      to: "#E8704F",
      shadow: "rgba(232,112,79,0.35)",
      statusFg: "#A8431F",
      label: tFor(lang, "clientsDisplay.status.lead"),
    };
  }
  if (c.status === "cold") {
    return {
      from: "#9C8074",
      to: "#5C4034",
      shadow: "rgba(92,64,52,0.35)",
      statusFg: "#5C4034",
      label: tFor(lang, "clientsDisplay.status.cold"),
    };
  }
  return {
    from: "#7FA86F",
    to: "#4A7039",
    shadow: "rgba(74,112,57,0.32)",
    statusFg: "#3F7A33",
    label: tFor(lang, "clientsDisplay.status.regular"),
  };
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface SinceBadgeData {
  tier: "warm" | "steady" | "cool" | "cold";
  num: string;
  unit: string;
}

export function sinceBadge(days: number, lang: Lang = "en"): SinceBadgeData {
  const tier = days <= 2
    ? "warm"
    : days <= 7
    ? "steady"
    : days <= 21
    ? "cool"
    : "cold";
  // Contacted today: the watermark reads "0 / TODAY". Zero-padding it would
  // print the nonsense "00 días atrás" (P-34), so the pad starts at day 1.
  if (days <= 0) {
    return { tier, num: "0", unit: tFor(lang, "clientsDisplay.since.today") };
  }
  if (days < 30) {
    return {
      tier,
      num: String(days).padStart(2, "0"),
      unit: tFor(
        lang,
        days === 1 ? "clientsDisplay.since.day.one" : "clientsDisplay.since.day.other",
      ),
    };
  }
  const weeks = Math.max(1, Math.round(days / 7));
  return {
    tier,
    num: String(weeks),
    unit: tFor(
      lang,
      weeks === 1 ? "clientsDisplay.since.week.one" : "clientsDisplay.since.week.other",
    ),
  };
}

export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${
    (abs / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })
  }`;
}

export interface BalanceDisplay {
  cls: string;
  text: string;
}

export function balanceDisplay(
  c: CustomerCard,
  lang: Lang = "en",
): BalanceDisplay {
  if (c.balanceCents > 0) {
    return {
      cls: "ccard2__bal-val--owe",
      text: tFor(lang, "clientsDisplay.balance.due", {
        amount: dollars(c.balanceCents),
      }),
    };
  }
  if (c.balanceCents < 0) {
    return {
      cls: "ccard2__bal-val--cred",
      text: tFor(lang, "clientsDisplay.balance.credit", {
        amount: dollars(-c.balanceCents),
      }),
    };
  }
  return {
    cls: "ccard2__bal-val--zero",
    text: tFor(lang, "clientsDisplay.balance.settled"),
  };
}

export function segmentLabel(
  key: CustomerCard["segment"],
  lang: Lang = "en",
): string {
  return tFor(lang, SEGMENT_LABEL_KEYS[key ?? "unsorted"]);
}

/**
 * The customer's address, or an honest "none on file" line.
 *
 * P-64: every branch here used to invent a location for a customer whose
 * record carries no address at all — "Address on file" is a claim, and
 * "{name} — main location" reads like a real one. The claim is now gated
 * behind `hasAddress`, so an address-less client says so.
 */
export function addressFor(c: CustomerCard, lang: Lang = "en"): string {
  if (hasAddress(c)) return c.address as string;
  return tFor(lang, "clientsDisplay.address.none");
}

/** One-line "what's going on" copy for the card body. */
export function storyLineFor(c: CustomerCard, lang: Lang = "en"): string {
  if (c.notes && c.notes.trim()) return c.notes.trim();
  if (c.balanceCents > 0) {
    return tFor(lang, "clientsDisplay.story.balance", {
      amount: dollars(c.balanceCents),
      sub: c.balanceSub,
    });
  }
  if (c.status === "active") {
    return tFor(
      lang,
      c.activeJobs === 1
        ? "clientsDisplay.story.active.one"
        : "clientsDisplay.story.active.other",
      { n: c.activeJobs, sub: c.jobsSub },
    );
  }
  if (c.status === "lead") {
    return tFor(lang, "clientsDisplay.story.lead", { when: c.lastWhenRel });
  }
  if (c.status === "cold") {
    return tFor(
      lang,
      c.daysSinceContact === 1
        ? "clientsDisplay.story.cold.one"
        : "clientsDisplay.story.cold.other",
      { n: c.daysSinceContact },
    );
  }
  if (c.status === "regular") {
    return tFor(lang, "clientsDisplay.story.regular", { when: c.lastWhenRel });
  }
  return tFor(lang, "clientsDisplay.story.default", { when: c.lastWhenRel });
}

export function ctaFor(c: CustomerCard, lang: Lang = "en"): string {
  if (c.balanceCents > 0) return tFor(lang, "clientsDisplay.cta.reminder");
  if (c.status === "active") return tFor(lang, "clientsDisplay.cta.progress");
  if (c.status === "lead") return tFor(lang, "clientsDisplay.cta.followUp");
  if (c.status === "cold") return tFor(lang, "clientsDisplay.cta.hello");
  return tFor(lang, "clientsDisplay.cta.openCard");
}

/** Editorial number → words for small counts; falls back to digits. */
const NUM_WORD_KEYS = [
  "clientsDisplay.num.zero",
  "clientsDisplay.num.one",
  "clientsDisplay.num.two",
  "clientsDisplay.num.three",
  "clientsDisplay.num.four",
  "clientsDisplay.num.five",
  "clientsDisplay.num.six",
  "clientsDisplay.num.seven",
  "clientsDisplay.num.eight",
  "clientsDisplay.num.nine",
  "clientsDisplay.num.ten",
  "clientsDisplay.num.eleven",
  "clientsDisplay.num.twelve",
  "clientsDisplay.num.thirteen",
  "clientsDisplay.num.fourteen",
  "clientsDisplay.num.fifteen",
  "clientsDisplay.num.sixteen",
  "clientsDisplay.num.seventeen",
  "clientsDisplay.num.eighteen",
  "clientsDisplay.num.nineteen",
  "clientsDisplay.num.twenty",
];

export function numberWord(n: number, lang: Lang = "en"): string {
  if (n >= 0 && n < NUM_WORD_KEYS.length) return tFor(lang, NUM_WORD_KEYS[n]);
  return String(n);
}
