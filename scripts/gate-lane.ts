/**
 * scripts/gate-lane.ts — the three test lanes the merge gate runs (REQ-278 /
 * REQ-316), one command per lane, so `deno task test:unit|test:int|test:e2e`
 * each names real files of its own kind and answers `--plan` with them.
 *
 *   deno run -A scripts/gate-lane.ts <unit|int|e2e> [--plan]
 *
 *   unit  backend/src/**  `test.ts` / `*.test.ts` (not int / e2e)  — deno test --parallel
 *         jest/unit/**    `*.test.ts`                              — jest (parallel by default)
 *   int   backend/src/**  `int.test.ts` + `e2e.test.ts` (in-process servers on their
 *         own ports; nothing to serve)                              — deno test --parallel
 *   e2e   jest/integration/** `*.int.test.ts` (real HTTP against the served app)
 *         cypress/e2e/**  `*.cy.ts` (a browser against the served app)
 *         Both drive BASE_URL — the gate serves it (`deno task serve` on a free
 *         PORT); by hand it defaults to the dev stack, http://localhost:5280.
 *
 * `--plan` prints the lane's files, one repo-relative path per line, and runs
 * nothing (what wt-gate reads to check every file's kind before it runs).
 */
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const lane = Deno.args[0];
const plan = Deno.args.includes("--plan");
if (!lane || !["unit", "int", "e2e"].includes(lane)) {
  console.error("usage: gate-lane.ts <unit|int|e2e> [--plan]");
  Deno.exit(2);
}

async function listed(pathspec: string): Promise<string[]> {
  const out = await new Deno.Command("git", {
    args: ["ls-files", "--cached", "--others", "--exclude-standard", "--", pathspec],
    cwd: ROOT,
    stdout: "piped",
    stderr: "null",
  }).output();
  return new TextDecoder().decode(out.stdout).split("\n").filter(Boolean).sort();
}

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const isBackendUnit = (p: string) =>
  /(^|[._])test\.ts$/.test(base(p)) && !/(^|\.)(int|e2e|smk)\.test\.ts$/.test(base(p));
const isBackendInt = (p: string) => /(^|\.)(int|e2e)\.test\.ts$/.test(base(p));

const files: Record<string, () => Promise<string[]>> = {
  unit: async () => [
    ...(await listed("backend/src")).filter(isBackendUnit),
    ...(await listed("jest/unit")).filter((p) => p.endsWith(".test.ts")),
  ],
  int: async () => (await listed("backend/src")).filter(isBackendInt),
  e2e: async () => [
    ...(await listed("jest/integration")).filter((p) => p.endsWith(".int.test.ts")),
    ...(await listed("cypress/e2e")).filter((p) => p.endsWith(".cy.ts")),
  ],
};

const paths = await files[lane]();
if (paths.length === 0) {
  console.error(`gate-lane: the ${lane} lane reaches no test file`);
  Deno.exit(2);
}
if (plan) {
  console.log(paths.join("\n"));
  Deno.exit(0);
}

async function run(
  label: string,
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<number> {
  console.log(`gate-lane[${lane}]: $ (cd ${cwd.replace(ROOT + "/", "")} && ${cmd} ${args.slice(0, 4).join(" ")}${args.length > 4 ? " …" : ""})`);
  const status = await new Deno.Command(cmd, {
    args,
    cwd,
    env: { ...Deno.env.toObject(), ...env },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  console.log(`gate-lane[${lane}]: ${label} → exit ${status.code}`);
  return status.code;
}

const inBackend = (p: string) => p.replace(/^backend\//, "");
const DENO_TEST = ["test", "-A", "--unstable-kv", "--parallel"];
const codes: number[] = [];

if (lane === "unit") {
  codes.push(
    await run("backend unit", "deno", [...DENO_TEST, ...paths.filter((p) => p.startsWith("backend/")).map(inBackend)], `${ROOT}/backend`),
  );
  codes.push(await run("jest unit", "npx", ["jest", "--selectProjects", "unit"], `${ROOT}/jest`));
} else if (lane === "int") {
  codes.push(await run("backend int + e2e", "deno", [...DENO_TEST, ...paths.map(inBackend)], `${ROOT}/backend`));
} else {
  // The served app: the gate exports BASE_URL (REQ-278); by hand, the dev stack.
  const baseUrl = (Deno.env.get("BASE_URL") ?? "http://localhost:5280").replace(/\/$/, "");
  console.log(`gate-lane[e2e]: BASE_URL=${baseUrl}`);
  const env = {
    BASE_URL: baseUrl,
    API_BASE_URL: `${baseUrl}/api`,
    FRONTEND_BASE_URL: baseUrl,
    CYPRESS_BASE_URL: baseUrl,
  };
  codes.push(await run("jest integration", "npx", ["jest", "--selectProjects", "integration"], `${ROOT}/jest`, env));
  codes.push(await run("cypress", "npx", ["cypress", "run"], `${ROOT}/cypress`, env));
}

Deno.exit(codes.every((c) => c === 0) ? 0 : 1);
