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

/** REQ-081/090 — a demo booking from /landing2: a call with just a cell (as soon as possible), or a demo on a day and a window, who, how to reach them — and the consent box, ticked */
export interface DemoRequestInput {
  mode: "demo" | "call";
  /** "" for a call with just a cell */
  name: string;
  phone: string;
  /** "" when not given */
  email: string;
  /** YYYY-MM-DD for a demo; "" for a call */
  day: string;
  /** "morning" | "afternoon" for a demo; "" for a call */
  slot: string;
  lang: Lang;
  /** the TCPA consent box — the page only posts once it is ticked */
  consent: boolean;
}

export type DemoRequestResult =
  | {
    ok: true;
    mode: "demo" | "call";
    day: string;
    slot: string;
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

  /** REQ-081/090 — POST /demo-request — the demo booking (backend DemoRequestController). */
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
