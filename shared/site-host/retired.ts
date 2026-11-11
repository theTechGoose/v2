/**
 * REQ-219 — the hosts that are no longer the site, and where a request for
 * one of them goes: the SAME path and query on the site's own origin.
 *
 * The old domain used to be a registrar forwarder, which answers "/" and 404
 * for every other path — so every old link (a text, an email, a search
 * result) was dead. Pointed at the app instead, the app answers each of these
 * hosts with a permanent redirect. The site's own "www" is retired the same
 * way: one address per page (REQ-218), not two.
 *
 * Shared so the front-end's first middleware and the tests read one list.
 */
import { SITE_ORIGIN } from "../quote-flow/site-meta.ts";

/** names only — never a URL (REQ-086: nothing links to the old domain) */
export const RETIRED_HOSTS: readonly string[] = [
  "paperworkmonster.com",
  "www.paperworkmonster.com",
  "www.documonster.com",
];

/** a Host header as a bare lowercase name: no port, no trailing dot */
function hostName(host: string | null | undefined): string {
  return String(host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(
    /\.$/,
    "",
  );
}

/**
 * Where a request for `host` at `pathAndQuery` should be sent, or null when
 * the host is not retired (the site itself, a preview host, localhost).
 */
export function retiredHostRedirect(
  host: string | null | undefined,
  pathAndQuery: string,
): string | null {
  if (!RETIRED_HOSTS.includes(hostName(host))) return null;
  // one leading slash exactly: "//other.example" after an origin would name another site
  const path = `/${String(pathAndQuery ?? "").replace(/^\/+/, "")}`;
  return `${SITE_ORIGIN}${path}`;
}
