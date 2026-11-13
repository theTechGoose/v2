/**
 * REQ-806 — `deno task ops`, pure parts: the arguments, the view browser's write block, file
 * names, and the session cookie the tool's own browser carries (never printed).
 */
export type OpsArgs =
  | { cmd: "ask"; account: string; reason: string; base: string }
  | { cmd: "view"; paths: string[]; out?: string; base: string }
  | { cmd: "end" };

export const OPS_USAGE = `usage:
  deno task ops ask "<phone | name | business>" [--reason "<why>"] [--base <url>]
  deno task ops view <path> [<path> …] [--out <dir>] [--base <url>]
  deno task ops end`;

export function parseOpsArgs(argv: string[]): OpsArgs {
  const flags: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) flags[a.slice(2)] = argv[++i] ?? "";
    else pos.push(a);
  }
  const base = (flags.base || "https://documonster.com").replace(/\/+$/, "");
  const [cmd, ...rest] = pos;
  if (cmd === "ask") {
    const account = rest.join(" ").trim();
    if (!account) throw new Error(`an account is required\n${OPS_USAGE}`);
    return { cmd, account, reason: flags.reason ?? "", base };
  }
  if (cmd === "view") {
    if (!rest.length) throw new Error(`a path is required\n${OPS_USAGE}`);
    return { cmd, paths: rest, ...(flags.out ? { out: flags.out } : {}), base };
  }
  if (cmd === "end") return { cmd };
  throw new Error(OPS_USAGE);
}

/** the view browser sends no write anywhere — reads only */
export function blocksRequest(
  _base: string,
  method: string,
  _url: string,
): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

/** "01-i-1b2c-x-1" — a screenshot / text file's name */
export function outName(i: number, path: string): string {
  const slug = path.replace(/^\/+/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  ) ||
    "home";
  return `${String(i + 1).padStart(2, "0")}-${slug}`;
}

export function viewCookie(base: string, sessionId: string) {
  const u = new URL(base);
  return {
    name: "pm_session",
    value: sessionId,
    domain: u.hostname,
    path: "/",
    secure: u.protocol === "https:",
    httpOnly: true,
  };
}
