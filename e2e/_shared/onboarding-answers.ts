/**
 * REQ-091 — the nine onboarding questions, answered the way the wizard saves
 * them, through the app's own API: what a story does to put an account past
 * onboarding (the dashboard sends anyone with an open question back to the
 * wizard) or to leave exactly one question open.
 */
import {
  ONBOARDING_QUESTIONS,
  type OnboardingQuestion,
} from "../../shared/quote-flow/onboarding-questions.ts";

export const JSON_HEADERS = { "content-type": "application/json" };

type Http = (input: string, init?: RequestInit) => Promise<Response>;

/** a 1×1 transparent PNG — the logo the story uploads */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export interface AnswerOptions {
  /** questions to leave OPEN */
  except?: OnboardingQuestion[];
  name?: string;
  businessName?: string;
  email?: string;
}

/** Answer every onboarding question not in `except`, as the signed-in account (`auth` carries its cookie). */
export async function answerQuestions(http: Http, auth: Record<string, string>, opts: AnswerOptions = {}): Promise<void> {
  const open = new Set<OnboardingQuestion>(opts.except ?? []);
  const answered = (q: OnboardingQuestion) => !open.has(q);
  const send = async (path: string, method: string, body: unknown) => {
    const r = await http(path, { method, headers: auth, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return r;
  };
  const me: Record<string, string> = {};
  if (answered("name")) me.name = opts.name ?? "Story Person";
  if (answered("email")) me.email = opts.email ?? `story-${Date.now()}@blackhole.postmarkapp.com`;
  if (Object.keys(me).length) await (await send("/api/me", "PUT", me)).body?.cancel();

  const identity: Record<string, unknown> = {};
  if (answered("businessName")) identity.businessName = opts.businessName ?? "Story Roofing LLC";
  if (answered("payment")) identity.acceptedPaymentMethods = { cash: { enabled: true } };
  if (answered("logo")) {
    const up = await send("/api/files", "POST", { filename: "logo.png", mimeType: "image/png", base64: PNG_BASE64 });
    identity.logoFileId = ((await up.json()) as { id: string }).id;
  }
  if (Object.keys(identity).length) await (await send("/api/profile/identity", "PUT", identity)).body?.cancel();

  const address: Record<string, string> = {};
  if (answered("state")) address.state = "TX";
  if (answered("address")) Object.assign(address, { street: "1600 Congress Ave", city: "Austin", postal: "78701" });
  if (Object.keys(address).length) await (await send("/api/profile/address", "PUT", address)).body?.cancel();

  if (answered("insurance")) await (await send("/api/profile/insurance", "PUT", { provider: "State Farm" })).body?.cancel();
  if (answered("plan")) await (await send("/api/me/plan", "POST", { planId: "free" })).body?.cancel();
}

/** the questions, for a story that wants to name one */
export const QUESTIONS = ONBOARDING_QUESTIONS;
