/**
 * REQ-081/090/108 — the demo booking on /landing2. REQ-108 (Raphael, 2026-10-21, the launch
 * checklist): "Visitors must select a specific day and time, rather than a morning or afternoon
 * window. Offer available times between 8 a.m. and 8 p.m. Eastern Time. Do not allow same-day
 * bookings. The earliest available date must be tomorrow. Collect their name, phone number, and
 * email address. … Ensure the team receives all submitted information, including the selected
 * demo date and time." What a booking is, read strictly from the page's POST — a name, a cell, an
 * email, a day from tomorrow (Eastern) within the window, a time the page offers, the consent on
 * record — and the two messages it produces: the person's text ("Te confirmamos por texto") and
 * the team's email with the date, the time and the consent on it. REQ-090's call with just a cell
 * is gone: the card books a demo, nothing else. Pure: no I/O, no env; the controller does the sending.
 */
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import { SUPPORT_PHONE_DISPLAY } from "#legal/contact.ts";
import {
  DEMO_DAY_WINDOW,
  DEMO_TIMES,
  demoDateOf,
  demoDayLabel,
  demoEarliestDay,
  type DemoLang,
  demoTime,
  demoTimeLabel,
} from "#demo-booking/mod.ts";

export { DEMO_TIMES, demoDayLabel, demoTimeLabel };
export type { DemoLang };

export interface DemoRequest {
  name: string;
  /** E.164 */
  phone: string;
  email: string;
  /** YYYY-MM-DD — tomorrow (Eastern) at the earliest, within DEMO_DAY_WINDOW days (REQ-102/108) */
  day: string;
  /** HH:MM Eastern, one of DEMO_TIMES */
  time: string;
  lang: DemoLang;
  /** the consent box the person ticked — the one field never optional (TCPA / 10DLC) */
  consent: true;
}

const NAME_MAX = 120;
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

  if (b.consent !== true) {
    throw new DemoRequestInvalid("consent", "the box was not ticked");
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

  // REQ-108 — the email is collected, never optional
  const email = str(b.email);
  if (!email) throw new DemoRequestInvalid("email", "empty");
  if (!EMAIL_RE.test(email)) {
    throw new DemoRequestInvalid("email", "not an address");
  }

  const day = str(b.day);
  const date = demoDateOf(day);
  if (!date) {
    throw new DemoRequestInvalid("day", `"${day}" is not a YYYY-MM-DD date`);
  }
  // REQ-108 — never today: tomorrow in Eastern is the earliest, whatever the hour
  const earliest = demoDateOf(demoEarliestDay(now))!;
  if (date.getTime() < earliest.getTime()) {
    throw new DemoRequestInvalid("day", `before ${demoEarliestDay(now)}, the earliest day (tomorrow, Eastern)`);
  }
  if (date.getTime() > earliest.getTime() + (DEMO_DAY_WINDOW - 1) * DAY_MS) {
    throw new DemoRequestInvalid("day", `past ${DEMO_DAY_WINDOW} days out`);
  }

  const time = str(b.time);
  if (!demoTime(time)) {
    throw new DemoRequestInvalid(
      "time",
      `"${time}" is not one of the offered times (8:00 AM to 7:30 PM Eastern, every half hour)`,
    );
  }

  const lang = b.lang === undefined ? "es" : str(b.lang);
  if (lang !== "es" && lang !== "en") {
    throw new DemoRequestInvalid("lang", `"${lang}" is not es or en`);
  }

  return { name, phone, email, day, time, lang, consent: true };
}

const DEMO_LABEL: Record<DemoLang, string> = {
  es: "Demo de 15 min",
  en: "15-min demo",
};

/** what the person booked, as a line: "Demo de 15 min · Mar 20 Oct · 10:30 AM (hora del Este)" */
export function demoSummary(req: DemoRequest): string {
  return `${DEMO_LABEL[req.lang]} · ${demoDayLabel(req.day, req.lang)} · ${demoTimeLabel(req.time, req.lang)}`;
}

/** the confirmation text, in the person's language, by name */
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

/** the team's email: every field of the booking, the date and the time, the consent on record, the person's language, nothing hidden */
export function demoTeamEmail(
  req: DemoRequest,
): { subject: string; htmlBody: string } {
  const row = (label: string, value: string) =>
    `<p><strong>${label}:</strong> ${value ? escapeHtml(value) : "—"}</p>`;
  const time = `${demoTime(req.time)?.label ?? req.time} Eastern`;
  const when = `${demoDayLabel(req.day, "en")} (${req.day}) · ${time}`;
  const subject = `[demo] ${req.name} — ${req.day} ${time}`;
  const htmlBody = [
    `<h2>New ${DEMO_LABEL.en} request from /landing2</h2>`,
    row("When", when),
    row("Name", req.name),
    row("Phone", req.phone),
    row("Email", req.email),
    row("Consent", "yes — the box on the page, ticked by the person"),
    row("Language", req.lang === "es" ? "Spanish" : "English"),
  ].join("\n");
  return { subject, htmlBody };
}
