/**
 * REQ-883 — the HR module's records. Every one is the account's (userId): the account is the
 * tenant. A hire's packet is minted from the department at creation and frozen; a proof is the
 * per-document audit record of a signature or an acknowledgment; a provisioning result is one
 * system's arm (REQ-888).
 */
/** Legacy (REQ-887 → amended by REQ-1002): the call-centre prototype's Inbound/Outbound. */
export type Division = "inbound" | "outbound";
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
  /** 0-based page of the PDF */
  page: number;
  xPct: number;
  yPct: number;
}

export interface HrDocument {
  id: string;
  userId: string;
  /** admin-facing */
  name: string;
  /** what the hire sees */
  label: string;
  category: string;
  kind: DocKind;
  type: DocType;
  /** print the hire's login credentials on it */
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
  /** REQ-1002: no longer asked for or written — only departments created before it carry
   * one; nothing reads it (the packet is docIds, provisioning is systemIds). */
  division?: Division;
  /** what a hire SIGNS */
  docIds: string[];
  /** what we BUILD */
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
export type SystemStatus = "connected" | "available";

export interface HrSystem {
  id: string;
  userId: string;
  /** the catalog key, or "custom" */
  key: string;
  name: string;
  kind: SystemKind;
  desc: string;
  status: SystemStatus;
  /** REQ-888 — the arm: POSTed the hire on provision / offboard; null = manual */
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
  userId: string;
  companyName: string;
  hrEmail: string;
  linkExpiryDays: number;
  autoSend: boolean;
  autoProvision: boolean;
  remind24h: boolean;
  notifyOnComplete: boolean;
  /** REQ-885e — printed on a document flagged `creds` (the handbook portal's login) */
  credsUsername: string;
  credsPassword: string;
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

export interface HireMail {
  sentAt: string | null;
  openedAt: string | null;
  remindedAt: string | null;
}

export interface Hire {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  departmentId: string;
  /** snapshot; follows a rename */
  departmentName: string;
  /** YYYY-MM-DD */
  startDate: string;
  status: HireStatus;
  token: string;
  tokenExpiresAt: string;
  /** frozen at creation */
  packet: PacketDoc[];
  /** the department's systems at creation — the plan when the department is gone */
  systemIds: string[];
  mail: HireMail;
  provisioning: ProvisionResult[];
  createdAt: string;
  updatedAt: string;
  signedAt: string | null;
  activeAt: string | null;
  offboardedAt: string | null;
}

export interface Proof {
  id: string;
  userId: string;
  hireId: string;
  docId: string;
  docVersion: number;
  kind: DocKind;
  printedName: string;
  /** a PNG data URL for a signature; null for an acknowledgment */
  signaturePng: string | null;
  consentText: string;
  ip: string;
  userAgent: string;
  at: string;
}

export class HrError extends Error {
  constructor(
    /** a stable code the client can switch on */
    readonly code: string,
    readonly status = 400,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "HrError";
  }
}
