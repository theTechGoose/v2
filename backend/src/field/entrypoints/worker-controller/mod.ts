/**
 * REQ-138/141 — the worker's API, behind the worker's own `pm_worker` cookie:
 * login by cell + PIN, the day's visits without prices, check-offs, notes,
 * services, deferrals. A foreman sees every crew of the account.
 */
import { Body, Context, Controller, Get, Param, Post, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { AbsenceStore, CrewStore, FieldTaskStore, FieldWorkerStore, SubscriptionStore, TaskTypeStore } from "@field/domain/data/field-stores/mod.ts";
import { canActOn } from "@field/domain/business/crews/mod.ts"; // REQ-840
import { WorkerSessionStore } from "@field/domain/data/worker-session-store/mod.ts";
import { FieldDay } from "@field/domain/coordinators/field-day/mod.ts";
import { FieldViews } from "@field/domain/coordinators/field-views/mod.ts";
import { FieldNotices } from "@field/domain/coordinators/field-notices/mod.ts";
import { FieldActivity } from "@field/domain/coordinators/field-activity/mod.ts";
import { newId } from "@field/domain/coordinators/field-zones/mod.ts";
import { addService, deferTask, findOrCreateTaskType, inActionWindow, liveTypes, sameVisit } from "@field/domain/business/tasks/mod.ts";
import { lastDayOf, onTask } from "@field/domain/business/job-span/mod.ts";
import { isValidDate, shiftDate, todayIn } from "@field/domain/business/schedule/mod.ts";
import { businessZoneOf, fieldTodayFor } from "@users/domain/coordinators/business-zone/mod.ts"; // REQ-940
import { workerLang } from "@field/domain/business/worker-welcome/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { WorkOrderStore } from "@paperwork/domain/data/work-order-store/mod.ts"; // REQ-1010
import { woDayStaff, workOrderRow, workOrdersOn } from "@field/domain/business/work-order-day/mod.ts"; // REQ-1010, REQ-1022
import { CAP, type Crew, digitsOf, FieldError, type FieldTask, type FieldWorker, str, tooLong } from "@field/dto/field.ts";

type Body_ = Record<string, unknown>;
const body = (b: unknown): Body_ => (b && typeof b === "object" ? b as Body_ : {});
/** REQ-840: the worker's crew, when they are in one of the account's */
async function crewOf(w: FieldWorker, crews: CrewStore): Promise<Crew | null> {
  const c = w.crewId ? await crews.find(w.crewId) : null;
  return c && c.userId === w.userId ? c : null;
}

/**
 * REQ-285 — what the worker's screen gets: who, the role, and the language the screen opens in (REQ-155's
 * rule: theirs, else the owner's). REQ-840 — the crew's name; a worker who leads their crew is a foreman.
 * REQ-940 — `today` / `timeZone`: the business's field day, the one the action window checks against.
 * REQ-1008 — `crewLead: true` when that foreman power is only their own crew's (not the account-wide role).
 */
async function publicWorker(w: FieldWorker, users: UserStore, crews: CrewStore) {
  const owner = w.language ? {} : await users.get(w.userId).catch(() => ({}));
  const crew = await crewOf(w, crews);
  const accountWide = w.role === "foreman";
  const leadsCrew = !accountWide && !!crew && crew.foremanId === w.id;
  const timeZone = await businessZoneOf(w.userId); // REQ-940: the screen's "Today" is the business's day
  return {
    id: w.id,
    name: w.name,
    today: todayIn(timeZone),
    timeZone,
    role: accountWide || leadsCrew ? "foreman" as const : "worker" as const,
    ...(leadsCrew ? { crewLead: true as const } : {}),
    language: workerLang(w, owner),
    ...(crew ? { crewId: crew.id, crewName: crew.name } : {}),
  };
}

async function me(ctx: ExecutionContext, sessions: WorkerSessionStore, workers: FieldWorkerStore): Promise<FieldWorker | null> {
  const token = WorkerSessionStore.tokenFrom(ctx.req.header("cookie"));
  if (!token) return null;
  const s = await sessions.get(token);
  if (!s) return null;
  const w = await workers.find(s.workerId);
  return w && w.userId === s.userId ? w : null;
}
async function need(ctx: ExecutionContext, sessions: WorkerSessionStore, workers: FieldWorkerStore): Promise<FieldWorker> {
  const w = await me(ctx, sessions, workers);
  if (!w) throw new FieldError("not logged in", 401);
  return w;
}
/** the task a worker may act on now — theirs (their crew's for its foreman, anyone's for the account foreman), recent, not in the future */
async function actionable(ctx: ExecutionContext, id: string, sessions: WorkerSessionStore, workers: FieldWorkerStore, tasks: FieldTaskStore, crews: CrewStore): Promise<{ w: FieldWorker; t: FieldTask }> {
  const w = await need(ctx, sessions, workers);
  const t = await tasks.find(id);
  if (!t || t.userId !== w.userId || !canActOn(w, t, await crewOf(w, crews))) throw new FieldError("not found", 404);
  outsideWindow(w, t.date, await fieldTodayFor(w.userId), lastDayOf(t)); // REQ-785: a job's last day; REQ-940: the business's day
  return { w, t };
}

/** REQ-940: the 409 says WHICH side of the window the day is on, so the screen's wording is right */
function outsideWindow(w: FieldWorker, date: string, today: string, lastDay = date): void {
  if (inActionWindow(w, date, today, lastDay)) return;
  const future = date > today;
  throw new FieldError("outside the days you can edit", 409, { today, reason: future ? "future" : "too_old" }, future ? "future_day" : "too_old");
}

@Controller("field/worker")
export class FieldWorkerController {
  constructor(
    private workers: FieldWorkerStore,
    private sessions: WorkerSessionStore,
    private tasks: FieldTaskStore,
    private subs: SubscriptionStore,
    private types: TaskTypeStore,
    private day: FieldDay,
    private views: FieldViews,
    private notices: FieldNotices,
    private users: UserStore,
    private activity: FieldActivity,
    private crews: CrewStore, // REQ-840
    private workOrders: WorkOrderStore, // REQ-1010
    private absences: AbsenceStore, // REQ-1022
  ) {}

  /** REQ-138: cell + PIN; five misses lock the worker for a minute */
  @Post("login")
  async login(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const b = body(raw);
    const phone = digitsOf(b.phoneNumber), pin = String(b.pin ?? "").trim();
    const w = phone ? await this.workers.findByPhone(phone) : null;
    if (w && await this.sessions.locked(w.id)) throw new FieldError("too many attempts — wait a minute", 429);
    if (!w || w.pin !== pin) {
      if (w) await this.sessions.miss(w.id);
      // REQ-1165: a removed worker with the PIN they had is told so; any other PIN stays a plain 401
      if (!w && phone && await this.workers.wasRemoved(phone, pin)) {
        throw new FieldError("worker access removed", 403, undefined, "worker_removed");
      }
      throw new FieldError("wrong cell or PIN", 401);
    }
    await this.sessions.clearMisses(w.id);
    const s = await this.sessions.create(w.id, w.userId);
    ctx.header("Set-Cookie", WorkerSessionStore.cookie(s.token));
    return publicWorker(w, this.users, this.crews);
  }

  @Post("logout")
  async logout(@Context() ctx: ExecutionContext) {
    const token = WorkerSessionStore.tokenFrom(ctx.req.header("cookie"));
    if (token) await this.sessions.delete(token);
    ctx.header("Set-Cookie", WorkerSessionStore.clearCookie());
    return { ok: true };
  }

  @Get("me")
  async whoami(@Context() ctx: ExecutionContext) {
    const w = await me(ctx, this.sessions, this.workers);
    return w ? publicWorker(w, this.users, this.crews) : null;
  }

  /** REQ-141: only this worker's tasks (REQ-785: a job they are on the crew of, on each of its days), no prices; a foreman asking ?all=1 gets every crew, theirs first */
  @Get("tasks")
  async list(@Context() ctx: ExecutionContext, @Query("date") date?: string, @Query("all") all?: string) {
    const w = await need(ctx, this.sessions, this.workers);
    const d = date ?? await fieldTodayFor(w.userId); // REQ-940: the business's day
    if (!isValidDate(d)) throw new FieldError("date must be YYYY-MM-DD");
    const rows = (await this.day.generate(w.userId, d)).all; // REQ-170: any day materializes on read
    const everyone = all === "1" && w.role === "foreman";
    const crew = await crewOf(w, this.crews); // REQ-840: a crew's foreman asking for all gets the crew's
    const n = await this.views.workerNames(w.userId);
    const mine = (t: Pick<FieldTask, "workerId" | "crewIds" | "crewId">) => everyone || onTask(w.id, t) || (all === "1" && canActOn(w, t, crew));
    const tasks = rows
      .filter(mine)
      .sort((a, b) => (onTask(w.id, a) ? 0 : 1) - (onTask(w.id, b) ? 0 : 1))
      .map((t) => this.views.workerTask(t, n));
    // REQ-1010: a work order assigned to a worker for this day is on their day too (read-only, no price).
    // REQ-1022: the assignee out that day → the absence's cover has it instead (covering for them).
    const [wos, absences, workers, crews] = await Promise.all([
      this.workOrders.listByUser(w.userId),
      this.absences.listByUser(w.userId),
      this.workers.listByUser(w.userId),
      this.crews.listByUser(w.userId),
    ]);
    const people = { absences, workers, crews, date: d };
    const orders = workOrdersOn(wos, d)
      .map((wo) => ({ wo, staff: woDayStaff(wo, people) }))
      // an uncovered absence (the cover is out too) puts it on nobody's own day; the account foreman still sees it
      .filter(({ staff }) => everyone || (!!staff && mine(staff)))
      .map(({ wo, staff }) => workOrderRow(wo, n, staff ?? undefined))
      .sort((a, b) => (onTask(w.id, a) ? 0 : 1) - (onTask(w.id, b) ? 0 : 1));
    return [...tasks, ...orders];
  }

  /** the account's task types, for the "add a service" picker */
  @Get("task-types")
  async taskTypes(@Context() ctx: ExecutionContext) {
    const w = await need(ctx, this.sessions, this.workers);
    return liveTypes(await this.types.listByUser(w.userId)).sort((a, b) => a.name.localeCompare(b.name)); // REQ-839: no archived ones
  }

  /** REQ-141: add a service to a visit the worker has that day (a removed one is restored) */
  @Post("visits/:subscriptionId/services")
  async addService(@Context() ctx: ExecutionContext, @Param("subscriptionId") subscriptionId: string, @Body() raw: unknown) {
    const w = await need(ctx, this.sessions, this.workers);
    const b = body(raw);
    const s = await this.subs.find(subscriptionId);
    if (!s || s.userId !== w.userId) throw new FieldError("not found", 404);
    const today = await fieldTodayFor(w.userId); // REQ-940
    const date = str(b.date) ?? today;
    if (!isValidDate(date)) throw new FieldError("date must be YYYY-MM-DD");
    outsideWindow(w, date, today);
    const dayTasks = await this.tasks.listByDay(w.userId, date);
    const crew = await crewOf(w, this.crews);
    if (!dayTasks.some((t) => t.subscriptionId === s.id && canActOn(w, t, crew))) throw new FieldError("not found", 404);
    let taskTypeId = str(b.taskTypeId);
    const types = await this.types.listByUser(w.userId);
    if (!taskTypeId && str(b.taskTypeName)) {
      const r = findOrCreateTaskType(types, str(b.taskTypeName)!, w.userId, newId);
      if (r.created || r.restored) await this.types.put(r.type); // REQ-839
      taskTypeId = r.type.id;
      types.push(r.type);
    }
    if (!taskTypeId || !types.some((x) => x.id === taskTypeId)) throw new FieldError("taskTypeId required");
    const r = addService({ subscription: await this.day.effective(s), taskTypeId, date, existing: dayTasks, newId, addedByName: w.name }); // REQ-811: priced from the checklist too
    if (!r.ok) throw new FieldError(r.reason === "invoiced" ? "visit already invoiced" : r.reason, r.reason === "no_visit" ? 404 : 409);
    await this.tasks.put(r.task);
    const n = await this.views.workerNames(w.userId);
    return ctx.json(this.views.workerTask(r.task, n), r.restored ? 200 : 201);
  }

  @Post("tasks/:id/complete")
  async complete(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() raw: unknown) {
    const { w, t } = await actionable(ctx, id, this.sessions, this.workers, this.tasks, this.crews);
    if (t.invoiceId) throw new FieldError("already invoiced", 409);
    const b = body(raw);
    if (tooLong(b.note, CAP.note)) throw new FieldError(`note too long (max ${CAP.note})`);
    const wasComplete = t.status === "complete";
    t.status = "complete";
    t.completedAt = new Date().toISOString();
    if (typeof b.note === "string") t.note = b.note.trim() || undefined;
    await this.tasks.put(t);
    if (!wasComplete) await this.activity.taskCompleted(t, w.name); // REQ-566
    return this.views.workerTask(t, await this.views.workerNames(w.userId));
  }

  @Post("tasks/:id/uncomplete")
  async uncomplete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const { w, t } = await actionable(ctx, id, this.sessions, this.workers, this.tasks, this.crews);
    if (t.invoiceId) throw new FieldError("already invoiced", 409);
    if (t.status === "complete") {
      t.status = "assigned";
      delete t.completedAt;
      await this.tasks.put(t);
    }
    return this.views.workerTask(t, await this.views.workerNames(w.userId));
  }

  /** not done — never invoiced */
  @Post("tasks/:id/skip")
  async skip(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const { w, t } = await actionable(ctx, id, this.sessions, this.workers, this.tasks, this.crews);
    if (t.invoiceId) throw new FieldError("already invoiced", 409);
    t.status = "skipped";
    delete t.completedAt;
    await this.tasks.put(t);
    await this.notices.customerCanceled(w.userId, t); // REQ-171: the customer hears, once
    return this.views.workerTask(t, await this.views.workerNames(w.userId));
  }

  @Post("tasks/:id/restore")
  async restore(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const { w, t } = await actionable(ctx, id, this.sessions, this.workers, this.tasks, this.crews);
    if (t.status === "skipped") {
      t.status = "assigned";
      await this.tasks.put(t);
    }
    return this.views.workerTask(t, await this.views.workerNames(w.userId));
  }

  /** tomorrow, with a note: the original is marked, a copy holds tomorrow's slot */
  @Post("tasks/:id/defer")
  async defer(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() raw: unknown) {
    const { w, t } = await actionable(ctx, id, this.sessions, this.workers, this.tasks, this.crews);
    // REQ-785: a job of several days is not pushed a day — the office changes its days
    if (lastDayOf(t) !== t.date) throw new FieldError("a job of several days is not deferred — the office changes its days", 409);
    const visit = (await this.tasks.listByDay(w.userId, t.date)).filter((x) => x.subscriptionId === t.subscriptionId);
    if (t.invoiceId || visit.some((x) => x.invoiceId)) throw new FieldError("visit already invoiced", 409);
    if (t.status === "deferred") throw new FieldError("already deferred", 409);
    const b = body(raw);
    if (tooLong(b.note, CAP.note)) throw new FieldError(`note too long (max ${CAP.note})`);
    const to = shiftDate(t.date, 1);
    const tomorrow = await this.tasks.listByDay(w.userId, to);
    const already = tomorrow.some((x) => x.subscriptionId === t.subscriptionId && x.taskTypeId === t.taskTypeId);
    const { copy } = deferTask(t, to, String(b.note ?? "").trim() || undefined, newId);
    await this.tasks.putMany(already ? [t] : [t, copy]); // tomorrow's slot may already exist (a generated round): then it simply absorbs the work
    await this.notices.customerDeferred(w.userId, t, to); // REQ-171: the customer hears the new day, once
    return this.views.workerTask(t, await this.views.workerNames(w.userId));
  }

  /** the note is the visit's — on every task of that visit that is not invoiced */
  @Post("tasks/:id/note")
  async note(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() raw: unknown) {
    const { w, t } = await actionable(ctx, id, this.sessions, this.workers, this.tasks, this.crews);
    if (t.invoiceId) throw new FieldError("already invoiced", 409);
    const b = body(raw);
    if (tooLong(b.note, CAP.note)) throw new FieldError(`note too long (max ${CAP.note})`);
    const note = String(b.note ?? "").trim() || undefined;
    // REQ-785: the visit's tasks — a one-off's are its customer's (a job's, its own days'), never every one-off that day
    const visit = (await this.tasks.listByDay(w.userId, t.date)).filter((x) => sameVisit(t, x) && !x.invoiceId);
    await this.tasks.putMany(visit.map((x) => ({ ...x, note })));
    t.note = note;
    return this.views.workerTask(t, await this.views.workerNames(w.userId));
  }

}
