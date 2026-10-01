/**
 * test-lane — the repo's `test:unit` / `test:int` / `test:smoke` tasks (REQ-051).
 *
 *   deno run -A scripts/test-lane.ts <unit|int|smoke> [--plan]
 *
 * The merge gate (REQ-278/316) needs each lane to know its files BEFORE it
 * runs, and a test's kind is its filename: `int.test.ts` is int, `smk.test.ts`
 * is smoke (external services — never in the gate), everything else that
 * Deno calls a test (`test.ts`, `<name>.test.ts`, the in-process `e2e.test.ts`
 * server tests) is unit. `--plan` prints the lane's files, one path per line,
 * exit 0; without it the lane runs them with `deno test --parallel` from the
 * backend (its import map), and the unit lane also runs jest's unit project
 * (jest's own workers) — one exit code for both.
 */
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const lane = Deno.args[0];
const plan = Deno.args.includes("--plan");
if (!["unit", "int", "smoke"].includes(lane ?? "")) {
  console.error("usage: test-lane.ts <unit|int|smoke> [--plan]");
  Deno.exit(2);
}

type Kind = "unit" | "int" | "smoke";
const TEST_NAME = /(^|\/)([^/]*[._])?test\.ts$/;
function kindOf(path: string): Kind {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name === "smk.test.ts" || name.endsWith(".smk.test.ts")) return "smoke";
  if (name === "int.test.ts" || name.endsWith(".int.test.ts")) return "int";
  return "unit";
}
async function walk(dir: string, out: string[]): Promise<void> {
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) {
      if (e.name === "node_modules") continue;
      await walk(p, out);
    } else if (e.isFile && TEST_NAME.test(p)) out.push(p);
  }
}

const backend: string[] = [];
await walk(`${ROOT}/backend/src`, backend);
const backendLane = backend
  .filter((p) => kindOf(p) === lane)
  .map((p) => p.slice(ROOT.length + 1))
  .sort();
const jestLane: string[] = [];
if (lane === "unit") {
  const jestFiles: string[] = [];
  await walk(`${ROOT}/jest/unit`, jestFiles);
  jestLane.push(...jestFiles.map((p) => p.slice(ROOT.length + 1)).sort());
}

if (plan) {
  for (const p of [...backendLane, ...jestLane]) console.log(p);
  Deno.exit(0);
}

async function run(cmd: string, args: string[], cwd: string): Promise<number> {
  console.log(
    `== ${cmd} ${args.join(" ")}  (in ${cwd.slice(ROOT.length + 1) || "."})`,
  );
  const status = await new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  return status.code;
}

let rc = 0;
if (backendLane.length > 0) {
  const rel = backendLane.map((p) => p.replace(/^backend\//, ""));
  rc = await run(
    "deno",
    ["test", "-A", "--unstable-kv", "--parallel", ...rel],
    `${ROOT}/backend`,
  );
}
if (lane === "unit") {
  const jestRc = await run(
    "npx",
    ["jest", "--selectProjects", "unit", "--ci"],
    `${ROOT}/jest`,
  );
  if (jestRc !== 0) rc = jestRc;
}
Deno.exit(rc);
