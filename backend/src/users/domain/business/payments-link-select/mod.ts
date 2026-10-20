/**
 * selectPaymentsLinkName — REQ-054, the REQ-001 rule applied to the CRM's link builder.
 *
 * Pure decision: which PaymentsLink an env selects. No I/O here; the data
 * module passes in the env values it read.
 *
 *   - PPWK_PAYMENTS_URL and PPWK_PAYMENTS_TOKEN both set → "crm"
 *   - either missing, NOT in production              → "fake" (the gate's lanes, a dev box)
 *   - either missing, IN production                  → throws — never boot prod on the
 *     fake, whose one remote control (POST /me/plan/fake-paid) would make every
 *     paid plan free.
 *
 * REQ-100 — the merchant account is NOT a key. `PPWK_PAYMENTS_ACCOUNT` (REQ-069) was the
 * env knob that sent a real customer's $99 through the sandbox account; every pick names
 * its account itself now (shared/quote-flow/merchant-accounts.ts) and the real client
 * refuses a charge that names none — so an env var cannot pick the account, set or not.
 *
 * "Production" = `DENO_DEPLOYMENT_ID` is set (Deno Deploy sets it on every
 * deployment; nothing else in this repo does).
 */
export type PaymentsLinkName = "crm" | "fake";

export interface PaymentsLinkEnv {
  PPWK_PAYMENTS_URL?: string;
  PPWK_PAYMENTS_TOKEN?: string;
  DENO_DEPLOYMENT_ID?: string;
}

const KEYS = ["PPWK_PAYMENTS_URL", "PPWK_PAYMENTS_TOKEN"] as const;

export function selectPaymentsLinkName(env: PaymentsLinkEnv): PaymentsLinkName {
  const missing = KEYS.filter((k) => !(env[k] ?? "").trim());
  if (missing.length === 0) return "crm";
  const inProduction = typeof env.DENO_DEPLOYMENT_ID === "string" && env.DENO_DEPLOYMENT_ID.length > 0;
  if (inProduction) {
    throw new Error(`PPWK_PAYMENTS_URL and PPWK_PAYMENTS_TOKEN must both be set in production (${missing.join(", ")} missing) — the fake link builder never serves paid plans`);
  }
  return "fake";
}
