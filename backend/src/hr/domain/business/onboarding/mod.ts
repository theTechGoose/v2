/**
 * REQ-884..889 — the HR module's pure rules. No I/O: the roster's order, the packet minted
 * from a department, link expiry, the pipeline a hire is on, the document version rule, the
 * provisioning plan and what its results add up to, the 24-hour reminder, the overview's numbers.
 */
import type {
  Department,
  Hire,
  HireStatus,
  HrDocument,
  HrSystem,
  PacketDoc,
  ProvisionResult,
} from "@hr/dto/hr.ts";
import { businessFrom } from "@communication/domain/business/sender/mod.ts";

/** REQ-1003 / REQ-1036 — who every email to a new hire is from: the hiring business (its name as
 *  the display name, its alias as the address, REQ-628), never DocuMonster; a reply reaches the
 *  account's HR address when one is on file. One sender for the invite, its reminder and the
 *  provisioner's welcome note. */
export function newHireSender(input: {
  alias?: string | null;
  company?: string | null;
  hrEmail?: string | null;
}): { from: string; replyTo?: string } {
  const from = businessFrom({ alias: input.alias, name: input.company });
  const replyTo = (input.hrEmail ?? "").trim();
  return replyTo ? { from, replyTo } : { from };
}

/** unfinished hires first (REQ-884c) */
export const STATUS_RANK: Record<HireStatus, number> = {
  expired: 0,
  opened: 1,
  invited: 2,
  signing: 3,
  signed: 4,
  provisioning: 5,
  active: 6,
  offboarded: 7,
};

export type SortKey = "name" | "dept" | "start" | "progress" | "status";
export type SortDir = "asc" | "desc";

export const fullName = (h: Pick<Hire, "firstName" | "lastName">): string =>
  `${h.firstName} ${h.lastName}`.trim();

export function sortHires(
  hires: Hire[],
  key: SortKey = "status",
  dir: SortDir = "asc",
): Hire[] {
  const m = dir === "asc" ? 1 : -1;
  const val = (h: Hire): string | number =>
    key === "name"
      ? fullName(h).toLowerCase()
      : key === "dept"
      ? h.departmentName.toLowerCase()
      : key === "start"
      ? h.startDate
      : key === "progress"
      ? h.packet.filter((d) => d.done).length / (h.packet.length || 1)
      : STATUS_RANK[h.status] ?? 9;
  return [...hires].sort((a, b) => {
    const av = val(a), bv = val(b);
    if (av < bv) return -m;
    if (av > bv) return m;
    return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
  });
}

/** REQ-884a — the department's live documents, in its order, frozen onto the hire */
export function mintPacket(dept: Department, docs: HrDocument[]): PacketDoc[] {
  const out: PacketDoc[] = [];
  for (const id of dept.docIds) {
    const d = docs.find((x) => x.id === id && !x.discardedAt);
    if (!d) continue;
    out.push({
      docId: d.id,
      name: d.name,
      label: d.label,
      kind: d.kind,
      version: d.version,
      done: false,
      doneAt: null,
      proofId: null,
    });
  }
  return out;
}

const UNFINISHED: HireStatus[] = ["invited", "opened", "signing"];

export function isExpired(hire: Hire, nowIso: string): boolean {
  return UNFINISHED.includes(hire.status) && hire.tokenExpiresAt < nowIso;
}

export function expiresAt(fromIso: string, days: number): string {
  return new Date(new Date(fromIso).getTime() + days * 86_400_000)
    .toISOString();
}

export interface PipelineStep {
  key: "invited" | "opened" | "signing" | "signed" | "provisioned";
  state: "done" | "active" | "pending";
}

const REACHED: Partial<Record<HireStatus, number>> = {
  invited: 0,
  opened: 1,
  signing: 2,
  signed: 3,
  provisioning: 4,
  active: 5,
};

/** REQ-884f — Invited → Link opened → Signing in progress → All documents signed → Accounts provisioned */
export function pipeline(hire: Hire): PipelineStep[] {
  const keys: PipelineStep["key"][] = [
    "invited",
    "opened",
    "signing",
    "signed",
    "provisioned",
  ];
  let reached = REACHED[hire.status];
  let frozen = false;
  if (reached === undefined) {
    // expired / offboarded: what was reached before, nothing active
    frozen = true;
    reached = hire.signedAt
      ? 4
      : hire.packet.some((d) => d.done)
      ? 3
      : hire.mail.openedAt
      ? 2
      : hire.mail.sentAt
      ? 1
      : 0;
    if (hire.status === "offboarded" && hire.activeAt) reached = 5;
  }
  return keys.map((key, i) => ({
    key,
    state: i < reached!
      ? "done"
      : i === reached && !frozen
      ? (reached === 5 ? "done" : "active")
      : "pending",
  }));
}

export function packetProgress(packet: PacketDoc[]): {
  done: number;
  total: number;
} {
  return { done: packet.filter((d) => d.done).length, total: packet.length };
}

export function allDone(packet: PacketDoc[]): boolean {
  return packet.length > 0 && packet.every((d) => d.done);
}

/** REQ-886a — what a hire signed must be the version it was: content, kind, fields and the PDF bump it */
export function bumpsVersion(
  doc: HrDocument,
  patch: Partial<HrDocument>,
): boolean {
  if (
    patch.contentHtml !== undefined && patch.contentHtml !== doc.contentHtml
  ) return true;
  if (patch.kind !== undefined && patch.kind !== doc.kind) return true;
  if (patch.pdfFileId !== undefined && patch.pdfFileId !== doc.pdfFileId) {
    return true;
  }
  if (
    patch.fields !== undefined &&
    JSON.stringify(patch.fields) !== JSON.stringify(doc.fields)
  ) return true;
  return false;
}

/** REQ-887 — the arms: the department's current connected systems; the hire's snapshot when it is gone */
export function provisionPlan(
  hire: Hire,
  dept: Department | null,
  systems: HrSystem[],
): HrSystem[] {
  const ids = dept ? dept.systemIds : hire.systemIds;
  return ids
    .map((id) => systems.find((s) => s.id === id))
    .filter((s): s is HrSystem => !!s && s.status === "connected");
}

/** REQ-913 — the arms DocuMonster runs itself, in-process */
export const BUILTIN_KEYS: ReadonlySet<string> = new Set([
  "dm-worker",
  "dm-admin",
  "dm-email",
  "dm-text",
]);
export type BuiltinKey = "dm-worker" | "dm-admin" | "dm-email" | "dm-text";
export function isBuiltin(key: string): key is BuiltinKey {
  return BUILTIN_KEYS.has(key);
}
export type ArmMode = "builtin" | "webhook" | "manual";
/** REQ-913 — how a system gets built: in-process, by webhook (REQ-888b), or by hand */
export function armMode(sys: Pick<HrSystem, "key" | "webhookUrl">): ArmMode {
  if (isBuiltin(sys.key)) return "builtin";
  return sys.webhookUrl ? "webhook" : "manual";
}

/** REQ-888c — active only once every arm is ok or done */
export function aggregateProvisioning(
  results: ProvisionResult[],
): "active" | "provisioning" {
  return results.every((r) => r.state === "ok" || r.state === "done")
    ? "active"
    : "provisioning";
}

export const REMIND_AFTER_MS = 24 * 3_600_000;

/** REQ-889b — still invited or opened, sent over 24 h ago, not reminded yet */
export function reminderDue(hire: Hire, nowIso: string): boolean {
  if (hire.status !== "invited" && hire.status !== "opened") return false;
  if (!hire.mail.sentAt || hire.mail.remindedAt) return false;
  return new Date(hire.mail.sentAt).getTime() + REMIND_AFTER_MS <=
    new Date(nowIso).getTime();
}

export interface DashboardStats {
  sent: number;
  completed: number;
  awaiting: number;
  accounts: number;
  byDay: { day: string; sent: number }[];
  statusMix: { signed: number; awaiting: number; expired: number };
  byDepartment: { department: string; signed: number; awaiting: number }[];
  recent: Hire[];
}

const COMPLETED: HireStatus[] = [
  "signed",
  "provisioning",
  "active",
  "offboarded",
];
const AWAITING: HireStatus[] = ["invited", "opened", "signing"];

/** REQ-889c — the overview's numbers off the account's hires */
export function dashboardStats(hires: Hire[], nowIso: string): DashboardStats {
  const day = (iso: string) => iso.slice(0, 10);
  const today = new Date(nowIso);
  const byDay: { day: string; sent: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000).toISOString().slice(
      0,
      10,
    );
    byDay.push({
      day: d,
      sent: hires.filter((h) => day(h.mail.sentAt ?? h.createdAt) === d).length,
    });
  }
  const depts = new Map<string, { signed: number; awaiting: number }>();
  for (const h of hires) {
    const row = depts.get(h.departmentName) ?? { signed: 0, awaiting: 0 };
    if (COMPLETED.includes(h.status)) row.signed++;
    else if (AWAITING.includes(h.status)) row.awaiting++;
    depts.set(h.departmentName, row);
  }
  return {
    sent: hires.length,
    completed: hires.filter((h) => COMPLETED.includes(h.status)).length,
    awaiting: hires.filter((h) => AWAITING.includes(h.status)).length,
    accounts:
      hires.filter((h) => h.status === "active" || h.status === "offboarded")
        .length,
    byDay,
    statusMix: {
      signed: hires.filter((h) => COMPLETED.includes(h.status)).length,
      awaiting: hires.filter((h) => AWAITING.includes(h.status)).length,
      expired: hires.filter((h) => h.status === "expired").length,
    },
    byDepartment: [...depts.entries()]
      .map(([department, v]) => ({ department, ...v }))
      .sort((a, b) => a.department.localeCompare(b.department)),
    recent: [...hires].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 3),
  };
}
