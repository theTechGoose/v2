/**
 * Seed data ported verbatim from Paperwork Monster Clients.html.
 * Used as a fallback while the backend's per-client roll-up endpoints
 * (`/clients` derived fields, `/analytics/clients/top`,
 * `/analytics/clients/segments`) come online.
 */

import { tFor } from "./i18n.ts";

export type ClientStatus = "active" | "lead" | "owes" | "regular" | "cold";
export type LastTone = "hot" | "warm" | "cold";
export type Segment = "HOA" | "Property mgmt" | "Small biz" | "Homeowner";

export interface Client {
  name: string;
  initials: string;
  segment: Segment;
  band: [string, string];
  shadow: string;
  contact: string;
  phone: string;
  last: string;
  lastWhen: string;
  lastTone: LastTone;
  balance: number;
  balanceSub: string;
  jobs: string;
  jobsSub: string;
  status: ClientStatus;
  temp: number;
  vip: boolean;
  /** Optional override; otherwise derived from segment in ClientCard. */
  address?: string;
}

export const CLIENTS: Client[] = [
  {
    name: "Greenleaf HOA",
    initials: "GH",
    segment: "HOA",
    band: ["#5FA34F", "#335D2A"],
    shadow: "rgba(81,152,67,0.5)",
    contact: "board@greenleaf-hoa.org",
    phone: "(415) 555-0145",
    last: tFor("en", "clientsSeed.greenleafHoa.last"),
    lastWhen: tFor("en", "clientsSeed.greenleafHoa.lastWhen"),
    lastTone: "warm",
    balance: 0,
    balanceSub: tFor("en", "clientsSeed.greenleafHoa.balanceSub"),
    jobs: "—",
    jobsSub: tFor("en", "clientsSeed.greenleafHoa.jobsSub"),
    status: "regular",
    temp: 78,
    vip: true,
  },
  {
    name: "Maple Grove Apartments",
    initials: "MG",
    segment: "Property mgmt",
    band: ["#5FA34F", "#427A37"],
    shadow: "rgba(81,152,67,0.45)",
    contact: "janet@maplegrove.co",
    phone: "(415) 555-0124",
    last: tFor("en", "clientsSeed.mapleGrove.last"),
    lastWhen: tFor("en", "clientsSeed.mapleGrove.lastWhen"),
    lastTone: "hot",
    balance: 4200,
    balanceSub: tFor("en", "clientsSeed.mapleGrove.balanceSub"),
    jobs: "2",
    jobsSub: tFor("en", "clientsSeed.mapleGrove.jobsSub"),
    status: "active",
    temp: 92,
    vip: true,
  },
  {
    name: "Cobblestone Cafe",
    initials: "CC",
    segment: "Small biz",
    band: ["#7BB568", "#519843"],
    shadow: "rgba(81,152,67,0.4)",
    contact: "hello@cobblestone.cafe",
    phone: "(415) 555-0117",
    last: tFor("en", "clientsSeed.cobblestone.last"),
    lastWhen: tFor("en", "clientsSeed.cobblestone.lastWhen"),
    lastTone: "hot",
    balance: 0,
    balanceSub: tFor("en", "clientsSeed.cobblestone.balanceSub"),
    jobs: "1",
    jobsSub: tFor("en", "clientsSeed.cobblestone.jobsSub"),
    status: "regular",
    temp: 71,
    vip: false,
  },
  {
    name: "Marshall & Sons",
    initials: "MS",
    segment: "Property mgmt",
    band: ["#785544", "#4F362A"],
    shadow: "rgba(100,69,54,0.4)",
    contact: "mike@marshall-sons.com",
    phone: "(415) 555-0166",
    last: tFor("en", "clientsSeed.marshallSons.last"),
    lastWhen: tFor("en", "clientsSeed.marshallSons.lastWhen"),
    lastTone: "warm",
    balance: -500,
    balanceSub: tFor("en", "clientsSeed.marshallSons.balanceSub"),
    jobs: "1",
    jobsSub: tFor("en", "clientsSeed.marshallSons.jobsSub"),
    status: "active",
    temp: 64,
    vip: false,
  },
  {
    name: "Sarah Chen",
    initials: "SC",
    segment: "Homeowner",
    band: ["#FF8D8D", "#E03131"],
    shadow: "rgba(224,49,49,0.4)",
    contact: "sarah.chen@gmail.com",
    phone: "(415) 555-0188",
    last: tFor("en", "clientsSeed.sarahChen.last"),
    lastWhen: tFor("en", "clientsSeed.sarahChen.lastWhen"),
    lastTone: "hot",
    balance: 1920,
    balanceSub: tFor("en", "clientsSeed.sarahChen.balanceSub"),
    jobs: "1",
    jobsSub: tFor("en", "clientsSeed.sarahChen.jobsSub"),
    status: "owes",
    temp: 58,
    vip: false,
  },
  {
    name: "Hilltop Diner",
    initials: "HD",
    segment: "Small biz",
    band: ["#94715F", "#4F362A"],
    shadow: "rgba(100,69,54,0.4)",
    contact: "manager@hilltopdiner.com",
    phone: "(415) 555-0102",
    last: tFor("en", "clientsSeed.hilltopDiner.last"),
    lastWhen: tFor("en", "clientsSeed.hilltopDiner.lastWhen"),
    lastTone: "cold",
    balance: 1160,
    balanceSub: tFor("en", "clientsSeed.hilltopDiner.balanceSub"),
    jobs: "—",
    jobsSub: tFor("en", "clientsSeed.hilltopDiner.jobsSub"),
    status: "owes",
    temp: 22,
    vip: false,
  },
  {
    name: "Tom & Linda Kowalski",
    initials: "TK",
    segment: "Homeowner",
    band: ["#B89D90", "#785544"],
    shadow: "rgba(120,85,68,0.4)",
    contact: "linda.k@outlook.com",
    phone: "(415) 555-0193",
    last: tFor("en", "clientsSeed.kowalski.last"),
    lastWhen: tFor("en", "clientsSeed.kowalski.lastWhen"),
    lastTone: "hot",
    balance: 0,
    balanceSub: tFor("en", "clientsSeed.kowalski.balanceSub"),
    jobs: "—",
    jobsSub: tFor("en", "clientsSeed.kowalski.jobsSub"),
    status: "lead",
    temp: 86,
    vip: false,
  },
  {
    name: "Jana Patel",
    initials: "JP",
    segment: "Homeowner",
    band: ["#FF8D8D", "#FA5252"],
    shadow: "rgba(255,107,107,0.4)",
    contact: "jana.patel@hey.com",
    phone: "(415) 555-0142",
    last: tFor("en", "clientsSeed.janaPatel.last"),
    lastWhen: tFor("en", "clientsSeed.janaPatel.lastWhen"),
    lastTone: "warm",
    balance: -825,
    balanceSub: tFor("en", "clientsSeed.janaPatel.balanceSub"),
    jobs: "1",
    jobsSub: tFor("en", "clientsSeed.janaPatel.jobsSub"),
    status: "active",
    temp: 68,
    vip: false,
  },
  {
    name: "Marcus Lin",
    initials: "ML",
    segment: "Homeowner",
    band: ["#FFB3B3", "#FF6B6B"],
    shadow: "rgba(255,107,107,0.4)",
    contact: "marcus.lin@gmail.com",
    phone: "(415) 555-0151",
    last: tFor("en", "clientsSeed.marcusLin.last"),
    lastWhen: tFor("en", "clientsSeed.marcusLin.lastWhen"),
    lastTone: "warm",
    balance: 0,
    balanceSub: tFor("en", "clientsSeed.marcusLin.balanceSub"),
    jobs: "—",
    jobsSub: tFor("en", "clientsSeed.marcusLin.jobsSub"),
    status: "lead",
    temp: 52,
    vip: false,
  },
  {
    name: "Bayside Properties",
    initials: "BP",
    segment: "Property mgmt",
    band: ["#5FA34F", "#427A37"],
    shadow: "rgba(81,152,67,0.4)",
    contact: "ops@bayside-pm.com",
    phone: "(415) 555-0179",
    last: tFor("en", "clientsSeed.bayside.last"),
    lastWhen: tFor("en", "clientsSeed.bayside.lastWhen"),
    lastTone: "cold",
    balance: 0,
    balanceSub: tFor("en", "clientsSeed.bayside.balanceSub"),
    jobs: "—",
    jobsSub: tFor("en", "clientsSeed.bayside.jobsSub"),
    status: "cold",
    temp: 28,
    vip: false,
  },
  {
    name: "Riverside Yoga",
    initials: "RY",
    segment: "Small biz",
    band: ["#FFB3B3", "#FA5252"],
    shadow: "rgba(255,107,107,0.35)",
    contact: "studio@riversideyoga.com",
    phone: "(415) 555-0188",
    last: tFor("en", "clientsSeed.riversideYoga.last"),
    lastWhen: tFor("en", "clientsSeed.riversideYoga.lastWhen"),
    lastTone: "cold",
    balance: 0,
    balanceSub: tFor("en", "clientsSeed.riversideYoga.balanceSub"),
    jobs: "—",
    jobsSub: tFor("en", "clientsSeed.riversideYoga.jobsSub"),
    status: "cold",
    temp: 24,
    vip: false,
  },
  {
    name: "Ortega Rentals",
    initials: "OR",
    segment: "Property mgmt",
    band: ["#B89D90", "#644536"],
    shadow: "rgba(100,69,54,0.4)",
    contact: "mateo@ortegarentals.com",
    phone: "(415) 555-0163",
    last: tFor("en", "clientsSeed.ortega.last"),
    lastWhen: tFor("en", "clientsSeed.ortega.lastWhen"),
    lastTone: "cold",
    balance: 0,
    balanceSub: tFor("en", "clientsSeed.ortega.balanceSub"),
    jobs: "—",
    jobsSub: tFor("en", "clientsSeed.ortega.jobsSub"),
    status: "cold",
    temp: 18,
    vip: false,
  },
];

export const STATUS_LABELS: Record<ClientStatus, string> = {
  active: tFor("en", "clientsSeed.statusLabel.active"),
  lead: tFor("en", "clientsSeed.statusLabel.lead"),
  owes: tFor("en", "clientsSeed.statusLabel.owes"),
  regular: tFor("en", "clientsSeed.statusLabel.regular"),
  cold: tFor("en", "clientsSeed.statusLabel.cold"),
};

export interface Story {
  line: string;
  cta: string;
}

export const STORIES: Record<string, Story> = {
  "Greenleaf HOA": {
    line: tFor("en", "clientsSeed.greenleafHoa.story.line"),
    cta: tFor("en", "clientsSeed.greenleafHoa.story.cta"),
  },
  "Maple Grove Apartments": {
    line: tFor("en", "clientsSeed.mapleGrove.story.line"),
    cta: tFor("en", "clientsSeed.mapleGrove.story.cta"),
  },
  "Cobblestone Cafe": {
    line: tFor("en", "clientsSeed.cobblestone.story.line"),
    cta: tFor("en", "clientsSeed.cobblestone.story.cta"),
  },
  "Marshall & Sons": {
    line: tFor("en", "clientsSeed.marshallSons.story.line"),
    cta: tFor("en", "clientsSeed.marshallSons.story.cta"),
  },
  "Sarah Chen": {
    line: tFor("en", "clientsSeed.sarahChen.story.line"),
    cta: tFor("en", "clientsSeed.sarahChen.story.cta"),
  },
  "Hilltop Diner": {
    line: tFor("en", "clientsSeed.hilltopDiner.story.line"),
    cta: tFor("en", "clientsSeed.hilltopDiner.story.cta"),
  },
  "Tom & Linda Kowalski": {
    line: tFor("en", "clientsSeed.kowalski.story.line"),
    cta: tFor("en", "clientsSeed.kowalski.story.cta"),
  },
  "Jana Patel": {
    line: tFor("en", "clientsSeed.janaPatel.story.line"),
    cta: tFor("en", "clientsSeed.janaPatel.story.cta"),
  },
  "Marcus Lin": {
    line: tFor("en", "clientsSeed.marcusLin.story.line"),
    cta: tFor("en", "clientsSeed.marcusLin.story.cta"),
  },
  "Bayside Properties": {
    line: tFor("en", "clientsSeed.bayside.story.line"),
    cta: tFor("en", "clientsSeed.bayside.story.cta"),
  },
  "Riverside Yoga": {
    line: tFor("en", "clientsSeed.riversideYoga.story.line"),
    cta: tFor("en", "clientsSeed.riversideYoga.story.cta"),
  },
  "Ortega Rentals": {
    line: tFor("en", "clientsSeed.ortega.story.line"),
    cta: tFor("en", "clientsSeed.ortega.story.cta"),
  },
};

export const SINCE_DAYS: Record<string, number> = {
  "Greenleaf HOA": 2,
  "Maple Grove Apartments": 0,
  "Cobblestone Cafe": 1,
  "Marshall & Sons": 4,
  "Sarah Chen": 3,
  "Hilltop Diner": 11,
  "Tom & Linda Kowalski": 0,
  "Jana Patel": 5,
  "Marcus Lin": 1,
  "Bayside Properties": 4,
  "Riverside Yoga": 42,
  "Ortega Rentals": 61,
};

export const daysSinceContact = (c: Client): number => SINCE_DAYS[c.name] ?? 7;

export interface FilterEntry {
  id: ClientStatus | "all";
  label: string;
  count: number;
}

export const FILTERS: FilterEntry[] = [
  { id: "all", label: tFor("en", "clientsSeed.filter.all"), count: CLIENTS.length },
  {
    id: "active",
    label: tFor("en", "clientsSeed.filter.activeJobs"),
    count: CLIENTS.filter((c) => c.status === "active").length,
  },
  {
    id: "lead",
    label: tFor("en", "clientsSeed.filter.leads"),
    count: CLIENTS.filter((c) => c.status === "lead").length,
  },
  {
    id: "owes",
    label: tFor("en", "clientsSeed.filter.oweYou"),
    count: CLIENTS.filter((c) => c.status === "owes").length,
  },
  {
    id: "regular",
    label: tFor("en", "clientsSeed.filter.regulars"),
    count: CLIENTS.filter((c) => c.status === "regular").length,
  },
  {
    id: "cold",
    label: tFor("en", "clientsSeed.filter.quiet"),
    count: CLIENTS.filter((c) => c.status === "cold").length,
  },
];

export interface TopClient {
  name: string;
  amt: string;
  pct: number;
}

export const TOP_CLIENTS: TopClient[] = [
  { name: "Greenleaf HOA", amt: "$32,400", pct: 100 },
  { name: "Maple Grove Apartments", amt: "$24,800", pct: 76 },
  { name: "Ortega Rentals", amt: "$18,720", pct: 58 },
  { name: "Cobblestone Cafe", amt: "$15,920", pct: 49 },
  { name: "Marshall & Sons", amt: "$11,450", pct: 35 },
];

export interface SegmentRow {
  lbl: string;
  pct: number;
  num: number;
  color: string;
}

export const SEGMENTS: SegmentRow[] = [
  { lbl: tFor("en", "clientsSeed.segment.propertyMgmt"), pct: 80, num: 4, color: "var(--brand-green)" },
  { lbl: tFor("en", "clientsSeed.segment.homeowners"), pct: 60, num: 5, color: "var(--brand-pink)" },
  { lbl: tFor("en", "clientsSeed.segment.smallBiz"), pct: 40, num: 2, color: "var(--brand-teal)" },
  { lbl: tFor("en", "clientsSeed.segment.hoas"), pct: 18, num: 1, color: "var(--coffee-500)" },
];

export interface MoodPalette {
  from: string;
  to: string;
  shadow: string;
  statusFg: string;
  label: string;
}

export const moodFor = (c: Client): MoodPalette => {
  if (c.vip) {
    return {
      from: "#1A535C",
      to: "#0F3A40",
      shadow: "rgba(26,83,92,0.35)",
      statusFg: "#1A535C",
      label: tFor("en", "clientsSeed.mood.onTheBooks"),
    };
  }
  if (c.balance > 0) {
    return {
      from: "#FF6B6B",
      to: "#D63F3F",
      shadow: "rgba(255,107,107,0.35)",
      statusFg: "#B23030",
      label: tFor("en", "clientsSeed.mood.owesYou"),
    };
  }
  if (c.status === "active") {
    return {
      from: "#5FA34F",
      to: "#3F7A33",
      shadow: "rgba(81,152,67,0.35)",
      statusFg: "#3F7A33",
      label: tFor("en", "clientsSeed.mood.activeJob"),
    };
  }
  if (c.status === "lead") {
    return {
      from: "#F7A893",
      to: "#E8704F",
      shadow: "rgba(232,112,79,0.35)",
      statusFg: "#A8431F",
      label: tFor("en", "clientsSeed.mood.newLead"),
    };
  }
  if (c.status === "cold") {
    return {
      from: "#9C8074",
      to: "#5C4034",
      shadow: "rgba(92,64,52,0.35)",
      statusFg: "#5C4034",
      label: tFor("en", "clientsSeed.mood.quiet"),
    };
  }
  return {
    from: "#7FA86F",
    to: "#4A7039",
    shadow: "rgba(74,112,57,0.32)",
    statusFg: "#3F7A33",
    label: tFor("en", "clientsSeed.mood.regular"),
  };
};
