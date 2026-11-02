/**
 * REQ-126 — Raphael, 2026-11-02: "the tests send emails to hans and andy, it should not send
 * emails to anyone but me on tests."
 *
 * The gate's server boots the backend with the checkout's `.env`, so a real Postmark key is in
 * the process and every send dispatches for real: the /landing2 story's demo booking mailed the
 * team inbox (Hans, Raphael, Andy) on every run. Nothing in the send path knew whether it was
 * production. Now the EmailService itself knows: off the real deploy (no DENO_DEPLOYMENT_ID — the
 * gate, a box, the Mac, every test) the request Postmark gets is addressed to Raphael alone, nobody
 * copied, the subject naming who it was for. On the deploy the payload is exactly the caller's.
 * Pure; the service reads the env and hands it in.
 */
export const DEV_RECIPIENT = "rafac@monsterrg.com";

export interface DeliveryEnv {
  DENO_DEPLOYMENT_ID?: string;
  /** moves the one address (a box of someone else's); never the rule */
  DEV_MAIL_TO?: string;
}

export function isRealDeploy(env: DeliveryEnv): boolean {
  return Boolean(env.DENO_DEPLOYMENT_ID?.trim());
}

/** the request as Postmark should get it: untouched on the deploy; to Raphael alone off it */
export function deliveredTo<
  T extends { To: string; Cc?: string; Subject: string },
>(payload: T, env: DeliveryEnv): T {
  if (isRealDeploy(env)) return payload;
  const { Cc, ...rest } = payload;
  const note = Cc ? `[to: ${payload.To}; cc: ${Cc}]` : `[to: ${payload.To}]`;
  return {
    ...rest,
    To: env.DEV_MAIL_TO?.trim() || DEV_RECIPIENT,
    Subject: `${note} ${payload.Subject}`,
  } as T;
}

export function deliveryEnv(): DeliveryEnv {
  return {
    DENO_DEPLOYMENT_ID: Deno.env.get("DENO_DEPLOYMENT_ID"),
    DEV_MAIL_TO: Deno.env.get("DEV_MAIL_TO"),
  };
}
