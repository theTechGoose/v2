/**
 * Static seed used while the backend's /agents/* module is incomplete.
 * Populated on the server when the real endpoints return an empty list.
 * Drop this module once /agents/conversations is wired up end-to-end.
 */
import type { Conversation, Message } from "../clients/assistant.ts";

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const SEED_CONVERSATIONS: Conversation[] = [
  {
    id: "seed-1",
    userId: "seed",
    title: "Rivera kitchen remodel",
    customerName: "Maria Rivera",
    preview: "Sent. They opened it. I'll nudge if no reply by Friday.",
    phase: "chat",
    unread: true,
    updatedAt: now - 30 * 60_000,
    createdAt: now - 2 * DAY,
  },
  {
    id: "seed-2",
    userId: "seed",
    title: "Patel deck rebuild",
    customerName: "Anish Patel",
    preview: "Drafted contract. Need your sign-off on materials.",
    phase: "terms",
    updatedAt: now - 4 * HOUR,
    createdAt: now - 5 * DAY,
  },
  {
    id: "seed-3",
    userId: "seed",
    title: "Ortega roof repair",
    customerName: "Lupe Ortega",
    preview: "Invoice paid 🎉",
    phase: "send",
    updatedAt: now - 2 * DAY,
    createdAt: now - 12 * DAY,
  },
];

export function seedMessages(conversationId: string): Message[] {
  if (conversationId === "seed-1") {
    return [
      { id: "m1", conversationId, role: "user",      kind: "text",  content: "Hey Bossie — kitchen remodel for the Riveras. Got pics.", createdAt: now - 90 * 60_000 },
      { id: "m2", conversationId, role: "assistant", kind: "text",  content: "Got 'em. Want me to draft a quote at $14,200?",            createdAt: now - 88 * 60_000 },
      { id: "m3", conversationId, role: "user",      kind: "text",  content: "Yeah send it.",                                            createdAt: now - 70 * 60_000 },
      { id: "m4", conversationId, role: "assistant", kind: "text",  content: "Sent. They opened it. I'll nudge if no reply by Friday.", createdAt: now - 30 * 60_000 },
    ];
  }
  if (conversationId === "seed-2") {
    return [
      { id: "m1", conversationId, role: "user",      kind: "text", content: "Patel wants composite vs cedar — what's the price diff?", createdAt: now - 6 * HOUR },
      { id: "m2", conversationId, role: "assistant", kind: "text", content: "Composite ≈ $4,200 over cedar. I drafted both. Pick one to send.", createdAt: now - 5 * HOUR },
    ];
  }
  return [
    { id: "m1", conversationId, role: "assistant", kind: "text", content: "Invoice marked paid.", createdAt: now - 2 * DAY },
  ];
}

export function groupByRecency(convs: Conversation[]): { label: string; items: Conversation[] }[] {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart.getTime() - DAY;
  const weekStart = todayStart.getTime() - 7 * DAY;

  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const week: Conversation[] = [];
  const older: Conversation[] = [];

  for (const c of convs) {
    if (c.updatedAt >= todayStart.getTime())     today.push(c);
    else if (c.updatedAt >= yesterdayStart)      yesterday.push(c);
    else if (c.updatedAt >= weekStart)           week.push(c);
    else                                          older.push(c);
  }

  const groups = [
    { label: "Today",      items: today },
    { label: "Yesterday",  items: yesterday },
    { label: "This week",  items: week },
    { label: "Earlier",    items: older },
  ];
  return groups.filter((g) => g.items.length > 0);
}
