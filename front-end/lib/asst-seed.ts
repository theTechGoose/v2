/**
 * Static seed for the assistant — ported verbatim from
 * Paperwork Monster Assistant.html. Used until the backend's `/agents/*`
 * endpoints flesh out (per spec, those are deferred).
 */
import { type Lang, tFor } from "./i18n.ts";

interface ThreadEntry {
  id: string;
  client: string;
  preview: string;
  time: string;
  chip: "sent" | "draft" | "needs" | "paid";
  chipLabel: string;
  active?: boolean;
}

export interface ThreadGroup {
  group: string;
  items: ThreadEntry[];
}

export function seedThreads(lang: Lang = "en"): ThreadGroup[] {
  return [
    {
      group: tFor(lang, "assistantInbox.group.today"),
      items: [
        {
          id: "t1",
          client: tFor(lang, "assistantInbox.thread.t1.client"),
          preview: tFor(lang, "assistantInbox.thread.t1.preview"),
          time: tFor(lang, "assistantInbox.time.eightMin"),
          chip: "sent",
          chipLabel: tFor(lang, "status.sent"),
          active: true,
        },
        {
          id: "t2",
          client: tFor(lang, "assistantInbox.thread.t2.client"),
          preview: tFor(lang, "assistantInbox.thread.t2.preview"),
          time: tFor(lang, "assistantInbox.time.oneHour"),
          chip: "draft",
          chipLabel: tFor(lang, "assistantInbox.chip.drafted"),
        },
        {
          id: "t3",
          client: tFor(lang, "assistantInbox.thread.t3.client"),
          preview: tFor(lang, "assistantInbox.thread.t3.preview"),
          time: tFor(lang, "assistantInbox.time.threeHour"),
          chip: "needs",
          chipLabel: tFor(lang, "assistantInbox.chip.nudged"),
        },
      ],
    },
    {
      group: tFor(lang, "assistantInbox.group.yesterday"),
      items: [
        {
          id: "t4",
          client: tFor(lang, "assistantInbox.thread.t4.client"),
          preview: tFor(lang, "assistantInbox.thread.t4.preview"),
          time: tFor(lang, "assistantInbox.time.mon"),
          chip: "paid",
          chipLabel: tFor(lang, "status.signed"),
        },
        {
          id: "t5",
          client: tFor(lang, "assistantInbox.thread.t5.client"),
          preview: tFor(lang, "assistantInbox.thread.t5.preview"),
          time: tFor(lang, "assistantInbox.time.mon"),
          chip: "sent",
          chipLabel: tFor(lang, "status.sent"),
        },
      ],
    },
    {
      group: tFor(lang, "assistantInbox.group.thisWeek"),
      items: [
        {
          id: "t6",
          client: tFor(lang, "assistantInbox.thread.t6.client"),
          preview: tFor(lang, "assistantInbox.thread.t6.preview"),
          time: tFor(lang, "assistantInbox.time.sun"),
          chip: "paid",
          chipLabel: tFor(lang, "status.paid"),
        },
        {
          id: "t7",
          client: tFor(lang, "assistantInbox.thread.t7.client"),
          preview: tFor(lang, "assistantInbox.thread.t7.preview"),
          time: tFor(lang, "assistantInbox.time.sat"),
          chip: "sent",
          chipLabel: tFor(lang, "status.sent"),
        },
      ],
    },
  ];
}

export function seedTotal(): number {
  return seedThreads().reduce((sum, g) => sum + g.items.length, 0) + 5; // 12 in prototype
}
