/**
 * Seed data ported verbatim from Paperwork Monster Quotes.html.
 * Used as a fallback while the backend's per-quote engagement endpoints
 * (`/quotes` derived `stage`/`opens`/`daysIn`, `/quotes/:id/opens`,
 * `/analytics/quotes/win-rate`, `/analytics/quotes/insight`) come online.
 */

export type Stage = "draft" | "sent" | "opened" | "cooling" | "stale" | "won" | "lost";

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
}

export const QPIPELINE: Quote[] = [
  // Drafting
  { id: "Q-1109", title: "Storefront awning replacement", client: "Cobblestone Cafe",       initials: "CC", stage: "draft", value: 4250, daysIn: 1, opens: 0, sentDays: null, band: ["#9C8074", "#5C4034"], shadow: "rgba(92,64,52,0.32)" },
  { id: "Q-1110", title: "Lobby refresh — paint + trim",  client: "Bayside Properties",      initials: "BP", stage: "draft", value: 6800, daysIn: 2, opens: 0, sentDays: null, band: ["#9C8074", "#5C4034"], shadow: "rgba(92,64,52,0.32)" },

  // Out for response — sent
  { id: "Q-1107", title: "Garage epoxy floor — 2-car",        client: "Tom & Linda Kowalski", initials: "TK", stage: "opened",  value: 3850, daysIn: 1,  opens: 3, sentDays: 1,  band: ["#F7A893", "#E8704F"], shadow: "rgba(232,112,79,0.4)" },
  { id: "Q-1106", title: "Common-area paint — buildings A & B", client: "Greenleaf HOA",       initials: "GH", stage: "opened",  value: 5800, daysIn: 3,  opens: 2, sentDays: 3,  band: ["#5FA34F", "#3F7A33"], shadow: "rgba(81,152,67,0.35)" },
  { id: "Q-1108", title: "Kitchen backsplash — subway tile", client: "Marcus Lin",            initials: "ML", stage: "sent",    value: 2400, daysIn: 0,  opens: 0, sentDays: 0,  band: ["#FFB3B3", "#FF6B6B"], shadow: "rgba(255,107,107,0.35)" },
  { id: "Q-1104", title: "4-unit gutter cleaning",          client: "Bayside Properties",     initials: "BP", stage: "cooling", value: 1240, daysIn: 4,  opens: 1, sentDays: 4,  band: ["#B89D90", "#785544"], shadow: "rgba(120,85,68,0.35)" },
  { id: "Q-1103", title: "Driveway repour — concrete",      client: "Marshall & Sons",        initials: "MS", stage: "opened",  value: 8200, daysIn: 2,  opens: 2, sentDays: 2,  band: ["#5FA34F", "#3F7A33"], shadow: "rgba(81,152,67,0.35)" },
  { id: "Q-1101", title: "Deck stain & seal",               client: "Hilltop Diner",          initials: "HD", stage: "stale",   value: 1850, daysIn: 12, opens: 1, sentDays: 12, band: ["#FF6B6B", "#D63F3F"], shadow: "rgba(255,107,107,0.4)" },
  { id: "Q-1102", title: "Studio floor seal",               client: "Riverside Yoga",         initials: "RY", stage: "stale",   value: 2100, daysIn: 9,  opens: 0, sentDays: 9,  band: ["#FF6B6B", "#D63F3F"], shadow: "rgba(255,107,107,0.4)" },

  // Decided
  { id: "Q-1099", title: "Building C re-roof",   client: "Maple Grove Apartments", initials: "MG", stage: "won",  value: 14200, daysIn: 0, opens: 4, sentDays: 6, decidedDays: 1, band: ["#5FA34F", "#3F7A33"], shadow: "rgba(81,152,67,0.35)" },
  { id: "Q-1098", title: "Patio re-tile",        client: "Cobblestone Cafe",       initials: "CC", stage: "won",  value: 3400,  daysIn: 0, opens: 5, sentDays: 4, decidedDays: 2, band: ["#5FA34F", "#3F7A33"], shadow: "rgba(81,152,67,0.35)" },
  { id: "Q-1097", title: "Bathroom remodel",     client: "Sarah Chen",             initials: "SC", stage: "won",  value: 6800,  daysIn: 0, opens: 3, sentDays: 3, decidedDays: 5, band: ["#5FA34F", "#3F7A33"], shadow: "rgba(81,152,67,0.35)" },
  { id: "Q-1096", title: "Interior paint — 2BR", client: "Jana Patel",             initials: "JP", stage: "won",  value: 1650,  daysIn: 0, opens: 2, sentDays: 5, decidedDays: 7, band: ["#5FA34F", "#3F7A33"], shadow: "rgba(81,152,67,0.35)" },
  { id: "Q-1094", title: "Window trim repaint", client: "Ortega Rentals",          initials: "OR", stage: "lost", value: 1900,  daysIn: 0, opens: 2, sentDays: 8, decidedDays: 4, band: ["#B89D90", "#785544"], shadow: "rgba(120,85,68,0.35)" },
  { id: "Q-1093", title: "Office foyer refresh",client: "Westgate Dental",         initials: "WD", stage: "lost", value: 2750,  daysIn: 0, opens: 1, sentDays: 6, decidedDays: 9, band: ["#B89D90", "#785544"], shadow: "rgba(120,85,68,0.35)" },
];

export const QSTORIES: Record<string, string> = {
  "Q-1109": "Cobblestone’s spring sign refresh — you’re still pricing material. Wrap it up tonight; Aisha asked for it Monday.",
  "Q-1110": "Bayside is ready to spend; this is the third quote they’ve asked for this quarter. Don’t make them wait.",
  "Q-1107": "Tom & Linda opened this three times today — they’re shopping. Knock $150 off if they book this week and you close it.",
  "Q-1106": "Margaret peeked Tuesday, again Wednesday morning. Greenleaf says yes by Thursday — send a friendly nudge tomorrow.",
  "Q-1108": "Just sent; give it 24 hours before you tap on the door. New leads need a beat.",
  "Q-1104": "Four days of silence on a 4-unit gutter quote. Property managers ghost when budget tightens — ask if job details need trimming.",
  "Q-1103": "Mike opened it twice but the city permit is the holdup. Send him a status note so he knows you’re tracking it.",
  "Q-1101": "Twelve days, one open, no reply. Hilltop is broke this month — offer to split the deck job into two payments and close it.",
  "Q-1102": "Riverside hasn’t opened it. Re-send with the subject line “spring patio season” and a fresh deadline.",
};

export const stageLabel: Record<Stage, string> = {
  draft: "Drafting",
  sent: "Just sent",
  opened: "Opened",
  cooling: "Cooling",
  stale: "Stale",
  won: "Won",
  lost: "Lost",
};

export interface MoodPalette { from: string; to: string; shadow: string; statusFg: string }

const moods: Record<string, MoodPalette> = {
  draft:      { from: "#9C8074", to: "#5C4034", shadow: "rgba(92,64,52,0.32)",   statusFg: "#5C4034" },
  sent:       { from: "#FFB3B3", to: "#FF6B6B", shadow: "rgba(255,107,107,0.35)", statusFg: "#B23030" },
  opened:     { from: "#5FA34F", to: "#3F7A33", shadow: "rgba(81,152,67,0.35)",   statusFg: "#3F7A33" },
  cooling:    { from: "#B89D90", to: "#785544", shadow: "rgba(120,85,68,0.35)",   statusFg: "#785544" },
  stale:      { from: "#FF6B6B", to: "#D63F3F", shadow: "rgba(214,63,63,0.4)",    statusFg: "#B23030" },
  opened_hot: { from: "#F7A893", to: "#E8704F", shadow: "rgba(232,112,79,0.4)",   statusFg: "#A8431F" },
};

export const moodForQuote = (q: Quote): MoodPalette => {
  if (q.stage === "opened" && q.opens >= 3) return moods.opened_hot;
  return moods[q.stage] ?? moods.sent;
};

export interface OpenEvent { when: string; time: string; device: string }

export const buildOpens = (q: Quote): OpenEvent[] => {
  if (q.opens === 0) return [];
  const seeds: OpenEvent[] = [
    { when: "Today", time: "9:42am",  device: "iPhone" },
    { when: "Today", time: "2:18pm",  device: "Mac" },
    { when: "Yesterday", time: "4:12pm", device: "iPhone" },
    { when: "Tue",   time: "11:30am", device: "iPhone" },
    { when: "Mon",   time: "7:54pm",  device: "iPad" },
    { when: "Sun",   time: "10:08am", device: "Mac" },
    { when: "Sat",   time: "8:21pm",  device: "iPhone" },
  ];
  const offset =
    q.stage === "cooling" ? 2 :
    q.stage === "stale"   ? 4 :
    q.stage === "sent"    ? 0 : 0;
  return seeds.slice(offset, offset + Math.min(q.opens, 5));
};

export type ReadingChunk = { text: string; em?: string; tail?: string };

export const readingFor = (q: Quote, opens: OpenEvent[]): ReadingChunk => {
  if (q.stage === "draft")  return { text: "Not sent yet — ", em: "finish writing", tail: ", then ship it." };
  if (opens.length === 0)   return { text: "Sent, but no opens yet. Could be in spam, or they haven't checked email today." };
  const devices = new Set(opens.map((o) => o.device));
  if (q.stage === "opened" && q.opens >= 3 && devices.size >= 2)
    return { text: "They're ", em: "shopping", tail: " — opened on multiple devices. Probably comparing. Time to send the offer." };
  if (q.stage === "opened" && q.opens >= 3)
    return { text: "Three opens means real interest. ", em: "Send the offer", tail: " while it's hot." };
  if (q.stage === "opened")
    return { text: "One peek and a pause. A ", em: "friendly nudge", tail: " usually breaks the silence." };
  if (q.stage === "cooling")
    return { text: "Opened a few times early, then went quiet. Worth a ", em: "job-details trim", tail: " and a re-send." };
  if (q.stage === "stale")
    return { text: "Lots of attention, then gone cold. Last shot: ", em: "win it back", tail: " with a sharper offer." };
  if (q.stage === "sent")
    return { text: "Just landed in their inbox. ", em: "Give it 24 hours", tail: " before you tap on the door." };
  return { text: "Quiet — try a nudge." };
};
