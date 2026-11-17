/** REQ-912c — GET /me/systems: what DocuMonster runs on for this account, in one call. */
import { api, type ApiOptions } from "../lib/api.ts";
import type { CatalogEntry, HrSystem } from "./hr.ts";

export type LineSummary =
  | { status: "none" }
  | { status: "active"; number: string; kind: "env" }
  | {
    status: "active";
    number: string;
    kind: "subaccount";
    /** REQ-920d — the line's texting registration */
    a2p: "none" | "pending" | "registered" | "failed";
  }
  /** REQ-920d — a house line (REQ-920b): registered through the platform's verified campaign */
  | { status: "active"; number: string; kind: "main"; a2p: "house" }
  | { status: "released"; number: string; kind: "subaccount" };

export interface SystemsSummary {
  email: { provider: "postmark"; configured: boolean; from: string };
  line: LineSummary;
  payments: { stripe: { connected: boolean }; square: { connected: boolean } };
  esign: { provider: "documonster"; on: true };
  hr: { systems: HrSystem[]; catalog: CatalogEntry[] };
}

export const systemsClient = {
  summary: (opts?: ApiOptions) => api.get<SystemsSummary>("/me/systems", opts),
};

/** REQ-913 — the arms DocuMonster runs itself (no webhook to set) */
export const BUILTIN_KEYS = ["dm-worker", "dm-admin", "dm-email", "dm-text"];
export const isBuiltin = (key: string) => BUILTIN_KEYS.includes(key);
