/**
 * REQ-091 — the onboarding gate the pages share: the questions still open on
 * the signed-in account, read off the same profile snapshot the wizard saves
 * into (in-process on Deno Deploy, like /welcome does). `null` when the
 * profile could not be read — the caller decides (the dashboard lets the
 * person through rather than trap them between two pages that cannot load).
 */
import { getSessionId } from "./auth.ts";
import { ssrBackendGetAuthed } from "./backend-fetch.ts";
import type { ProfileSnapshot } from "../clients/profile.ts";
import {
  type OnboardingQuestion,
  unansweredQuestions,
} from "../../shared/quote-flow/onboarding-questions.ts";

export async function loadProfileSnapshot(req: Request): Promise<ProfileSnapshot | null> {
  const res = await ssrBackendGetAuthed<ProfileSnapshot>("/profile", getSessionId(req))
    .catch(() => ({ ok: false as const, status: 0 }));
  return res.ok && res.data ? res.data : null;
}

/** the open questions, or null when the profile could not be read */
export async function openOnboardingQuestions(req: Request): Promise<OnboardingQuestion[] | null> {
  const snapshot = await loadProfileSnapshot(req);
  return snapshot ? unansweredQuestions(snapshot) : null;
}
