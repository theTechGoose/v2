/**
 * REQ-883..889 — the HR module's API.
 *   /hr/*          — the admin's: hires, documents, departments, systems, settings, the overview;
 *                    behind the owner's session, every record the calling account's
 *   /hr/sign/:token — the hire's: open the packet, sign or acknowledge a document, the PDF;
 *                    public — the token is the identity
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
import { decodeBase64 } from "#std/encoding/base64";
import { t } from "@core/i18n/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import { appUrl } from "@users/domain/business/app-url/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { MAX_UPLOAD_BYTES } from "@files/entrypoints/files-controller/mod.ts";
import {
  DepartmentStore,
  HireStore,
  HrDocumentStore,
  HrSettingsStore,
  HrSystemStore,
  newId,
  newToken,
  ProofStore,
  SYSTEM_CATALOG,
} from "@hr/domain/data/hr-stores/mod.ts";
import { HrNotices } from "@hr/domain/coordinators/hr-notices/mod.ts";
import { Provisioner } from "@hr/domain/coordinators/provisioner/mod.ts";
import {
  allDone,
  bumpsVersion,
  dashboardStats,
  expiresAt,
  fullName,
  isExpired,
  mintPacket,
  packetProgress,
  pipeline,
  type PipelineStep,
  type SortDir,
  sortHires,
  type SortKey,
  isBuiltin,
} from "@hr/domain/business/onboarding/mod.ts";
import {
  type Department,
  type DocField,
  type DocKind,
  type Hire,
  type HrDocument,
  HrError,
  type HrSettings,
  type HrSystem,
  type Proof,
  type SystemKind,
} from "@hr/dto/hr.ts";

type Body_ = Record<string, unknown>;
const body = (
  b: unknown,
): Body_ => (b && typeof b === "object" ? b as Body_ : {});
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max = 500): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === "boolean" ? v : fallback;
const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : undefined;

export interface HireView extends Hire {
  name: string;
  progress: { done: number; total: number };
  pipeline: PipelineStep[];
  signUrl: string;
}

const KINDS: SystemKind[] = [
  "crm",
  "dialer",
  "email",
  "payroll",
  "esign",
  "comms",
  "sso",
  "other",
];
const FIELD_TYPES = ["signature", "initials", "date", "name", "text", "check"];

function parseFields(v: unknown): DocField[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: DocField[] = [];
  for (const f of v) {
    const o = body(f);
    const type = str(o.type);
    if (!FIELD_TYPES.includes(type)) continue;
    const num = (x: unknown) =>
      typeof x === "number" && Number.isFinite(x) ? x : NaN;
    const page = num(o.page), xPct = num(o.xPct), yPct = num(o.yPct);
    if ([page, xPct, yPct].some(Number.isNaN)) continue;
    out.push({
      id: str(o.id) || newId(),
      type: type as DocField["type"],
      page: Math.max(0, Math.floor(page)),
      xPct: Math.min(100, Math.max(0, xPct)),
      yPct: Math.min(100, Math.max(0, yPct)),
    });
  }
  return out;
}

/** the controllers' shared helpers — module-level: a Danet controller's every method is a route */
interface Deps {
  hires: HireStore;
  depts: DepartmentStore;
  docs: HrDocumentStore;
  systems: HrSystemStore;
  notices: HrNotices;
}

function view(d: Deps, h: Hire): HireView {
  return {
    ...h,
    name: fullName(h),
    progress: packetProgress(h.packet),
    pipeline: pipeline(h),
    signUrl: d.notices.signUrl(h.token),
  };
}

/** REQ-884c — a lapsed link reads back expired */
async function settled(d: Deps, h: Hire): Promise<Hire> {
  if (!isExpired(h, nowIso())) return h;
  return await d.hires.put({ ...h, status: "expired", updatedAt: nowIso() });
}

async function ownHire(d: Deps, userId: string, id: string): Promise<Hire> {
  const h = await d.hires.find(id);
  if (!h || h.userId !== userId) {
    throw new HrError("hire_not_found", 404, "hire not found");
  }
  return await settled(d, h);
}
async function ownDept(
  d: Deps,
  userId: string,
  id: string,
): Promise<Department> {
  const x = await d.depts.find(id);
  if (!x || x.userId !== userId) {
    throw new HrError("department_not_found", 404, "department not found");
  }
  return x;
}
async function ownDoc(
  d: Deps,
  userId: string,
  id: string,
): Promise<HrDocument> {
  const x = await d.docs.find(id);
  if (!x || x.userId !== userId || x.discardedAt) {
    throw new HrError("document_not_found", 404, "document not found");
  }
  return x;
}
async function ownSystem(
  d: Deps,
  userId: string,
  id: string,
): Promise<HrSystem> {
  const x = await d.systems.find(id);
  if (!x || x.userId !== userId) {
    throw new HrError("system_not_found", 404, "system not found");
  }
  return x;
}

function settingsView(s: HrSettings) {
  return { ...s, signingDomain: appUrl() };
}

async function checkDocIds(
  d: Deps,
  userId: string,
  ids: string[],
): Promise<string[]> {
  const live = (await d.docs.listByUser(userId)).filter((x) => !x.discardedAt)
    .map((x) => x.id);
  for (const id of ids) {
    if (!live.includes(id)) {
      throw new HrError(
        "unknown_document",
        400,
        `document ${id} is not in the library`,
      );
    }
  }
  return [...new Set(ids)];
}
async function checkSystemIds(
  d: Deps,
  userId: string,
  ids: string[],
): Promise<string[]> {
  const have = (await d.systems.listByUser(userId)).map((x) => x.id);
  for (const id of ids) {
    if (!have.includes(id)) {
      throw new HrError("unknown_system", 400, `system ${id} is not attached`);
    }
  }
  return [...new Set(ids)];
}

/** REQ-932 — a packet with nothing in it is never sent: the hire could never finish it */
function assertSendable(packet: readonly unknown[]): void {
  if (packet.length === 0) {
    throw new HrError(
      "packet_empty",
      409,
      "this department has no documents to sign yet",
    );
  }
}

/** REQ-884b — send the link; an expired hire gets a rotated token and returns to invited */
async function sendTo(d: Deps, h: Hire): Promise<Hire> {
  assertSendable(h.packet);
  const settings = await d.notices.settingsFor(h.userId);
  let next = h;
  if (h.status === "expired") {
    next = await d.hires.rotateToken(h, newToken());
    next = {
      ...next,
      status: "invited",
      tokenExpiresAt: expiresAt(nowIso(), settings.linkExpiryDays),
    };
  }
  const now = nowIso();
  next = await d.hires.put({
    ...next,
    mail: { ...next.mail, sentAt: now, remindedAt: null },
    updatedAt: now,
  });
  await d.notices.sendLink(next, "invite");
  return next;
}

/** REQ-885 — the hire behind a token; lapsed links are refused */
async function byToken(d: Deps, token: string): Promise<Hire> {
  const h = await d.hires.findByToken(token);
  if (!h) throw new HrError("link_not_found", 404, "this link is not valid");
  if (h.status === "expired" || isExpired(h, nowIso())) {
    if (h.status !== "expired") {
      await d.hires.put({ ...h, status: "expired", updatedAt: nowIso() });
    }
    throw new HrError(
      "link_expired",
      410,
      "this link has expired — ask HR for a new one",
    );
  }
  if (h.status === "offboarded") {
    throw new HrError("link_not_found", 404, "this link is not valid");
  }
  return h;
}

@Controller("hr")
export class HrController {
  constructor(
    readonly users: UserStore,
    readonly sessions: SessionStore,
    readonly hires: HireStore,
    readonly depts: DepartmentStore,
    readonly docs: HrDocumentStore,
    readonly systems: HrSystemStore,
    readonly proofs: ProofStore,
    readonly settings: HrSettingsStore,
    readonly files: FileStore,
    readonly notices: HrNotices,
    readonly provisioner: Provisioner,
  ) {}

  // ------------------------------------------------------------ settings

  /** REQ-889a */
  @Get("settings")
  async getSettings(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return settingsView(await this.notices.settingsFor(user.id));
  }

  @Put("settings")
  async putSettings(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const cur = await this.notices.settingsFor(user.id);
    let days = cur.linkExpiryDays;
    if (b.linkExpiryDays !== undefined) {
      days = Number(b.linkExpiryDays);
      if (!Number.isInteger(days) || days < 1 || days > 90) {
        throw new HrError(
          "expiry_invalid",
          400,
          "the link must expire after 1 to 90 days",
        );
      }
    }
    const next: HrSettings = {
      ...cur,
      companyName: b.companyName !== undefined
        ? str(b.companyName, 120)
        : cur.companyName,
      hrEmail: b.hrEmail !== undefined ? str(b.hrEmail, 200) : cur.hrEmail,
      linkExpiryDays: days,
      autoSend: bool(b.autoSend, cur.autoSend),
      autoProvision: bool(b.autoProvision, cur.autoProvision),
      remind24h: bool(b.remind24h, cur.remind24h),
      notifyOnComplete: bool(b.notifyOnComplete, cur.notifyOnComplete),
      credsUsername: b.credsUsername !== undefined
        ? str(b.credsUsername, 120)
        : cur.credsUsername,
      credsPassword: b.credsPassword !== undefined
        ? str(b.credsPassword, 120)
        : cur.credsPassword,
      updatedAt: nowIso(),
    };
    await this.settings.put(next);
    return settingsView(await this.notices.settingsFor(user.id));
  }

  // ------------------------------------------------------------- systems

  /** REQ-888a — the account's systems and what the catalog still offers */
  @Get("systems")
  async listSystems(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const systems = (await this.systems.listByUser(user.id)).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
    const catalog = SYSTEM_CATALOG.filter((c) =>
      !systems.some((s) => s.key === c.key)
    );
    return { systems, catalog };
  }

  @Post("systems")
  async attachSystem(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const key = str(b.key, 40);
    const existing = await this.systems.listByUser(user.id);
    const now = nowIso();
    let sys: HrSystem;
    if (key) {
      const c = SYSTEM_CATALOG.find((x) => x.key === key);
      if (!c) throw new HrError("unknown_system", 400, "not in the catalog");
      if (existing.some((s) => s.key === key)) {
        throw new HrError(
          "system_exists",
          409,
          `${c.name} is already attached`,
        );
      }
      sys = {
        id: newId(),
        userId: user.id,
        key,
        name: c.name,
        kind: c.kind,
        desc: c.desc,
        status: "connected",
        webhookUrl: null,
        createdAt: now,
        updatedAt: now,
      };
    } else {
      const name = str(b.name, 80);
      if (!name) throw new HrError("name_required", 400, "a name is required");
      if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
        throw new HrError("system_exists", 409, `${name} is already attached`);
      }
      const kind = str(b.kind, 20);
      sys = {
        id: newId(),
        userId: user.id,
        key: "custom",
        name,
        kind: KINDS.includes(kind as SystemKind) ? kind as SystemKind : "other",
        desc: str(b.desc, 120),
        status: "connected",
        webhookUrl: null,
        createdAt: now,
        updatedAt: now,
      };
    }
    await this.systems.put(sys);
    return ctx.json(sys, 201);
  }

  @Put("systems/:id")
  async updateSystem(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const sys = await ownSystem(this, user.id, id);
    const b = body(raw);
    // REQ-913 — a built-in arm runs in DocuMonster itself; it takes no webhook
    if (b.webhookUrl !== undefined && b.webhookUrl !== null && isBuiltin(sys.key)) {
      throw new HrError("builtin_no_webhook", 400, "a built-in system takes no webhook");
    }
    const next = { ...sys, updatedAt: nowIso() };
    if (b.status !== undefined) {
      if (b.status !== "connected" && b.status !== "available") {
        throw new HrError(
          "status_invalid",
          400,
          "status is connected or available",
        );
      }
      next.status = b.status;
    }
    if (b.webhookUrl !== undefined) {
      const url = b.webhookUrl === null ? "" : str(b.webhookUrl, 500);
      if (url && !/^https?:\/\//i.test(url)) {
        throw new HrError(
          "webhook_invalid",
          400,
          "the webhook must be an http(s) URL",
        );
      }
      next.webhookUrl = url || null;
    }
    if (b.name !== undefined && str(b.name, 80)) next.name = str(b.name, 80);
    if (b.desc !== undefined) next.desc = str(b.desc, 120);
    return await this.systems.put(next);
  }

  @Delete("systems/:id")
  async removeSystem(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const sys = await ownSystem(this, user.id, id);
    await this.systems.delete(sys);
    for (const d of await this.depts.listByUser(user.id)) {
      if (d.systemIds.includes(id)) {
        await this.depts.put({
          ...d,
          systemIds: d.systemIds.filter((x) => x !== id),
          updatedAt: nowIso(),
        });
      }
    }
    return { ok: true };
  }

  // ----------------------------------------------------------- documents

  /** REQ-886a */
  @Get("documents")
  async listDocuments(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return (await this.docs.listByUser(user.id)).filter((d) => !d.discardedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  @Post("documents")
  async createDocument(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const now = nowIso();
    const name = str(b.name, 120) || "Untitled document";
    const kind: DocKind = b.kind === "sign" ? "sign" : "ack";
    const doc: HrDocument = {
      id: newId(),
      userId: user.id,
      name,
      label: str(b.label, 160) || name,
      category: str(b.category, 80),
      kind,
      type: "text",
      creds: bool(b.creds, false),
      contentHtml: typeof b.contentHtml === "string"
        ? b.contentHtml.slice(0, 400_000)
        : "",
      pdfFileId: null,
      pdfName: null,
      fields: parseFields(b.fields) ?? [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      discardedAt: null,
    };
    await this.docs.put(doc);
    return ctx.json(doc, 201);
  }

  @Get("documents/:id")
  async getDocument(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await ownDoc(this, user.id, id);
  }

  @Put("documents/:id")
  async saveDocument(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const doc = await ownDoc(this, user.id, id);
    const b = body(raw);
    const patch: Partial<HrDocument> = {};
    if (b.name !== undefined) patch.name = str(b.name, 120) || doc.name;
    if (b.label !== undefined) {
      patch.label = str(b.label, 160) || patch.name || doc.name;
    }
    if (b.category !== undefined) patch.category = str(b.category, 80);
    if (b.kind !== undefined) patch.kind = b.kind === "sign" ? "sign" : "ack";
    if (b.creds !== undefined) patch.creds = bool(b.creds, doc.creds);
    if (typeof b.contentHtml === "string") {
      patch.contentHtml = b.contentHtml.slice(0, 400_000);
    }
    const fields = parseFields(b.fields);
    if (fields) patch.fields = fields;
    if (doc.type === "pdf" && patch.kind === "ack") patch.kind = "sign"; // a PDF is signed
    const version = bumpsVersion(doc, patch) ? doc.version + 1 : doc.version;
    return await this.docs.put({
      ...doc,
      ...patch,
      version,
      updatedAt: nowIso(),
    });
  }

  /** REQ-886a — the PDF behind the document; the editor stamps fields onto it */
  @Post("documents/:id/pdf")
  async importPdf(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const doc = await ownDoc(this, user.id, id);
    const b = body(raw);
    const base64 = str(b.base64, 12_000_000);
    if (!base64) throw new HrError("pdf_required", 400, "base64 is required");
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(base64);
    } catch {
      throw new HrError("pdf_invalid", 400, "the file is not base64");
    }
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new HrError("file_too_large", 413, "the PDF is over 8 MiB");
    }
    if (!new TextDecoder().decode(bytes.slice(0, 8)).startsWith("%PDF")) {
      throw new HrError("pdf_invalid", 400, "the file is not a PDF");
    }
    const filename = str(b.filename, 200) || "document.pdf";
    const meta = await this.files.create({
      userId: user.id,
      filename,
      mimeType: "application/pdf",
      bytes,
    });
    const next: HrDocument = {
      ...doc,
      type: "pdf",
      kind: "sign",
      pdfFileId: meta.id,
      pdfName: filename,
      version: doc.version + 1,
      updatedAt: nowIso(),
    };
    if (next.name === "Untitled document") {
      next.name = filename.replace(/\.pdf$/i, "");
      if (next.label === "Untitled document") next.label = next.name;
    }
    return await this.docs.put(next);
  }

  @Get("documents/:id/pdf")
  async readPdf(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const doc = await ownDoc(this, user.id, id);
    if (!doc.pdfFileId) {
      throw new HrError("no_pdf", 404, "the document has no PDF");
    }
    return pdfResponse(
      await this.files.readBytes(doc.pdfFileId),
      doc.pdfName ?? "document.pdf",
    );
  }

  @Delete("documents/:id")
  async discardDocument(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const doc = await ownDoc(this, user.id, id);
    await this.docs.put({ ...doc, discardedAt: nowIso(), updatedAt: nowIso() });
    for (const d of await this.depts.listByUser(user.id)) {
      if (d.docIds.includes(id)) {
        await this.depts.put({
          ...d,
          docIds: d.docIds.filter((x) => x !== id),
          updatedAt: nowIso(),
        });
      }
    }
    return { ok: true };
  }

  // --------------------------------------------------------- departments

  /** REQ-887a */
  @Get("departments")
  async listDepartments(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return (await this.depts.listByUser(user.id)).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  @Post("departments")
  async createDepartment(
    @Context() ctx: ExecutionContext,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const name = str(b.name, 80);
    if (!name) {
      throw new HrError("name_required", 400, "give the department a name");
    }
    const all = await this.depts.listByUser(user.id);
    if (all.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
      throw new HrError("department_exists", 409, `${name} already exists`);
    }
    const now = nowIso();
    const dept: Department = {
      id: newId(),
      userId: user.id,
      name,
      division: b.division === "inbound" ? "inbound" : "outbound",
      docIds: await checkDocIds(this, user.id, strList(b.docIds) ?? []),
      systemIds: await checkSystemIds(
        this,
        user.id,
        strList(b.systemIds) ?? [],
      ),
      createdAt: now,
      updatedAt: now,
    };
    await this.depts.put(dept);
    return ctx.json(dept, 201);
  }

  @Get("departments/:id")
  async getDepartment(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await ownDept(this, user.id, id);
  }

  @Put("departments/:id")
  async updateDepartment(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dept = await ownDept(this, user.id, id);
    const b = body(raw);
    const next = { ...dept, updatedAt: nowIso() };
    if (b.name !== undefined) {
      const name = str(b.name, 80);
      if (!name) {
        throw new HrError("name_required", 400, "give the department a name");
      }
      const all = await this.depts.listByUser(user.id);
      if (
        all.some((d) =>
          d.id !== id && d.name.toLowerCase() === name.toLowerCase()
        )
      ) throw new HrError("department_exists", 409, `${name} already exists`);
      next.name = name;
    }
    if (b.division !== undefined) {
      next.division = b.division === "inbound" ? "inbound" : "outbound";
    }
    const docIds = strList(b.docIds);
    if (docIds) next.docIds = await checkDocIds(this, user.id, docIds);
    const systemIds = strList(b.systemIds);
    if (systemIds) {
      next.systemIds = await checkSystemIds(this, user.id, systemIds);
    }
    await this.depts.put(next);
    if (next.name !== dept.name) {
      for (const h of await this.hires.listByUser(user.id)) {
        if (h.departmentId === id) {
          await this.hires.put({
            ...h,
            departmentName: next.name,
            updatedAt: nowIso(),
          });
        }
      }
    }
    return next;
  }

  // -------------------------------------------------------------- hires

  /** REQ-889c */
  @Get("dashboard")
  async dashboard(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.notices.sweepReminders(user.id);
    const hires: Hire[] = [];
    for (const h of await this.hires.listByUser(user.id)) {
      hires.push(await settled(this, h));
    }
    const s = dashboardStats(hires, nowIso());
    return { ...s, recent: s.recent.map((h) => view(this, h)) };
  }

  /** REQ-884c — the roster, unfinished first; every read runs the reminder sweep (REQ-889b) */
  @Get("hires")
  async listHires(
    @Context() ctx: ExecutionContext,
    @Query("sort") sort?: string,
    @Query("dir") dir?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.notices.sweepReminders(user.id);
    const hires: Hire[] = [];
    for (const h of await this.hires.listByUser(user.id)) {
      hires.push(await settled(this, h));
    }
    const key: SortKey =
      (["name", "dept", "start", "progress", "status"] as const).includes(
          sort as SortKey,
        )
        ? sort as SortKey
        : "status";
    const d: SortDir = dir === "desc" ? "desc" : "asc";
    return sortHires(hires, key, d).map((h) => view(this, h));
  }

  /** REQ-884a — the packet is minted from the department now and frozen */
  @Post("hires")
  async createHire(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = body(raw);
    const firstName = str(b.firstName, 60);
    if (!firstName) {
      throw new HrError("name_required", 400, "add at least a first name");
    }
    const departmentId = str(b.departmentId, 80);
    if (!departmentId) {
      throw new HrError("department_required", 400, "pick a department");
    }
    const dept = await ownDept(this, user.id, departmentId);
    let phone = "";
    if (str(b.phone)) {
      try {
        phone = normalizePhone(str(b.phone, 40));
      } catch {
        throw new HrError(
          "phone_invalid",
          400,
          "that mobile number cannot be texted",
        );
      }
    }
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(str(b.startDate))
      ? str(b.startDate)
      : "";
    const settings = await this.notices.settingsFor(user.id);
    const docs = await this.docs.listByUser(user.id);
    const packet = mintPacket(dept, docs);
    assertSendable(packet);
    const now = nowIso();
    const hire: Hire = {
      id: newId(),
      userId: user.id,
      firstName,
      lastName: str(b.lastName, 80),
      email: str(b.email, 200),
      phone,
      departmentId: dept.id,
      departmentName: dept.name,
      startDate,
      status: "invited",
      token: newToken(),
      tokenExpiresAt: expiresAt(now, settings.linkExpiryDays),
      packet,
      systemIds: [...dept.systemIds],
      mail: { sentAt: null, openedAt: null, remindedAt: null },
      provisioning: [],
      createdAt: now,
      updatedAt: now,
      signedAt: null,
      activeAt: null,
      offboardedAt: null,
    };
    await this.hires.put(hire);
    let out = hire;
    if (settings.autoSend) out = await sendTo(this, hire);
    return ctx.json(view(this, out), 201);
  }

  @Get("hires/:id")
  async getHire(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return view(this, await ownHire(this, user.id, id));
  }

  /** REQ-884b — resend, or re-issue an expired link with a rotated token */
  @Post("hires/:id/send")
  async sendLink(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const h = await ownHire(this, user.id, id);
    if (h.status === "offboarded") {
      throw new HrError("offboarded", 409, "this person was offboarded");
    }
    return view(this, await sendTo(this, h));
  }

  /** REQ-888c — every arm, or one again */
  @Post("hires/:id/provision")
  async provision(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const h = await ownHire(this, user.id, id);
    if (!["signed", "provisioning", "active"].includes(h.status)) {
      throw new HrError("not_signed", 409, "the packet is not complete yet");
    }
    const only = str(body(raw).systemId, 80) || undefined;
    return view(this, await this.provisioner.run(h, only));
  }

  @Post("hires/:id/provision/:systemId/done")
  async markDone(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Param("systemId") systemId: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const h = await ownHire(this, user.id, id);
    const next = await this.provisioner.markDone(h, systemId);
    if (!next) {
      throw new HrError("arm_not_found", 404, "that system is not in the plan");
    }
    return view(this, next);
  }

  /** REQ-888d */
  @Post("hires/:id/offboard")
  async offboard(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const h = await ownHire(this, user.id, id);
    if (h.status === "offboarded") {
      throw new HrError("offboarded", 409, "already offboarded");
    }
    return view(this, await this.provisioner.offboard(h));
  }

  /** REQ-885d — the proof behind a packet row */
  @Get("hires/:id/proofs/:docId")
  async proof(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Param("docId") docId: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const h = await ownHire(this, user.id, id);
    const p = await this.proofs.findForDoc(h.id, docId);
    if (!p) throw new HrError("not_signed_yet", 404, "not signed yet");
    return p;
  }
}

function pdfResponse(bytes: Uint8Array, name: string): Response {
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(bytes.length),
      "content-disposition": `inline; filename="${
        name.replace(/[^\w.\- ]/g, "_")
      }"`,
    },
  });
}

/** REQ-885 — the hire's side: the token is the identity */
@Controller("hr/sign")
export class HrSignController {
  constructor(
    readonly hires: HireStore,
    readonly depts: DepartmentStore,
    readonly docs: HrDocumentStore,
    readonly systems: HrSystemStore,
    readonly proofs: ProofStore,
    readonly files: FileStore,
    readonly users: UserStore,
    readonly notices: HrNotices,
    readonly provisioner: Provisioner,
  ) {}

  /** REQ-885a — the packet for the phone; the first open is recorded */
  @Get(":token")
  async open(@Param("token") token: string) {
    let h = await byToken(this, token);
    if (h.status === "invited") {
      const now = nowIso();
      h = await this.hires.put({
        ...h,
        status: "opened",
        mail: { ...h.mail, openedAt: h.mail.openedAt ?? now },
        updatedAt: now,
      });
    }
    const [settings, user] = await Promise.all([
      this.notices.settingsFor(h.userId),
      this.users.get(h.userId).catch(() => null),
    ]);
    const docs = [];
    for (const p of h.packet) {
      const d = await this.docs.find(p.docId);
      const creds = !!d?.creds;
      docs.push({
        docId: p.docId,
        name: p.name,
        label: p.label,
        category: d?.category ?? "",
        kind: p.kind,
        type: d?.type ?? "text",
        contentHtml: d?.contentHtml ?? "",
        fields: d?.fields ?? [],
        creds,
        ...(creds && (settings.credsUsername || settings.credsPassword)
          ? {
            credentials: {
              username: settings.credsUsername,
              password: settings.credsPassword,
            },
          }
          : {}),
        done: p.done,
        doneAt: p.doneAt,
      });
    }
    return {
      firstName: h.firstName,
      departmentName: h.departmentName,
      companyName: settings.companyName,
      lang: user?.language === "es" ? "es" : "en",
      status: h.status,
      progress: packetProgress(h.packet),
      docs,
    };
  }

  @Get(":token/pdf/:docId")
  async pdf(@Param("token") token: string, @Param("docId") docId: string) {
    const h = await byToken(this, token);
    if (!h.packet.some((p) => p.docId === docId)) {
      throw new HrError("document_not_found", 404, "not in this packet");
    }
    const d = await this.docs.find(docId);
    if (!d?.pdfFileId) {
      throw new HrError("no_pdf", 404, "the document has no PDF");
    }
    return pdfResponse(
      await this.files.readBytes(d.pdfFileId),
      d.pdfName ?? "document.pdf",
    );
  }

  /** REQ-885b — sign or acknowledge one document; the proof is the audit record */
  @Post(":token/docs/:docId")
  async sign(
    @Context() ctx: ExecutionContext,
    @Param("token") token: string,
    @Param("docId") docId: string,
    @Body() raw: unknown,
  ) {
    const h = await byToken(this, token);
    const idx = h.packet.findIndex((p) => p.docId === docId);
    if (idx < 0) {
      throw new HrError("document_not_found", 404, "not in this packet");
    }
    const p = h.packet[idx];
    if (p.done) throw new HrError("already_signed", 409, "already done");
    const b = body(raw);
    if (b.consent !== true) {
      throw new HrError(
        "consent_required",
        400,
        "please acknowledge to continue",
      );
    }
    const printedName = str(b.printedName, 120) || fullName(h);
    const signaturePng = typeof b.signaturePng === "string" &&
        b.signaturePng.startsWith("data:image/")
      ? b.signaturePng.slice(0, 600_000)
      : null;
    if (p.kind === "sign" && (!signaturePng || !printedName)) {
      throw new HrError("signature_required", 400, "please sign to continue");
    }
    const user = await this.users.get(h.userId).catch(() => null);
    const lang = user?.language === "es" ? "es" : "en";
    const now = nowIso();
    const proof: Proof = {
      id: newId(),
      userId: h.userId,
      hireId: h.id,
      docId,
      docVersion: p.version,
      kind: p.kind,
      printedName,
      signaturePng: p.kind === "sign" ? signaturePng : null,
      consentText: t(lang, "hr.consent", { label: p.label }),
      ip: (ctx.req.header("x-forwarded-for") ?? "").split(",")[0].trim() || "",
      userAgent: ctx.req.header("user-agent") ?? "",
      at: now,
    };
    await this.proofs.put(proof);
    const packet = h.packet.map((d, i) =>
      i === idx ? { ...d, done: true, doneAt: now, proofId: proof.id } : d
    );
    const complete = allDone(packet);
    let next: Hire = {
      ...h,
      packet,
      status: complete ? "signed" : "signing",
      signedAt: complete ? now : h.signedAt,
      updatedAt: now,
    };
    await this.hires.put(next);
    if (complete) {
      const settings = await this.notices.settingsFor(h.userId);
      await this.notices.notifyComplete(next);
      if (settings.autoProvision) next = await this.provisioner.run(next);
    }
    return ctx.json({
      proof,
      status: next.status,
      progress: packetProgress(packet),
      complete,
    }, 201);
  }
}
