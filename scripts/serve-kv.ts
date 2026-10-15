/**
 * REQ-077 — which KV the backend `serve.ts` starts runs on.
 *
 * A bare PORT is what the merge gate (wt-gate, REQ-278) and `pin-link --serve`
 * (REQ-287) hand the `serve` task. Without a KV_PATH every such server — and a
 * developer's own `deno task serve` — opens Deno's ONE default KV file for this
 * checkout, so state crosses runs: the 30 s per-address OTP cooldown (P-03)
 * set by the previous gate's login story, or by the pinned server, answers
 * 429 to the next run's fixed address, the login island shows the cooldown
 * instead of navigating, and the story waits out its 90 s.
 *
 * So: an explicit KV_PATH always wins; a bare PORT with none gets a fresh
 * file in a temp dir of its own (`tmp()` makes it); no PORT keeps the
 * platform default and the developer's persistent dev data. Pure, so the
 * unit test (`jest/unit/serve-kv.test.ts`) can hand in the temp-dir maker.
 */
export interface ServeKvEnv {
  PORT?: string;
  KV_PATH?: string;
}

export function kvPathFor(
  env: ServeKvEnv,
  tmp: () => string,
): string | undefined {
  if (env.KV_PATH) return env.KV_PATH;
  if (env.PORT) return `${tmp()}/kv.sqlite3`;
  return undefined;
}
