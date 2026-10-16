/**
 * REQ-081 — the demo booking on /landing2 ("take this mock … make it real … make sure all
 * aspects of the page are working"): what a booking is, read strictly from the page's POST, and
 * the two messages it produces — the person's text ("Te confirmamos por texto") and the team's
 * email. Pure: no I/O, no env; the controller does the sending.
 */
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import { SUPPORT_PHONE_DISPLAY } from "#legal/contact.ts";
import {
  DEMO_SLOTS,
  demoDateOf,
  demoDayLabel,
  type DemoLang,
} from "#demo-booking/mod.ts";

export { DEMO_SLOTS, demoDayLabel };

export type DemoMode = "demo" | "call";
export type { DemoLang };

export interface DemoRequest {
  mode: DemoMode;
  name: string;
  /** E.164 */
  phone: string;
  /** "" when the person has none (a call, or a demo with "no email — call me") */
  email: string;
  /** "" when not given */
  trade: string;
  /** YYYY-MM-DD, today or later, within 90 days */
  day: string;
  /** one of DEMO_SLOTS */
  slot: string;
  lang: DemoLang;
}

const WINDOW_DAYS = 90;
const NAME_MAX = 120;
const TRADE_MAX = 120;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** a request the page should never have sent; `field` names the first bad one */
export class DemoRequestInvalid extends Error {
  constructor(readonly field: string, detail: string) {
    super(`demo-request invalid: ${field} — ${detail}`);
    this.name = "DemoRequestInvalid";
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const DAY_MS = 86_400_000;

export function parseDemoRequest(
  input: unknown,
  now: Date = new Date(),
): DemoRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DemoRequestInvalid("body", "not an object");
  }
  const b = input as Record<string, unknown>;

  const mode = str(b.mode);
  if (mode !== "demo" && mode !== "call") {
    throw new DemoRequestInvalid("mode", `"${mode}" is not demo or call`);
  }

  const name = str(b.name);
  if (!name) throw new DemoRequestInvalid("name", "empty");
  if (name.length > NAME_MAX) {
    throw new DemoRequestInvalid("name", `over ${NAME_MAX} characters`);
  }

  let phone: string;
  try {
    phone = normalizePhone(str(b.phone));
  } catch (e) {
    throw new DemoRequestInvalid(
      "phone",
      e instanceof Error ? e.message : String(e),
    );
  }
  if (!/^\+\d{10,15}$/.test(phone)) {
    throw new DemoRequestInvalid("phone", "not a dialable number");
  }

  const email = str(b.email);
  const noEmail = b.noEmail === true;
  if (email && !EMAIL_RE.test(email)) {
    throw new DemoRequestInvalid("email", "not an address");
  }
  if (mode === "demo" && !email && !noEmail) {
    throw new DemoRequestInvalid(
      "email",
      "a demo needs an email unless the person has none",
    );
  }

  const trade = str(b.trade);
  if (trade.length > TRADE_MAX) {
    throw new DemoRequestInvalid("trade", `over ${TRADE_MAX} characters`);
  }

  const day = str(b.day);
  const date = demoDateOf(day);
  if (!date) {
    throw new DemoRequestInvalid("day", `"${day}" is not a YYYY-MM-DD date`);
  }
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  if (date.getTime() < today) {
    throw new DemoRequestInvalid("day", "in the past");
  }
  if (date.getTime() > today + WINDOW_DAYS * DAY_MS) {
    throw new DemoRequestInvalid("day", `past ${WINDOW_DAYS} days out`);
  }

  const slot = str(b.slot);
  if (!DEMO_SLOTS.includes(slot)) {
    throw new DemoRequestInvalid(
      "slot",
      `"${slot}" is not one of the offered hours`,
    );
  }

  const lang = b.lang === undefined ? "es" : str(b.lang);
  if (lang !== "es" && lang !== "en") {
    throw new DemoRequestInvalid("lang", `"${lang}" is not es or en`);
  }

  return { mode, name, phone, email, trade, day, slot, lang };
}

const MODE_LABEL: Record<DemoLang, Record<DemoMode, string>> = {
  es: { demo: "Demo de 15 min", call: "Llamada" },
  en: { demo: "15-min demo", call: "Phone call" },
};
const TZ: Record<DemoLang, string> = { es: "hora del Este", en: "Eastern" };

/** what the person booked, as the page's summary line reads it: "Demo de 15 min · Sáb 17 Oct · 11:00 AM (hora del Este)" */
export function demoSummary(req: DemoRequest): string {
  return `${MODE_LABEL[req.lang][req.mode]} · ${
    demoDayLabel(req.day, req.lang)
  } · ${req.slot} (${TZ[req.lang]})`;
}

/** the confirmation text, in the person's language */
export function demoConfirmationSms(req: DemoRequest): string {
  const summary = demoSummary(req);
  return req.lang === "es"
    ? `DocuMonster: ¡listo, ${req.name}! Te llamamos — ${summary}. ¿Cambios? Llámanos o escríbenos al ${SUPPORT_PHONE_DISPLAY}.`
    : `DocuMonster: you're booked, ${req.name}! We'll call you — ${summary}. Changes? Call or text us at ${SUPPORT_PHONE_DISPLAY}.`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}

/** the team's email: every field of the booking, the person's language, nothing hidden */
export function demoTeamEmail(
  req: DemoRequest,
): { subject: string; htmlBody: string } {
  const row = (label: string, value: string) =>
    `<p><strong>${label}:</strong> ${value ? escapeHtml(value) : "—"}</p>`;
  const subject = `[${req.mode}] ${req.name} — ${req.day} ${req.slot}`;
  const htmlBody = [
    `<h2>New ${MODE_LABEL.en[req.mode]} request from /landing2</h2>`,
    row(
      "When",
      `${demoDayLabel(req.day, "en")} (${req.day}) · ${req.slot} Eastern`,
    ),
    row("Name", req.name),
    row("Phone", req.phone),
    row("Email", req.email),
    row("Trade", req.trade),
    row("Language", req.lang === "es" ? "Spanish" : "English"),
  ].join("\n");
  return { subject, htmlBody };
}
