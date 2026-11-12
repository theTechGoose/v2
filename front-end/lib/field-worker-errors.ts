/**
 * REQ-421 (demo cycle 2, m42) — /field/workers words the server's refusals.
 *
 * POST/PUT/DELETE /field/workers answer a stable `code` (backend field-controllers);
 * this maps it to a `field.wk.err.*` key (en + es) and the box it belongs under, so
 * the page never prints the server's English developer string. A refusal without a
 * known code (or a network failure) is the house fallback, `field.common.error`.
 */
import { ApiError } from "./api.ts";

/** the add-form box an error belongs under; null → the form's (or row's) own alert */
export type WorkerErrField = "name" | "phone" | "pin" | null;

export interface WorkerErr {
  key: string;
  field: WorkerErrField;
  vars?: Record<string, string>;
}

const CODES: Record<string, { key: string; field: WorkerErrField }> = {
  name_required: { key: "field.wk.err.nameRequired", field: "name" },
  name_too_long: { key: "field.wk.err.nameTooLong", field: "name" },
  phone_10_digits: { key: "field.wk.err.phone10", field: "phone" },
  pin_4_digits: { key: "field.wk.err.pin4", field: "pin" },
  // the cell is the worker's login, unique across every account — worded neutrally
  worker_phone_taken: { key: "field.wk.err.phoneTaken", field: "phone" },
  language_invalid: { key: "field.wk.err.language", field: null },
  worker_covers_zones: { key: "field.wk.err.coversZones", field: null },
};

/** "Zona 3" reads "Zone 3" in English (the server names zones in Spanish) */
export function zoneName(name: string, lang: "en" | "es"): string {
  return lang === "en" ? name.replace(/^Zona /, "Zone ") : name;
}

/** the worded error for a failed /field/workers call */
export function workerError(err: unknown, lang: "en" | "es"): WorkerErr {
  const body = err instanceof ApiError ? err.body : null;
  const code = body && typeof body === "object"
    ? (body as { code?: unknown }).code
    : undefined;
  const hit = typeof code === "string" ? CODES[code] : undefined;
  if (!hit) return { key: "field.common.error", field: null };
  if (code === "worker_covers_zones") {
    const zones = (body as { detail?: { zones?: unknown } }).detail?.zones;
    const names = Array.isArray(zones)
      ? zones.filter((z): z is string => typeof z === "string")
      : [];
    return {
      ...hit,
      vars: { zones: names.map((z) => zoneName(z, lang)).join(", ") },
    };
  }
  return { ...hit };
}
