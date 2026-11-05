/**
 * REQ-138..142 — the office's API, behind the owner's session:
 *   /field/workers, /field/task-types, /field/subscriptions, /field/regions,
 *   /field/tasks, /field/batches. Every record is the calling account's.
 */
import {
  Body,
  Context,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import {
  accountLabel,
  realName,
} from "@users/domain/business/account-admins/mod.ts";
import { appUrl } from "@users/domain/business/app-url/mod.ts";
import { secretAllows } from "@users/domain/business/shared-secret/mod.ts";
import type { User } from "@users/dto/user.ts";
import { workerWelcome } from "@field/domain/business/worker-welcome/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  BatchStore,
  FieldTaskStore,
  FieldWorkerStore,
  RegionStore,
  SubscriptionStore,
  TaskTypeStore,
} from "@field/domain/data/field-stores/mod.ts";
import { FieldGeocoder } from "@field/domain/data/geocoder/mod.ts";
import {
  FieldZones,
  newId,
} from "@field/domain/coordinators/field-zones/mod.ts";
import { FieldDay } from "@field/domain/coordinators/field-day/mod.ts";
import { FieldBatches } from "@field/domain/coordinators/field-batches/mod.ts";
import {
  FieldViews,
  safeWorker,
} from "@field/domain/coordinators/field-views/mod.ts";
import {
  findOrCreateTaskType,
  searchTaskTypes,
} from "@field/domain/business/tasks/mod.ts";
import {
  fieldToday,
  isValidDate,
} from "@field/domain/business/schedule/mod.ts";
import {
  type Cadence,
  CADENCES,
  CAP,
  digitsOf,
  FieldError,
  type FieldWorker,
  str,
  type Subscription,
  type SubscriptionItem,
  type TaskType,
  tooLong,
} from "@field/dto/field.ts";

type Body_ = Record<string, unknown>;
const body = (
  b: unknown,
): Body_ => (b && typeof b === "object" ? b as Body_ : {});

/** what the welcome text and the owner tool need from the controller */
interface WelcomeDeps {
  users: UserStore;
  identities: BusinessIdentityStore;
  sms: SmsService;
}

/** REQ-151 — the welcome text to one worker, in the owner's language; false (and a log line) when it could not go out */
async function welcomeWorker(
  d: WelcomeDeps,
  user: User,
  w: FieldWorker,
): Promise<boolean> {
  const lang = user.language === "es" ? "es" : "en";
  const identity = await d.identities.get(user.id);
  const who = realName(user.name);
  const biz = identity?.businessName?.trim();
  const owner = who && biz ? `${who} (${biz})` : accountLabel(user, biz);
  try {
    const sent = await d.sms.send({
      to: normalizePhone(w.phoneNumber),
      body: workerWelcome(lang, {
        owner,
        url: `${appUrl()}/worker`,
        pin: w.pin,
      }),
    });
    if (!sent.ok) {
      console.error(
        `[field/workers] welcome text to ${w.phoneNumber} failed: ${sent.reason}`,
      );
    }
    return sent.ok;
  } catch (err) {
    console.error(
      `[field/workers] welcome text to ${w.phoneNumber} failed: ${
        (err as Error).message
      }`,
    );
    return false;
  }
}

/** REQ-154 — the account the tool names: by phone, or by a business name matching exactly one account */
async function findOwner(
  d: WelcomeDeps,
  b: Body_,
): Promise<
  { user: User; business: string | undefined } | {
    error: string;
    matches?: { phone: string; business: string }[];
  }
> {
  if (typeof b.phoneNumber === "string" && b.phoneNumber.trim()) {
    let phone: string;
    try {
      phone = normalizePhone(b.phoneNumber);
    } catch {
      return { error: "bad_phone" };
    }
    const user = await d.users.findByPhone(phone);
    if (!user) return { error: "no_such_user" };
    return {
      user,
      business: (await d.identities.get(user.id))?.businessName?.trim(),
    };
  }
  const needle = typeof b.business === "string"
    ? b.business.trim().toLowerCase()
    : "";
  if (!needle) return { error: "owner_required" };
  const matches: { user: User; business: string }[] = [];
  for (const user of await d.users.searchByPhone("", 100_000)) {
    const business = (await d.identities.get(user.id))?.businessName?.trim();
    if (business && business.toLowerCase().includes(needle)) {
      matches.push({ user, business });
    }
  }
  if (matches.length === 0) return { error: "no_such_business" };
  if (matches.length > 1) {
    return {
      error: "ambiguous_business",
      matches: matches.map((m) => ({
        phone: m.user.phoneNumber,
        business: m.business,
      })),
    };
  }
  return matches[0];
}

/** the controller's stores as the helpers take them (private members are not structurally assignable) */
function deps(
  c: { users: UserStore; identities: BusinessIdentityStore; sms: SmsService },
): WelcomeDeps {
  return { users: c.users, identities: c.identities, sms: c.sms };
}

@Controller("field/workers")
export class FieldWorkersController {
  constructor(
    private workers: FieldWorkerStore,
    private regions: RegionStore,
    readonly users: UserStore,
    private sessions: SessionStore,
    readonly identities: BusinessIdentityStore,
    readonly sms: SmsService,
  ) {}

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return (await this.workers.listByUser(user.id)).map(safeWorker);
  }

  /** REQ-138: name, cell (the login name, unique), a 4-digit PIN, an optional foreman role; REQ-151: the worker is texted the link and the PIN */
  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const name = str(b.name),
      pin = String(b.pin ?? "").trim(),
      phone = digitsOf(b.phoneNumber);
    if (!name) throw new FieldError("name required");
    if (name.length > CAP.text) throw new FieldError("name too long");
    if (phone.length < 10) {
      throw new FieldError("phoneNumber required (10 digits)");
    }
    if (!/^\d{4}$/.test(pin)) throw new FieldError("pin must be 4 digits");
    if (await this.workers.findByPhone(phone)) {
      throw new FieldError("a worker with that cell already exists", 409);
    }
    const now = new Date().toISOString();
    const w: FieldWorker = {
      id: newId(),
      userId: user.id,
      name,
      phoneNumber: phone,
      pin,
      createdAt: now,
      updatedAt: now,
    };
    if (b.role === "foreman") w.role = "foreman";
    await this.workers.put(w);
    // REQ-151 — the welcome text: who added them, the /worker address, the PIN; its failure is logged, never thrown
    const texted = await welcomeWorker(deps(this), user, w);
    return ctx.json({ ...safeWorker(w), texted }, 201);
  }

  /**
   * REQ-154 — OWNER TOOL: text every existing worker of an account their sign-in link and PIN (the
   * REQ-151 text) — for the accounts that had workers before the text existed. Gated exactly as
   * `/me/reset-by-phone` (`x-reset-secret` against `RESET_SECRET`, never a session). The owner by
   * `phoneNumber` or by `business` (a case-insensitive match on the business name, one account only);
   * `dryRun: true` lists the workers and texts nothing. `deno task welcome-workers` calls it on prod.
   */
  @Post("welcome-by-owner")
  async welcomeByOwner(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    if (
      !secretAllows(
        Deno.env.get("RESET_SECRET"),
        ctx.req.header("x-reset-secret"),
      )
    ) {
      return { ok: false as const, error: "forbidden" };
    }
    const b = body(raw);
    const found = await findOwner(deps(this), b);
    if ("error" in found) return { ok: false as const, ...found };
    const { user, business } = found;
    const dryRun = b.dryRun === true;
    const workers = (await this.workers.listByUser(user.id)).sort((x, y) =>
      x.createdAt.localeCompare(y.createdAt)
    );
    const out: { id: string; name: string; phone: string; texted?: boolean }[] =
      [];
    for (const w of workers) {
      const row: { id: string; name: string; phone: string; texted?: boolean } =
        { id: w.id, name: w.name, phone: w.phoneNumber };
      if (!dryRun) row.texted = await welcomeWorker(deps(this), user, w);
      out.push(row);
    }
    return {
      ok: true as const,
      dryRun,
      owner: {
        phone: user.phoneNumber,
        business,
        name: realName(user.name),
        language: user.language === "es" ? "es" : "en",
      },
      workers: out,
    };
  }

  @Delete(":id")
  async remove(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const w = await this.workers.getOwned(id, user.id);
    const zones = (await this.regions.listByUser(user.id)).filter((r) =>
      r.workerId === id
    ).map((r) => r.name);
    if (zones.length) {
      throw new FieldError(
        "worker still covers zones — reassign them first",
        409,
        { zones },
      );
    }
    await this.workers.delete(w);
    return { ok: true };
  }
}

@Controller("field/task-types")
export class FieldTaskTypesController {
  constructor(
    private types: TaskTypeStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  /** REQ-139: case- and accent-insensitive search */
  @Get()
  async search(@Context() ctx: ExecutionContext, @Query("q") q?: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return searchTaskTypes(await this.types.listByUser(user.id), q ?? "").sort((
      a,
      b,
    ) => a.name.localeCompare(b.name));
  }
}

@Controller("field/subscriptions")
export class FieldSubscriptionsController {
  constructor(
    private subs: SubscriptionStore,
    private types: TaskTypeStore,
    private regions: RegionStore,
    private customers: CustomerStore,
    private geocoder: FieldGeocoder,
    private zones: FieldZones,
    private day: FieldDay,
    private views: FieldViews,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const [subs, n] = await Promise.all([
      this.subs.listByUser(user.id),
      this.views.names(user.id),
    ]);
    return subs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((
      s,
    ) => this.views.subscription(s, n));
  }

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const customerId = str(b.customerId);
    if (!customerId) throw new FieldError("customerId required");
    await this.customers.getOwned(customerId, user.id); // 404 / 403 from the customer store itself
    const address = str(b.address);
    if (!address) throw new FieldError("address required");
    if (address.length > CAP.text) throw new FieldError("address too long");
    const items = await parseItems(this.types, user.id, b.items);
    if (!items.length) {
      throw new FieldError("at least one task type with a price");
    }
    const sched = parseSchedule(b, { cadence: "weekly" });
    if (b.startDate !== undefined && !isValidDate(b.startDate)) {
      throw new FieldError("startDate must be YYYY-MM-DD");
    }
    const { lat, lng } = await this.geocoder.geocode(address); // once, for this address only
    const now = new Date().toISOString();
    const s: Subscription = {
      id: newId(),
      userId: user.id,
      customerId,
      address,
      lat,
      lng,
      items,
      ...sched,
      startDate: isValidDate(b.startDate) ? b.startDate : fieldToday(),
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await this.subs.put(s);
    const { subs } = await this.zones.regroup(user.id);
    const n = await this.views.names(user.id);
    return ctx.json(
      this.views.subscription(subs.find((x) => x.id === s.id) ?? s, n),
      201,
    );
  }

  @Put(":id")
  async update(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const s = await this.subs.getOwned(id, user.id);
    const b = body(raw);
    const sched = parseSchedule(b, s);
    if (b.startDate !== undefined && !isValidDate(b.startDate)) {
      throw new FieldError("startDate must be YYYY-MM-DD");
    }
    if (typeof b.active === "boolean") {
      s.active = b.active;
      if (!s.active) {
        await this.day.dropOpen(
          user.id,
          fieldToday(),
          (t) => t.subscriptionId === s.id,
        );
      }
    }
    if (b.items !== undefined) {
      const items = await parseItems(this.types, user.id, b.items);
      if (!items.length) {
        throw new FieldError("at least one task type with a price");
      }
      s.items = items;
    }
    Object.assign(s, sched);
    if (isValidDate(b.startDate)) s.startDate = b.startDate;
    const address = str(b.address);
    if (address && address !== s.address) {
      if (address.length > CAP.text) throw new FieldError("address too long");
      s.address = address;
      Object.assign(s, await this.geocoder.geocode(address)); // only when the address changes
      s.pinned = false;
    }
    s.updatedAt = new Date().toISOString();
    await this.subs.put(s);
    const { subs } = await this.zones.regroup(user.id);
    return this.views.subscription(
      subs.find((x) => x.id === s.id) ?? s,
      await this.views.names(user.id),
    );
  }

  @Delete(":id")
  async remove(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const s = await this.subs.getOwned(id, user.id);
    await this.subs.delete(s);
    await this.day.dropOpen(
      user.id,
      fieldToday(),
      (t) => t.subscriptionId === s.id,
    ); // history stays, open future work goes
    await this.zones.regroup(user.id);
    return { ok: true };
  }

  /** REQ-140: drag-and-drop — the move sticks */
  @Post(":id/move")
  async move(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const s = await this.subs.getOwned(id, user.id);
    const regionId = str(body(raw).regionId);
    const r = regionId ? await this.regions.find(regionId) : null;
    if (!r || r.userId !== user.id) {
      throw new FieldError("region not found", 404);
    }
    if (!s.active) throw new FieldError("subscription is paused", 409);
    if (s.regionId !== r.id) {
      s.regionId = r.id;
      s.pinned = true;
      s.updatedAt = new Date().toISOString();
      await this.subs.put(s);
      await this.zones.regroup(user.id);
    }
    return this.views.subscription(
      await this.subs.get(s.id),
      await this.views.names(user.id),
    );
  }

  /** REQ-140: undo a drag — group by distance again */
  @Post(":id/unpin")
  async unpin(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const s = await this.subs.getOwned(id, user.id);
    s.pinned = false;
    s.updatedAt = new Date().toISOString();
    await this.subs.put(s);
    const { subs } = await this.zones.regroup(user.id);
    return this.views.subscription(
      subs.find((x) => x.id === s.id) ?? s,
      await this.views.names(user.id),
    );
  }
}

/** REQ-139: items by id or by name (found in any case, or created) */
async function parseItems(
  store: TaskTypeStore,
  userId: string,
  raw: unknown,
): Promise<SubscriptionItem[]> {
  if (!Array.isArray(raw)) return [];
  const types = await store.listByUser(userId);
  const created: TaskType[] = [];
  const out: SubscriptionItem[] = [];
  for (const it of raw as Body_[]) {
    const price = Math.round(Number(it.priceCents));
    if (!(price > 0) || price > 10_000_000) continue;
    let taskTypeId = str(it.taskTypeId);
    if (!taskTypeId && str(it.taskTypeName)) {
      const r = findOrCreateTaskType(
        [...types, ...created],
        str(it.taskTypeName)!,
        userId,
        newId,
      );
      if (r.created) created.push(r.type);
      taskTypeId = r.type.id;
    }
    if (
      taskTypeId && [...types, ...created].some((t) => t.id === taskTypeId) &&
      !out.some((o) => o.taskTypeId === taskTypeId)
    ) out.push({ taskTypeId, priceCents: price });
  }
  await store.putMany(created);
  return out;
}

/** REQ-139: cadence / days / intervalWeeks, validated; REQ-157: daysOfMonth (1–31) */
export function parseSchedule(
  b: Body_,
  cur: {
    cadence: Cadence;
    days?: number[];
    intervalWeeks?: number;
    daysOfMonth?: number[];
  },
): Pick<Subscription, "cadence" | "days" | "intervalWeeks" | "daysOfMonth"> {
  let cadence =
    (b.cadence !== undefined ? str(b.cadence) : cur.cadence) as Cadence;
  if (!CADENCES.includes(cadence)) {
    throw new FieldError("cadence must be weekly, biweekly or monthly");
  }
  let days = cur.days,
    intervalWeeks = cur.intervalWeeks,
    daysOfMonth = cur.daysOfMonth;
  if (b.daysOfMonth !== undefined) {
    if (
      !Array.isArray(b.daysOfMonth) ||
      !b.daysOfMonth.every((d) => Number.isInteger(d) && d >= 1 && d <= 31)
    ) throw new FieldError("daysOfMonth must be days 1–31");
    daysOfMonth = [...new Set(b.daysOfMonth as number[])].sort((x, y) => x - y);
    if (!daysOfMonth.length) daysOfMonth = undefined;
  }
  if (b.days !== undefined) {
    if (
      !Array.isArray(b.days) ||
      !b.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    ) throw new FieldError("days must be weekdays 0–6");
    days = [...new Set(b.days as number[])].sort();
    if (!days.length) days = undefined;
  }
  if (b.intervalWeeks !== undefined) {
    const n = Number(b.intervalWeeks);
    if (!Number.isInteger(n) || n < 1 || n > 8) {
      throw new FieldError("intervalWeeks must be 1–8");
    }
    intervalWeeks = n;
    if (cadence !== "monthly") cadence = n === 2 ? "biweekly" : "weekly"; // the label follows the interval
  }
  if (
    b.cadence !== undefined && b.intervalWeeks === undefined &&
    cadence !== "monthly"
  ) intervalWeeks = cadence === "biweekly" ? 2 : 1;
  return { cadence, days, intervalWeeks, daysOfMonth };
}

@Controller("field/regions")
export class FieldRegionsController {
  constructor(
    private regions: RegionStore,
    private workers: FieldWorkerStore,
    private tasks: FieldTaskStore,
    private zones: FieldZones,
    private views: FieldViews,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return (await this.views.regionsWithMembers(user.id)).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  @Post("regroup")
  async regroup(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const { regions } = await this.zones.regroup(user.id);
    return { regions: regions.length };
  }

  /** REQ-140: staff a zone; today's and later open tasks of the zone move to that worker */
  @Put(":id/worker")
  async staff(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const r = await this.regions.getOwned(id, user.id);
    const workerId = str(body(raw).workerId);
    if (workerId) {
      const w = await this.workers.find(workerId);
      if (!w || w.userId !== user.id) {
        throw new FieldError("worker not found", 404);
      }
      r.workerId = workerId;
      const open =
        (await this.tasks.listByRange(user.id, fieldToday(), "9999-12-31"))
          .filter((t) =>
            t.regionId === r.id && t.status === "assigned" && !t.invoiceId &&
            t.workerId !== workerId
          );
      await this.tasks.putMany(open.map((t) => ({ ...t, workerId })));
    } else delete r.workerId;
    await this.regions.put(r);
    return r;
  }
}

@Controller("field/tasks")
export class FieldTasksController {
  constructor(
    private tasks: FieldTaskStore,
    private day: FieldDay,
    private views: FieldViews,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  /** REQ-141: the day's round; today's is generated on first read */
  @Get()
  async list(@Context() ctx: ExecutionContext, @Query("date") date?: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const d = date ?? fieldToday();
    if (!isValidDate(d)) throw new FieldError("date must be YYYY-MM-DD");
    const rows = d === fieldToday()
      ? (await this.day.generate(user.id, d)).all
      : await this.tasks.listByDay(user.id, d);
    const n = await this.views.names(user.id);
    return rows.map((t) => this.views.task(t, n));
  }

  @Post("generate")
  async generate(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const date = str(body(raw).date) ?? fieldToday();
    if (!isValidDate(date)) throw new FieldError("date must be YYYY-MM-DD");
    const r = await this.day.generate(user.id, date);
    const n = await this.views.names(user.id);
    return {
      created: r.created.length,
      tasks: r.created.map((t) => this.views.task(t, n)),
      skipped: r.skipped.map((s) => ({
        subscriptionId: s.id,
        customerName: n.customer(s.customerId),
        address: s.address,
        regionName: n.region(s.regionId)?.name ?? "—",
      })),
    };
  }

  /** REQ-141: the office's note and price */
  @Put(":id")
  async update(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const t = await this.tasks.getOwned(id, user.id);
    const b = body(raw);
    if (tooLong(b.adminNote, CAP.note)) {
      throw new FieldError(`note too long (max ${CAP.note})`);
    }
    if ("adminNote" in b) {
      t.adminNote = String(b.adminNote ?? "").trim() || undefined;
    }
    // REQ-159 — the office marks the task done, or re-opens it
    if ("status" in b) {
      const st = str(b.status);
      if (st !== "complete" && st !== "assigned") {
        throw new FieldError("status must be complete or assigned");
      }
      if (t.invoiceId) {
        throw new FieldError(
          "task is on an invoice — edit the invoice instead",
          409,
        );
      }
      t.status = st;
      if (st === "complete") t.completedAt = new Date().toISOString();
      else delete t.completedAt;
    }
    if ("priceCents" in b) {
      if (t.invoiceId) {
        throw new FieldError(
          "task is on an invoice — edit the invoice instead",
          409,
        );
      }
      const p = Math.round(Number(b.priceCents));
      if (!Number.isFinite(p) || p < 0 || p > 10_000_000) {
        throw new FieldError("bad price");
      }
      t.priceCents = p;
    }
    await this.tasks.put(t);
    return this.views.task(t, await this.views.names(user.id));
  }
}

@Controller("field/batches")
export class FieldBatchesController {
  constructor(
    private batches: FieldBatches,
    private store: BatchStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.batches.list(user.id);
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.batches.get(user.id, id);
  }

  /** REQ-142: completed, un-invoiced tasks in the range → one draft per customer */
  @Post("pull")
  async pull(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const from = str(b.from), to = str(b.to);
    if (!isValidDate(from) || !isValidDate(to) || from > to) {
      throw new FieldError("from/to must be YYYY-MM-DD, from ≤ to");
    }
    const r = await this.batches.pull(
      user.id,
      from,
      to,
      user.language === "es" ? "es" : "en",
    );
    return ctx.json(r, r.invoices.length ? 201 : 200);
  }

  /** REQ-142: send the checked drafts; each customer gets theirs */
  @Post(":id/send")
  async send(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    if (!Array.isArray(b.invoiceIds) || !b.invoiceIds.length) {
      throw new FieldError(
        "invoiceIds: a non-empty list of the invoices to send",
      );
    }
    return await this.batches.send(
      user.id,
      id,
      b.invoiceIds.map(String),
      b.allowZero === true,
    );
  }
}
