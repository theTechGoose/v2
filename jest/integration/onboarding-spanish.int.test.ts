/**
 * P-ids covered:
 *   "P-04 [SIGNUP/I18N] The Spanish onboarding tells users to type 'omitir' — which the backend never accepts. Infinite loop."
 *   "P-23 [ASSISTANT/I18N] The Spanish chat doesn't understand 'sí'."
 *
 * Drives the REAL onboarding conversation over HTTP as a fresh Spanish user
 * and asserts the flow ADVANCES on the Spanish skip/confirm words the UI
 * itself advertises — instead of re-prompting the same step forever.
 *
 * ---------------------------------------------------------------------------
 * Endpoint / shape notes for the green agent (probed live against :5280):
 *   - A fresh user is made with the dev master OTP:
 *       POST /auth/verify { phoneNumber, code: "000000" }  → { ok, userId, isNewUser:true }
 *     The master-OTP user is created with a localized PLACEHOLDER name
 *     ("Nuevo usuario"), so `needsName` is already false and onboarding starts
 *     at the BUSINESS step. We PUT /me { language:"es" } to force Spanish acks.
 *   - Chat turns:  POST /agents/chat { conversationId?, content, kind:"text" }
 *       → { conversation:{ id }, newMessages:[ {role:"user",…}, {role:"assistant",…} ] }
 *     Omit conversationId on the first turn (server creates the conversation);
 *     pass conversation.id thereafter.
 *   - The onboarding state machine lives in
 *       backend/src/agents/domain/coordinators/handle-chat-message/mod.ts
 *     and its parsers in
 *       backend/src/agents/domain/business/onboarding/mod.ts
 *     isSkipReply (mod.ts:54 / SKIP_RE mod.ts:37) is English-only → "omitir"
 *     falls through to the address reprompt (P-04). isAffirmativeReply
 *     (mod.ts:285) is English-only → "sí" falls through to the state reprompt
 *     (P-23).
 *   - Fresh-per-run isolation uses the same dev tool the cypress command uses:
 *       backend/scripts/dev-wipe-user.ts <phone>   (a dev tool; safe to RUN).
 * ---------------------------------------------------------------------------
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { ApiSession } from "./helpers/api";

const BACKEND_DIR = path.resolve(__dirname, "../../backend");

// Exact Spanish copy (lang/es.json) — copied verbatim so the prod fix passes
// without editing this test. Only stable, fix-independent fragments are used.
const ES = {
  askBusinessMarker: "¿Y cómo se llama tu negocio?", // onboarding.askBusiness (after {firstName})
  stateGuessMarker: "Parece que estás en", // onboarding.askStateGuess
  addressMarker: "La última,", // onboarding.askAddress (before {firstName})
  payoutMarker: "Una cosa más,", // onboarding.askPayout (before {firstName})
  addressReprompt: "no pude interpretar eso", // onboardingChat.address.reprompt
  stateReprompt: "no reconocí eso", // onboardingChat.state.reprompt
};

function wipe(phone: string) {
  execFileSync(
    "deno",
    ["run", "-A", "--unstable-kv", "scripts/dev-wipe-user.ts", phone],
    { cwd: BACKEND_DIR, stdio: "ignore" },
  );
}

/** Fresh Spanish onboarding user: wipe → master-OTP verify → language=es. */
async function freshSpanishUser(phone: string): Promise<ApiSession> {
  wipe(phone);
  const s = new ApiSession();
  const v = await s.post("/auth/verify", {
    phoneNumber: phone,
    code: "000000",
  });
  if (v.status >= 400) {
    throw new Error(
      `verify ${phone} failed: ${v.status} ${JSON.stringify(v.body)}`,
    );
  }
  const lang = await s.put("/me", { language: "es" });
  if (lang.status >= 400) {
    throw new Error(
      `set language failed: ${lang.status} ${JSON.stringify(lang.body)}`,
    );
  }
  return s;
}

/** Send one chat turn; return the assistant reply text + the conversation id. */
async function chat(
  s: ApiSession,
  conversationId: string | undefined,
  content: string,
): Promise<{ assistant: string; conversationId: string }> {
  const r = await s.post("/agents/chat", {
    ...(conversationId ? { conversationId } : {}),
    content,
    kind: "text",
  });
  if (r.status >= 400) {
    throw new Error(
      `chat("${content}") failed: ${r.status} ${JSON.stringify(r.body)}`,
    );
  }
  const msgs: Array<{ role?: string; content?: string }> =
    r.body?.newMessages ?? [];
  const assistant =
    [...msgs].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const cid = r.body?.conversation?.id ?? conversationId ?? "";
  return { assistant, conversationId: cid };
}

describe("P-04: Spanish onboarding accepts 'omitir' as skip (address step advances)", () => {
  it("P-04: typing 'omitir' at the address step ADVANCES to the payout ask, not the reprompt", async () => {
    const s = await freshSpanishUser("+15125552104");

    // Walk to the address step using inputs that already work today so this
    // test isolates P-04 (the skip word) and doesn't depend on P-23's fix.
    let step = await chat(s, undefined, "hola"); // → business ask
    expect(step.assistant).toContain(ES.askBusinessMarker);

    step = await chat(s, step.conversationId, "Riley Roofing"); // → state guess
    expect(step.assistant).toContain(ES.stateGuessMarker);

    step = await chat(s, step.conversationId, "TX"); // → address ask
    expect(step.assistant).toContain(ES.addressMarker);

    // THE BUG: "omitir" is exactly what the composer placeholder + address
    // reprompt tell a Spanish user to type. Desired → the flow skips address
    // and moves to the payout ask. Red today → the address reprompt loops.
    step = await chat(s, step.conversationId, "omitir");
    expect(step.assistant).toContain(ES.payoutMarker);
    expect(step.assistant).not.toContain(ES.addressReprompt);
  });
});

describe("P-23: Spanish onboarding accepts 'sí' as confirm (state step advances)", () => {
  it("P-23: replying 'sí' to the phone-guess state confirm ADVANCES to the address ask, not the reprompt", async () => {
    const s = await freshSpanishUser("+15125552123");

    let step = await chat(s, undefined, "hola"); // → business ask
    expect(step.assistant).toContain(ES.askBusinessMarker);

    step = await chat(s, step.conversationId, "Riley Roofing"); // → state GUESS ask (512 → Texas)
    expect(step.assistant).toContain(ES.stateGuessMarker);

    // THE BUG: the guess ask says "¿es correcto…? " and the chip is labeled
    // "Sí — está correcto", but "sí" isn't understood. Desired → confirm the
    // guessed state and move to the address ask. Red today → state reprompt.
    step = await chat(s, step.conversationId, "sí");
    expect(step.assistant).toContain(ES.addressMarker);
    expect(step.assistant).not.toContain(ES.stateReprompt);
  });
});
