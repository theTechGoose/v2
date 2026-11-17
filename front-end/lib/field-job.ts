/**
 * REQ-785 — a job of several days on /field/tasks and /worker (demo-loop dv1-d11; Raphael: "Yes,
 * multi-day jobs."). It is ONE one-off task with a last day (`endDate`) and maybe more workers
 * (`crewIds`); it shows on every day from its `date` to its `endDate` and is done once. The
 * backend's rules: backend/src/field/domain/business/job-span/mod.ts.
 */

/** the longest job, in days (the backend refuses more) */
export const MAX_JOB_DAYS = 31;

export interface JobDays {
  date: string;
  endDate?: string;
}

const dayNum = (iso: string) =>
  Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/** the last day it covers: its endDate when after its day, else its day */
export function lastDay(t: JobDays): string {
  return t.endDate && t.endDate > t.date ? t.endDate : t.date;
}

/** how many days it runs — 1 for a one-day task */
export function jobDays(t: JobDays): number {
  return dayNum(lastDay(t)) - dayNum(t.date) + 1;
}

/** which day of the job `viewed` is ("Day 2 of 3"); null for a one-day task or a day it does not cover */
export function jobDayOf(
  t: JobDays,
  viewed: string,
): { n: number; of: number } | null {
  const of = jobDays(t);
  if (of < 2 || viewed < t.date || viewed > lastDay(t)) return null;
  return { n: dayNum(viewed) - dayNum(t.date) + 1, of };
}

/** "Nov 16" / "16 nov" */
function shortDay(iso: string, lang: "en" | "es"): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(
    lang === "es" ? "es-MX" : "en-US",
    { month: "short", day: "numeric", timeZone: "UTC" },
  );
}

/** "Nov 16 – Nov 18" / "16 nov – 18 nov"; one day reads alone */
export function jobRange(t: JobDays, lang: "en" | "es"): string {
  const last = lastDay(t);
  return last === t.date
    ? shortDay(t.date, lang)
    : `${shortDay(t.date, lang)} – ${shortDay(last, lang)}`;
}

/** what the form sends as the last day: blank or the first day itself is one day (nothing) */
export function endDateToSend(first: string, last: string): string | undefined {
  return last && last !== first ? last : undefined;
}

/** the Add task / Edit dates form's last day: null when it can be sent */
export function jobSpanProblem(
  first: string,
  last: string,
):
  | null
  | { key: "field.tk.badEnd" }
  | { key: "field.tk.jobTooLong"; vars: { max: string } } {
  const end = endDateToSend(first, last);
  if (!end) return null;
  if (end < first) return { key: "field.tk.badEnd" };
  if (jobDays({ date: first, endDate: end }) > MAX_JOB_DAYS) {
    return { key: "field.tk.jobTooLong", vars: { max: String(MAX_JOB_DAYS) } };
  }
  return null;
}

/** is this worker on the task — its worker, or on its crew? */
export function onJob(
  workerId: string,
  t: { workerId: string; crewIds?: string[] },
): boolean {
  return t.workerId === workerId || !!t.crewIds?.includes(workerId);
}

/** the others on the job, by name — its worker and its crew, never `meId` */
export function workMates(
  t: {
    workerId: string;
    workerName: string;
    crewIds?: string[];
    crewNames?: string[];
  },
  meId: string,
): string[] {
  const all = [
    { id: t.workerId, name: t.workerName },
    ...(t.crewIds ?? []).map((id, i) => ({
      id,
      name: t.crewNames?.[i] ?? "",
    })),
  ];
  return all.filter((w) => w.id !== meId && w.name).map((w) => w.name);
}

/** the workers a crew is picked from: everyone but the job's worker */
export function crewChoices<T extends { id: string }>(
  workers: readonly T[],
  leadId: string,
): T[] {
  return workers.filter((w) => w.id !== leadId);
}

/**
 * /worker's visit: a subscription's services that day; a one-off's — its customer's tasks with the
 * same first and last day (the backend's sameVisit), so a job of several days is its own card and
 * two customers' one-offs never merge.
 */
export function visitKey(
  t: { subscriptionId: string; customerId: string } & JobDays,
): string {
  return t.subscriptionId || `job:${t.customerId}|${t.date}|${lastDay(t)}`;
}
