/**
 * The team inboxes every public form on the websites is delivered to — the contact form and
 * the /landing2 demo booking (REQ-081) read the ONE list. Postmark accepts a comma-separated
 * `To`, so all three receive the message. `CONTACT_INBOX` (also comma-separated) overrides it.
 */
export const DEFAULT_TEAM_INBOX =
  "hp@hans.work, rafac@monsterrg.com, amcgill@monsterrg.com";

export function teamInbox(
  env: { get(k: string): string | undefined } = Deno.env,
): string {
  const set = env.get("CONTACT_INBOX")?.trim();
  return set || DEFAULT_TEAM_INBOX;
}
