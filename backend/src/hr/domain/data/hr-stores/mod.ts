/**
 * REQ-883 — the HR module's records, in KV, every one owned by an account (OwnedStore):
 *   [hr_hire, id] / [hr_hire_by_user, userId, id] / [hr_hire_by_token, token] → id
 *   [hr_department, id] / [hr_department_by_user, userId, id]
 *   [hr_document, id] / [hr_document_by_user, userId, id]
 *   [hr_system, id] / [hr_system_by_user, userId, id]
 *   [hr_proof, id] / [hr_proof_by_user, userId, id] / [hr_proof_by_hire, hireId, docId] → id
 *   [hr_settings, userId] → the account's settings
 */
import { Injectable } from "#danet/core";
import { encodeBase64Url } from "#std/encoding/base64url";
import { getKv } from "@core/data/kv/mod.ts";
import { OwnedStore } from "@field/domain/data/field-stores/mod.ts";
import type {
  CatalogEntry,
  Department,
  Hire,
  HrDocument,
  HrSettings,
  HrSystem,
  Proof,
} from "@hr/dto/hr.ts";

export const newId = (): string => crypto.randomUUID();

/** REQ-884a — 128 bits, URL-safe: the hire's whole identity */
export function newToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

@Injectable()
export class HireStore extends OwnedStore<Hire> {
  constructor() {
    super("hr_hire");
  }
  protected override extraKeys(h: Hire): Deno.KvKey[] {
    return [["hr_hire_by_token", h.token]];
  }
  async findByToken(token: string): Promise<Hire | null> {
    if (!token) return null;
    const kv = await getKv();
    const id = (await kv.get<string>(["hr_hire_by_token", token])).value;
    const h = id ? await this.find(id) : null;
    return h && h.token === token ? h : null;
  }
  /** a rotated token leaves no old key behind */
  async rotateToken(h: Hire, token: string): Promise<Hire> {
    const kv = await getKv();
    await kv.delete(["hr_hire_by_token", h.token]);
    return await this.put({ ...h, token });
  }
  /** every account's hires — the reminder sweep (REQ-889b) */
  async listAll(): Promise<Hire[]> {
    const kv = await getKv();
    const out: Hire[] = [];
    for await (const e of kv.list<Hire>({ prefix: ["hr_hire"] })) {
      out.push(e.value);
    }
    return out;
  }
}

@Injectable()
export class DepartmentStore extends OwnedStore<Department> {
  constructor() {
    super("hr_department");
  }
}

@Injectable()
export class HrDocumentStore extends OwnedStore<HrDocument> {
  constructor() {
    super("hr_document");
  }
}

@Injectable()
export class HrSystemStore extends OwnedStore<HrSystem> {
  constructor() {
    super("hr_system");
  }
  override async get(id: string): Promise<HrSystem> {
    return currentDesc(await super.get(id));
  }
  override async find(id: string): Promise<HrSystem | null> {
    const s = await super.find(id);
    return s ? currentDesc(s) : null;
  }
  override async listByUser(userId: string): Promise<HrSystem[]> {
    return (await super.listByUser(userId)).map(currentDesc);
  }
}

/** REQ-1036 — a built-in system attached before the catalog copy changed still carries the old
 *  catalog desc in KV (attach copies it); read it as today's catalog desc. A desc the owner wrote
 *  themselves is left alone. */
const STALE_DESC: Record<string, string> = {
  "dm-email": "A welcome note with the handbook portal's login, from DocuMonster",
};
function currentDesc(s: HrSystem): HrSystem {
  const stale = s.key ? STALE_DESC[s.key] : undefined;
  if (!stale || s.desc !== stale) return s;
  const now = SYSTEM_CATALOG.find((c) => c.key === s.key)?.desc;
  return now ? { ...s, desc: now } : s;
}

@Injectable()
export class ProofStore extends OwnedStore<Proof> {
  constructor() {
    super("hr_proof");
  }
  protected override extraKeys(p: Proof): Deno.KvKey[] {
    return [["hr_proof_by_hire", p.hireId, p.docId]];
  }
  async findForDoc(hireId: string, docId: string): Promise<Proof | null> {
    const kv = await getKv();
    const id =
      (await kv.get<string>(["hr_proof_by_hire", hireId, docId])).value;
    return id ? await this.find(id) : null;
  }
}

export const DEFAULT_SETTINGS: Omit<
  HrSettings,
  "userId" | "updatedAt" | "companyName" | "hrEmail"
> = {
  linkExpiryDays: 7,
  autoSend: true,
  autoProvision: true,
  remind24h: true,
  notifyOnComplete: false,
  credsUsername: "",
  credsPassword: "",
};

@Injectable()
export class HrSettingsStore {
  async find(userId: string): Promise<HrSettings | null> {
    const kv = await getKv();
    return (await kv.get<HrSettings>(["hr_settings", userId])).value;
  }
  async put(s: HrSettings): Promise<HrSettings> {
    const kv = await getKv();
    await kv.set(["hr_settings", s.userId], s);
    return s;
  }
}

/**
 * REQ-913 — what a department can build for a hire: DocuMonster's own four arms. The prototype's
 * third parties (Quickbase, Readymode, Five9, Paychex, Google email, DocuSign, Salesforce, Slack,
 * ADP, Twilio, Okta) are gone — DocuMonster is the source of truth; anything outside it is a
 * custom system with a webhook (REQ-888b). E-signature needs no system: the hire signs here.
 */
export const SYSTEM_CATALOG: CatalogEntry[] = [
  {
    key: "dm-worker",
    name: "DocuMonster worker account",
    kind: "crm",
    desc: "The hire becomes a Worker in Field, by their cell, and is texted their PIN",
  },
  {
    key: "dm-admin",
    name: "DocuMonster editor",
    kind: "sso",
    desc: "The hire is invited as an editor of this account",
  },
  {
    key: "dm-email",
    name: "Welcome email (Postmark)",
    kind: "email",
    // REQ-1036: the note is From the hiring business (REQ-1003), not DocuMonster
    desc: "A welcome note with the handbook portal's login, from your business",
  },
  {
    key: "dm-text",
    name: "Welcome text (your line)",
    kind: "comms",
    desc: "The same welcome by text, from this account's phone line",
  },
];
