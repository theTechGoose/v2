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

/** REQ-081 — a demo booking from /landing2: demo or call, the day and the slot, who, how to reach them */
export interface DemoRequestInput {
  mode: "demo" | "call";
  name: string;
  phone: string;
  email: string;
  /** the person said they have no email — a demo may be booked without one then */
  noEmail: boolean;
  trade: string;
  /** YYYY-MM-DD */
  day: string;
  /** one of the twelve slots, "9:00 AM" … "8:00 PM" */
  slot: string;
  lang: Lang;
}

export type DemoRequestResult =
  | { ok: true; mode: "demo" | "call"; day: string; slot: string; emailed: boolean; texted: boolean; lead: boolean }
  | { ok: false; reason: "invalid"; field: string }
  | { ok: false; reason: "too_many_attempts"; retryAfterMs: number }
  | { ok: false; reason: string };

export const landingClient = {
  /** POST /auth/send-otp — initiate OTP login flow. */
  sendOtp(input: SendOtpInput, opts: ApiOptions = {}): Promise<SendOtpResult> {
    return api.post<SendOtpResult>("/auth/send-otp", input, opts);
  },

  /** REQ-081 — POST /demo-request — the demo booking (backend DemoRequestController). */
  requestDemo(input: DemoRequestInput, opts: ApiOptions = {}): Promise<DemoRequestResult> {
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
