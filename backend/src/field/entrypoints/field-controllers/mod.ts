/**
 * REQ-138..142 — the office's API, behind the owner's session:
 *   /field/workers, /field/task-types, /field/subscriptions, /field/regions,
 *   /field/tasks, /field/batches. Every record is the calling account's.
 */
import { parseNetDays } from "@field/domain/business/invoice-terms/mod.ts";
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
import {
  newWorkerLang,
  parseLang,
  workerLang,
  workerSignInUrl,
  workerWelcome,
} from "@field/domain/business/worker-welcome/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  AbsenceStore,
  BatchStore,
  ChecklistStore,
  CrewStore,
  FieldTaskStore,
  FieldWorkerStore,
  RegionStore,
  SubscriptionStore,
  TaskTypeStore,
} from "@field/domain/data/field-stores/mod.ts";
import {
  claimedBy,
  crewMembers,
  crewNameTaken,
  leadOf,
  MAX_DEFER_DAYS,
} from "@field/domain/business/crews/mod.ts"; // REQ-840..842
import {
  checklistNameTaken,
  checklistUsage,
  hasServices,
} from "@field/domain/business/checklist/mod.ts"; // REQ-811
import { FieldGeocoder } from "@field/domain/data/geocoder/mod.ts";
import {
  FieldZones,
  newId,
} from "@field/domain/coordinators/field-zones/mod.ts";
import { FieldDay } from "@field/domain/coordinators/field-day/mod.ts";
import { FieldMapCenter } from "@field/domain/coordinators/field-map-center/mod.ts";
import { FieldBatches } from "@field/domain/coordinators/field-batches/mod.ts";
import { FieldNotices } from "@field/domain/coordinators/field-notices/mod.ts";
import { FieldActivity } from "@field/domain/coordinators/field-activity/mod.ts";
import {
  FieldViews,
  safeWorker,
} from "@field/domain/coordinators/field-views/mod.ts";
import {
  findOrCreateTaskType,
  fold,
  liveTypes,
  officeService,
  oneOffTask,
  searchTaskTypes,
  taskTypeNameTaken,
  taskTypeUsage,
} from "@field/domain/business/tasks/mod.ts";
import {
  fieldToday,
  isValidDate,
  shiftDate,
} from "@field/domain/business/schedule/mod.ts";
import {
  crewList,
  ledBy,
  spanFrom,
} from "@field/domain/business/job-span/mod.ts";
import {
  type Absence,
  type AbsenceDisposition,
  type Cadence,
  CADENCES,
  CAP,
  type Checklist,
  type Crew,
  digitsOf,
  DISPOSITIONS,
  FieldError,
  type FieldTask,
  type FieldWorker,
  str,
  type Subscription,
  type SubscriptionItem,
  type TaskType,
  tooLong,
} from "@field/dto/field.ts";

/** the account's crew a body names, or 404 */
async function ownCrew(
  crews: CrewStore,
  userId: string,
  id: string,
): Promise<Crew> {
  const c = await crews.find(id);
  if (!c || c.userId !== userId) {
    throw new FieldError("crew not found", 404, undefined, "crew_not_found");
  }
  return c;
}

/** a list of ids from a body, or null when it is not one */
function idList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string" || !x.trim()) return null;
    if (!out.includes(x.trim())) out.push(x.trim());
  }
  return out;
}

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

/**
 * REQ-151 — the welcome text to one worker, in the owner's language; `ok` false (and a log line) when it
 * could not go out. REQ-601 — also the sign-in address and the exact text, so the owner can share them.
 */
async function welcomeWorker(
  d: WelcomeDeps,
  user: User,
  w: FieldWorker,
  override?: "en" | "es",
): Promise<{ ok: boolean; url: string; body: string }> {
  const lang = override ?? workerLang(w, user); // REQ-155 — the worker's language
  const identity = await d.identities.get(user.id);
  const who = realName(user.name);
  const biz = identity?.businessName?.trim();
  const owner = who && biz ? `${who} (${biz})` : accountLabel(user, biz);
  const url = workerSignInUrl(appUrl(), lang); // REQ-285 — the screen opens in it
  const body = workerWelcome(lang, { owner, url, pin: w.pin });
  try {
    const sent = await d.sms.send({ to: normalizePhone(w.phoneNumber), body });
    if (!sent.ok) {
      console.error(
        `[field/workers] welcome text to ${w.phoneNumber} failed: ${sent.reason}`,
      );
    }
    return { ok: sent.ok, url, body };
  } catch (err) {
    console.error(
      `[field/workers] welcome text to ${w.phoneNumber} failed: ${
        (err as Error).message
      }`,
    );
    return { ok: false, url, body };
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
    private crews: CrewStore, // REQ-840
    private day: FieldDay,
    private views: FieldViews,
  ) {}

  /** REQ-840: each row with its crew's name */
  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const [workers, n] = await Promise.all([
      this.workers.listByUser(user.id),
      this.views.names(user.id),
    ]);
    return workers.map((w) => this.views.worker(w, n));
  }

  /** REQ-138: name, cell (the login name, unique), a 4-digit PIN, an optional foreman role; REQ-151: the worker is texted the link and the PIN */
  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const name = str(b.name),
      pin = String(b.pin ?? "").trim(),
      phone = digitsOf(b.phoneNumber);
    // REQ-421 (demo m42) — every refusal carries a stable `code` the page words in en/es
    if (!name) {
      throw new FieldError("name required", 400, undefined, "name_required");
    }
    if (name.length > CAP.text) {
      throw new FieldError("name too long", 400, undefined, "name_too_long");
    }
    if (phone.length < 10) {
      throw new FieldError(
        "phoneNumber required (10 digits)",
        400,
        undefined,
        "phone_10_digits",
      );
    }
    if (!/^\d{4}$/.test(pin)) {
      throw new FieldError(
        "pin must be 4 digits",
        400,
        undefined,
        "pin_4_digits",
      );
    }
    // the cell is the worker's login name, unique across every account — so the refusal
    // says only that the number is in use, never whose crew holds it
    if (await this.workers.findByPhone(phone)) {
      throw new FieldError(
        "that cell is already in use by a worker",
        409,
        undefined,
        "worker_phone_taken",
      );
    }
    const language = parseLang(b.language);
    if (language === null) {
      throw new FieldError(
        "language must be en or es",
        400,
        undefined,
        "language_invalid",
      );
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
    w.language = newWorkerLang(language, user); // REQ-774 — the picked one, else the owner's
    await this.workers.put(w);
    // REQ-151 — the welcome text: who added them, the /worker address, the PIN; its failure is logged, never thrown
    const welcome = await welcomeWorker(deps(this), user, w);
    // REQ-601 — the link and the very text, so a page whose text failed can hand them to the owner to share
    return ctx.json({
      ...safeWorker(w),
      texted: welcome.ok,
      signInUrl: welcome.url,
      shareText: welcome.body,
    }, 201);
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
    const override = parseLang(b.language);
    if (override === null) return { ok: false as const, error: "bad_language" };
    // REQ-154 revision: created in the same millisecond → KV order is random; name breaks the tie
    const workers = (await this.workers.listByUser(user.id)).sort((x, y) =>
      x.createdAt.localeCompare(y.createdAt) || x.name.localeCompare(y.name) ||
      x.id.localeCompare(y.id)
    );
    const out: {
      id: string;
      name: string;
      phone: string;
      language: "en" | "es";
      texted?: boolean;
    }[] = [];
    for (const w of workers) {
      const row: (typeof out)[number] = {
        id: w.id,
        name: w.name,
        phone: w.phoneNumber,
        language: override ?? workerLang(w, user),
      };
      if (!dryRun) {
        row.texted = (await welcomeWorker(
          deps(this),
          user,
          w,
          override ?? undefined,
        )).ok;
      }
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

  /** REQ-155 — the owner changes a worker's language; REQ-840 — or the worker's crew (`crewId`, null = none) */
  @Put(":id")
  async update(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const w = await this.workers.getOwned(id, user.id);
    const b = body(raw);
    if ("language" in b || !("crewId" in b)) {
      const language = parseLang(b.language);
      if (!language) {
        throw new FieldError(
          "language must be en or es",
          400,
          undefined,
          "language_invalid",
        );
      }
      w.language = language;
    }
    if ("crewId" in b) {
      const cid = str(b.crewId);
      const before = w.crewId;
      if (cid) {
        await ownCrew(this.crews, user.id, cid);
        w.crewId = cid;
      } else delete w.crewId;
      if (before && before !== w.crewId) {
        // leaving a crew they led: the crew has no foreman until one is picked
        const old = await this.crews.find(before);
        if (old && old.foremanId === w.id) {
          delete old.foremanId;
          old.updatedAt = new Date().toISOString();
          await this.crews.put(old);
        }
      }
      if (before !== w.crewId) {
        await this.day.dropOpen(
          user.id,
          fieldToday(),
          (t) =>
            (!!before && t.crewId === before) ||
            (!!w.crewId && t.crewId === w.crewId),
        );
      }
    }
    w.updatedAt = new Date().toISOString();
    await this.workers.put(w);
    return this.views.worker(w, await this.views.names(user.id));
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
        "worker_covers_zones", // REQ-421 — the page words it and names the zones
      );
    }
    await this.workers.delete(w);
    return { ok: true };
  }
}

/** REQ-839: a description for the catalogue, ≤ CAP.text; null or "" clears it */
function parseDescription(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new FieldError("description must be text");
  if (raw.length > CAP.text) {
    throw new FieldError(
      `description too long (max ${CAP.text})`,
      400,
      undefined,
      "description_too_long",
    );
  }
  return raw.trim() || undefined;
}

/** REQ-839: where each type is used — on the repeat visits and the checklists (a module function: Danet chokes on undecorated methods) */
async function typeUsage(
  d: { subs: SubscriptionStore; checklists: ChecklistStore },
  userId: string,
) {
  const [subscriptions, checklists] = await Promise.all([
    d.subs.listByUser(userId),
    d.checklists.listByUser(userId),
  ]);
  return (t: TaskType) => {
    const u = taskTypeUsage(t.id, { subscriptions, checklists, tasks: [] });
    return {
      ...t,
      usedBy: { subscriptions: u.subscriptions, checklists: u.checklists },
    };
  };
}

@Controller("field/task-types")
export class FieldTaskTypesController {
  constructor(
    private types: TaskTypeStore,
    private users: UserStore,
    private sessions: SessionStore,
    readonly subs: SubscriptionStore, // REQ-839
    readonly checklists: ChecklistStore,
    private tasks: FieldTaskStore,
  ) {}

  /** REQ-139: case- and accent-insensitive search; REQ-839: archived types only with `all=1`, each with its usage */
  @Get()
  async search(
    @Context() ctx: ExecutionContext,
    @Query("q") q?: string,
    @Query("all") all?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const types = await this.types.listByUser(user.id);
    const withUsage = await typeUsage(this, user.id);
    return searchTaskTypes(all === "1" ? types : liveTypes(types), q ?? "")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(withUsage);
  }

  /** REQ-839: a new service — 201; the same name in any case is 409, unless it is archived: then it comes back (200) */
  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const name = str(b.name)?.replace(/\s+/g, " ");
    if (!name) {
      throw new FieldError("name required", 400, undefined, "name_required");
    }
    if (name.length > CAP.taskType) {
      throw new FieldError("name too long", 400, undefined, "name_too_long");
    }
    const description = parseDescription(b.description);
    const types = await this.types.listByUser(user.id);
    const same = types.find((t) => fold(t.name) === fold(name));
    const withUsage = await typeUsage(this, user.id);
    if (same && !same.archived) {
      throw new FieldError(
        "a service with that name exists",
        409,
        undefined,
        "task_type_name_taken",
      );
    }
    const now = new Date().toISOString();
    if (same) {
      const { archived: _a, ...rest } = same;
      const restored: TaskType = {
        ...rest,
        ...(description !== undefined ? { description } : {}),
        updatedAt: now,
      };
      await this.types.put(restored);
      return withUsage(restored);
    }
    const t: TaskType = {
      id: newId(),
      userId: user.id,
      name,
      ...(description ? { description } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.types.put(t);
    return ctx.json(withUsage(t), 201);
  }

  /** REQ-839: rename, describe, archive or restore */
  @Put(":id")
  async update(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const t = await this.types.getOwned(id, user.id);
    const b = body(raw);
    if ("name" in b) {
      const name = str(b.name)?.replace(/\s+/g, " ");
      if (!name) {
        throw new FieldError("name required", 400, undefined, "name_required");
      }
      if (name.length > CAP.taskType) {
        throw new FieldError("name too long", 400, undefined, "name_too_long");
      }
      if (taskTypeNameTaken(await this.types.listByUser(user.id), name, t.id)) {
        throw new FieldError(
          "a service with that name exists",
          409,
          undefined,
          "task_type_name_taken",
        );
      }
      t.name = name;
    }
    if ("description" in b) {
      const d = parseDescription(b.description);
      if (d) t.description = d;
      else delete t.description;
    }
    if ("archived" in b) {
      if (b.archived === true) t.archived = true;
      else delete t.archived;
    }
    t.updatedAt = new Date().toISOString();
    await this.types.put(t);
    return (await typeUsage(this, user.id))(t);
  }

  /** REQ-839: gone when nothing uses it; 409 with the counts otherwise */
  @Delete(":id")
  async remove(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const t = await this.types.getOwned(id, user.id);
    const [subscriptions, checklists, tasks] = await Promise.all([
      this.subs.listByUser(user.id),
      this.checklists.listByUser(user.id),
      this.tasks.listByUser(user.id),
    ]);
    const u = taskTypeUsage(t.id, { subscriptions, checklists, tasks });
    if (u.subscriptions || u.checklists || u.tasks) {
      throw new FieldError(
        "service in use — archive it instead",
        409,
        u,
        "task_type_in_use",
      );
    }
    await this.types.delete(t);
    return { ok: true };
  }
}

/** REQ-840: the crew a body describes — checked against the account; `cur` on an edit */
async function parseCrew(
  d: { crews: CrewStore; workers: FieldWorkerStore; types: TaskTypeStore },
  userId: string,
  b: Body_,
  cur?: Crew,
): Promise<{ crew: Crew; members: string[] | null }> {
  const all = await d.crews.listByUser(userId);
  const now = new Date().toISOString();
  const crew: Crew = cur
    ? { ...cur, taskTypeIds: [...cur.taskTypeIds], updatedAt: now }
    : {
      id: newId(),
      userId,
      name: "",
      color: "",
      taskTypeIds: [],
      createdAt: now,
      updatedAt: now,
    };
  if ("name" in b || !cur) {
    const name = str(b.name)?.replace(/\s+/g, " ");
    if (!name) {
      throw new FieldError("name required", 400, undefined, "name_required");
    }
    if (name.length > CAP.crew) {
      throw new FieldError("name too long", 400, undefined, "name_too_long");
    }
    if (crewNameTaken(all, name, cur?.id)) {
      throw new FieldError(
        "a crew with that name exists",
        409,
        undefined,
        "crew_name_taken",
      );
    }
    crew.name = name;
  }
  if ("color" in b || !cur) {
    const color = str(b.color);
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
      throw new FieldError(
        "color must be #rrggbb",
        400,
        undefined,
        "bad_color",
      );
    }
    const used = new Set(
      all.filter((c) => c.id !== crew.id).map((c) => c.color),
    );
    crew.color = color ?? CREW_COLORS.find((c) => !used.has(c)) ??
      CREW_COLORS[all.length % CREW_COLORS.length];
  }
  if ("taskTypeIds" in b) {
    const ids = idList(b.taskTypeIds);
    if (!ids) throw new FieldError("taskTypeIds must be a list of ids");
    const types = await d.types.listByUser(userId);
    for (const id of ids) {
      if (!types.some((t) => t.id === id)) {
        throw new FieldError("unknown taskTypeId");
      }
      const other = claimedBy(all, id, crew.id);
      if (other) {
        throw new FieldError(
          `${other.name} already does that service`,
          409,
          { crew: other.name, taskTypeId: id },
          "task_type_claimed",
        );
      }
    }
    crew.taskTypeIds = ids;
  }
  if ("coversAll" in b) {
    if (b.coversAll === true) crew.coversAll = true;
    else delete crew.coversAll;
  }
  let members: string[] | null = null;
  const workers = await d.workers.listByUser(userId);
  if ("memberIds" in b) {
    members = idList(b.memberIds);
    if (!members) {
      throw new FieldError("memberIds must be a list of worker ids");
    }
    for (const id of members) {
      if (!workers.some((w) => w.id === id)) {
        throw new FieldError("unknown workerId");
      }
    }
  }
  const finalMembers = members ??
    workers.filter((w) => w.crewId === crew.id).map((w) => w.id);
  if ("foremanId" in b) {
    const fid = str(b.foremanId);
    if (fid) {
      if (!finalMembers.includes(fid)) {
        throw new FieldError(
          "the foreman must be one of the crew's members",
          400,
          undefined,
          "foreman_not_member",
        );
      }
      crew.foremanId = fid;
    } else delete crew.foremanId;
  } else if (crew.foremanId && !finalMembers.includes(crew.foremanId)) {
    delete crew.foremanId; // the foreman left with the new member list
  }
  return { crew, members };
}

/** REQ-840: a crew's colours — the zone palette's neighbours, so a crew and a zone never read alike */
const CREW_COLORS = [
  "#2f6f4e",
  "#b5541c",
  "#1f5f8b",
  "#8a5bb5",
  "#9c2f4b",
  "#5a6b1f",
  "#13747d",
  "#7a4b2a",
];

interface CrewDeps {
  crews: CrewStore;
  workers: FieldWorkerStore;
  regions: RegionStore;
  views: FieldViews;
}

/** REQ-840: one crew as the page shows it */
async function crewView(d: CrewDeps, userId: string, c: Crew) {
  const [workers, regions, n] = await Promise.all([
    d.workers.listByUser(userId),
    d.regions.listByUser(userId),
    d.views.names(userId),
  ]);
  return d.views.crew(c, workers, regions, n);
}

/** REQ-840: the members as sent — those named join (leaving their old crew), the rest of this crew leave; true when anyone moved */
async function applyMembers(
  d: CrewDeps,
  userId: string,
  crew: Crew,
  members: string[],
): Promise<boolean> {
  const workers = await d.workers.listByUser(userId);
  const changed: FieldWorker[] = [];
  const now = new Date().toISOString();
  for (const w of workers) {
    if (members.includes(w.id) && w.crewId !== crew.id) {
      changed.push({ ...w, crewId: crew.id, updatedAt: now });
    } else if (!members.includes(w.id) && w.crewId === crew.id) {
      const { crewId: _c, ...rest } = w;
      changed.push({ ...rest, updatedAt: now });
    }
  }
  await d.workers.putMany(changed);
  // a worker who left a crew they led
  const others = (await d.crews.listByUser(userId)).filter((c) =>
    c.id !== crew.id && c.foremanId && members.includes(c.foremanId)
  );
  for (const c of others) {
    delete c.foremanId;
    c.updatedAt = now;
    await d.crews.put(c);
  }
  return changed.length > 0 || others.length > 0;
}

/** REQ-840: the crews, their members and the services they do */
@Controller("field/crews")
export class FieldCrewsController {
  constructor(
    readonly crews: CrewStore,
    readonly workers: FieldWorkerStore,
    private types: TaskTypeStore,
    readonly regions: RegionStore,
    private absences: AbsenceStore,
    private day: FieldDay,
    readonly views: FieldViews,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const [crews, workers, regions, n] = await Promise.all([
      this.crews.listByUser(user.id),
      this.workers.listByUser(user.id),
      this.regions.listByUser(user.id),
      this.views.names(user.id),
    ]);
    return crews.sort((a, b) => a.name.localeCompare(b.name)).map((c) =>
      this.views.crew(c, workers, regions, n)
    );
  }

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const { crew, members } = await parseCrew(
      { crews: this.crews, workers: this.workers, types: this.types },
      user.id,
      body(raw),
    );
    await this.crews.put(crew);
    if (members) await applyMembers(this, user.id, crew, members);
    if (members?.length || crew.coversAll) {
      await this.day.dropOpen(user.id, fieldToday(), (t) => !!t.subscriptionId);
    }
    return ctx.json(await crewView(this, user.id, crew), 201);
  }

  @Put(":id")
  async update(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const cur = await this.crews.getOwned(id, user.id);
    const { crew, members } = await parseCrew(
      { crews: this.crews, workers: this.workers, types: this.types },
      user.id,
      body(raw),
      cur,
    );
    await this.crews.put(crew);
    const moved = members
      ? await applyMembers(this, user.id, crew, members)
      : false;
    const staffing = moved ||
      JSON.stringify(cur.taskTypeIds) !== JSON.stringify(crew.taskTypeIds) ||
      cur.foremanId !== crew.foremanId || !!cur.coversAll !== !!crew.coversAll;
    if (staffing) {
      // REQ-841: who does what changed — the open round from today re-derives on it
      const zones = new Set(
        (await this.regions.listByUser(user.id)).filter((r) =>
          r.crewIds?.includes(crew.id)
        ).map((r) => r.id),
      );
      const everywhere = !!cur.coversAll || !!crew.coversAll;
      await this.day.dropOpen(
        user.id,
        fieldToday(),
        (t) =>
          !!t.subscriptionId &&
          (everywhere || t.crewId === crew.id || zones.has(t.regionId)),
      );
    }
    return await crewView(this, user.id, crew);
  }

  /** 409 while a zone lists the crew; else its members are freed and its open round re-derives */
  @Delete(":id")
  async remove(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const crew = await this.crews.getOwned(id, user.id);
    const zones = (await this.regions.listByUser(user.id)).filter((r) =>
      r.crewIds?.includes(crew.id)
    ).map((r) => r.name);
    if (zones.length) {
      throw new FieldError(
        "crew still staffs zones — take it off them first",
        409,
        { zones },
        "crew_covers_zones",
      );
    }
    await applyMembers(this, user.id, crew, []);
    await this.absences.deleteMany(
      (await this.absences.listByUser(user.id)).filter((a) =>
        a.crewId === crew.id || a.coverCrewId === crew.id
      ),
    );
    await this.crews.delete(crew);
    await this.day.dropOpen(
      user.id,
      fieldToday(),
      (t) => t.crewId === crew.id || t.coverFor === crew.id || !!crew.coversAll,
    );
    return { ok: true };
  }
}

/**
 * REQ-842: the tasks an absence touches — the absent crew's or worker's (and, for a worker, their
 * crew's: the lead may change), those covering for them, those it decided
 */
const touchedBy = (a: Absence, workerCrewId?: string) => (t: FieldTask) =>
  t.byAbsence === a.id ||
  (a.crewId
    ? t.crewId === a.crewId || t.coverFor === a.crewId
    : (t.workerId === a.workerId ||
      !!t.crewIds?.includes(a.workerId!) || t.coverFor === a.workerId ||
      (!!workerCrewId && t.crewId === workerCrewId)));

/** REQ-842: the open round in the absence's days (from today) re-derives for everyone it touches */
async function redoAbsence(
  day: FieldDay,
  workers: FieldWorkerStore,
  userId: string,
  a: Absence,
) {
  const today = fieldToday();
  const from = a.from > today ? a.from : today;
  if (a.to < from) return;
  const crewId = a.workerId
    ? (await workers.find(a.workerId))?.crewId
    : undefined;
  await day.dropOpen(userId, from, touchedBy(a, crewId), a.to);
  // a deferred visit's copy sits after the absence — up to MAX_DEFER_DAYS later
  await day.dropOpen(
    userId,
    a.to,
    (t) => t.byAbsence === a.id,
    shiftDate(a.to, MAX_DEFER_DAYS),
  );
}

/** REQ-842: who is out, when, and what happens to their work */
@Controller("field/absences")
export class FieldAbsencesController {
  constructor(
    private absences: AbsenceStore,
    private workers: FieldWorkerStore,
    private crews: CrewStore,
    private day: FieldDay,
    private views: FieldViews,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  /** from today on, soonest first */
  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const today = fieldToday();
    const [rows, n] = await Promise.all([
      this.absences.listByUser(user.id),
      this.views.names(user.id),
    ]);
    return rows.filter((a) => a.to >= today)
      .sort((a, b) =>
        a.from.localeCompare(b.from) || a.createdAt.localeCompare(b.createdAt)
      )
      .map((a) => this.views.absence(a, n));
  }

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const workerId = str(b.workerId), crewId = str(b.crewId);
    if (!!workerId === !!crewId) {
      throw new FieldError(
        "workerId or crewId — one of them",
        400,
        undefined,
        "who_required",
      );
    }
    if (workerId) await ownWorker(this.workers, user.id, workerId);
    if (crewId) await ownCrew(this.crews, user.id, crewId);
    const from = str(b.from), to = str(b.to);
    if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
      throw new FieldError(
        "from and to must be YYYY-MM-DD",
        400,
        undefined,
        "bad_dates",
      );
    }
    if (to < from) {
      throw new FieldError(
        "to is before from",
        400,
        undefined,
        "end_before_start",
      );
    }
    if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) {
      throw new FieldError(
        "an absence runs at most a year",
        400,
        undefined,
        "too_long",
      );
    }
    const disposition = str(b.disposition) as AbsenceDisposition | undefined;
    if (!disposition || !DISPOSITIONS.includes(disposition)) {
      throw new FieldError(
        "disposition must be cover, defer or skip",
        400,
        undefined,
        "bad_disposition",
      );
    }
    const coverCrewId = str(b.coverCrewId),
      coverWorkerId = str(b.coverWorkerId);
    if (disposition === "cover") {
      if (!!coverCrewId === !!coverWorkerId) {
        throw new FieldError(
          "cover: coverCrewId or coverWorkerId — one of them",
          400,
          undefined,
          "cover_required",
        );
      }
      if (
        (coverCrewId && coverCrewId === crewId) ||
        (coverWorkerId && coverWorkerId === workerId)
      ) {
        throw new FieldError(
          "they cannot cover for themselves",
          400,
          undefined,
          "cover_self",
        );
      }
      if (coverCrewId) await ownCrew(this.crews, user.id, coverCrewId);
      if (coverWorkerId) await ownWorker(this.workers, user.id, coverWorkerId);
    }
    if (tooLong(b.note, CAP.note)) {
      throw new FieldError(`note too long (max ${CAP.note})`);
    }
    const a: Absence = {
      id: newId(),
      userId: user.id,
      ...(workerId ? { workerId } : { crewId }),
      from,
      to,
      disposition,
      ...(disposition === "cover"
        ? (coverCrewId ? { coverCrewId } : { coverWorkerId })
        : {}),
      ...(str(b.note) ? { note: str(b.note) } : {}),
      createdAt: new Date().toISOString(),
    };
    await this.absences.put(a);
    await redoAbsence(this.day, this.workers, user.id, a);
    return ctx.json(
      this.views.absence(a, await this.views.names(user.id)),
      201,
    );
  }

  @Delete(":id")
  async remove(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const a = await this.absences.getOwned(id, user.id);
    await this.absences.delete(a);
    await redoAbsence(this.day, this.workers, user.id, a);
    return { ok: true };
  }
}

@Controller("field/subscriptions")
export class FieldSubscriptionsController {
  constructor(
    private subs: SubscriptionStore,
    private types: TaskTypeStore,
    private checklists: ChecklistStore,
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
    // REQ-811: a checklist stands in for the rows — a visit needs one or the other
    const ckl = await parseChecklistId(this.checklists, user.id, b.checklistId);
    if (!hasServices(items, ckl.set ? ckl.id : undefined)) {
      throw new FieldError(
        "at least one task type with a price, or a checklist",
        400,
        undefined,
        "no_services",
      );
    }
    const sched = parseSchedule(b, { cadence: "weekly" });
    if (b.startDate !== undefined && !isValidDate(b.startDate)) {
      throw new FieldError("startDate must be YYYY-MM-DD");
    }
    const netDays = parseNetDays(b.netDays); // REQ-174
    if (!netDays.ok) throw new FieldError(netDays.reason);
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
      ...(ckl.set && ckl.id ? { checklistId: ckl.id } : {}), // REQ-811
      ...sched,
      startDate: isValidDate(b.startDate) ? b.startDate : fieldToday(),
      ...(netDays.value !== undefined ? { netDays: netDays.value } : {}),
      ...(b.overhead === true ? { overhead: true } : {}), // REQ-788
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
      s.items = await parseItems(this.types, user.id, b.items);
    }
    // REQ-811: a string names the account's checklist, null clears it; the visit keeps a checklist or at least one own row
    const ckl = await parseChecklistId(this.checklists, user.id, b.checklistId);
    if (ckl.set) {
      if (ckl.id) s.checklistId = ckl.id;
      else delete s.checklistId;
    }
    if (!hasServices(s.items, s.checklistId)) {
      throw new FieldError(
        "at least one task type with a price, or a checklist",
        400,
        undefined,
        "no_services",
      );
    }
    Object.assign(s, sched);
    if (isValidDate(b.startDate)) s.startDate = b.startDate;
    if (b.netDays !== undefined) { // REQ-174: a number sets it, null clears it
      const nd = parseNetDays(b.netDays);
      if (!nd.ok) throw new FieldError(nd.reason);
      if (nd.value === undefined) delete s.netDays;
      else s.netDays = nd.value;
    }
    if (typeof b.overhead === "boolean") s.overhead = b.overhead; // REQ-788
    const address = str(b.address);
    if (address && address !== s.address) {
      if (address.length > CAP.text) throw new FieldError("address too long");
      s.address = address;
      Object.assign(s, await this.geocoder.geocode(address)); // only when the address changes
      s.pinned = false;
    }
    s.updatedAt = new Date().toISOString();
    await this.subs.put(s);
    // REQ-170 — open future work follows the change: dropped here, re-derived on the next read
    await this.day.dropOpen(
      user.id,
      fieldToday(),
      (t) => t.subscriptionId === s.id,
    );
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
      if (r.created || r.restored) created.push(r.type); // REQ-839: a restored type is saved too
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

/** REQ-811: `checklistId` — a string names the account's checklist (404 otherwise), null or "" clears it, absent leaves it */
async function parseChecklistId(
  store: ChecklistStore,
  userId: string,
  raw: unknown,
): Promise<{ set: false } | { set: true; id?: string }> {
  if (raw === undefined) return { set: false };
  if (raw === null || raw === "") return { set: true };
  const id = str(raw);
  const c = id ? await store.find(id) : null;
  if (!c || c.userId !== userId) {
    throw new FieldError(
      "checklist not found",
      404,
      undefined,
      "checklist_not_found",
    );
  }
  return { set: true, id: c.id };
}

/** REQ-811: the checklist's name — required, at most CAP.checklist characters */
function parseChecklistName(raw: unknown): string {
  const name = str(raw);
  if (!name) throw new FieldError("name required");
  if (name.length > CAP.checklist) throw new FieldError("name too long");
  return name;
}

/**
 * REQ-811 — the account's checklists: a named list of services (task types with a
 * price) a repeat visit REFERENCES instead of listing the same rows again. Editing
 * one changes every visit on it; deleting one in use is refused.
 */
@Controller("field/checklists")
export class FieldChecklistsController {
  constructor(
    private checklists: ChecklistStore,
    private types: TaskTypeStore,
    private subs: SubscriptionStore,
    private day: FieldDay,
    private views: FieldViews,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const [all, subs, n] = await Promise.all([
      this.checklists.listByUser(user.id),
      this.subs.listByUser(user.id),
      this.views.names(user.id),
    ]);
    return all.sort((a, b) => a.name.localeCompare(b.name)).map((c) =>
      this.views.checklist(c, n, subs)
    );
  }

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const name = parseChecklistName(b.name);
    if (checklistNameTaken(await this.checklists.listByUser(user.id), name)) {
      throw new FieldError(
        "a checklist with that name exists",
        409,
        undefined,
        "checklist_name_taken",
      );
    }
    const items = await parseItems(this.types, user.id, b.items);
    if (!items.length) {
      throw new FieldError("at least one task type with a price");
    }
    const now = new Date().toISOString();
    const c: Checklist = {
      id: newId(),
      userId: user.id,
      name,
      items,
      createdAt: now,
      updatedAt: now,
    };
    await this.checklists.put(c);
    return ctx.json(
      this.views.checklist(c, await this.views.names(user.id), []),
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
    const c = await this.checklists.getOwned(id, user.id);
    const b = body(raw);
    if (b.name !== undefined) {
      const name = parseChecklistName(b.name);
      if (
        checklistNameTaken(
          await this.checklists.listByUser(user.id),
          name,
          c.id,
        )
      ) {
        throw new FieldError(
          "a checklist with that name exists",
          409,
          undefined,
          "checklist_name_taken",
        );
      }
      c.name = name;
    }
    let itemsChanged = false;
    if (b.items !== undefined) {
      const items = await parseItems(this.types, user.id, b.items);
      if (!items.length) {
        throw new FieldError("at least one task type with a price");
      }
      c.items = items;
      itemsChanged = true;
    }
    c.updatedAt = new Date().toISOString();
    await this.checklists.put(c);
    const subs = await this.subs.listByUser(user.id);
    if (itemsChanged) {
      // REQ-170 — every visit on this checklist: open future work is dropped here, re-derived on the next read
      const using = new Set(
        subs.filter((s) => s.checklistId === c.id).map((s) => s.id),
      );
      if (using.size) {
        await this.day.dropOpen(
          user.id,
          fieldToday(),
          (t) => using.has(t.subscriptionId),
        );
      }
    }
    return this.views.checklist(c, await this.views.names(user.id), subs);
  }

  @Delete(":id")
  async remove(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const c = await this.checklists.getOwned(id, user.id);
    const n = checklistUsage(await this.subs.listByUser(user.id), c.id);
    if (n > 0) {
      throw new FieldError(
        "checklist is used by repeat visits",
        409,
        { subscriptions: n },
        "checklist_in_use",
      );
    }
    await this.checklists.delete(c);
    return { ok: true };
  }
}

/** REQ-139: cadence / days / intervalWeeks, validated; REQ-157: daysOfMonth (1–31); REQ-787: month (1–12) for annual */
export function parseSchedule(
  b: Body_,
  cur: {
    cadence: Cadence;
    days?: number[];
    intervalWeeks?: number;
    daysOfMonth?: number[];
    month?: number;
  },
): Pick<
  Subscription,
  "cadence" | "days" | "intervalWeeks" | "daysOfMonth" | "month"
> {
  let cadence =
    (b.cadence !== undefined ? str(b.cadence) : cur.cadence) as Cadence;
  if (!CADENCES.includes(cadence)) {
    throw new FieldError("cadence must be weekly, biweekly, monthly or annual");
  }
  let days = cur.days,
    intervalWeeks = cur.intervalWeeks,
    daysOfMonth = cur.daysOfMonth,
    month = cur.month;
  if (b.month !== undefined) { // REQ-787
    if (
      typeof b.month !== "number" || !Number.isInteger(b.month) ||
      b.month < 1 || b.month > 12
    ) throw new FieldError("month must be 1–12");
    month = b.month;
  }
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
    if (cadence !== "monthly" && cadence !== "annual") {
      cadence = n === 2 ? "biweekly" : "weekly"; // the label follows the interval
    }
  }
  if (
    b.cadence !== undefined && b.intervalWeeks === undefined &&
    cadence !== "monthly" && cadence !== "annual"
  ) intervalWeeks = cadence === "biweekly" ? 2 : 1;
  if (cadence !== "annual") month = undefined; // REQ-787: only a yearly visit has a month
  return { cadence, days, intervalWeeks, daysOfMonth, month };
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
    private mapCenter: FieldMapCenter,
    private crews: CrewStore, // REQ-841
    private day: FieldDay,
  ) {}

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return (await this.views.regionsWithMembers(user.id)).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  /** REQ-288: where the map starts with no subscriptions to fit — the business's address, else the whole US */
  @Get("center")
  async center(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.mapCenter.center(user.id);
  }

  @Post("regroup")
  async regroup(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const { regions } = await this.zones.regroup(user.id);
    return { regions: regions.length };
  }

  /**
   * REQ-140: staff a zone; today's and later open tasks of the zone move to that worker.
   * REQ-841: `crewIds` — the crews staffing it, in order (replaces the list; [] clears it);
   * the zone's open round from today re-derives on them.
   */
  @Put(":id/worker")
  async staff(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const r = await this.regions.getOwned(id, user.id);
    const b = body(raw);
    if ("crewIds" in b) {
      const ids = idList(b.crewIds);
      if (!ids) throw new FieldError("crewIds must be a list of crew ids");
      for (const cid of ids) await ownCrew(this.crews, user.id, cid);
      if (ids.length) r.crewIds = ids;
      else delete r.crewIds;
      await this.regions.put(r);
      await this.day.dropOpen(
        user.id,
        fieldToday(),
        (t) => t.regionId === r.id && !!t.subscriptionId,
      );
      if (!("workerId" in b)) return r;
    }
    const workerId = str(b.workerId);
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
      await this.tasks.putMany(open.map((t) => ledBy(t, workerId))); // REQ-785: off the crew it now leads
    } else delete r.workerId;
    await this.regions.put(r);
    return r;
  }
}

/** REQ-164/165: the task type a body names — by id, or found/created by name */
async function taskTypeFrom(
  types: TaskTypeStore,
  userId: string,
  b: Body_,
): Promise<string> {
  const list = await types.listByUser(userId);
  const id = str(b.taskTypeId);
  if (id) {
    if (!list.some((x) => x.id === id)) {
      throw new FieldError("unknown taskTypeId");
    }
    return id;
  }
  const name = str(b.taskTypeName);
  if (!name) throw new FieldError("taskTypeId or taskTypeName required");
  const r = findOrCreateTaskType(list, name, userId, newId);
  if (r.created || r.restored) await types.put(r.type); // REQ-839: an archived type typed again comes back
  return r.type.id;
}

/** REQ-164/166: the account's worker a body names, or 400 (a module function — Danet chokes on undecorated methods) */
async function ownWorker(
  workers: FieldWorkerStore,
  userId: string,
  id: string,
): Promise<FieldWorker> {
  const w = await workers.find(id);
  if (!w || w.userId !== userId) throw new FieldError("unknown workerId");
  return w;
}

/** REQ-785: a job's last day from the body (`endDate` or `days`), or a 400 that names what is wrong */
function spanOf(
  date: string,
  b: { endDate?: unknown; days?: unknown },
): { endDate?: string } {
  const r = spanFrom(date, b);
  if (!r.ok) throw new FieldError(r.error, 400, undefined, r.code);
  return { endDate: r.endDate };
}

/** REQ-785: the job's other workers — the account's own, unique, never the lead; a 400 otherwise */
async function crewOf(
  workers: FieldWorkerStore,
  userId: string,
  raw: unknown,
  leadId: string,
): Promise<string[]> {
  const ids = crewList(raw, leadId);
  if (!ids) throw new FieldError("crewIds must be a list of worker ids");
  for (const id of ids) await ownWorker(workers, userId, id);
  return ids;
}

/**
 * REQ-785: a one-off's days from a PUT body — its first (`date`, else the current one) and its last
 * (`endDate` / `days`, else the current last; null = one day). A subscription's visit keeps its
 * schedule's day (400); an invoiced task keeps its days (409).
 */
function newDays(
  t: FieldTask,
  b: Body_,
): { date: string; endDate?: string } {
  if (!t.oneOff) {
    throw new FieldError(
      "a subscription's visit is on its schedule — only a one-off task's days change",
      400,
      undefined,
      "not_one_off",
    );
  }
  if (t.invoiceId) {
    throw new FieldError(
      "task is on an invoice — edit the invoice instead",
      409,
    );
  }
  const date = "date" in b ? str(b.date) : t.date;
  if (!date || !isValidDate(date)) {
    throw new FieldError("date must be YYYY-MM-DD");
  }
  const span = spanOf(
    date,
    "endDate" in b || "days" in b ? b : { endDate: t.endDate },
  );
  return { date, ...(span.endDate ? { endDate: span.endDate } : {}) };
}

/** a price in integer cents, 0 … $100,000 */
function priceOf(v: unknown, fallback?: number): number {
  if (v === undefined || v === null || v === "") {
    if (fallback === undefined) throw new FieldError("priceCents required");
    return fallback;
  }
  const p = Math.round(Number(v));
  if (!Number.isFinite(p) || p < 0 || p > 10_000_000) {
    throw new FieldError("bad price");
  }
  return p;
}

@Controller("field/tasks")
export class FieldTasksController {
  constructor(
    private tasks: FieldTaskStore,
    private day: FieldDay,
    private views: FieldViews,
    private users: UserStore,
    private sessions: SessionStore,
    private workers: FieldWorkerStore,
    private types: TaskTypeStore,
    private subs: SubscriptionStore,
    private regions: RegionStore,
    private customers: CustomerStore,
    private notices: FieldNotices,
    private activity: FieldActivity,
    private crews: CrewStore, // REQ-842
  ) {}

  /**
   * REQ-842: the whole day of one worker or one crew goes to another worker or crew at once —
   * the open, un-invoiced tasks that day (REQ-166 for a day). The new crew's foreman leads, its
   * members are the crew.
   */
  @Post("reassign")
  async reassign(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const date = str(b.date) ?? fieldToday();
    if (!isValidDate(date)) throw new FieldError("date must be YYYY-MM-DD");
    const fromWorkerId = str(b.fromWorkerId), fromCrewId = str(b.fromCrewId);
    const toWorkerId = str(b.toWorkerId), toCrewId = str(b.toCrewId);
    if (!!fromWorkerId === !!fromCrewId) {
      throw new FieldError("fromWorkerId or fromCrewId — one of them");
    }
    if (!!toWorkerId === !!toCrewId) {
      throw new FieldError("toWorkerId or toCrewId — one of them");
    }
    let to: Pick<FieldTask, "workerId" | "crewId" | "crewIds">;
    if (toWorkerId) {
      await ownWorker(this.workers, user.id, toWorkerId);
      to = { workerId: toWorkerId };
    } else {
      const crew = await ownCrew(this.crews, user.id, toCrewId!);
      const members = crewMembers(crew, await this.workers.listByUser(user.id));
      const lead = leadOf(crew, members);
      if (!lead) {
        throw new FieldError(
          "that crew has no members",
          400,
          undefined,
          "crew_empty",
        );
      }
      const rest = members.filter((m) => m.id !== lead.id).map((m) => m.id);
      to = {
        workerId: lead.id,
        crewId: crew.id,
        ...(rest.length ? { crewIds: rest } : {}),
      };
    }
    const day = await this.tasks.listByDay(user.id, date);
    const moved = day
      .filter((t) =>
        t.status === "assigned" && !t.invoiceId &&
        (fromCrewId ? t.crewId === fromCrewId : t.workerId === fromWorkerId)
      )
      .map((t) => {
        const { crewId: _c, crewIds: _k, ...rest } = t;
        return { ...rest, ...to } as FieldTask;
      });
    await this.tasks.putMany(moved);
    for (const t of moved) await this.notices.workerNewTask(user.id, t); // REQ-171
    return { moved: moved.length };
  }

  /**
   * REQ-164: a one-off task by hand — one customer, no subscription. REQ-785: one day, or a job of
   * several (`endDate` or `days`) — ONE task on each of its days — with more workers (`crewIds`).
   */
  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const customerId = str(b.customerId);
    if (!customerId) throw new FieldError("customerId required");
    const customer = await this.customers.getOwned(customerId, user.id); // 404 / 403 as the customers resource answers
    const date = str(b.date) ?? fieldToday();
    if (!isValidDate(date)) throw new FieldError("date must be YYYY-MM-DD");
    const span = spanOf(date, b); // REQ-785
    const taskTypeId = await taskTypeFrom(this.types, user.id, b);
    const priceCents = priceOf(b.priceCents);
    // the worker: named, else the one covering the customer's subscription's zone
    const subs = (await this.subs.listByUser(user.id)).filter((s) =>
      s.customerId === customer.id && s.active
    );
    const regions = await this.regions.listByUser(user.id);
    const home = subs.map((s) => regions.find((r) => r.id === s.regionId))
      .find((r) => r?.workerId);
    let workerId = str(b.workerId);
    if (workerId) await ownWorker(this.workers, user.id, workerId);
    else workerId = home?.workerId;
    if (!workerId) throw new FieldError("workerId required");
    const crewIds = await crewOf(this.workers, user.id, b.crewIds, workerId); // REQ-785
    const address = str(b.address) ?? subs[0]?.address ??
      customer.address?.trim() ?? undefined;
    if (address && address.length > CAP.text) {
      throw new FieldError("address too long");
    }
    const t = oneOffTask({
      userId: user.id,
      customerId: customer.id,
      date,
      endDate: span.endDate,
      crewIds,
      taskTypeId,
      priceCents,
      workerId,
      regionId: home?.id,
      address,
      newId,
    });
    await this.tasks.put(t);
    // REQ-340 (demo M37): a typed address lands on a customer who had none,
    // whatever order the form was filled in. A customer with an address keeps
    // it — the task's is that job's service address only.
    const typed = str(b.address);
    if (typed && !customer.address?.trim()) {
      await this.customers.update(customer.id, user.id, { address: typed });
    }
    const texted = await this.notices.workerNewTask(user.id, t); // REQ-171: today's news reaches the worker
    return ctx.json(
      { ...this.views.task(t, await this.views.names(user.id)), texted },
      201,
    );
  }

  /** REQ-165: the office adds a service to the visit this task belongs to */
  @Post(":id/services")
  async addService(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const t = await this.tasks.getOwned(id, user.id);
    const b = body(raw);
    const taskTypeId = await taskTypeFrom(this.types, user.id, b);
    const priceCents =
      b.priceCents === undefined || b.priceCents === null || b.priceCents === ""
        ? undefined
        : priceOf(b.priceCents);
    const found = t.subscriptionId
      ? await this.subs.find(t.subscriptionId)
      : null;
    // REQ-811: priced from the visit's effective services (its checklist's included)
    const subscription = found ? await this.day.effective(found) : undefined;
    const r = officeService({
      task: t,
      visit: await this.tasks.listByDay(user.id, t.date),
      taskTypeId,
      priceCents,
      subscription,
      newId,
    });
    if (!r.ok) {
      throw new FieldError(
        r.reason === "invoiced" ? "visit already invoiced" : r.reason,
        409,
      );
    }
    await this.tasks.put(r.task);
    const texted = await this.notices.workerNewTask(user.id, r.task); // REQ-171
    const n = await this.views.names(user.id);
    return ctx.json(
      { ...this.views.task(r.task, n), texted },
      r.restored ? 200 : 201,
    );
  }

  /** REQ-163: the office removes a task; one on an invoice stays */
  @Delete(":id")
  async remove(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const t = await this.tasks.getOwned(id, user.id);
    if (t.invoiceId) {
      throw new FieldError(
        "task is on an invoice — edit the invoice instead",
        409,
      );
    }
    // a one-off simply goes; a subscription's task stays as a tombstone so the day's round does not bring it back
    if (t.oneOff) await this.tasks.delete(t);
    else await this.tasks.put({ ...t, deleted: true });
    const texted = await this.notices.customerCanceled(user.id, t); // REQ-171
    return { ok: true, texted };
  }

  /** REQ-141/170: the day's round — any day is materialized on read, so it is always current */
  @Get()
  async list(@Context() ctx: ExecutionContext, @Query("date") date?: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const d = date ?? fieldToday();
    if (!isValidDate(d)) throw new FieldError("date must be YYYY-MM-DD");
    const rows = (await this.day.generate(user.id, d)).all;
    const n = await this.views.names(user.id);
    return rows.map((t) => this.views.task(t, n));
  }

  /** REQ-170: the subscriptions due that day whose zone has no worker — reported, never silently dropped */
  @Get("unstaffed")
  async unstaffed(
    @Context() ctx: ExecutionContext,
    @Query("date") date?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const d = date ?? fieldToday();
    if (!isValidDate(d)) throw new FieldError("date must be YYYY-MM-DD");
    const skipped = await this.day.uncoveredOn(user.id, d);
    const n = await this.views.names(user.id);
    // REQ-841: which services nobody covers
    return skipped.map(({ subscription: s, taskTypeIds }) => ({
      subscriptionId: s.id,
      customerName: n.customer(s.customerId),
      address: s.address,
      regionName: n.region(s.regionId)?.name ?? "—",
      taskTypeNames: taskTypeIds.map((id) => n.type(id)),
    }));
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

  /** REQ-141: the office's note and price · REQ-785: a one-off's days and crew */
  @Put(":id")
  async update(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    let t = await this.tasks.getOwned(id, user.id);
    const b = body(raw);
    if (tooLong(b.adminNote, CAP.note)) {
      throw new FieldError(`note too long (max ${CAP.note})`);
    }
    // REQ-785 — a one-off's new days and crew are checked before anything changes
    const days = "date" in b || "endDate" in b || "days" in b
      ? newDays(t, b)
      : null;
    const crew = "crewIds" in b
      ? await crewOf(
        this.workers,
        user.id,
        b.crewIds,
        str(b.workerId) ?? t.workerId,
      )
      : null;
    if (crew && t.invoiceId) {
      throw new FieldError(
        "task is on an invoice — edit the invoice instead",
        409,
      );
    }
    if ("adminNote" in b) {
      t.adminNote = String(b.adminNote ?? "").trim() || undefined;
    }
    // REQ-159 — the office marks the task done, or re-opens it
    let completedNow = false;
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
      completedNow = st === "complete" && t.status !== "complete"; // REQ-566
      t.status = st;
      if (st === "complete") t.completedAt = new Date().toISOString();
      else delete t.completedAt;
    }
    // REQ-166 — another of the account's workers takes the task, this day only
    if ("workerId" in b) {
      const wid = str(b.workerId);
      if (!wid) throw new FieldError("workerId required");
      if (t.invoiceId) {
        throw new FieldError(
          "task is on an invoice — edit the invoice instead",
          409,
        );
      }
      await ownWorker(this.workers, user.id, wid);
      if (wid !== t.workerId) {
        t = ledBy(t, wid); // REQ-785: the new lead is no longer also on the crew
        await this.tasks.put(t);
        await this.notices.workerNewTask(user.id, t); // REQ-171: the new worker hears, when it is today
      }
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
    // REQ-785 — a one-off's days (first and last) and the job's other workers
    const moved = !!days &&
      (days.date !== t.date || days.endDate !== t.endDate);
    if (days) {
      t.date = days.date;
      if (days.endDate) t.endDate = days.endDate;
      else delete t.endDate;
    }
    if (crew) {
      if (crew.length) t.crewIds = crew;
      else delete t.crewIds;
    }
    await this.tasks.put(t);
    if (completedNow) await this.activity.taskCompleted(t); // REQ-566
    if (moved || crew) await this.notices.workerNewTask(user.id, t); // REQ-171: moved onto today, the crew hears
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

  /** REQ-810: take a draft invoice out of the batch — deleted, its tasks un-invoiced; answers the batch */
  @Delete(":id/invoices/:invoiceId")
  async removeInvoice(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Param("invoiceId") invoiceId: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.batches.removeInvoice(user.id, id, invoiceId);
  }

  /** REQ-810: take one line off a draft of the batch; `key` (the line's taskId, else its description) guards a stale page */
  @Delete(":id/invoices/:invoiceId/lines/:index")
  async removeLine(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Param("invoiceId") invoiceId: string,
    @Param("index") index: string,
    @Query("key") key?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.batches.removeLine(
      user.id,
      id,
      invoiceId,
      /^\d+$/.test(index) ? Number(index) : -1,
      key ?? "",
      user.language === "es" ? "es" : "en",
    );
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
