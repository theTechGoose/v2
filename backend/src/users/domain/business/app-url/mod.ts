import { SITE_ORIGIN } from "#quote-flow/site-meta.ts";

/**
 * REQ-146/151 — the app's address in a text (the admin invite, the worker welcome): the real
 * site on the deploy, localhost otherwise; APP_URL overrides either.
 */
export function appUrl(): string {
  const explicit = Deno.env.get("APP_URL")?.trim() || undefined;
  if (Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined) {
    return explicit ?? SITE_ORIGIN;
  }
  return explicit ?? "http://localhost:5280";
}
