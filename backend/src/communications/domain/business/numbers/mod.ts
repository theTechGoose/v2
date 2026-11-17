/** REQ-903 — Twilio's number inventory, in our terms. */
import type { AvailableNumber } from "@communications/dto/mod.ts";

export interface NumberSearch {
  areaCode?: string;
  contains?: string;
  limit?: number;
}

/** three digits, or nothing */
export function parseAreaCode(raw: string | undefined): string | undefined {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === 3 ? digits : undefined;
}

/** the query for AvailablePhoneNumbers/US/Local.json: voice and sms capable, 1..50 a page */
export function availableNumbersQuery(search: NumberSearch): URLSearchParams {
  const q = new URLSearchParams();
  q.set("VoiceEnabled", "true");
  q.set("SmsEnabled", "true");
  q.set(
    "PageSize",
    String(Math.min(50, Math.max(1, Math.floor(search.limit ?? 20)))),
  );
  if (search.areaCode) q.set("AreaCode", search.areaCode);
  if (search.contains) q.set("Contains", search.contains);
  return q;
}

interface TwilioAvailableRow {
  phone_number?: string;
  friendly_name?: string;
  locality?: string | null;
  region?: string | null;
  capabilities?: Record<string, boolean>;
}

export function mapAvailable(rows: unknown[]): AvailableNumber[] {
  return rows.flatMap((r) => {
    const row = (r ?? {}) as TwilioAvailableRow;
    if (!row.phone_number) return [];
    const caps = row.capabilities ?? {};
    const cap = (k: string) =>
      Boolean(caps[k] ?? caps[k.toUpperCase()] ?? caps[k.toLowerCase()]);
    return [{
      phoneNumber: row.phone_number,
      friendlyName: row.friendly_name ?? row.phone_number,
      locality: row.locality ?? "",
      region: row.region ?? "",
      capabilities: { voice: cap("voice"), sms: cap("sms"), mms: cap("mms") },
    }];
  });
}
