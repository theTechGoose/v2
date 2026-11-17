/**
 * REQ-803 — the origin Square sends the customer back to after its checkout. On the real
 * deploy it is always the site's own (APP_URL, else documonster.com) — never a caller's
 * `Origin` header, so no one can mint a checkout on a business's Square that lands somewhere
 * else. Off the real deploy (a dev box, a test port, the e2e runner) the page's own origin, so
 * the customer comes back to the app that sent them; anything that is not http(s) falls back
 * to the local default.
 */
import {
  type EnvReader,
  onRealDeploy,
} from "@core/business/real-deploy/mod.ts";
import { SITE_ORIGIN } from "#quote-flow/site-meta.ts";

function originOf(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function squareReturnOrigin(
  requestOrigin: string | undefined | null,
  env: EnvReader = Deno.env,
): string {
  const explicit = originOf(env.get("APP_URL"));
  if (onRealDeploy(env)) return explicit ?? SITE_ORIGIN;
  return originOf(requestOrigin) ?? explicit ?? "http://localhost:5280";
}
