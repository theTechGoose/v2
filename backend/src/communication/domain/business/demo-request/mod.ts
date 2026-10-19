/**
 * REQ-081/090 — the demo booking on /landing2 (the v3 card: "Llámenme with just a cell books a
 * call as soon as possible, or the person picks one of five days from tomorrow and a morning or
 * afternoon window, name, cell and email, with its own consent box — and the backend takes that
 * booking and keeps the consent on record"): what a booking is, read strictly from the page's
 * POST, and the two messages it produces — the person's text ("Te confirmamos por texto") and the
 * team's email, the consent on it. Pure: no I/O, no env; the controller does the sending.
 */
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import { SUPPORT_PHONE_DISPLAY } from "#legal/contact.ts";
import {
  ASAP_LABEL,
  DEMO_SLOTS,
  demoDateOf,
  demoDayLabel,
  type DemoLang,
  demoSlot,
  type DemoSlotId,
  demoSlotLabel,
} from "#demo-booking/mod.ts";

export { DEMO_SLOTS, demoDayLabel, demoSlotLabel };

export type DemoMode = "demo" | "call";
export type { DemoLang };

export interface DemoRequest {
  mode: DemoMode;
  /** "" for a call booked with just a cell */
  name: string;
  /** E.164 */
  phone: string;
  /** "" when not given — the box on the page is optional */
  email: string;
  /** YYYY-MM-DD, today or later, within 90 days — for a demo; "" for a call (as soon as possible) */
  day: string;
  /** the window of DEMO_SLOTS — for a demo; "" for a call */
  slot: DemoSlotId | "";
  lang: DemoLang;
  /** the consent box the person ticked — the one field never optional (TCPA / 10DLC) */
  consent: true;
}

const WINDOW_DAYS = 90;
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

  const mode = str(b.mode);
  if (mode !== "demo" && mode !== "call") {
    throw new DemoRequestInvalid("mode", `"${mode}" is not demo or call`);
  }

  if (b.consent !== true) {
    throw new DemoRequestInvalid("consent", "the box was not ticked");
  }

  const name = str(b.name);
  if (mode === "demo" && !name) throw new DemoRequestInvalid("name", "empty");
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
  if (email && !EMAIL_RE.test(email)) {
    throw new DemoRequestInvalid("email", "not an address");
  }

  const day = str(b.day);
  const slotId = str(b.slot);
  if (mode === "call") {
    // as soon as possible: the page sends no day and no window
    if (day) throw new DemoRequestInvalid("day", "a call carries no day");
    if (slotId) {
      throw new DemoRequestInvalid("slot", "a call carries no window");
    }
  } else {
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
    if (!demoSlot(slotId)) {
      throw new DemoRequestInvalid(
        "slot",
        `"${slotId}" is not one of the offered windows`,
      );
    }
  }

  const lang = b.lang === undefined ? "es" : str(b.lang);
  if (lang !== "es" && lang !== "en") {
    throw new DemoRequestInvalid("lang", `"${lang}" is not es or en`);
  }

  return {
    mode,
    name,
    phone,
    email,
    day,
    slot: slotId as DemoSlotId | "",
    lang,
    consent: true,
  };
}

const MODE_LABEL: Record<DemoLang, Record<DemoMode, string>> = {
  es: { demo: "Demo de 15 min", call: "Llamada" },
  en: { demo: "15-min demo", call: "Phone call" },
};

/** what the person booked, as a line: "Demo de 15 min · Mar 20 Oct · Mañana, 9 AM – 12 PM (hora del Este)" or "Llamada · lo antes posible" */
export function demoSummary(req: DemoRequest): string {
  const when = req.mode === "call"
    ? ASAP_LABEL[req.lang]
    : `${demoDayLabel(req.day, req.lang)} · ${
      demoSlotLabel(req.slot, req.lang)
    }`;
  return `${MODE_LABEL[req.lang][req.mode]} · ${when}`;
}

/** the confirmation text, in the person's language; the name only when there is one */
export function demoConfirmationSms(req: DemoRequest): string {
  const summary = demoSummary(req);
  const who = req.name ? `, ${req.name}` : "";
  return req.lang === "es"
    ? `DocuMonster: ¡listo${who}! Te llamamos — ${summary}. ¿Cambios? Llámanos o escríbenos al ${SUPPORT_PHONE_DISPLAY}.`
    : `DocuMonster: you're booked${who}! We'll call you — ${summary}. Changes? Call or text us at ${SUPPORT_PHONE_DISPLAY}.`;
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

/** the team's email: every field of the booking, the consent on record, the person's language, nothing hidden */
export function demoTeamEmail(
  req: DemoRequest,
): { subject: string; htmlBody: string } {
  const row = (label: string, value: string) =>
    `<p><strong>${label}:</strong> ${value ? escapeHtml(value) : "—"}</p>`;
  const when = req.mode === "call"
    ? ASAP_LABEL.en
    : `${demoDayLabel(req.day, "en")} (${req.day}) · ${
      demoSlot(req.slot)?.long.en ?? req.slot
    } Eastern`;
  const subject = `[${req.mode}] ${req.name || req.phone} — ${
    req.mode === "call" ? ASAP_LABEL.en : `${req.day} ${req.slot}`
  }`;
  const htmlBody = [
    `<h2>New ${MODE_LABEL.en[req.mode]} request from /landing2</h2>`,
    row("When", when),
    row("Name", req.name),
    row("Phone", req.phone),
    row("Email", req.email),
    row("Consent", "yes — the box on the page, ticked by the person"),
    row("Language", req.lang === "es" ? "Spanish" : "English"),
  ].join("\n");
  return { subject, htmlBody };
}
