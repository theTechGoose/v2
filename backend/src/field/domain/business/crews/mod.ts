/**
 * REQ-840/841/842 — crews. A crew is a foreman and members who go out together and the
 * services it does; a zone lists the crews staffing it (REQ-841); an absence takes a worker
 * or a whole crew out for some days (REQ-842). Pure: every function takes the records it needs.
 */
import type {
  Absence,
  Crew,
  FieldTask,
  FieldWorker,
  Region,
} from "@field/dto/field.ts";
import { onTask } from "@field/domain/business/job-span/mod.ts";
import { shiftDate } from "@field/domain/business/schedule/mod.ts";

/** how far ahead a deferred visit looks for a day the staff is back */
export const MAX_DEFER_DAYS = 31;

/** case- and accent-insensitive, one space between words */
const fold = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(
    /\s+/g,
    " ",
  ).trim();

const byName = (
  a: { name: string; id: string },
  b: { name: string; id: string },
) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** the crew's workers, by name */
export function crewMembers(
  crew: Pick<Crew, "id">,
  workers: FieldWorker[],
): FieldWorker[] {
  return workers.filter((w) => w.crewId === crew.id).sort(byName);
}

/** who leads the crew's task: the foreman when among `members`, else the first member */
export function leadOf(
  crew: Pick<Crew, "foremanId">,
  members: FieldWorker[],
): FieldWorker | undefined {
  return members.find((w) => w.id === crew.foremanId) ?? members[0];
}

/** is the name (any case, any accents) already a crew's — another crew's than `exceptId`? */
export function crewNameTaken(
  all: Pick<Crew, "id" | "name">[],
  name: string,
  exceptId?: string,
): boolean {
  const needle = fold(name);
  return all.some((c) => c.id !== exceptId && fold(c.name) === needle);
}

/** the crew (other than `exceptCrewId`) that lists the service */
export function claimedBy(
  crews: Crew[],
  taskTypeId: string,
  exceptCrewId?: string,
): Crew | undefined {
  return crews.find((c) =>
    c.id !== exceptCrewId && c.taskTypeIds.includes(taskTypeId)
  );
}

/** REQ-840: a worker acts on a task they are on; the crew's foreman on any of the crew's; the account foreman on anything */
export function canActOn(
  w: FieldWorker,
  t: Pick<FieldTask, "workerId" | "crewIds" | "crewId">,
  crew: Pick<Crew, "id" | "foremanId"> | null | undefined,
): boolean {
  if (w.role === "foreman" || onTask(w.id, t)) return true;
  return !!crew && !!t.crewId && t.crewId === crew.id &&
    crew.foremanId === w.id;
}

/** REQ-842: the absence that has this worker or this crew out on `date` (inclusive range) */
export function isOut(
  absences: Absence[],
  who: { workerId?: string; crewId?: string },
  date: string,
): Absence | undefined {
  return absences.find((a) =>
    a.from <= date && date <= a.to &&
    ((!!who.workerId && a.workerId === who.workerId) ||
      (!!who.crewId && a.crewId === who.crewId))
  );
}

/** REQ-842: the crew's members who are not out that day */
export function availableMembers(
  crew: Pick<Crew, "id">,
  workers: FieldWorker[],
  absences: Absence[],
  date: string,
): FieldWorker[] {
  return crewMembers(crew, workers).filter((w) =>
    !isOut(absences, { workerId: w.id }, date)
  );
}

/** who does one service on one zone */
export type Staff =
  | { kind: "crew"; crew: Crew; lead: FieldWorker; crewIds: string[] }
  | { kind: "worker"; workerId: string };

export interface StaffInput {
  region: Region;
  taskTypeId: string;
  crews: Crew[];
  workers: FieldWorker[];
}

/** the crews that count as the zone's staff, in order: the zone's own list, then every coversAll crew by name */
function candidates(region: Region, crews: Crew[]): Crew[] {
  const byId = new Map(crews.map((c) => [c.id, c]));
  const own = (region.crewIds ?? []).map((id) => byId.get(id)).filter((
    c,
  ): c is Crew => !!c);
  const everywhere = crews.filter((c) => c.coversAll && !own.includes(c)).sort(
    byName,
  );
  return [...own, ...everywhere];
}

const crewStaff = (crew: Crew, members: FieldWorker[]): Staff | null => {
  const lead = leadOf(crew, members);
  return lead
    ? {
      kind: "crew",
      crew,
      lead,
      crewIds: members.filter((w) => w.id !== lead.id).map((w) => w.id),
    }
    : null;
};

/**
 * REQ-841: the zone's crews in order (then the coversAll crews) — the first that lists the
 * service, else the first that lists nothing (does anything); a crew with no members is skipped;
 * then the zone's worker; else nobody. `members` picks the crew's members for the day.
 */
function resolve(
  input: StaffInput,
  members: (c: Crew) => FieldWorker[],
): Staff | null {
  const staffed = candidates(input.region, input.crews).map((c) => ({
    c,
    m: members(c),
  })).filter((x) => x.m.length > 0);
  const hit = staffed.find((x) => x.c.taskTypeIds.includes(input.taskTypeId)) ??
    staffed.find((x) => x.c.taskTypeIds.length === 0);
  if (hit) return crewStaff(hit.c, hit.m);
  return input.region.workerId
    ? { kind: "worker", workerId: input.region.workerId }
    : null;
}

/** the staff for a service on a zone, nobody out */
export function staffFor(input: StaffInput): Staff | null {
  return resolve(input, (c) => crewMembers(c, input.workers));
}

export type Resolution =
  | { kind: "staff"; staff: Staff }
  | { kind: "cover"; staff: Staff; coverFor: string; absence: Absence }
  | { kind: "defer"; to: string | null; staff: Staff; absence: Absence }
  | { kind: "skip"; staff: Staff; absence: Absence };

export type DayInput = StaffInput & { absences: Absence[]; date: string };

/** what a day's crew / cover lookup needs: the account's crews, workers and absences, and the day */
export type DayPeople = Pick<
  DayInput,
  "crews" | "workers" | "absences" | "date"
>;

/** the day's staff of a crew: its available members; the absence that empties it (when it is) */
function crewOnDay(
  crew: Crew,
  input: DayPeople,
): { staff: Staff | null; out?: Absence } {
  const crewOut = isOut(input.absences, { crewId: crew.id }, input.date);
  if (crewOut) return { staff: null, out: crewOut };
  const members = availableMembers(
    crew,
    input.workers,
    input.absences,
    input.date,
  );
  const staff = crewStaff(crew, members);
  if (staff) return { staff };
  // every member out one by one — the last one's absence speaks for the crew
  const all = crewMembers(crew, input.workers);
  const out = all.map((w) =>
    isOut(input.absences, { workerId: w.id }, input.date)
  ).filter((a): a is Absence => !!a).pop();
  return { staff: null, out };
}

/** the staff named by a cover: a crew (its available members) or a worker — null when they are out too (REQ-1022: work orders too) */
export function coverStaff(a: Absence, input: DayPeople): Staff | null {
  if (a.coverCrewId) {
    const crew = input.crews.find((c) => c.id === a.coverCrewId);
    return crew ? crewOnDay(crew, input).staff : null;
  }
  if (a.coverWorkerId) {
    return isOut(input.absences, { workerId: a.coverWorkerId }, input.date)
      ? null
      : { kind: "worker", workerId: a.coverWorkerId };
  }
  return null;
}

/** is the usual staff of this service there that day? */
function presentOn(input: DayInput): boolean {
  const usual = staffFor(input);
  if (!usual) return false;
  if (usual.kind === "worker") {
    return !isOut(input.absences, { workerId: usual.workerId }, input.date);
  }
  return !!crewOnDay(usual.crew, input).staff;
}

/** REQ-842: the first day after `from` (within MAX_DEFER_DAYS) the service's usual staff is back */
export function nextAvailableDay(
  input: Omit<DayInput, "date">,
  from: string,
  max = MAX_DEFER_DAYS,
): string | null {
  let d = from;
  for (let i = 0; i < max; i++) {
    d = shiftDate(d, 1);
    if (presentOn({ ...input, date: d })) return d;
  }
  return null;
}

/**
 * REQ-842: who does the service on `date`. The usual staff (REQ-841) when present — a member out
 * just leaves the day's crew. Out (a crew absence, every member out, or the solo worker out): the
 * absence's disposition — cover (by the named crew or worker; null when they are out too), defer
 * (to the next day the usual staff is back) or skip. Null: nobody.
 */
export function staffOn(input: DayInput): Resolution | null {
  const usual = staffFor(input);
  if (!usual) return null;
  let out: Absence | undefined;
  if (usual.kind === "worker") {
    out = isOut(input.absences, { workerId: usual.workerId }, input.date);
  } else {
    const day = crewOnDay(usual.crew, input);
    if (day.staff) return { kind: "staff", staff: day.staff };
    out = day.out;
  }
  if (!out) return { kind: "staff", staff: usual };
  if (out.disposition === "cover") {
    const staff = coverStaff(out, input);
    return staff
      ? {
        kind: "cover",
        staff,
        coverFor: out.crewId ?? out.workerId!,
        absence: out,
      }
      : null;
  }
  if (out.disposition === "defer") {
    return {
      kind: "defer",
      to: nextAvailableDay(input, input.date),
      staff: usual,
      absence: out,
    };
  }
  return { kind: "skip", staff: usual, absence: out };
}
