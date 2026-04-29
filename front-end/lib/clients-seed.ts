/**
 * Seed data ported verbatim from Paperwork Monsters Clients.html.
 * Used as a fallback while the backend's per-client roll-up endpoints
 * (`/clients` derived fields, `/analytics/clients/top`,
 * `/analytics/clients/segments`) come online.
 */

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
  { name: "Greenleaf HOA",          initials: "GH", segment: "HOA",           band: ["#5FA34F", "#335D2A"], shadow: "rgba(81,152,67,0.5)",  contact: "board@greenleaf-hoa.org",  phone: "(415) 555-0145", last: "Common area paint",     lastWhen: "quote viewed Tue",     lastTone: "warm", balance: 0,    balanceSub: "settled · quote out $5,800",   jobs: "—", jobsSub: "quote out · $5,800", status: "regular", temp: 78, vip: true },
  { name: "Maple Grove Apartments", initials: "MG", segment: "Property mgmt", band: ["#5FA34F", "#427A37"], shadow: "rgba(81,152,67,0.45)", contact: "janet@maplegrove.co",      phone: "(415) 555-0124", last: "Re-roof — building C",  lastWhen: "in progress · today",  lastTone: "hot",  balance: 4200, balanceSub: "progress invoice · due May 5", jobs: "2", jobsSub: "active",              status: "active",  temp: 92, vip: true },
  { name: "Cobblestone Cafe",       initials: "CC", segment: "Small biz",     band: ["#7BB568", "#519843"], shadow: "rgba(81,152,67,0.4)",  contact: "hello@cobblestone.cafe",   phone: "(415) 555-0117", last: "Patio re-tile",         lastWhen: "on track · Apr 30",    lastTone: "hot",  balance: 0,    balanceSub: "settled · deposit on file",     jobs: "1", jobsSub: "active",              status: "regular", temp: 71, vip: false },
  { name: "Marshall & Sons",        initials: "MS", segment: "Property mgmt", band: ["#785544", "#4F362A"], shadow: "rgba(100,69,54,0.4)",  contact: "mike@marshall-sons.com",   phone: "(415) 555-0166", last: "Driveway repour",       lastWhen: "awaiting permit",       lastTone: "warm", balance: -500, balanceSub: "$500 deposit on file",         jobs: "1", jobsSub: "active",              status: "active",  temp: 64, vip: false },
  { name: "Sarah Chen",             initials: "SC", segment: "Homeowner",     band: ["#FF8D8D", "#E03131"], shadow: "rgba(224,49,49,0.4)",  contact: "sarah.chen@gmail.com",     phone: "(415) 555-0188", last: "Bathroom remodel",      lastWhen: "in progress · Wed",    lastTone: "hot",  balance: 1920, balanceSub: "INV-208 · due in 3 days",       jobs: "1", jobsSub: "active",              status: "owes",    temp: 58, vip: false },
  { name: "Hilltop Diner",          initials: "HD", segment: "Small biz",     band: ["#94715F", "#4F362A"], shadow: "rgba(100,69,54,0.4)",  contact: "manager@hilltopdiner.com", phone: "(415) 555-0102", last: "Bar refinish · INV-204",lastWhen: "invoice 11 days late",  lastTone: "cold", balance: 1160, balanceSub: "INV-204 · 11 days late",         jobs: "—", jobsSub: "overdue",             status: "owes",    temp: 22, vip: false },
  { name: "Tom & Linda Kowalski",   initials: "TK", segment: "Homeowner",     band: ["#B89D90", "#785544"], shadow: "rgba(120,85,68,0.4)",  contact: "linda.k@outlook.com",      phone: "(415) 555-0193", last: "Garage epoxy floor",    lastWhen: "quote opened 2× today", lastTone: "hot",  balance: 0,    balanceSub: "no invoices yet",               jobs: "—", jobsSub: "no active jobs",      status: "lead",    temp: 86, vip: false },
  { name: "Jana Patel",             initials: "JP", segment: "Homeowner",     band: ["#FF8D8D", "#FA5252"], shadow: "rgba(255,107,107,0.4)",contact: "jana.patel@hey.com",       phone: "(415) 555-0142", last: "Interior paint · 2BR",  lastWhen: "scheduled Mon Apr 29",  lastTone: "warm", balance: -825, balanceSub: "50% deposit on file",          jobs: "1", jobsSub: "scheduled",           status: "active",  temp: 68, vip: false },
  { name: "Marcus Lin",             initials: "ML", segment: "Homeowner",     band: ["#FFB3B3", "#FF6B6B"], shadow: "rgba(255,107,107,0.4)",contact: "marcus.lin@gmail.com",     phone: "(415) 555-0151", last: "Kitchen backsplash",    lastWhen: "quote sent today",      lastTone: "warm", balance: 0,    balanceSub: "no invoices yet",               jobs: "—", jobsSub: "awaiting reply",      status: "lead",    temp: 52, vip: false },
  { name: "Bayside Properties",     initials: "BP", segment: "Property mgmt", band: ["#5FA34F", "#427A37"], shadow: "rgba(81,152,67,0.4)",  contact: "ops@bayside-pm.com",       phone: "(415) 555-0179", last: "4-unit gutter cleaning",lastWhen: "quote sent 4 days ago", lastTone: "cold", balance: 0,    balanceSub: "settled · quote out $1,240",    jobs: "—", jobsSub: "cooling off",          status: "cold",    temp: 28, vip: false },
  { name: "Riverside Yoga",         initials: "RY", segment: "Small biz",     band: ["#FFB3B3", "#FA5252"], shadow: "rgba(255,107,107,0.35)",contact: "studio@riversideyoga.com",phone: "(415) 555-0188", last: "Studio floor seal",     lastWhen: "completed Mar 14",      lastTone: "cold", balance: 0,    balanceSub: "paid in full · Mar 16",          jobs: "—", jobsSub: "last job 6 wks ago",  status: "cold",    temp: 24, vip: false },
  { name: "Ortega Rentals",         initials: "OR", segment: "Property mgmt", band: ["#B89D90", "#644536"], shadow: "rgba(100,69,54,0.4)",  contact: "mateo@ortegarentals.com",  phone: "(415) 555-0163", last: "Unit 4B paint",         lastWhen: "completed Feb 22",      lastTone: "cold", balance: 0,    balanceSub: "paid in full · Feb 28",          jobs: "—", jobsSub: "no active jobs",      status: "cold",    temp: 18, vip: false },
];

export const STATUS_LABELS: Record<ClientStatus, string> = {
  active: "Active job",
  lead: "Lead",
  owes: "Owes you",
  regular: "Regular",
  cold: "Quiet",
};

export interface Story { line: string; cta: string }

export const STORIES: Record<string, Story> = {
  "Greenleaf HOA":          { line: "Eleven jobs since 2022. Margaret peeked at the new paint quote Tuesday — nudge gently, they always say yes by Thursday.", cta: "Send a friendly nudge" },
  "Maple Grove Apartments": { line: "Diego is on building C right now. Janet pays progress invoices the day she gets them — send the next one tonight.",         cta: "Draft progress invoice" },
  "Cobblestone Cafe":       { line: "Patio re-tile lands April 30. Aisha tipped the crew last visit; they’re not just a customer, they’re fans.",                cta: "Confirm Wednesday" },
  "Marshall & Sons":        { line: "Driveway is waiting on a city permit — that’s on the inspector, not on you. Worth a heads-up text so Mike doesn’t worry.",     cta: "Send permit update" },
  "Sarah Chen":             { line: "Bathroom is on track but $1,920 is due Friday and Sarah hasn’t opened INV-208 yet. Friendly reminder, not a chase.",           cta: "Send a kind reminder" },
  "Hilltop Diner":          { line: "Eleven days late on a $1,160 invoice and quiet since. Lead with empathy — offer to split it in two payments.",                 cta: "Offer the split-pay" },
  "Tom & Linda Kowalski":   { line: "They opened the garage epoxy quote twice today. Hot lead. Knock $150 off if they book this week and you’ll close it.",         cta: "Send the warm offer" },
  "Jana Patel":             { line: "Paint job Monday, deposit already in. Easy week. Drop a confirmation text Sunday night and call it good.",                       cta: "Schedule Sunday text" },
  "Marcus Lin":             { line: "New lead — kitchen backsplash quote went out this morning. Give it a day, then check in if quiet.",                              cta: "Set 48-hour follow-up" },
  "Bayside Properties":     { line: "Quote’s been sitting four days. Property managers ghost when budget tightens; ask if scope needs trimming.",                  cta: "Ask if scope is right" },
  "Riverside Yoga":         { line: "Used to book monthly, quiet six weeks. Patio season starts next week — perfect excuse to reconnect.",                            cta: "Pitch the spring re-seal" },
  "Ortega Rentals":         { line: "Two months silent. Mateo manages eight units across town — when he goes quiet, he’s usually deciding between you and someone cheaper.", cta: "Win him back" },
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

export interface FilterEntry { id: ClientStatus | "all"; label: string; count: number }

export const FILTERS: FilterEntry[] = [
  { id: "all",     label: "All",         count: CLIENTS.length },
  { id: "active",  label: "Active jobs", count: CLIENTS.filter((c) => c.status === "active").length },
  { id: "lead",    label: "Leads",       count: CLIENTS.filter((c) => c.status === "lead").length },
  { id: "owes",    label: "Owe you",     count: CLIENTS.filter((c) => c.status === "owes").length },
  { id: "regular", label: "Regulars",    count: CLIENTS.filter((c) => c.status === "regular").length },
  { id: "cold",    label: "Quiet",       count: CLIENTS.filter((c) => c.status === "cold").length },
];

export interface TopClient { name: string; amt: string; pct: number }

export const TOP_CLIENTS: TopClient[] = [
  { name: "Greenleaf HOA",          amt: "$32,400", pct: 100 },
  { name: "Maple Grove Apartments", amt: "$24,800", pct: 76 },
  { name: "Ortega Rentals",         amt: "$18,720", pct: 58 },
  { name: "Cobblestone Cafe",       amt: "$15,920", pct: 49 },
  { name: "Marshall & Sons",        amt: "$11,450", pct: 35 },
];

export interface SegmentRow { lbl: string; pct: number; num: number; color: string }

export const SEGMENTS: SegmentRow[] = [
  { lbl: "Property mgmt", pct: 80, num: 4, color: "var(--brand-green)" },
  { lbl: "Homeowners",    pct: 60, num: 5, color: "var(--brand-pink)" },
  { lbl: "Small biz",     pct: 40, num: 2, color: "var(--brand-teal)" },
  { lbl: "HOAs",          pct: 18, num: 1, color: "var(--coffee-500)" },
];

export interface MoodPalette { from: string; to: string; shadow: string; statusFg: string; label: string }

export const moodFor = (c: Client): MoodPalette => {
  if (c.vip) return { from: "#1A535C", to: "#0F3A40", shadow: "rgba(26,83,92,0.35)", statusFg: "#1A535C", label: "On the books" };
  if (c.balance > 0) return { from: "#FF6B6B", to: "#D63F3F", shadow: "rgba(255,107,107,0.35)", statusFg: "#B23030", label: "Owes you" };
  if (c.status === "active") return { from: "#5FA34F", to: "#3F7A33", shadow: "rgba(81,152,67,0.35)", statusFg: "#3F7A33", label: "Active job" };
  if (c.status === "lead")   return { from: "#F7A893", to: "#E8704F", shadow: "rgba(232,112,79,0.35)", statusFg: "#A8431F", label: "New lead" };
  if (c.status === "cold")   return { from: "#9C8074", to: "#5C4034", shadow: "rgba(92,64,52,0.35)", statusFg: "#5C4034", label: "Quiet" };
  return { from: "#7FA86F", to: "#4A7039", shadow: "rgba(74,112,57,0.32)", statusFg: "#3F7A33", label: "Regular" };
};
