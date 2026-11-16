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

/** REQ-888a — what the System integrator offers */
export const SYSTEM_CATALOG: CatalogEntry[] = [
  {
    key: "quickbase",
    name: "Quickbase CRM",
    kind: "crm",
    desc: "CRM record of record",
  },
  {
    key: "readymode",
    name: "Readymode",
    kind: "dialer",
    desc: "Predictive dialer",
  },
  { key: "five9", name: "Five9", kind: "dialer", desc: "Cloud contact center" },
  { key: "paychex", name: "Paychex", kind: "payroll", desc: "Payroll & HR" },
  {
    key: "gmail",
    name: "Email (Google)",
    kind: "email",
    desc: "Account provisioning",
  },
  { key: "docusign", name: "DocuSign", kind: "esign", desc: "E-signature" },
  { key: "salesforce", name: "Salesforce", kind: "crm", desc: "CRM" },
  { key: "slack", name: "Slack", kind: "comms", desc: "Team comms" },
  { key: "adp", name: "ADP", kind: "payroll", desc: "Payroll & HR" },
  { key: "twilio", name: "Twilio", kind: "comms", desc: "SMS delivery" },
  { key: "okta", name: "Okta", kind: "sso", desc: "SSO & identity" },
];
