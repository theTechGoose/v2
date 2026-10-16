/**
 * REQ-082 — "for the fake you should have a pop up with the code."
 *
 * On the fakes no text goes out (REQ-318: DENO_DEPLOY unset — the gate, a dev box, a pin), so
 * the code the send-otp coordinator stored rides the reply and the page shows it. On the real
 * deploy — DENO_DEPLOY set, or Deno Deploy's own DENO_DEPLOYMENT_ID — the reply never carries
 * it: the code goes through the SMS adapter only. Pure: the env is a parameter.
 */
export function devCodeFor(
  code: string,
  env: { get(k: string): string | undefined } = Deno.env,
): string | undefined {
  const real = Boolean(env.get("DENO_DEPLOY")?.trim()) ||
    Boolean(env.get("DENO_DEPLOYMENT_ID")?.trim());
  return real ? undefined : code;
}
