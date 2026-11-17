/**
 * REQ-192 — the timeclock's API.
 *   /timeclock/worker/* — the worker's clock, behind the worker's own pm_worker cookie (REQ-138)
 *   /timeclock/*        — the office's timesheet, behind the owner's session
 * Every record is the calling account's.
 */
import {
  Body,
  Context,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { FieldWorkerStore } from "@field/domain/data/field-stores/mod.ts";
import { WorkerSessionStore } from "@field/domain/data/worker-session-store/mod.ts";
import { newId } from "@field/domain/coordinators/field-zones/mod.ts";
import type { FieldWorker } from "@field/dto/field.ts";
import {
  PunchStore,
  punchType,
} from "@timeclock/domain/data/punch-store/mod.ts";
import {
  checkFlip,
  checkManualPunch,
  dayStartIn,
  deriveShifts,
  lastStatus,
  type PunchLike,
  sumShifts,
  timeclockTz,
  weekBoundsIn,
} from "@timeclock/domain/business/shifts/mod.ts";
import {
  type Punch,
  type PunchType,
  type Report,
  type StatusView,
  TimeclockError,
} from "@timeclock/dto/timeclock.ts";

type Body_ = Record<string, unknown>;
const body = (
  b: unknown,
): Body_ => (b && typeof b === "object" ? b as Body_ : {});
const nowIso = () => new Date().toISOString();
const REASON_MAX = 300;

function parseIso(v: unknown, what: string): string {
  const t = typeof v === "string" && v.trim() ? new Date(v).getTime() : NaN;
  if (Number.isNaN(t)) {
    throw new TimeclockError(
      "invalid_time",
      400,
      `${what} must be an ISO-8601 timestamp`,
    );
  }
  return new Date(t).toISOString();
}
function requireReason(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) {
    throw new TimeclockError("reason_required", 400, "a reason is required");
  }
  if (s.length > REASON_MAX) {
    throw new TimeclockError(
      "reason_too_long",
      400,
      `a reason is at most ${REASON_MAX} characters`,
    );
  }
  return s;
}
const like = (p: Punch): PunchLike => ({ id: p.id, type: p.type, at: p.at });

/** the worker's week: the browser's own bounds when it sent them, the account's zone otherwise */
function windowOf(
  q: { from?: unknown; to?: unknown; today?: unknown },
): { from: string; to: string; dayStart: string } {
  const tz = timeclockTz();
  const sent = typeof q.from === "string" && q.from &&
    typeof q.to === "string" && q.to;
  const week = weekBoundsIn(tz);
  const from = sent ? parseIso(q.from, "from") : week.from;
  const to = sent ? parseIso(q.to, "to") : week.to;
  if (from >= to) {
    throw new TimeclockError("invalid_range", 400, "from must be before to");
  }
  const dayStart = typeof q.today === "string" && q.today
    ? parseIso(q.today, "today")
    : dayStartIn(tz);
  return { from, to, dayStart };
}

function statusOf(
  w: FieldWorker,
  active: Punch[],
  win: { from: string; to: string; dayStart: string },
): StatusView {
  const asOf = nowIso();
  const { status, since } = lastStatus(active);
  const shifts = deriveShifts(active.map(like), asOf).shifts.filter((s) =>
    s.start >= win.from && s.start < win.to
  );
  return {
    worker: { id: w.id, name: w.name },
    status,
    since,
    shifts,
    weekTotalMs: sumShifts(shifts),
    todayTotalMs: sumShifts(shifts.filter((s) => s.start >= win.dayStart)),
    asOf,
    from: win.from,
    to: win.to,
  };
}

async function needWorker(
  ctx: ExecutionContext,
  sessions: WorkerSessionStore,
  workers: FieldWorkerStore,
): Promise<FieldWorker> {
  const token = WorkerSessionStore.tokenFrom(ctx.req.header("cookie"));
  const s = token ? await sessions.get(token) : null;
  const w = s ? await workers.find(s.workerId) : null;
  if (!w || !s || w.userId !== s.userId) {
    throw new TimeclockError("not_logged_in", 401, "not logged in");
  }
  return w;
}

async function ownWorker(
  workers: FieldWorkerStore,
  userId: string,
  id: unknown,
): Promise<FieldWorker> {
  const w = typeof id === "string" && id ? await workers.find(id) : null;
  if (!w || w.userId !== userId) {
    throw new TimeclockError("worker_not_found", 404, "worker not found");
  }
  return w;
}

function officeWindow(
  fromQ?: string,
  toQ?: string,
): { from: string; to: string } {
  const week = weekBoundsIn(timeclockTz());
  const from = fromQ ? parseIso(fromQ, "from") : week.from;
  const to = toQ ? parseIso(toQ, "to") : week.to;
  if (from >= to) {
    throw new TimeclockError("invalid_range", 400, "from must be before to");
  }
  return { from, to };
}

@Controller("timeclock/worker")
export class TimeclockWorkerController {
  constructor(
    private workers: FieldWorkerStore,
    private sessions: WorkerSessionStore,
    private punches: PunchStore,
  ) {}

  /** the screen's boot call: state, this week's shifts, both totals */
  @Get("status")
  async status(
    @Context() ctx: ExecutionContext,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("today") today?: string,
  ): Promise<StatusView> {
    const w = await needWorker(ctx, this.sessions, this.workers);
    const win = windowOf({ from, to, today });
    return statusOf(w, await this.punches.listByWorker(w.userId, w.id), win);
  }

  /** the one button: no type flips the state; a type that would not flip it is refused */
  @Post("punch")
  async punch(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const w = await needWorker(ctx, this.sessions, this.workers);
    const b = body(raw);
    const seen = await this.punches.last(w.userId, w.id);
    const last = seen.value;
    const type: PunchType = punchType(b.type) ??
      (last?.type === "in" ? "out" : "in");
    const rejection = checkFlip(last, type);
    if (rejection === "already_in") {
      throw new TimeclockError(
        rejection,
        409,
        `${w.name} is already clocked in`,
      );
    }
    if (rejection === "not_in") {
      throw new TimeclockError(rejection, 409, `${w.name} is not clocked in`);
    }
    // strictly after the last punch: two taps in one millisecond must still order in → out
    const at = last && last.at >= nowIso()
      ? new Date(new Date(last.at).getTime() + 1).toISOString()
      : nowIso();
    const p: Punch = {
      id: newId(),
      userId: w.userId,
      workerId: w.id,
      type,
      at,
      source: "worker",
      reason: null,
      createdAt: at,
      voided: null,
    };
    if (!(await this.punches.appendIfLast(p, seen))) {
      throw new TimeclockError(
        "retry",
        409,
        "another tap got there first — try again",
      );
    }
    const win = windowOf({ from: b.from, to: b.to, today: b.today });
    return ctx.json({
      punch: p,
      status: statusOf(w, await this.punches.listByWorker(w.userId, w.id), win),
    }, 201);
  }
}

@Controller("timeclock")
export class TimeclockController {
  constructor(
    private workers: FieldWorkerStore,
    private punches: PunchStore,
    readonly users: UserStore,
    private sessions: SessionStore,
  ) {}

  /** the week: each worker's shifts, total and anomalies; a worker with nothing in the window still appears */
  @Get("report")
  async report(
    @Context() ctx: ExecutionContext,
    @Query("from") fromQ?: string,
    @Query("to") toQ?: string,
    @Query("workerId") workerId?: string,
  ): Promise<Report> {
    const user = await requireUser(ctx, this.sessions, this.users);
    const { from, to } = officeWindow(fromQ, toQ);
    const asOf = nowIso();
    const workers = workerId
      ? [await ownWorker(this.workers, user.id, workerId)]
      : (await this.workers.listByUser(user.id)).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    const rows: Report["workers"] = [];
    for (const w of workers) {
      const active = await this.punches.listByWorker(user.id, w.id, true);
      const d = deriveShifts(active.map(like), asOf);
      const shifts = d.shifts.filter((s) => s.start >= from && s.start < to);
      const anomalies = d.anomalies.filter((a) => a.at >= from && a.at < to);
      rows.push({
        worker: { id: w.id, name: w.name },
        shifts,
        totalMs: sumShifts(shifts),
        anomalies,
      });
    }
    return { from, to, asOf, workers: rows };
  }

  /** the log, newest first, voided punches included */
  @Get("punches")
  async list(
    @Context() ctx: ExecutionContext,
    @Query("from") fromQ?: string,
    @Query("to") toQ?: string,
    @Query("workerId") workerId?: string,
  ): Promise<Punch[]> {
    const user = await requireUser(ctx, this.sessions, this.users);
    const { from, to } = officeWindow(fromQ, toQ);
    if (workerId) await ownWorker(this.workers, user.id, workerId);
    return (await this.punches.listByUserRange(
      user.id,
      from,
      to,
      workerId || undefined,
    )).reverse();
  }

  /** a manual punch: worker, in/out, a time, a reason; it must alternate with its neighbours */
  @Post("punches")
  async manual(
    @Context() ctx: ExecutionContext,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const w = await ownWorker(this.workers, user.id, b.workerId);
    const type = punchType(b.type);
    if (!type) {
      throw new TimeclockError(
        "invalid_type",
        400,
        'type must be "in" or "out"',
      );
    }
    const at = parseIso(b.at, "at");
    if (at > nowIso()) {
      throw new TimeclockError(
        "in_the_future",
        400,
        "a punch cannot be in the future",
      );
    }
    const reason = requireReason(b.reason);
    const active = await this.punches.listByWorker(user.id, w.id, true);
    if (active.some((p) => p.at === at)) {
      throw new TimeclockError(
        "punch_exists_at_time",
        409,
        "a punch already exists at that time",
      );
    }
    const prev = active.filter((p) => p.at < at).at(-1) ?? null;
    const next = active.find((p) => p.at > at) ?? null;
    const rejection = checkManualPunch(
      prev && like(prev),
      next && like(next),
      type,
    );
    if (rejection) {
      const why = {
        same_as_prev: `the previous punch is already an "${type}"`,
        same_as_next: `the next punch is already an "${type}"`,
        out_without_in: 'an "out" needs an "in" before it',
      }[rejection];
      throw new TimeclockError(rejection, 409, why);
    }
    const now = nowIso();
    const p: Punch = {
      id: newId(),
      userId: user.id,
      workerId: w.id,
      type,
      at,
      source: "manual",
      reason,
      createdAt: now,
      voided: null,
    };
    await this.punches.put(p);
    await this.punches.recomputeLast(user.id, w.id);
    return ctx.json(p, 201);
  }

  /**
   * a whole forgotten shift in one go (an in and an out): a single manual punch could never open a
   * pair before an existing one — the rule of alternation refuses an "in" whose next punch is an
   * "in". The pair must sit in a gap: no punch inside it, an "out" (or nothing) before, an "in"
   * (or nothing) after.
   */
  @Post("shifts")
  async shift(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const w = await ownWorker(this.workers, user.id, b.workerId);
    const start = parseIso(b.start, "start"), end = parseIso(b.end, "end");
    if (start >= end) {
      throw new TimeclockError(
        "invalid_range",
        400,
        "start must be before end",
      );
    }
    if (end > nowIso()) {
      throw new TimeclockError(
        "in_the_future",
        400,
        "a shift cannot end in the future",
      );
    }
    const reason = requireReason(b.reason);
    const active = await this.punches.listByWorker(user.id, w.id, true);
    if (active.some((p) => p.at >= start && p.at <= end)) {
      throw new TimeclockError(
        "overlaps",
        409,
        "a punch already sits inside that shift",
      );
    }
    const prev = active.filter((p) => p.at < start).at(-1) ?? null;
    const next = active.find((p) => p.at > end) ?? null;
    if (prev?.type === "in") {
      throw new TimeclockError(
        "same_as_prev",
        409,
        'the punch before the shift is an "in" without an out',
      );
    }
    if (next?.type === "out") {
      throw new TimeclockError(
        "same_as_next",
        409,
        'the punch after the shift is an "out" without an in',
      );
    }
    const now = nowIso();
    const pin: Punch = {
      id: newId(),
      userId: user.id,
      workerId: w.id,
      type: "in",
      at: start,
      source: "manual",
      reason,
      createdAt: now,
      voided: null,
    };
    const pout: Punch = {
      id: newId(),
      userId: user.id,
      workerId: w.id,
      type: "out",
      at: end,
      source: "manual",
      reason,
      createdAt: now,
      voided: null,
    };
    await this.punches.putMany([pin, pout]);
    await this.punches.recomputeLast(user.id, w.id);
    return ctx.json({ in: pin, out: pout }, 201);
  }

  /** void = a correction appended to the punch; the punch itself is never deleted */
  @Post("punches/:id/void")
  async void(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const p = await this.punches.find(id);
    if (!p || p.userId !== user.id) {
      throw new TimeclockError("punch_not_found", 404, "punch not found");
    }
    const reason = requireReason(body(raw).reason);
    if (p.voided) {
      throw new TimeclockError(
        "already_voided",
        409,
        "the punch is already voided",
      );
    }
    const voided: Punch = { ...p, voided: { at: nowIso(), reason } };
    await this.punches.put(voided);
    await this.punches.recomputeLast(user.id, p.workerId);
    return ctx.json(voided, 201);
  }
}
