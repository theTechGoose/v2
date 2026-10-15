/**
 * selectPaymentsLinkName — REQ-054, the REQ-001 rule applied to the CRM's link builder.
 *
 * Pure decision: which PaymentsLink an env selects. No I/O here; the data
 * module passes in the env values it read.
 *
 *   - PPWK_PAYMENTS_URL, PPWK_PAYMENTS_TOKEN and PPWK_PAYMENTS_ACCOUNT all set → "crm"
 *   - any missing, NOT in production              → "fake" (the gate's lanes, a dev box)
 *   - any missing, IN production                  → throws — never boot prod on the
 *     fake, whose one remote control (POST /me/plan/fake-paid) would make every
 *     paid plan free.
 *
 * REQ-069 — the third key: the CRM (its REQ-091) takes the merchant account on every
 * mint and every subscription as the `x-account` header, required, the name of an
 * account its operator put on record. PPWK_PAYMENTS_ACCOUNT is that name; a pick that
 * names its own (REQ-064) still wins.
 *
 * "Production" = `DENO_DEPLOYMENT_ID` is set (Deno Deploy sets it on every
 * deployment; nothing else in this repo does).
 */
export type PaymentsLinkName = "crm" | "fake";

export interface PaymentsLinkEnv {
  PPWK_PAYMENTS_URL?: string;
  PPWK_PAYMENTS_TOKEN?: string;
  /** REQ-069 — the CRM merchant account every charge goes through unless a pick names one */
  PPWK_PAYMENTS_ACCOUNT?: string;
  DENO_DEPLOYMENT_ID?: string;
}

export function selectPaymentsLinkName(env: PaymentsLinkEnv): PaymentsLinkName {
  const origin = (env.PPWK_PAYMENTS_URL ?? "").trim();
  const token = (env.PPWK_PAYMENTS_TOKEN ?? "").trim();
  const account = (env.PPWK_PAYMENTS_ACCOUNT ?? "").trim();
  if (origin && token && account) return "crm";
  const inProduction = typeof env.DENO_DEPLOYMENT_ID === "string" && env.DENO_DEPLOYMENT_ID.length > 0;
  if (inProduction) {
    const missing = (["PPWK_PAYMENTS_URL", "PPWK_PAYMENTS_TOKEN", "PPWK_PAYMENTS_ACCOUNT"] as const).filter((k) => !(env[k] ?? "").trim());
    throw new Error(`PPWK_PAYMENTS_URL, PPWK_PAYMENTS_TOKEN and PPWK_PAYMENTS_ACCOUNT must all be set in production (${missing.join(", ")} missing) — the fake link builder never serves paid plans`);
  }
  return "fake";
}
