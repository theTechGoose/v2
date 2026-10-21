/**
 * HTTP client for the landing page.
 *
 * Surfaces only the endpoint(s) landing actually calls.
 * Backend reference: backend/src/users/entrypoints/auth-controller/mod.ts
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { Lang } from "../lib/lang.ts";

export interface SendOtpInput {
  phoneNumber: string;
  language?: Lang;
}

export interface SendOtpResult {
  sent: true;
  /** REQ-082 — on the fakes only: the code the server stored, for the page to show. */
  devCode?: string;
}

export interface ContactInput {
  name: string;
  email: string;
  /** REQ-068 — optional; the number the person may be texted on. */
  phone?: string;
  subject: string;
  message: string;
  /** REQ-068 — the SMS consent box, unchecked by default, never required. */
  smsConsent: boolean;
}

export interface ContactResult {
  ok: boolean;
  reason?: string;
  retryAfterMs?: number;
}

/** REQ-081/090/108 — a demo booking from /landing2: a specific day and time, who, how to reach them, the consent */
export interface DemoRequestInput {
  name: string;
  phone: string;
  email: string;
  /** YYYY-MM-DD, tomorrow (Eastern) at the earliest */
  day: string;
  /** HH:MM Eastern, one of DEMO_TIMES (8:00 AM to 7:30 PM) */
  time: string;
  lang: Lang;
  /** the TCPA consent box — the page only posts once it is ticked */
  consent: boolean;
}

export type DemoRequestResult =
  | {
    ok: true;
    day: string;
    time: string;
    emailed: boolean;
    texted: boolean;
    lead: boolean;
  }
  | { ok: false; reason: "invalid"; field: string }
  | { ok: false; reason: "too_many_attempts"; retryAfterMs: number }
  | { ok: false; reason: string };

export const landingClient = {
  /** POST /auth/send-otp — initiate OTP login flow. */
  sendOtp(input: SendOtpInput, opts: ApiOptions = {}): Promise<SendOtpResult> {
    return api.post<SendOtpResult>("/auth/send-otp", input, opts);
  },

  /** REQ-081/090/108 — POST /demo-request — the demo booking (backend DemoRequestController). */
  requestDemo(
    input: DemoRequestInput,
    opts: ApiOptions = {},
  ): Promise<DemoRequestResult> {
    return api.post<DemoRequestResult>("/demo-request", input, opts);
  },

  /** POST /contact — public inquiry form (backend ContactPublicController). */
  submitContact(
    input: ContactInput,
    opts: ApiOptions = {},
  ): Promise<ContactResult> {
    return api.post<ContactResult>("/contact", input, opts);
  },
};
