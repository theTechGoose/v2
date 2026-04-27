/**
 * Static seed for the assistant — ported verbatim from
 * Paperwork Monsters Assistant.html. Used until the backend's `/agents/*`
 * endpoints flesh out (per spec, those are deferred).
 */

interface ThreadEntry { id: string; client: string; preview: string; time: string; chip: "sent" | "draft" | "needs" | "paid"; chipLabel: string; active?: boolean }

export interface ThreadGroup { group: string; items: ThreadEntry[] }

export const SEED_THREADS: ThreadGroup[] = [
  { group: "Today", items: [
    { id: "t1", client: "Tom & Linda K.",  preview: "Garage epoxy floor — 2-car, includes prep, primer, and topcoat. Awaiting signature.", time: "8m", chip: "sent",  chipLabel: "Sent",    active: true },
    { id: "t2", client: "Marcus Lin",      preview: "\"Need a quote for kitchen backsplash, ~30 sqft, white subway tile.\"",                  time: "1h", chip: "draft", chipLabel: "Drafted" },
    { id: "t3", client: "Hilltop Diner",   preview: "Followed up on overdue invoice #INV-204 ($1,160) — payment promised by Friday.",          time: "3h", chip: "needs", chipLabel: "Nudged" },
  ]},
  { group: "Yesterday", items: [
    { id: "t4", client: "Sarah Chen",      preview: "Bathroom remodel contract drafted and e-signed. Crew scheduled Wed.",                     time: "Mon", chip: "paid",  chipLabel: "Signed" },
    { id: "t5", client: "Greenleaf HOA",   preview: "Common area paint quote — 4,200 sqft, two coats, eggshell.",                              time: "Mon", chip: "sent",  chipLabel: "Sent" },
  ]},
  { group: "This week", items: [
    { id: "t6", client: "Cobblestone Cafe", preview: "Patio re-tile invoice #INV-198 sent. $1,000 deposit received.",                          time: "Sun", chip: "paid",  chipLabel: "Paid" },
    { id: "t7", client: "Bayside Properties", preview: "4-unit gutter cleaning quote sent. Cold — 4 days no view.",                            time: "Sat", chip: "sent",  chipLabel: "Sent" },
  ]},
];

export function seedTotal(): number {
  return SEED_THREADS.reduce((sum, g) => sum + g.items.length, 0) + 5; // 12 in prototype
}
