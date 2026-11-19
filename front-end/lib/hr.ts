/**
 * REQ-883 — the HR pages' pure helpers: status chips, the pipeline's labels, the roster's order,
 * dates, initials, the field-stamp palette. No DOM, no fetch — jest reads this file too.
 */
import type {
  ArmState,
  DocField,
  FieldType,
  Hire,
  HireStatus,
  PipelineStep,
} from "../clients/hr.ts";
import { type Lang, tFor } from "./i18n.ts";

export type SortKey = "name" | "dept" | "start" | "progress" | "status";
export type SortDir = "asc" | "desc";

/** chip class + lang key per status (REQ-884c) */
export const STATUS_CHIP: Record<HireStatus, string> = {
  invited: "chip--teal",
  opened: "chip--amber",
  signing: "chip--teal",
  signed: "chip--green",
  provisioning: "chip--teal",
  active: "chip--green",
  expired: "chip--pink",
  offboarded: "chip--muted",
};

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

export const SORT_KEYS: SortKey[] = [
  "name",
  "dept",
  "start",
  "progress",
  "status",
];

/** the roster's order, the same rule as the backend's (unfinished first) — for client-side re-sorts */
export function sortHires(hires: Hire[], key: SortKey, dir: SortDir): Hire[] {
  const m = dir === "asc" ? 1 : -1;
  const val = (h: Hire): string | number =>
    key === "name"
      ? h.name.toLowerCase()
      : key === "dept"
      ? h.departmentName.toLowerCase()
      : key === "start"
      ? h.startDate
      : key === "progress"
      ? h.progress.done / (h.progress.total || 1)
      : STATUS_RANK[h.status] ?? 9;
  return [...hires].sort((a, b) => {
    const av = val(a), bv = val(b);
    if (av < bv) return -m;
    if (av > bv) return m;
    return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
  });
}

/** the roster's search box: name, email, phone or department */
export function matchesHire(h: Hire, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [h.name, h.email, h.phone, h.departmentName].some((v) =>
    (v ?? "").toLowerCase().includes(s)
  );
}

export const PIPELINE_KEYS: PipelineStep["key"][] = [
  "invited",
  "opened",
  "signing",
  "signed",
  "provisioned",
];

/** the lang key of a provisioning arm's state */
export function armKey(state: ArmState): string {
  return ({
    ok: "hr.detail.arm.ok",
    done: "hr.detail.arm.done",
    manual: "hr.detail.arm.manual",
    fault: "hr.detail.arm.fault",
    queued: "hr.detail.arm.queued",
    torn_down: "hr.detail.arm.torn",
    teardown_fault: "hr.detail.arm.tornFault",
  } as Record<ArmState, string>)[state];
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "Jun 30" from YYYY-MM-DD, in the given language; "—" when blank */
export function fmtDate(iso: string, lang: "en" | "es"): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(
    lang === "es" ? "es-MX" : "en-US",
    { month: "short", day: "numeric" },
  );
}

/**
 * "Jun 27 · 9:14 AM" from an instant, on the business's wall clock (REQ-944 / REQ-1154): the
 * day AND the time use `timeZone` (an IANA zone, e.g. GET /me's businessTimezone), so the
 * browser's own zone never decides what the HR page prints. Without a zone it falls back to
 * the runtime's.
 */
export function fmtWhen(
  iso: string | null,
  lang: "en" | "es",
  timeZone?: string,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const locale = lang === "es" ? "es-MX" : "en-US";
  const tz = timeZone ? { timeZone } : {};
  return `${
    d.toLocaleDateString(locale, { month: "short", day: "numeric", ...tz })
  } · ${
    d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", ...tz })
  }`;
}

export const FIELD_TYPES: Record<
  FieldType,
  { key: string; icon: string; color: string }
> = {
  signature: {
    key: "hr.docs.field.signature",
    icon: "pencil",
    color: "#1a8e40",
  },
  initials: { key: "hr.docs.field.initials", icon: "doc", color: "#0170b9" },
  date: { key: "hr.docs.field.date", icon: "cal", color: "#ea580c" },
  name: { key: "hr.docs.field.name", icon: "user", color: "#7c3aed" },
  text: { key: "hr.docs.field.text", icon: "list", color: "#0891b2" },
  check: { key: "hr.docs.field.check", icon: "check", color: "#16a34a" },
};

export function newFieldId(): string {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** a stamp placed at a click, clamped to the page (REQ-886b) */
export function placeField(
  type: FieldType,
  page: number,
  xPct: number,
  yPct: number,
): DocField {
  const clamp = (v: number) => Math.max(1, Math.min(99, v));
  return { id: newFieldId(), type, page, xPct: clamp(xPct), yPct: clamp(yPct) };
}

/** the share of the donut each slice takes (REQ-889d) */
export function donutSlices(
  mix: { signed: number; awaiting: number; expired: number },
): { key: "signed" | "awaiting" | "expired"; value: number; pct: number }[] {
  const total = mix.signed + mix.awaiting + mix.expired;
  return (["signed", "awaiting", "expired"] as const).map((key) => ({
    key,
    value: mix[key],
    pct: total ? mix[key] / total : 0,
  }));
}

/** the text the hire gets, as shown in the send modal and on the detail page — REQ-1158: the
 *  same hr.sms.invite key the backend sends (hr-notices sendLink), in the language asked for */
export function inviteText(
  first: string,
  company: string,
  url: string,
  lang: Lang = "en",
): string {
  return tFor(lang, "hr.sms.invite", { first, company, url });
}

/** REQ-1156 — the done screen's body: promise accounts only when the plan will build some */
export function signDoneKey(accounts: number | undefined): string {
  return (accounts ?? 0) > 0
    ? "hr.sign.done.body"
    : "hr.sign.done.bodyNoAccounts";
}

/**
 * REQ-1156 — the Accounts panel's header action. With systems: "Create accounts" (provision).
 * With none, there is nothing to create; a signed hire gets "Mark ready" instead, which runs the
 * same empty plan and so goes straight to active (REQ-888(c)). Otherwise no action.
 */
export function accountsAction(
  h: Pick<Hire, "status" | "systemIds">,
): "provision" | "finish" | null {
  if (!["signed", "provisioning", "active"].includes(h.status)) return null;
  if (h.systemIds.length > 0) return "provision";
  return h.status === "signed" ? "finish" : null;
}
