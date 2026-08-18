/**
 * Seed data ported verbatim from Paperwork Monster Quotes.html.
 * Used as a fallback while the backend's per-quote engagement endpoints
 * (`/quotes` derived `stage`/`opens`/`daysIn`, `/quotes/:id/opens`,
 * `/analytics/quotes/win-rate`, `/analytics/quotes/insight`) come online.
 */
import { tFor } from "./i18n.ts";

export type Stage =
  | "draft"
  | "sent"
  | "opened"
  | "cooling"
  | "stale"
  | "won"
  | "lost";

export interface Quote {
  id: string;
  title: string;
  client: string;
  initials: string;
  /** Real customer link, when the quote was sent to a known customer. Used
   *  to compute the "unique clients" KPI on /quotes — unlinked quotes
   *  ("—") must not collapse into a phantom client (#31). */
  customerId?: string;
  stage: Stage;
  value: number;
  daysIn: number;
  opens: number;
  sentDays: number | null;
  decidedDays?: number;
  band: [string, string];
  shadow: string;
  /** Onboarding sample quote (P-15): rendered as a badged card but
   *  excluded from every money/pipeline aggregate. */
  isSample?: boolean;
}

export const QPIPELINE: Quote[] = [
  // Drafting
  {
    id: "Q-1109",
    title: tFor("en", "quotesSeed.q1109.title"),
    client: tFor("en", "quotesSeed.client.cobblestoneCafe"),
    initials: "CC",
    stage: "draft",
    value: 4250,
    daysIn: 1,
    opens: 0,
    sentDays: null,
    band: ["#9C8074", "#5C4034"],
    shadow: "rgba(92,64,52,0.32)",
  },
  {
    id: "Q-1110",
    title: tFor("en", "quotesSeed.q1110.title"),
    client: tFor("en", "quotesSeed.client.baysideProperties"),
    initials: "BP",
    stage: "draft",
    value: 6800,
    daysIn: 2,
    opens: 0,
    sentDays: null,
    band: ["#9C8074", "#5C4034"],
    shadow: "rgba(92,64,52,0.32)",
  },

  // Out for response — sent
  {
    id: "Q-1107",
    title: tFor("en", "quotesSeed.q1107.title"),
    client: tFor("en", "quotesSeed.client.tomLindaKowalski"),
    initials: "TK",
    stage: "opened",
    value: 3850,
    daysIn: 1,
    opens: 3,
    sentDays: 1,
    band: ["#F7A893", "#E8704F"],
    shadow: "rgba(232,112,79,0.4)",
  },
  {
    id: "Q-1106",
    title: tFor("en", "quotesSeed.q1106.title"),
    client: tFor("en", "quotesSeed.client.greenleafHoa"),
    initials: "GH",
    stage: "opened",
    value: 5800,
    daysIn: 3,
    opens: 2,
    sentDays: 3,
    band: ["#5FA34F", "#3F7A33"],
    shadow: "rgba(81,152,67,0.35)",
  },
  {
    id: "Q-1108",
    title: tFor("en", "quotesSeed.q1108.title"),
    client: tFor("en", "quotesSeed.client.marcusLin"),
    initials: "ML",
    stage: "sent",
    value: 2400,
    daysIn: 0,
    opens: 0,
    sentDays: 0,
    band: ["#FFB3B3", "#FF6B6B"],
    shadow: "rgba(255,107,107,0.35)",
  },
  {
    id: "Q-1104",
    title: tFor("en", "quotesSeed.q1104.title"),
    client: tFor("en", "quotesSeed.client.baysideProperties"),
    initials: "BP",
    stage: "cooling",
    value: 1240,
    daysIn: 4,
    opens: 1,
    sentDays: 4,
    band: ["#B89D90", "#785544"],
    shadow: "rgba(120,85,68,0.35)",
  },
  {
    id: "Q-1103",
    title: tFor("en", "quotesSeed.q1103.title"),
    client: tFor("en", "quotesSeed.client.marshallSons"),
    initials: "MS",
    stage: "opened",
    value: 8200,
    daysIn: 2,
    opens: 2,
    sentDays: 2,
    band: ["#5FA34F", "#3F7A33"],
    shadow: "rgba(81,152,67,0.35)",
  },
  {
    id: "Q-1101",
    title: tFor("en", "quotesSeed.q1101.title"),
    client: tFor("en", "quotesSeed.client.hilltopDiner"),
    initials: "HD",
    stage: "stale",
    value: 1850,
    daysIn: 12,
    opens: 1,
    sentDays: 12,
    band: ["#FF6B6B", "#D63F3F"],
    shadow: "rgba(255,107,107,0.4)",
  },
  {
    id: "Q-1102",
    title: tFor("en", "quotesSeed.q1102.title"),
    client: tFor("en", "quotesSeed.client.riversideYoga"),
    initials: "RY",
    stage: "stale",
    value: 2100,
    daysIn: 9,
    opens: 0,
    sentDays: 9,
    band: ["#FF6B6B", "#D63F3F"],
    shadow: "rgba(255,107,107,0.4)",
  },

  // Decided
  {
    id: "Q-1099",
    title: tFor("en", "quotesSeed.q1099.title"),
    client: tFor("en", "quotesSeed.client.mapleGroveApartments"),
    initials: "MG",
    stage: "won",
    value: 14200,
    daysIn: 0,
    opens: 4,
    sentDays: 6,
    decidedDays: 1,
    band: ["#5FA34F", "#3F7A33"],
    shadow: "rgba(81,152,67,0.35)",
  },
  {
    id: "Q-1098",
    title: tFor("en", "quotesSeed.q1098.title"),
    client: tFor("en", "quotesSeed.client.cobblestoneCafe"),
    initials: "CC",
    stage: "won",
    value: 3400,
    daysIn: 0,
    opens: 5,
    sentDays: 4,
    decidedDays: 2,
    band: ["#5FA34F", "#3F7A33"],
    shadow: "rgba(81,152,67,0.35)",
  },
  {
    id: "Q-1097",
    title: tFor("en", "quotesSeed.q1097.title"),
    client: tFor("en", "quotesSeed.client.sarahChen"),
    initials: "SC",
    stage: "won",
    value: 6800,
    daysIn: 0,
    opens: 3,
    sentDays: 3,
    decidedDays: 5,
    band: ["#5FA34F", "#3F7A33"],
    shadow: "rgba(81,152,67,0.35)",
  },
  {
    id: "Q-1096",
    title: tFor("en", "quotesSeed.q1096.title"),
    client: tFor("en", "quotesSeed.client.janaPatel"),
    initials: "JP",
    stage: "won",
    value: 1650,
    daysIn: 0,
    opens: 2,
    sentDays: 5,
    decidedDays: 7,
    band: ["#5FA34F", "#3F7A33"],
    shadow: "rgba(81,152,67,0.35)",
  },
  {
    id: "Q-1094",
    title: tFor("en", "quotesSeed.q1094.title"),
    client: tFor("en", "quotesSeed.client.ortegaRentals"),
    initials: "OR",
    stage: "lost",
    value: 1900,
    daysIn: 0,
    opens: 2,
    sentDays: 8,
    decidedDays: 4,
    band: ["#B89D90", "#785544"],
    shadow: "rgba(120,85,68,0.35)",
  },
  {
    id: "Q-1093",
    title: tFor("en", "quotesSeed.q1093.title"),
    client: tFor("en", "quotesSeed.client.westgateDental"),
    initials: "WD",
    stage: "lost",
    value: 2750,
    daysIn: 0,
    opens: 1,
    sentDays: 6,
    decidedDays: 9,
    band: ["#B89D90", "#785544"],
    shadow: "rgba(120,85,68,0.35)",
  },
];

export const QSTORIES: Record<string, string> = {
  "Q-1109": tFor("en", "quotesSeed.story.q1109"),
  "Q-1110": tFor("en", "quotesSeed.story.q1110"),
  "Q-1107": tFor("en", "quotesSeed.story.q1107"),
  "Q-1106": tFor("en", "quotesSeed.story.q1106"),
  "Q-1108": tFor("en", "quotesSeed.story.q1108"),
  "Q-1104": tFor("en", "quotesSeed.story.q1104"),
  "Q-1103": tFor("en", "quotesSeed.story.q1103"),
  "Q-1101": tFor("en", "quotesSeed.story.q1101"),
  "Q-1102": tFor("en", "quotesSeed.story.q1102"),
};

export const stageLabel: Record<Stage, string> = {
  draft: tFor("en", "quotesSeed.stage.draft"),
  sent: tFor("en", "quotesSeed.stage.sent"),
  opened: tFor("en", "quotesSeed.stage.opened"),
  cooling: tFor("en", "quotesSeed.stage.cooling"),
  stale: tFor("en", "quotesSeed.stage.stale"),
  won: tFor("en", "quotesSeed.stage.won"),
  lost: tFor("en", "quotesSeed.stage.lost"),
};

/** Localized stage label. The `stageLabel` record above resolves EN at
 *  module load; live components must use this so an ES account never sees
 *  "Drafting" / "Just sent" (P-15). */
export const stageLabelFor = (lang: "en" | "es", stage: Stage): string =>
  tFor(lang, `quotesSeed.stage.${stage}`);

export interface MoodPalette {
  from: string;
  to: string;
  shadow: string;
  statusFg: string;
}

const moods: Record<string, MoodPalette> = {
  draft: {
    from: "#9C8074",
    to: "#5C4034",
    shadow: "rgba(92,64,52,0.32)",
    statusFg: "#5C4034",
  },
  sent: {
    from: "#FFB3B3",
    to: "#FF6B6B",
    shadow: "rgba(255,107,107,0.35)",
    statusFg: "#B23030",
  },
  opened: {
    from: "#5FA34F",
    to: "#3F7A33",
    shadow: "rgba(81,152,67,0.35)",
    statusFg: "#3F7A33",
  },
  cooling: {
    from: "#B89D90",
    to: "#785544",
    shadow: "rgba(120,85,68,0.35)",
    statusFg: "#785544",
  },
  stale: {
    from: "#FF6B6B",
    to: "#D63F3F",
    shadow: "rgba(214,63,63,0.4)",
    statusFg: "#B23030",
  },
  opened_hot: {
    from: "#F7A893",
    to: "#E8704F",
    shadow: "rgba(232,112,79,0.4)",
    statusFg: "#A8431F",
  },
};

export const moodForQuote = (q: Quote): MoodPalette => {
  if (q.stage === "opened" && q.opens >= 3) return moods.opened_hot;
  return moods[q.stage] ?? moods.sent;
};

export interface OpenEvent {
  when: string;
  time: string;
  device: string;
}

export const buildOpens = (q: Quote): OpenEvent[] => {
  if (q.opens === 0) return [];
  const seeds: OpenEvent[] = [
    {
      when: tFor("en", "quotesSeed.when.today"),
      time: "9:42am",
      device: "iPhone",
    },
    {
      when: tFor("en", "quotesSeed.when.today"),
      time: "2:18pm",
      device: "Mac",
    },
    {
      when: tFor("en", "quotesSeed.when.yesterday"),
      time: "4:12pm",
      device: "iPhone",
    },
    {
      when: tFor("en", "quotesSeed.when.tue"),
      time: "11:30am",
      device: "iPhone",
    },
    { when: tFor("en", "quotesSeed.when.mon"), time: "7:54pm", device: "iPad" },
    { when: tFor("en", "quotesSeed.when.sun"), time: "10:08am", device: "Mac" },
    {
      when: tFor("en", "quotesSeed.when.sat"),
      time: "8:21pm",
      device: "iPhone",
    },
  ];
  const offset = q.stage === "cooling"
    ? 2
    : q.stage === "stale"
    ? 4
    : q.stage === "sent"
    ? 0
    : 0;
  return seeds.slice(offset, offset + Math.min(q.opens, 5));
};

export type ReadingChunk = { text: string; em?: string; tail?: string };

export const readingFor = (
  q: Quote,
  opens: OpenEvent[],
  lang: "en" | "es" = "en",
): ReadingChunk => {
  if (q.stage === "draft") {
    return {
      text: tFor(lang, "quotesSeed.reading.draft.text"),
      em: tFor(lang, "quotesSeed.reading.draft.em"),
      tail: tFor(lang, "quotesSeed.reading.draft.tail"),
    };
  }
  if (opens.length === 0) {
    return {
      text: tFor(lang, "quotesSeed.reading.noOpens.text"),
    };
  }
  const devices = new Set(opens.map((o) => o.device));
  if (q.stage === "opened" && q.opens >= 3 && devices.size >= 2) {
    return {
      text: tFor(lang, "quotesSeed.reading.shopping.text"),
      em: tFor(lang, "quotesSeed.reading.shopping.em"),
      tail: tFor(lang, "quotesSeed.reading.shopping.tail"),
    };
  }
  if (q.stage === "opened" && q.opens >= 3) {
    return {
      text: tFor(lang, "quotesSeed.reading.hot.text"),
      em: tFor(lang, "quotesSeed.reading.hot.em"),
      tail: tFor(lang, "quotesSeed.reading.hot.tail"),
    };
  }
  if (q.stage === "opened") {
    return {
      text: tFor(lang, "quotesSeed.reading.peek.text"),
      em: tFor(lang, "quotesSeed.reading.peek.em"),
      tail: tFor(lang, "quotesSeed.reading.peek.tail"),
    };
  }
  if (q.stage === "cooling") {
    return {
      text: tFor(lang, "quotesSeed.reading.cooling.text"),
      em: tFor(lang, "quotesSeed.reading.cooling.em"),
      tail: tFor(lang, "quotesSeed.reading.cooling.tail"),
    };
  }
  if (q.stage === "stale") {
    return {
      text: tFor(lang, "quotesSeed.reading.stale.text"),
      em: tFor(lang, "quotesSeed.reading.stale.em"),
      tail: tFor(lang, "quotesSeed.reading.stale.tail"),
    };
  }
  if (q.stage === "sent") {
    return {
      text: tFor(lang, "quotesSeed.reading.sent.text"),
      em: tFor(lang, "quotesSeed.reading.sent.em"),
      tail: tFor(lang, "quotesSeed.reading.sent.tail"),
    };
  }
  return { text: tFor(lang, "quotesSeed.reading.quiet.text") };
};
