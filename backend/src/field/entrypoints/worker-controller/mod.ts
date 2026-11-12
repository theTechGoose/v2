/**
 * REQ-138/141 — the worker's API, behind the worker's own `pm_worker` cookie:
 * login by cell + PIN, the day's visits without prices, check-offs, notes,
 * services, deferrals. A foreman sees every crew of the account.
 */
import { Body, Context, Controller, Get, Param, Post, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { FieldTaskStore, FieldWorkerStore, SubscriptionStore, TaskTypeStore } from "@field/domain/data/field-stores/mod.ts";
import { WorkerSessionStore } from "@field/domain/data/worker-session-store/mod.ts";
import { FieldDay } from "@field/domain/coordinators/field-day/mod.ts";
import { FieldViews } from "@field/domain/coordinators/field-views/mod.ts";
import { FieldNotices } from "@field/domain/coordinators/field-notices/mod.ts";
import { newId } from "@field/domain/coordinators/field-zones/mod.ts";
import { addService, canAct, deferTask, findOrCreateTaskType, inActionWindow } from "@field/domain/business/tasks/mod.ts";
import { fieldToday, isValidDate, shiftDate } from "@field/domain/business/schedule/mod.ts";
import { workerLang } from "@field/domain/business/worker-welcome/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { CAP, digitsOf, FieldError, type FieldTask, type FieldWorker, str, tooLong } from "@field/dto/field.ts";

type Body_ = Record<string, unknown>;
const body = (b: unknown): Body_ => (b && typeof b === "object" ? b as Body_ : {});
/** REQ-285 — what the worker's screen gets: who, the role, and the language the screen opens in (REQ-155's rule: theirs, else the owner's) */
async function publicWorker(w: FieldWorker, users: UserStore) {
  const owner = w.language ? {} : await users.get(w.userId).catch(() => ({}));
  return { id: w.id, name: w.name, role: w.role ?? "worker", language: workerLang(w, owner) };
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
/** the task a worker may act on now — theirs (anyone's for a foreman), recent, not in the future */
async function actionable(ctx: ExecutionContext, id: string, sessions: WorkerSessionStore, workers: FieldWorkerStore, tasks: FieldTaskStore): Promise<{ w: FieldWorker; t: FieldTask }> {
  const w = await need(ctx, sessions, workers);
  const t = await tasks.find(id);
  if (!t || t.userId !== w.userId || !canAct(w, t)) throw new FieldError("not found", 404);
  if (!inActionWindow(w, t.date, fieldToday())) throw new FieldError("outside the days you can edit", 409);
  return { w, t };
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
      throw new FieldError("wrong cell or PIN", 401);
    }
    await this.sessions.clearMisses(w.id);
    const s = await this.sessions.create(w.id, w.userId);
    ctx.header("Set-Cookie", WorkerSessionStore.cookie(s.token));
    return publicWorker(w, this.users);
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
    return w ? publicWorker(w, this.users) : null;
  }

  /** REQ-141: only this worker's tasks, no prices; a foreman asking ?all=1 gets every crew, theirs first */
  @Get("tasks")
  async list(@Context() ctx: ExecutionContext, @Query("date") date?: string, @Query("all") all?: string) {
    const w = await need(ctx, this.sessions, this.workers);
    const d = date ?? fieldToday();
    if (!isValidDate(d)) throw new FieldError("date must be YYYY-MM-DD");
    const rows = (await this.day.generate(w.userId, d)).all; // REQ-170: any day materializes on read
    const everyone = all === "1" && w.role === "foreman";
    const n = await this.views.names(w.userId);
    return rows
      .filter((t) => everyone || t.workerId === w.id)
      .sort((a, b) => (a.workerId === w.id ? 0 : 1) - (b.workerId === w.id ? 0 : 1))
      .map((t) => this.views.workerTask(t, n));
  }

  /** the account's task types, for the "add a service" picker */
  @Get("task-types")
  async taskTypes(@Context() ctx: ExecutionContext) {
    const w = await need(ctx, this.sessions, this.workers);
    return (await this.types.listByUser(w.userId)).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** REQ-141: add a service to a visit the worker has that day (a removed one is restored) */
  @Post("visits/:subscriptionId/services")
  async addService(@Context() ctx: ExecutionContext, @Param("subscriptionId") subscriptionId: string, @Body() raw: unknown) {
    const w = await need(ctx, this.sessions, this.workers);
    const b = body(raw);
    const s = await this.subs.find(subscriptionId);
    if (!s || s.userId !== w.userId) throw new FieldError("not found", 404);
    const date = str(b.date) ?? fieldToday();
    if (!isValidDate(date)) throw new FieldError("date must be YYYY-MM-DD");
    if (!inActionWindow(w, date, fieldToday())) throw new FieldError("outside the days you can edit", 409);
    const dayTasks = await this.tasks.listByDay(w.userId, date);
    if (!dayTasks.some((t) => t.subscriptionId === s.id && canAct(w, t))) throw new FieldError("not found", 404);
    let taskTypeId = str(b.taskTypeId);
    const types = await this.types.listByUser(w.userId);
    if (!taskTypeId && str(b.taskTypeName)) {
      const r = findOrCreateTaskType(types, str(b.taskTypeName)!, w.userId, newId);
      if (r.created) await this.types.put(r.type);
      taskTypeId = r.type.id;
      types.push(r.type);
    }
    if (!taskTypeId || !types.some((x) => x.id === taskTypeId)) throw new FieldError("taskTypeId required");
    const r = addService({ subscription: s, taskTypeId, date, existing: dayTasks, newId, addedByName: w.name });
    if (!r.ok) throw new FieldError(r.reason === "invoiced" ? "visit already invoiced" : r.reason, r.reason === "no_visit" ? 404 : 409);
    await this.tasks.put(r.task);
    const n = await this.views.names(w.userId);
    return ctx.json(this.views.workerTask(r.task, n), r.restored ? 200 : 201);
  }

  @Post("tasks/:id/complete")
  async complete(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() raw: unknown) {
    const { w, t } = await actionable(ctx, id, this.sessions, this.workers, this.tasks);
    if (t.invoiceId) throw new FieldError("already invoiced", 409);
    const b = body(raw);
    if (tooLong(b.note, CAP.note)) throw new FieldError(`note too long (max ${CAP.note})`);
    t.status = "complete";
    t.completedAt = new Date().toISOString();
    if (typeof b.note === "string") t.note = b.note.trim() || undefined;
    await this.tasks.put(t);
    return this.views.workerTask(t, await this.views.names(w.userId));
  }

  @Post("tasks/:id/uncomplete")
  async uncomplete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const { w, t } = await actionable(ctx, id, this.sessions, this.workers, this.tasks);
    if (t.invoiceId) throw new FieldError("already invoiced", 409);
    if (t.status === "complete") {
      t.status = "assigned";
      delete t.completedAt;
      await this.tasks.put(t);
    }
    return this.views.workerTask(t, await this.views.names(w.userId));
  }

  /** not done — never invoiced */
  @Post("tasks/:id/skip")
  async skip(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const { w, t } = await actionable(ctx, id, this.sessions, this.workers, this.tasks);
    if (t.invoiceId) throw new FieldError("already invoiced", 409);
    t.status = "skipped";
    delete t.completedAt;
    await this.tasks.put(t);
    await this.notices.customerCanceled(w.userId, t); // REQ-171: the customer hears, once
    return this.views.workerTask(t, await this.views.names(w.userId));
  }

  @Post("tasks/:id/restore")
  async restore(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const { w, t } = await actionable(ctx, id, this.sessions, this.workers, this.tasks);
    if (t.status === "skipped") {
      t.status = "assigned";
      await this.tasks.put(t);
    }
    return this.views.workerTask(t, await this.views.names(w.userId));
  }

  /** tomorrow, with a note: the original is marked, a copy holds tomorrow's slot */
  @Post("tasks/:id/defer")
  async defer(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() raw: unknown) {
    const { w, t } = await actionable(ctx, id, this.sessions, this.workers, this.tasks);
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
    return this.views.workerTask(t, await this.views.names(w.userId));
  }

  /** the note is the visit's — on every task of that visit that is not invoiced */
  @Post("tasks/:id/note")
  async note(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() raw: unknown) {
    const { w, t } = await actionable(ctx, id, this.sessions, this.workers, this.tasks);
    if (t.invoiceId) throw new FieldError("already invoiced", 409);
    const b = body(raw);
    if (tooLong(b.note, CAP.note)) throw new FieldError(`note too long (max ${CAP.note})`);
    const note = String(b.note ?? "").trim() || undefined;
    const visit = (await this.tasks.listByDay(w.userId, t.date)).filter((x) => x.subscriptionId === t.subscriptionId && !x.invoiceId);
    await this.tasks.putMany(visit.map((x) => ({ ...x, note })));
    t.note = note;
    return this.views.workerTask(t, await this.views.names(w.userId));
  }

}
