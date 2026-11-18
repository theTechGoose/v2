/**
 * REQ-927 — service migration as segments. Migrating service A into B moves every record that
 * uses A (repeat-visit rows, checklist rows, tasks — history included — and crews' service lists)
 * onto B, marks each moved row "was A" (`migratedFrom`, a stack: the last mark is the latest) and
 * lists it on the segment, so the same records can be undone, redone or moved on to another
 * service. All-or-nothing: each function works on a copy of the world and answers the records to
 * save (`changed`), or a refusal with nothing changed. Pure.
 */
import type {
  Checklist,
  Crew,
  FieldTask,
  MigrationMark,
  ServiceMigration,
  Subscription,
  SubscriptionItem,
  TaskType,
} from "@field/dto/field.ts";

export interface World {
  subscriptions: Subscription[];
  checklists: Checklist[];
  tasks: FieldTask[];
  crews: Crew[];
}

export interface Changed {
  subscriptions: string[];
  checklists: string[];
  tasks: string[];
  crews: string[];
}

export type SegmentResult =
  | { ok: true; seg: ServiceMigration; world: World; changed: Changed }
  | { ok: false; code: string; detail?: Record<string, unknown> };

type Marked = { taskTypeId: string; migratedFrom?: MigrationMark[] };

class Refused extends Error {
  constructor(readonly code: string, readonly detail?: Record<string, unknown>) {
    super(code);
  }
}

const top = (r: Marked) => r.migratedFrom?.[r.migratedFrom.length - 1];
const hasMark = (r: Marked, id: string) => !!r.migratedFrom?.some((m) => m.migrationId === id);

function push(r: Marked, from: string, segId: string, to: string) {
  r.migratedFrom = [...(r.migratedFrom ?? []), { typeId: from, migrationId: segId }];
  r.taskTypeId = to;
}
function pop(r: Marked, back: string) {
  r.taskTypeId = back;
  const rest = (r.migratedFrom ?? []).slice(0, -1);
  if (rest.length) r.migratedFrom = rest;
  else delete r.migratedFrom;
}

class Tracker {
  sets = { subscriptions: new Set<string>(), checklists: new Set<string>(), tasks: new Set<string>(), crews: new Set<string>() };
  out(): Changed {
    return {
      subscriptions: [...this.sets.subscriptions],
      checklists: [...this.sets.checklists],
      tasks: [...this.sets.tasks],
      crews: [...this.sets.crews],
    };
  }
}

/** move `from` → `to` on the records (all of them, or only the segment's `only`), recording refs on `seg` */
function apply(
  w: World,
  seg: ServiceMigration,
  from: string,
  to: string,
  ch: Tracker,
  only?: ServiceMigration["refs"],
) {
  if (from === to) throw new Refused("same_service");
  const pick = <T extends { id: string }>(list: T[], ids?: string[]) => ids ? list.filter((x) => ids.includes(x.id)) : list;
  const refs: ServiceMigration["refs"] = { subscriptions: [], checklists: [], tasks: [], crews: [] };
  const merged: ServiceMigration["merged"] = [];
  const rows = (kind: "subscription" | "checklist", recs: (Subscription | Checklist)[], refList: string[], set: Set<string>) => {
    for (const r of recs) {
      const i = r.items.findIndex((it) => it.taskTypeId === from);
      if (i < 0) continue;
      const row = r.items[i];
      if (r.items.some((it) => it.taskTypeId === to)) {
        r.items.splice(i, 1);
        merged.push({ kind, id: r.id, at: i, item: row });
      } else push(row, from, seg.id, to);
      refList.push(r.id);
      set.add(r.id);
    }
  };
  rows("subscription", pick(w.subscriptions, only?.subscriptions), refs.subscriptions, ch.sets.subscriptions);
  rows("checklist", pick(w.checklists, only?.checklists), refs.checklists, ch.sets.checklists);
  for (const t of pick(w.tasks, only?.tasks)) {
    if (t.taskTypeId !== from) continue;
    push(t, from, seg.id, to);
    refs.tasks.push(t.id);
    ch.sets.tasks.add(t.id);
  }
  for (const c of pick(w.crews, only?.crews.map((x) => x.id))) {
    if (!c.taskTypeIds.includes(from)) continue;
    const taken = c.taskTypeIds.includes(to) || w.crews.some((o) => o.id !== c.id && o.taskTypeIds.includes(to));
    if (taken) {
      // an empty list means "does any service" — never turn a crew into that by accident
      if (c.taskTypeIds.length === 1) throw new Refused("migration_crew_conflict", { crew: c.name });
      c.taskTypeIds = c.taskTypeIds.filter((id) => id !== from);
      refs.crews.push({ id: c.id, action: "dropped" });
    } else {
      c.taskTypeIds = c.taskTypeIds.map((id) => id === from ? to : id);
      refs.crews.push({ id: c.id, action: "replaced" });
    }
    ch.sets.crews.add(c.id);
  }
  seg.refs = refs;
  seg.merged = merged;
  seg.toTypeId = to;
  seg.state = "applied";
}

/** put the segment's records back on its `from` service */
function revert(w: World, seg: ServiceMigration, ch: Tracker) {
  if (seg.state !== "applied") throw new Refused("segment_not_applied");
  const from = seg.fromTypeId, to = seg.toTypeId;
  // a later migration sits on top of one of our marks: that one must be undone first
  const records: Marked[] = [...w.subscriptions.flatMap((s) => s.items), ...w.checklists.flatMap((c) => c.items), ...w.tasks];
  for (const r of records) {
    if (hasMark(r, seg.id) && top(r)?.migrationId !== seg.id) {
      throw new Refused("segment_superseded", { migrationId: top(r)!.migrationId });
    }
  }
  const rows = (recs: (Subscription | Checklist)[], set: Set<string>) => {
    for (const r of recs) {
      const i = r.items.findIndex((it) => it.taskTypeId === to && top(it)?.migrationId === seg.id);
      if (i < 0) continue;
      if (r.items.some((it) => it.taskTypeId === from)) r.items.splice(i, 1); // A was added back by hand: keep that row
      else pop(r.items[i], from);
      set.add(r.id);
    }
  };
  rows(w.subscriptions, ch.sets.subscriptions);
  rows(w.checklists, ch.sets.checklists);
  for (const m of seg.merged) {
    const r = (m.kind === "subscription" ? w.subscriptions : w.checklists).find((x) => x.id === m.id);
    if (!r || r.items.some((it) => it.taskTypeId === from)) continue;
    r.items.splice(Math.min(m.at, r.items.length), 0, structuredClone(m.item));
    (m.kind === "subscription" ? ch.sets.subscriptions : ch.sets.checklists).add(r.id);
  }
  for (const t of w.tasks) {
    if (t.taskTypeId !== to || top(t)?.migrationId !== seg.id) continue;
    pop(t, from);
    ch.sets.tasks.add(t.id);
  }
  for (const ref of seg.refs.crews) {
    const c = w.crews.find((x) => x.id === ref.id);
    if (!c || c.taskTypeIds.includes(from)) continue;
    if (ref.action === "replaced" && c.taskTypeIds.includes(to)) {
      c.taskTypeIds = c.taskTypeIds.map((id) => id === to ? from : id);
    } else if (ref.action === "dropped" && !w.crews.some((o) => o.taskTypeIds.includes(from))) {
      c.taskTypeIds = [...c.taskTypeIds, from];
    } else continue;
    ch.sets.crews.add(c.id);
  }
  seg.state = "undone";
}

function run(w: World, seg: ServiceMigration, fn: (w: World, seg: ServiceMigration, ch: Tracker) => void): SegmentResult {
  const copy = structuredClone(w), s = structuredClone(seg), ch = new Tracker();
  try {
    fn(copy, s, ch);
  } catch (e) {
    if (e instanceof Refused) return { ok: false, code: e.code, ...(e.detail ? { detail: e.detail } : {}) };
    throw e;
  }
  return { ok: true, seg: s, world: copy, changed: ch.out() };
}

/** a new segment: every record on `from` moves to `toTypeId` */
export function migrateService(
  w: World,
  input: { id: string; userId: string; from: TaskType; toTypeId: string; now: string },
): SegmentResult {
  const f = input.from;
  const seg: ServiceMigration = {
    id: input.id,
    userId: input.userId,
    fromTypeId: f.id,
    toTypeId: input.toTypeId,
    from: { name: f.name, ...(f.description ? { description: f.description } : {}), ...(f.archived ? { archived: true as const } : {}), createdAt: f.createdAt },
    state: "applied",
    refs: { subscriptions: [], checklists: [], tasks: [], crews: [] },
    merged: [],
    history: [{ action: "migrate", toTypeId: input.toTypeId, at: input.now }],
    createdAt: input.now,
    updatedAt: input.now,
  };
  return run(w, seg, (w, s, ch) => {
    apply(w, s, f.id, input.toTypeId, ch);
    const r = s.refs;
    if (!r.subscriptions.length && !r.checklists.length && !r.tasks.length && !r.crews.length) {
      throw new Refused("nothing_to_migrate");
    }
  });
}

const stamp = (s: ServiceMigration, action: ServiceMigration["history"][number]["action"], now: string) => {
  s.history = [...s.history, { action, toTypeId: s.toTypeId, at: now }];
  s.updatedAt = now;
};

/** the segment's records go back to the service they were */
export function undoSegment(w: World, seg: ServiceMigration, now: string): SegmentResult {
  return run(w, seg, (w, s, ch) => {
    revert(w, s, ch);
    stamp(s, "undo", now);
  });
}

/** an undone segment's records move to its target again */
export function redoSegment(w: World, seg: ServiceMigration, now: string): SegmentResult {
  return run(w, seg, (w, s, ch) => {
    if (s.state !== "undone") throw new Refused("segment_not_undone");
    apply(w, s, s.fromTypeId, s.toTypeId, ch, s.refs);
    stamp(s, "redo", now);
  });
}

/** the segment's records go on to another service — from where they sit now (target, or back on `from`) */
export function moveSegment(w: World, seg: ServiceMigration, toTypeId: string, now: string): SegmentResult {
  return run(w, seg, (w, s, ch) => {
    if (toTypeId === s.fromTypeId || (s.state === "applied" && toTypeId === s.toTypeId)) throw new Refused("same_service");
    if (s.state === "applied") revert(w, s, ch);
    apply(w, s, s.fromTypeId, toTypeId, ch, s.refs);
    stamp(s, "move", now);
  });
}

/** REQ-927: when PUT rebuilds a record's rows, keep the marks of the rows that stayed on the same service */
export function keepMarks(prev: SubscriptionItem[] | undefined, next: SubscriptionItem[]): SubscriptionItem[] {
  return next.map((it) => {
    const was = prev?.find((p) => p.taskTypeId === it.taskTypeId)?.migratedFrom;
    return was?.length ? { ...it, migratedFrom: was } : it;
  });
}
