/**
 * dev-reset-e2e-fixtures.ts — put a dev environment into the state the
 * Cypress suite assumes, so `npx cypress run` is repeatable on ANY machine.
 *
 * Two fixture classes (see TESTS-PROBLEMS.md "Environment notes"):
 *
 * 1. ACCUMULATORS — specs that create quotes/invoices/conversations against
 *    a fixed phone every run. A second run on the same KV finds last run's
 *    cards (extra .qcard matches, customer pickers instead of create forms).
 *    Reset = wipe the user outright; the spec recreates what it needs.
 *
 * 2. LEGACY EN USERS — specs written before the app went Spanish-first.
 *    They assume their fixed-phone user already EXISTS (login lands on
 *    /dashboard, not the new-user /welcome) with language "en" (they assert
 *    English chrome). On a fresh KV those users don't exist and a bare
 *    master-OTP login creates them Spanish-first, so the specs go red for
 *    environment reasons, not product ones. Reset = wipe, then re-create as
 *    an onboarded English user via the same dev endpoints the harness uses.
 *
 * Usage (dev stack must be running — deno task serve or equivalents):
 *   cd backend && deno run -A --unstable-kv scripts/dev-reset-e2e-fixtures.ts
 *
 * Dev/local only: relies on the master OTP (000000), which is disabled in
 * prod, and on the same per-phone wipe the cypress harness shells out to.
 */

const BASE = Deno.env.get("E2E_BASE_URL") ?? "http://localhost:5280/api";

/** Same per-phone wipe the cypress harness shells out to (CLI-only module). */
async function runWipe(phone: string): Promise<void> {
  const scriptDir = new URL(".", import.meta.url).pathname;
  const out = await new Deno.Command("deno", {
    args: ["run", "-A", "--unstable-kv", "dev-wipe-user.ts", phone],
    cwd: scriptDir,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(
      `wipe failed for ${phone}: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
}

/** Specs that accumulate paperwork/conversations against these phones. */
const ACCUMULATORS = [
  // assistant-experience.cy.ts
  "+15125553020",
  "+15125553021",
  "+15125553022",
  "+15125553023",
  "+15125553024",
  "+15125553025",
  "+15125553026",
  // invoice-detail-panel.cy.ts
  "+15125552830",
  "+15125552831",
  "+15125552832",
  "+15125552891",
  // settings-save-model.cy.ts
  "+15125552840",
  // otp-rate-limit.int.test.ts (cooldown/attempts state)
  "+15125552000",
  "+15125552001",
  "+15125552002",
  "+15125552003",
];

/** Pre-Spanish-first specs that assume an EXISTING, onboarded, EN user. */
const LEGACY_EN_USERS = [
  "+15125550100", // assistant.cy.ts
  "+15125550111", // assistant-history.cy.ts
  "+15125550199", // landing.cy.ts (login form → expects /dashboard, not /welcome)
  "+15125550928", // quotes-job-name.cy.ts
  "+15125550933", // dashboard-assistant-access.cy.ts
  "+15125550934",
  "+15125550935",
  "+15125550942", // public-completion-notify.cy.ts
  "+15125550946", // i18n-spanish.cy.ts (sets es itself, but assumes existing)
];

async function api(
  method: string,
  path: string,
  body: unknown,
  cookie?: string,
): Promise<Response> {
  return await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedLegacyEnUser(phone: string): Promise<void> {
  const verify = await api("POST", "/auth/verify", {
    phoneNumber: phone,
    code: "000000",
  });
  const setCookie = verify.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  await verify.body?.cancel();
  if (!verify.ok || !cookie) {
    throw new Error(`master-OTP verify failed for ${phone}: ${verify.status}`);
  }
  await (await api("PUT", "/me", {
    name: "Dev User",
    language: "en",
  }, cookie)).body?.cancel();
  await (await api("POST", "/me/onboarded", { skipped: true }, cookie))
    .body?.cancel();
}

for (const phone of [...ACCUMULATORS, ...LEGACY_EN_USERS]) {
  await runWipe(phone);
}
for (const phone of LEGACY_EN_USERS) {
  await seedLegacyEnUser(phone);
  console.log(`seeded EN user ${phone}`);
}
console.log(
  `reset ${ACCUMULATORS.length} accumulator phones, seeded ${LEGACY_EN_USERS.length} legacy EN users`,
);
