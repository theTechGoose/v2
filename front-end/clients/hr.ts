/**
 * REQ-883 — the HR module's HTTP client. Backend:
 * backend/src/hr/entrypoints/hr-controllers/mod.ts — /hr/* behind the owner's session,
 * /hr/sign/:token public (the token is the hire's identity).
 */
import { api, type ApiOptions } from "../lib/api.ts";

export type DocKind = "ack" | "sign";
export type DocType = "text" | "pdf";
export type FieldType =
  | "signature"
  | "initials"
  | "date"
  | "name"
  | "text"
  | "check";
export interface DocField {
  id: string;
  type: FieldType;
  page: number;
  xPct: number;
  yPct: number;
}
export interface HrDocument {
  id: string;
  userId: string;
  name: string;
  label: string;
  category: string;
  kind: DocKind;
  type: DocType;
  creds: boolean;
  contentHtml: string;
  pdfFileId: string | null;
  pdfName: string | null;
  fields: DocField[];
  version: number;
  createdAt: string;
  updatedAt: string;
  discardedAt: string | null;
}
export interface Department {
  id: string;
  userId: string;
  name: string;
  /** REQ-1002: legacy, only on departments made before it; never shown or sent */
  division?: "inbound" | "outbound";
  docIds: string[];
  systemIds: string[];
  createdAt: string;
  updatedAt: string;
}
export type SystemKind =
  | "crm"
  | "dialer"
  | "email"
  | "payroll"
  | "esign"
  | "comms"
  | "sso"
  | "other";
export interface HrSystem {
  id: string;
  userId: string;
  key: string;
  name: string;
  kind: SystemKind;
  desc: string;
  status: "connected" | "available";
  webhookUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CatalogEntry {
  key: string;
  name: string;
  kind: SystemKind;
  desc: string;
}
export interface HrSettings {
  companyName: string;
  hrEmail: string;
  linkExpiryDays: number;
  autoSend: boolean;
  autoProvision: boolean;
  remind24h: boolean;
  notifyOnComplete: boolean;
  credsUsername: string;
  credsPassword: string;
  signingDomain: string;
  updatedAt: string;
}
export type HireStatus =
  | "invited"
  | "opened"
  | "signing"
  | "signed"
  | "provisioning"
  | "active"
  | "expired"
  | "offboarded";
export interface PacketDoc {
  docId: string;
  name: string;
  label: string;
  kind: DocKind;
  version: number;
  done: boolean;
  doneAt: string | null;
  proofId: string | null;
}
export type ArmState =
  | "queued"
  | "ok"
  | "fault"
  | "manual"
  | "done"
  | "torn_down"
  | "teardown_fault";
export interface ProvisionResult {
  systemId: string;
  name: string;
  state: ArmState;
  detail: string | null;
  at: string;
}
export interface PipelineStep {
  key: "invited" | "opened" | "signing" | "signed" | "provisioned";
  state: "done" | "active" | "pending";
}
export interface Hire {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  departmentId: string;
  departmentName: string;
  startDate: string;
  status: HireStatus;
  token: string;
  tokenExpiresAt: string;
  packet: PacketDoc[];
  systemIds: string[];
  mail: {
    sentAt: string | null;
    openedAt: string | null;
    remindedAt: string | null;
  };
  provisioning: ProvisionResult[];
  progress: { done: number; total: number };
  pipeline: PipelineStep[];
  signUrl: string;
  createdAt: string;
  updatedAt: string;
  signedAt: string | null;
  activeAt: string | null;
  offboardedAt: string | null;
}
export interface Proof {
  id: string;
  hireId: string;
  docId: string;
  docVersion: number;
  kind: DocKind;
  printedName: string;
  signaturePng: string | null;
  consentText: string;
  ip: string;
  userAgent: string;
  at: string;
}
export interface Dashboard {
  sent: number;
  completed: number;
  awaiting: number;
  accounts: number;
  byDay: { day: string; sent: number }[];
  statusMix: { signed: number; awaiting: number; expired: number };
  byDepartment: { department: string; signed: number; awaiting: number }[];
  recent: Hire[];
}
/** what the phone gets (REQ-885a): the first name only */
export interface SignDoc {
  docId: string;
  name: string;
  label: string;
  category: string;
  kind: DocKind;
  type: DocType;
  contentHtml: string;
  fields: DocField[];
  creds: boolean;
  credentials?: { username: string; password: string };
  done: boolean;
  doneAt: string | null;
}
export interface SignPacket {
  firstName: string;
  departmentName: string;
  companyName: string;
  lang: "en" | "es";
  status: HireStatus;
  progress: { done: number; total: number };
  docs: SignDoc[];
  /** REQ-1156 — the accounts the hire's provisioning plan will create (0: no systems) */
  accounts: number;
}

export interface NewHire {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  departmentId: string;
  startDate?: string;
}

export const hrClient = {
  dashboard: (opts?: ApiOptions) => api.get<Dashboard>("/hr/dashboard", opts),
  hires: (sort?: string, dir?: string, opts?: ApiOptions) =>
    api.get<Hire[]>("/hr/hires", { ...opts, query: { sort, dir } }),
  hire: (id: string, opts?: ApiOptions) =>
    api.get<Hire>(`/hr/hires/${encodeURIComponent(id)}`, opts),
  createHire: (body: NewHire) => api.post<Hire>("/hr/hires", body),
  sendLink: (id: string) =>
    api.post<Hire>(`/hr/hires/${encodeURIComponent(id)}/send`, {}),
  provision: (id: string, systemId?: string) =>
    api.post<Hire>(`/hr/hires/${encodeURIComponent(id)}/provision`, {
      systemId,
    }),
  markDone: (id: string, systemId: string) =>
    api.post<Hire>(
      `/hr/hires/${encodeURIComponent(id)}/provision/${
        encodeURIComponent(systemId)
      }/done`,
      {},
    ),
  offboard: (id: string) =>
    api.post<Hire>(`/hr/hires/${encodeURIComponent(id)}/offboard`, {}),
  proof: (id: string, docId: string) =>
    api.get<Proof>(
      `/hr/hires/${encodeURIComponent(id)}/proofs/${encodeURIComponent(docId)}`,
    ),

  documents: (opts?: ApiOptions) =>
    api.get<HrDocument[]>("/hr/documents", opts),
  document: (id: string) =>
    api.get<HrDocument>(`/hr/documents/${encodeURIComponent(id)}`),
  createDocument: (body: Partial<HrDocument>) =>
    api.post<HrDocument>("/hr/documents", body),
  saveDocument: (id: string, body: Partial<HrDocument>) =>
    api.put<HrDocument>(`/hr/documents/${encodeURIComponent(id)}`, body),
  importPdf: (id: string, filename: string, base64: string) =>
    api.post<HrDocument>(`/hr/documents/${encodeURIComponent(id)}/pdf`, {
      filename,
      base64,
    }),
  pdfUrl: (id: string) => `/api/hr/documents/${encodeURIComponent(id)}/pdf`,
  discardDocument: (id: string) =>
    api.delete<{ ok: true }>(`/hr/documents/${encodeURIComponent(id)}`),

  departments: (opts?: ApiOptions) =>
    api.get<Department[]>("/hr/departments", opts),
  department: (id: string) =>
    api.get<Department>(`/hr/departments/${encodeURIComponent(id)}`),
  createDepartment: (body: { name: string }) =>
    api.post<Department>("/hr/departments", body),
  saveDepartment: (id: string, body: Partial<Department>) =>
    api.put<Department>(`/hr/departments/${encodeURIComponent(id)}`, body),

  systems: (opts?: ApiOptions) =>
    api.get<{ systems: HrSystem[]; catalog: CatalogEntry[] }>(
      "/hr/systems",
      opts,
    ),
  attachSystem: (
    body: { key: string } | { name: string; kind: SystemKind; desc: string },
  ) => api.post<HrSystem>("/hr/systems", body),
  saveSystem: (
    id: string,
    body: { status?: "connected" | "available"; webhookUrl?: string | null },
  ) => api.put<HrSystem>(`/hr/systems/${encodeURIComponent(id)}`, body),
  removeSystem: (id: string) =>
    api.delete<{ ok: true }>(`/hr/systems/${encodeURIComponent(id)}`),

  settings: (opts?: ApiOptions) => api.get<HrSettings>("/hr/settings", opts),
  saveSettings: (body: Partial<HrSettings>) =>
    api.put<HrSettings>("/hr/settings", body),
};

/** REQ-885 — the hire's side, by token */
export const hrSignClient = {
  open: (token: string, opts?: ApiOptions) =>
    api.get<SignPacket>(`/hr/sign/${encodeURIComponent(token)}`, opts),
  sign: (
    token: string,
    docId: string,
    body: { printedName?: string; consent: boolean; signaturePng?: string },
  ) =>
    api.post<
      {
        proof: Proof;
        status: HireStatus;
        progress: { done: number; total: number };
        complete: boolean;
      }
    >(
      `/hr/sign/${encodeURIComponent(token)}/docs/${encodeURIComponent(docId)}`,
      body,
    ),
  pdfUrl: (token: string, docId: string) =>
    `/api/hr/sign/${encodeURIComponent(token)}/pdf/${
      encodeURIComponent(docId)
    }`,
};
