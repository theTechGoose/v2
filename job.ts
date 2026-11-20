// vm-cycle/job.ts — LOOP-008: what ONE VM does for a QA cycle. It runs on the VM (boot.sh fetches the kit this file
// travels in and starts it); the Mac only launches, waits and collects.
//
//   mode analyze — triage the testers' reports, one RCA agent per issue, group the fixable ones by root cause
//   mode fix     — for this VM's slice of the items: a worktree, the test writer, then the fixer
//   mode merge   — the integrator merges the cycle's fix refs; the driver runs the quick lanes ITSELF and sends a red one back
//   mode gate    — run the steps addressed to this VM at a ref and hand each one's result back as it ends
//
// IN:  /work/kit/work.json (what to do), refs under refs/qa/ on GitHub (read-only deploy key).
// OUT: every finished step uploads its result JSON and a git bundle to the run's folder in the results bucket, under a
//      name used ONCE (the VM's account can create objects, not replace them).
// A VM CAN VANISH AT ANY MINUTE (spot): so every `beat` it also uploads its own log so far and every commit made since
// the last beat. Nothing a child prints is held in this process's memory: it goes to a file and is read back capped.
//
// Test seams (job_test.ts): QAVM_KIT / QAVM_V2 / QAVM_OUT / QAVM_WT (paths), QAVM_IDX (the VM's index), QAVM_AGENT,
// QAVM_UPLOAD_DIR (a folder instead of the bucket), QAVM_SKIP_SETUP (no install, sink or .env), QAVM_KILL_GRACE,
// QAVM_RETRY_WAIT, QAVM_BEAT (seconds).
import * as P from "./prompts.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const E = (k: string, d: string) => Deno.env.get(k) ?? d;
const KIT = E("QAVM_KIT", "/work/kit"), V2 = E("QAVM_V2", "/work/v2"), OUT = E("QAVM_OUT", "/work/out"), WT = E("QAVM_WT", "/work/wt");
const AGENT = E("QAVM_AGENT", "fleet-claude"), UPDIR = Deno.env.get("QAVM_UPLOAD_DIR"), SKIP = !!Deno.env.get("QAVM_SKIP_SETUP");
const GRACE = Number(E("QAVM_KILL_GRACE", "30")), RETRY_WAIT = Number(E("QAVM_RETRY_WAIT", "45"));
const HOST = Deno.hostname();
const IDX = Number(Deno.env.get("QAVM_IDX") ?? HOST.replace(/^.*-/, ""));
const T0 = Date.now();
const work = JSON.parse(Deno.readTextFileSync(`${KIT}/work.json`));
const C: number = work.cycle, BASE: string = work.base, BASE_SHA: string = work.baseSha;
const TMO: Record<string, number> = { triage: 15, rca: 12, test: 25, fix: 50, merge: 60, ...(work.timeouts ?? {}) };
const BEAT = Number(E("QAVM_BEAT", String(work.beat ?? 120)));
const DEADLINE = T0 + (work.minutes - (work.reserve ?? 5)) * 60_000;
const left = () => (DEADLINE - Date.now()) / 60_000;
const secs = () => Math.round((Date.now() - T0) / 1000);
const LOG: string[] = [];
const say = (m: string) => { LOG.push(`${String(secs()).padStart(5)}s [vm ${IDX}] ${m}`); console.log(`[vm ${IDX}] ${m}`); };
const dec = new TextDecoder();
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
const redact = (s: string) => s.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[key]");
const tail = (s: string, n: number) => redact(strip(s)).split("\n").slice(-n).join("\n");
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

// ── shell ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TOOLS = `${KIT}/tools`;
const baseEnv: Record<string, string> = { ...Deno.env.toObject(), PATH: `${TOOLS}:${Deno.env.get("PATH") ?? ""}` };
const sshKey = `${Deno.env.get("HOME") ?? ""}/.ssh/theTechGoose_v2`;
try { Deno.statSync(sshKey); baseEnv.GIT_SSH_COMMAND = `ssh -i ${sshKey} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`; } catch { /* not a fleet VM */ }

/** A file's text, at most `max` bytes of it: its first 20 MB and its end. */
async function readCapped(file: string, max = 150_000_000): Promise<string> {
  const size = (await Deno.stat(file).catch(() => null))?.size ?? 0;
  if (size <= max) return await Deno.readTextFile(file).catch(() => "");
  const f = await Deno.open(file), head = new Uint8Array(20_000_000), end = new Uint8Array(max - head.length);
  const fill = async (b: Uint8Array) => { for (let n = 0; n < b.length;) { const r = await f.read(b.subarray(n)); if (r === null) break; n += r; } };
  try { await fill(head); await f.seek(size - end.length, Deno.SeekMode.Start); await fill(end); } finally { f.close(); }
  return `${dec.decode(head)}\n… ${Math.round((size - max) / 1e6)} MB of output left on the VM by the driver …\n${dec.decode(end)}`;
}
/** Run a shell command. Its output goes to a FILE (never into this process's memory) and comes back capped. */
async function sh(cmd: string, o: { cwd?: string; env?: Record<string, string>; timeoutSec?: number; logFile?: string } = {}): Promise<{ code: number; out: string }> {
  const file = o.logFile ?? await Deno.makeTempFile({ prefix: "qavm-sh-" });
  const wrapped = `( ${cmd}\n) > ${q(file)} 2>&1`;
  const args = o.timeoutSec ? ["-k", String(GRACE), String(Math.max(1, Math.ceil(o.timeoutSec))), "bash", "-c", wrapped] : ["-c", wrapped];
  const p = await new Deno.Command(o.timeoutSec ? "timeout" : "bash", { args, cwd: o.cwd ?? V2, env: { ...baseEnv, ...(o.env ?? {}) }, stdin: "null", stdout: "null", stderr: "null" }).output();
  const out = await readCapped(file);
  if (!o.logFile) await Deno.remove(file).catch(() => {});
  return { code: p.code, out };
}
const git = async (cwd: string, ...a: string[]) => {
  const p = await new Deno.Command("git", { args: a, cwd, env: baseEnv, stdout: "piped", stderr: "piped" }).output();
  return { code: p.code, out: dec.decode(p.stdout).trim(), err: dec.decode(p.stderr).trim() };
};
const exists = (p: string) => Deno.stat(p).then(() => true).catch(() => false);
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const todo = [...items];
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, todo.length)) }, async () => { for (let t = todo.shift(); t !== undefined; t = todo.shift()) await fn(t).catch((e) => say(`ERROR ${e?.stack ?? e}`)); }));
}

// ── upload: one name, once ───────────────────────────────────────────────────────────────────────────────────────────
const used = new Set<string>();
let token: { v: string; at: number } | null = null, bucket = "";
const md = async (path: string) => { const r = await fetch(`http://metadata.google.internal/computeMetadata/v1/${path}`, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(15_000) }); if (!r.ok) throw new Error(`metadata ${path}: ${r.status}`); return await r.text(); };
async function upload(local: string, name: string): Promise<boolean> {
  if (used.has(name)) { say(`upload refused: ${name} was already used`); return false; }
  used.add(name);
  try {
    if (UPDIR) {
      const dest = `${UPDIR}/out/${name}`;
      if (await exists(dest)) { say(`upload refused: ${name} exists in the bucket`); return false; }
      await Deno.mkdir(dest.slice(0, dest.lastIndexOf("/")), { recursive: true });
      await Deno.copyFile(local, dest);
      return true;
    }
    for (let i = 0; i < 3; i++) {
      try {
        if (!token || Date.now() - token.at > 240_000) token = { v: JSON.parse(await md("instance/service-accounts/default/token")).access_token, at: Date.now() };
        bucket ||= await md("instance/attributes/fleet-bucket");
        const obj = encodeURIComponent(`runs/${Deno.env.get("FLEET_RUN")}/${HOST}/out/${name}`);
        const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${obj}`, { method: "POST", headers: { Authorization: `Bearer ${token.v}`, "Content-Type": "application/octet-stream" }, body: await Deno.readFile(local), signal: AbortSignal.timeout(180_000) });
        await r.body?.cancel();
        if (r.ok) return true;
        say(`upload ${name}: http ${r.status}`);
      } catch (e) { say(`upload ${name}: ${(e as Error).message}`); }
      await new Promise((r) => setTimeout(r, 3000));
    }
  } catch (e) { say(`upload ${name}: ${(e as Error).message}`); }
  return false;
}
async function putJson(name: string, v: unknown) {
  const f = `${OUT}/${name}`;
  await Deno.mkdir(f.slice(0, f.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(f, JSON.stringify(v, null, 1));
  await upload(f, name);
}
/** `<BASE_SHA>..<branch>` as a bundle, uploaded. false when the branch has nothing beyond the base. */
async function putBundle(cwd: string, branch: string, name: string): Promise<boolean> {
  if ((await git(cwd, "rev-list", "--count", `${BASE_SHA}..refs/heads/${branch}`)).out === "0") return false;
  const f = `${OUT}/${name}`;
  await Deno.mkdir(f.slice(0, f.lastIndexOf("/")), { recursive: true });
  const b = await git(cwd, "bundle", "create", f, `${BASE_SHA}..refs/heads/${branch}`);
  if (b.code !== 0) { say(`bundle ${name} failed: ${b.err.split("\n")[0]}`); return false; }
  return await upload(f, name);
}

// ── the beat: what a VM hands back while it is still working ─────────────────────────────────────────────────────────
const beats: (() => Promise<void>)[] = [];
/** Branches being worked on: each beat, a branch whose tip moved is bundled and uploaded as `<rel>/wip-<n>.bundle`. */
const watch = new Map<string, { cwd: string; branch: string; rel: string; last: string; n: number }>();
beats.push(async () => {
  for (const w of [...watch.values()]) {
    const tip = (await git(w.cwd, "rev-parse", "-q", "--verify", `refs/heads/${w.branch}`)).out;
    if (!tip || tip === w.last) continue;
    if (await putBundle(w.cwd, w.branch, `${w.rel}/wip-${++w.n}.bundle`)) w.last = tip;
  }
});
let beating = false, beatN = 0;
async function beat() {
  if (beating) return;
  beating = true;
  try {
    for (const b of beats) await b().catch((e) => say(`beat: ${(e as Error).message}`));
    const sys = SKIP ? "" : (await sh("uptime; free -m | sed -n 2p; df -h /work | tail -1", { timeoutSec: 20 }).catch(() => ({ out: "" }))).out;
    const name = `log/${String(++beatN).padStart(4, "0")}-${secs()}s.txt`, f = `${OUT}/${name}`;
    await Deno.mkdir(`${OUT}/log`, { recursive: true });
    await Deno.writeTextFile(f, `${LOG.join("\n")}\n--- ${left().toFixed(1)} min of work left · ${used.size} objects uploaded\n${sys}`);
    await upload(f, name);
  } finally { beating = false; }
}

// ── the memory watchdog ──────────────────────────────────────────────────────────────────────────────────────────────
// A VM that runs out of memory does not crash: it goes silent (r28e2933e VM 5: 9.7 GB → 28.4 GB used in 26 minutes,
// then no beat). Before that point the driver kills the test processes: the step ends red, and the VM can still report.
const MIN_FREE = Number(E("QAVM_MIN_FREE_MB", "2500")), KILL_COMM = E("QAVM_KILL_COMM", "chrome,deno,node").split(","), MEM_FILE = Deno.env.get("QAVM_MEM_FILE");
let lastKill = 0, watchdogNote = "";
async function freeMb(): Promise<number> {
  try {
    if (MEM_FILE) return Number((await Deno.readTextFile(MEM_FILE)).trim());
    const m = (await Deno.readTextFile("/proc/meminfo")).match(/^MemAvailable:\s+(\d+) kB/m);
    return m ? Math.round(Number(m[1]) / 1024) : Infinity;
  } catch { return Infinity; }
}
async function watchdog() {
  const mb = await freeMb();
  if (!(mb < MIN_FREE) || Date.now() - lastKill < 30_000) return;
  lastKill = Date.now();
  const ps = await new Deno.Command("ps", { args: ["-eo", "pid=,ppid=,comm=,args="], stdout: "piped", stderr: "null" }).output();
  const rows = dec.decode(ps.stdout).split("\n").map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[3].split("/").pop()!, args: m[4] }));
  const parent = new Map(rows.map((r) => [r.pid, r.ppid]));
  const mine = (pid: number) => { for (let p = parent.get(pid), n = 0; p !== undefined && n < 64; p = parent.get(p), n++) if (p === Deno.pid) return true; return false; };
  // this driver's own children, and on a real VM also orphans (a browser whose parent already died)
  const pids = rows.filter((r) => r.pid !== Deno.pid && KILL_COMM.includes(r.comm) && !/job\.ts/.test(r.args) && (mine(r.pid) || (!SKIP && r.ppid === 1))).map((r) => String(r.pid));
  if (pids.length) await new Deno.Command("kill", { args: ["-9", ...pids], stdout: "null", stderr: "null" }).output();
  watchdogNote = `memory watchdog: ${mb} MB left — killed ${pids.length} test processes (${KILL_COMM.join(", ")}) at ${secs()}s so the VM could go on`;
  say(watchdogNote);
}

// ── agents ───────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Ran { ok: boolean; result?: Any; cutOff?: boolean; notStarted?: boolean; error?: string; secs: number }
/** Run one headless agent. Its answer is the JSON file it was told to write; a crash is retried, a time-out is not. */
async function agent(role: string, prompt: string, o: { cwd: string; dir: string; file: string; need: string[]; label: string; env?: Record<string, string> }): Promise<Ran> {
  await Deno.mkdir(o.dir, { recursive: true });
  const t0 = Date.now(), attempts = work.attempts ?? 2;
  let error = "";
  for (let a = 1; a <= attempts; a++) {
    const budget = Math.min(TMO[role], left() - 1);
    if (budget < Math.min(3, TMO[role])) return { ok: false, notStarted: true, error: `no time left to start (${left().toFixed(1)} min before the VM's deadline)`, secs: 0 };
    await Deno.remove(o.file).catch(() => {});
    let text = a > 1 && error.startsWith("no valid result") ? `${prompt}\n\n(Your previous run ended without a valid result file: ${error}. Check the state of your work, finish it, and write the file.)` : prompt;
    if (text.length > 100_000) { await Deno.writeTextFile(`${o.dir}/${role}.prompt.txt`, text); text = `Read the file ${o.dir}/${role}.prompt.txt completely and follow it exactly. It is your whole task.`; }
    const out = await Deno.open(`${o.dir}/${role}.out`, { write: true, create: true, truncate: true }), err = await Deno.open(`${o.dir}/${role}.err`, { write: true, create: true, truncate: true });
    const child = new Deno.Command("timeout", { args: ["-k", String(GRACE), String(Math.ceil(budget * 60)), AGENT, "-p", text, "--output-format", "stream-json", "--verbose"], cwd: o.cwd, env: { ...baseEnv, ...(o.env ?? {}) }, stdin: "null", stdout: "piped", stderr: "piped" }).spawn();
    const [st] = await Promise.all([child.status, child.stdout.pipeTo(out.writable), child.stderr.pipeTo(err.writable)]);
    const res = await Deno.readTextFile(o.file).then((t) => JSON.parse(t)).catch(() => null);
    const missing = res && typeof res === "object" ? o.need.filter((k) => !(k in res)) : o.need;
    if (res && !missing.length) return { ok: true, result: res, secs: Math.round((Date.now() - t0) / 1000) };
    if (st.code === 124 || st.code === 137) return { ok: false, cutOff: true, error: `cut off after ${budget.toFixed(1)} min`, secs: Math.round((Date.now() - t0) / 1000) };
    error = st.code === 0 ? `no valid result file (${res ? `missing ${missing.join(", ")}` : "none written, or not JSON"})` : `exit ${st.code}: ${tail(await Deno.readTextFile(`${o.dir}/${role}.err`).catch(() => ""), 12)}`;
    say(`${o.label}: attempt ${a} failed — ${error.split("\n")[0].slice(0, 200)}`);
    if (a < attempts) await new Promise((r) => setTimeout(r, RETRY_WAIT * 1000 * a));
  }
  return { ok: false, error, secs: Math.round((Date.now() - t0) / 1000) };
}

// ── git plumbing ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function worktree(dir: string, start: string, branch?: string) {
  if (!(await exists(dir))) {
    const r = await git(V2, "worktree", "add", "-f", ...(branch ? ["-B", branch] : ["--detach"]), dir, start);
    if (r.code !== 0) throw new Error(`worktree ${dir} at ${start}: ${r.err}`);
  }
  await sh(`mkdir -p node_modules && for e in "${V2}"/node_modules/* "${V2}"/node_modules/.bin "${V2}"/node_modules/.deno; do [ -e "$e" ] && [ ! -e "node_modules/$(basename "$e")" ] && ln -s "$e" "node_modules/$(basename "$e")"; done
[ -d "${V2}/jest/node_modules" ] && [ -d jest ] && [ ! -e jest/node_modules ] && ln -s "${V2}/jest/node_modules" jest/node_modules
[ -f "${V2}/.env" ] && [ ! -e .env ] && ln -s "${V2}/.env" .env; true`, { cwd: dir });
}
/** Uncommitted edits are never left to die with the VM. */
async function checkpoint(cwd: string, who: string, finished = false, tag = ""): Promise<boolean> {
  if (!(await git(cwd, "status", "--porcelain")).out) return false;
  await git(cwd, "add", "-A");
  const msg = finished ? `${tag}: files ${who} left uncommitted (committed by the VM driver, LOOP-008)` : `WIP checkpoint: ${who} stopped with uncommitted edits (LOOP-008) — not a finished change`;
  return (await git(cwd, "commit", "-q", "--no-verify", "-m", msg)).code === 0;
}
const SETUP_ENV: Record<string, string> = {};
const shotsEnv = (who: string): Record<string, string> => ({ ...(work.tz ? { TZ: work.tz } : {}), SHOTS_DIR: `/work/evidence/${safe(who)}`, SHOTS_HISTORY_DIR: "/work/evidence/.durations", ...(work.agentEnv ?? {}), ...SETUP_ENV });

async function setup() {
  await Deno.mkdir(OUT, { recursive: true }); await Deno.mkdir(WT, { recursive: true });
  await git(V2, "config", "user.name", work.git.name); await git(V2, "config", "user.email", work.git.email);
  // the linked node_modules and .env are symlinks, which a `node_modules/` ignore rule does not cover: keep them out of every `git add -A`
  const common = (await git(V2, "rev-parse", "--path-format=absolute", "--git-common-dir")).out;
  await Deno.mkdir(`${common}/info`, { recursive: true });
  const ex = await Deno.readTextFile(`${common}/info/exclude`).catch(() => "");
  if (!/^node_modules$/m.test(ex)) await Deno.writeTextFile(`${common}/info/exclude`, `${ex}${ex.endsWith("\n") || !ex ? "" : "\n"}node_modules\n.env\n`);
  for (let i = 0; i < 3; i++) {
    const f = await git(V2, "fetch", "-q", "origin", `+refs/heads/${BASE}:refs/remotes/origin/${BASE}`, `+refs/qa/c${C}/*:refs/qa/c${C}/*`);
    if (f.code === 0) break;
    say(`fetch failed (${f.err.split("\n")[0]})`); await new Promise((r) => setTimeout(r, 4000));
  }
  if ((await git(V2, "cat-file", "-e", `${BASE_SHA}^{commit}`)).code !== 0) { say(`the base commit ${BASE_SHA} is not on this VM — nothing can start`); Deno.exit(92); }
  if (work.startSha && (await git(V2, "rev-parse", "-q", "--verify", `${work.start}^{commit}`)).out !== work.startSha) { say(`${work.start} is not at ${work.startSha} on this VM — nothing can start`); Deno.exit(94); }
  const co = await git(V2, "checkout", "-q", "-f", "--detach", BASE_SHA);
  if (co.code !== 0) { say(`checkout of ${BASE_SHA} failed: ${co.err}`); Deno.exit(93); }
  if (SKIP) return;
  // the VM's .env: the fleet env minus every real Postmark/Twilio/comms setting, all pointed at the local sink (as qa5.sh)
  const SINK = "http://127.0.0.1:4999";
  const fleet = await Deno.readTextFile("/work/.fleet-env").catch(() => "");
  await Deno.writeTextFile(`${V2}/.env`, [...fleet.split("\n").filter((l) => l && !/^(POSTMARK_|TWILIO_|COMMS_)/.test(l)), "AGENTS_LLM_CLIENT=openai", "TRANSCRIPTION_CLIENT=openai", "POSTMARK_API_KEY=sink", `POSTMARK_BASE_URL=${SINK}`,
    "TWILIO_ACCOUNT_SID=ACsink0000000000000000000000000000", "TWILIO_AUTH_TOKEN=sink", "TWILIO_FROM=+18435550100", `TWILIO_BASE_URL=${SINK}`, `COMMS_TWILIO_BASE_URL=${SINK}`, `COMMS_TRUSTHUB_BASE_URL=${SINK}`, `COMMS_MESSAGING_BASE_URL=${SINK}`].join("\n") + "\n", { mode: 0o600 });
  await sh(`(SINK_DIR=/work/mail nohup deno run -A --no-config "${KIT}/outbox-sink.ts" > /tmp/sink.log 2>&1 &) 2>/dev/null; chmod +x "${TOOLS}"/* 2>/dev/null; (sudo apt-get install -y -qq ripgrep > /tmp/apt.log 2>&1 &); true`);
  const inst = await sh("deno install", { timeoutSec: 600 });
  // shots: a Playwright library from the repo's own Deno cache, and the VM's Chrome as its browser
  const pw = (await sh(`ls -d "$HOME"/.cache/deno/npm/registry.npmjs.org/playwright-core/*/ 2>/dev/null | sort -V | tail -1`)).out.trim().replace(/\/$/, "");
  if (pw) SETUP_ENV.SHOTS_PLAYWRIGHT = pw;
  // …and both packages linked into node_modules (as on the Mac host): shots type-checks every story up front, and under
  // this repo's `nodeModulesDir: manual` its `npm:playwright` import resolves only from there (seen on r997dacf1: "Could
  // not find a matching package for 'npm:playwright@^1.50'", 0 stories ran). Worktrees link every entry of this folder.
  const linked = (await sh(`for p in playwright playwright-core; do src=$(ls -d "$HOME"/.cache/deno/npm/registry.npmjs.org/$p/*/ 2>/dev/null | sort -V | tail -1); [ -n "$src" ] && [ ! -e "node_modules/$p" ] && ln -s "\${src%/}" "node_modules/$p"; done; ls -d node_modules/playwright node_modules/playwright-core 2>/dev/null | wc -l`)).out.trim();
  const chrome = (await sh("command -v google-chrome || command -v chromium || true")).out.trim();
  if (chrome) SETUP_ENV.PLAYWRIGHT_CHROMIUM_EXECUTABLE = chrome;
  const probe = await sh("shots probe", { env: shotsEnv("probe"), timeoutSec: 120 });
  say(`setup done at ${secs()}s · base ${BASE_SHA.slice(0, 8)} · deno install exit ${inst.code} · playwright ${pw || "NOT FOUND"} · ${linked} of 2 playwright packages in node_modules · browser ${chrome || "NOT FOUND"} · shots probe exit ${probe.code}${probe.code ? ` (${tail(probe.out, 3).replace(/\n/g, " / ")})` : ""} · AI key ${/^OPENAI_API_KEY=../m.test(fleet) ? "present" : "MISSING"} · ${navigator.hardwareConcurrency} cores`);
}
/** A worktree that is ahead of the base may need a dependency the base did not have. */
async function installIn(wt: string) {
  if (SKIP) return;
  const r = await sh("deno install", { cwd: wt, timeoutSec: 600 });
  say(`deno install in ${wt}: exit ${r.code} at ${secs()}s · head ${(await git(wt, "rev-parse", "--short", "HEAD")).out}${r.code ? ` (${tail(r.out, 3).replace(/\n/g, " / ")})` : ""}`);
}

// ── mode: analyze ────────────────────────────────────────────────────────────────────────────────────────────────────
const ctx = (): P.Ctx => ({ cycle: C, commit: work.commit ?? BASE_SHA, base: BASE, rules: `${KIT}/ISSUE-RULES.md`, raw: (work.reports ?? []).map((r: string) => `${KIT}/${r}`), src: `${WT}/src` });
async function analyze() {
  const c = ctx();
  await worktree(c.src, c.commit);
  let triage = work.triage;
  if (!triage) {
    const r = await agent("triage", P.triage(c, `${OUT}/triage.json`), { cwd: c.src, dir: OUT, file: `${OUT}/triage.json`, need: ["issues", "coverage"], label: "triage" });
    if (!r.ok) { await putJson("analysis.json", { cycle: C, error: `triage failed: ${r.error}` }); say(`triage FAILED: ${r.error}`); return 3; }
    triage = r.result; await upload(`${OUT}/triage.json`, "triage.json");
  }
  say(`cycle ${C}: ${triage.issues.length} distinct issues (triage at ${secs()}s)`);
  const list = triage.issues.map((i: Any) => `${i.id}: ${i.title} (${i.where})`).join("\n");
  const have = new Map<string, Any>((work.rcas ?? []).map((r: Any) => [r.id, r]));
  const rcas = new Map<string, Any>();
  for (const i of triage.issues) if (have.has(i.id)) rcas.set(i.id, { ...i, ...have.get(i.id), id: i.id });
  await pool(triage.issues.filter((i: Any) => !rcas.has(i.id)), work.parallel ?? 12, async (i: Any) => {
    const f = `${OUT}/rca/${i.id}.json`, scratch = `/tmp/scratch-${i.id}`;
    const r = await agent("rca", P.rca(c, i, list, f, scratch), { cwd: c.src, dir: `${OUT}/rca-log/${i.id}`, file: f, need: ["verdict", "category", "why", "root_cause", "evidence", "fix", "confidence"], label: `rca ${i.id}` });
    if (!r.ok) return say(`rca ${i.id} → FAILED (${(r.error ?? "").split("\n")[0]})`);
    if (!P.CATS.includes(r.result.category)) return say(`rca ${i.id} → FAILED (unknown category ${r.result.category})`);
    rcas.set(i.id, { ...i, ...r.result, id: i.id });
    await putJson(`rca/${i.id}.json`, rcas.get(i.id));
    say(`rca ${i.id} → ${r.result.verdict} / ${r.result.category} (${r.secs}s)`);
  });
  const all = triage.issues.map((i: Any) => rcas.get(i.id)).filter(Boolean);
  await putJson("analysis.json", { cycle: C, commit: c.commit, triage, rcas: all, missing: triage.issues.filter((i: Any) => !rcas.has(i.id)).map((i: Any) => i.id), ...group(all, triage.coverage) });
  say(`analysis done at ${secs()}s: ${all.length} of ${triage.issues.length} RCAs`);
  return 0;
}
/** qa-cycle.js's routing, unchanged: fix categories become items, one per root cause; the rest is owner list or logged. */
export function group(rcas: Any[], coverage: string) {
  const fixable = rcas.filter((r) => P.FIX_CATS.includes(r.category) && r.verdict !== "TEST_ARTIFACT");
  const owner = rcas.filter((r) => r.category === "MISSING_NEW_AREA" || r.category === "OWNER_CALL");
  const logged = rcas.filter((r) => !P.FIX_CATS.includes(r.category) && !owner.includes(r) || (P.FIX_CATS.includes(r.category) && r.verdict === "TEST_ARTIFACT"));
  const primary = new Map<string, Any>(), items: Any[] = [];
  for (const r of fixable) {
    const host = (r.same_root_cause_as || []).map((id: string) => primary.get(id)).find(Boolean);
    if (host) { host.ids.push(r.id); host.rca.push(r); primary.set(r.id, host); continue; }
    const it = { slug: `${r.id}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase(), ids: [r.id], rca: [r] };
    items.push(it); primary.set(r.id, it);
  }
  const categories: Record<string, number> = {};
  for (const r of rcas) categories[r.category] = (categories[r.category] || 0) + 1;
  return { items, summary: { cycle: C, coverage, categories,
    owner: owner.map((r) => ({ id: r.id, title: r.title, category: r.category, why: r.why, size: r.size })),
    logged: logged.map((r) => ({ id: r.id, title: r.title, category: r.category, verdict: r.verdict, why: r.why })),
    significant: fixable.filter((r) => ["blocker", "major"].includes(r.severity)).length, fixable: fixable.length } };
}

// ── mode: fix ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function fix() {
  const c = ctx(), mine = (work.items as Any[]).filter((_, i) => i % work.vms === IDX);
  say(`fix: ${mine.length} of ${work.items.length} items are this VM's (${mine.map((i) => i.slug).join(" ")}), ${work.parallel ?? 4} at a time, ${left().toFixed(0)} min of work`);
  await pool(mine, work.parallel ?? 4, async (it: Any) => {
    const t0 = Date.now(), dir = `${OUT}/fix/${it.slug}`, rel = `fix/${it.slug}`, branch = `fix/q${C}-${it.slug}`, wt = `${WT}/${it.slug}`;
    await Deno.mkdir(dir, { recursive: true });
    let test = it.test ?? null, fixr: Any = null, status = "", error: string | undefined;
    const done = async () => {
      watch.delete(it.slug);
      const head = (await git(wt, "rev-parse", "HEAD")).out, commits = Number((await git(wt, "rev-list", "--count", `${BASE_SHA}..HEAD`)).out || 0);
      await putJson(`${rel}/done.json`, { slug: it.slug, ids: it.ids, req: it.req, branch, head, commits, status, test, fix: fixr, error, vm: IDX, secs: Math.round((Date.now() - t0) / 1000) });
      say(`fix ${it.slug} → ${status} (${commits} commits, ${Math.round((Date.now() - t0) / 1000)}s)${error ? ` — ${error.split("\n")[0].slice(0, 160)}` : ""}`);
    };
    try { await worktree(wt, it.resume ?? BASE_SHA, branch); } catch (e) { status = "setup_failed"; error = (e as Error).message; return await putJson(`${rel}/done.json`, { slug: it.slug, ids: it.ids, req: it.req, branch, head: null, commits: 0, status, test, fix: null, error, vm: IDX }); }
    const w = { cwd: wt, branch, rel, last: (await git(wt, "rev-parse", "HEAD")).out, n: 0 };
    watch.set(it.slug, w);
    const tipSaved = async () => { w.last = (await git(wt, "rev-parse", "HEAD")).out; };
    const env = shotsEnv(it.slug);
    if (!test) {
      const r = await agent("test", P.testWriter(c, it, { wt, branch, file: `${dir}/test.json`, v2: V2, mins: Math.min(TMO.test, left() - 1), resumed: !!it.resume }), { cwd: wt, dir, file: `${dir}/test.json`, need: ["status", "req_id", "tests"], label: `test ${it.slug}`, env });
      const wip = await checkpoint(wt, "the test writer", r.ok, `${it.req} (LOOP-007 q${C}, ${it.ids.join(", ")})`);
      if (r.ok) { test = r.result; await upload(`${dir}/test.json`, `${rel}/test.json`); }
      if (await putBundle(wt, branch, `${rel}/test.bundle`)) await tipSaved();
      if (!r.ok) { status = r.notStarted ? "not_started" : r.cutOff || wip ? "cut_off" : "agent_failed"; error = r.error; return await done(); }
      if (test.status !== "red") { status = test.status; return await done(); }
    }
    const r = await agent("fix", P.fixer(c, it, test, { wt, branch, file: `${dir}/fix.json`, v2: V2, mins: Math.min(TMO.fix, left() - 1), checkpoint: !!it.checkpoint }), { cwd: wt, dir, file: `${dir}/fix.json`, need: ["status", "commit", "summary", "green"], label: `fix ${it.slug}`, env });
    const wip = await checkpoint(wt, "the fixer", r.ok, `${test.req_id ?? it.req} (LOOP-007 q${C}, ${it.ids.join(", ")})`);
    if (r.ok) { fixr = r.result; await upload(`${dir}/fix.json`, `${rel}/fix.json`); }
    if (await putBundle(wt, branch, `${rel}/fix.bundle`)) await tipSaved();
    status = r.ok ? r.result.status : r.notStarted ? "test_only" : r.cutOff || wip ? "cut_off" : "agent_failed";
    if (!r.ok) error = r.error;
    await done();
  });
  return 0;
}

// ── the gate ─────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Iso { kind: "deno" | "shots"; cwd?: string; cmd: string; minutes?: number }
interface GateStep { name: string; cmd: string; minutes: number; vm?: number; isolate?: Iso }
export interface Step { name: string; cmd: string; exit: number; ok: boolean; runs: number; secs: number; counts: string[]; failures: string[]; flaky: string[]; new_failures: string[]; isolated: boolean; tail: string; head?: string; vm?: number }
const DEFAULT_GATE: GateStep[] = [{ name: "unit", cmd: "deno task test:unit", minutes: 30 }, { name: "int", cmd: "deno task test:int", minutes: 30 }, { name: "e2e", cmd: "e2e-chunks", minutes: 60 }];
const COUNTS = /^(ok|FAILED) \| .*\d+ (passed|failed)|^Tests?( Suites)?:\s|\d+ pass · \d+ fail|^== e2e total/;
/** A red step's output, small enough to travel: all of it up to 1.5 MB, else its start, the part from the first failure on, and its end. */
export function compact(output: string): string {
  const text = redact(strip(output));
  if (text.length <= 1_500_000) return text;
  const lines = text.split("\n"), take = (from: number, budget: number) => { let n = 0, i = from; for (; i < lines.length && n + lines[i].length < budget; i++) n += lines[i].length + 1; return i; };
  const cut = (n: number) => `\n… ${n} lines cut by the VM driver (the whole output was ${Math.round(text.length / 1e6)} MB) …\n`;
  const headEnd = take(0, 60_000);
  const first = lines.findIndex((l, i) => i >= headEnd && (/^\s*(ERRORS|FAILURES)\s*$/.test(l) || /^shots: ✗ /.test(l) || / => (?:\.\/|file:\/\/)\S+:\d+:\d+$/.test(l) || /^\s+● /.test(l)));
  let tailStart = lines.length, n = 0; while (tailStart > headEnd && n + lines[tailStart - 1].length < 500_000) n += lines[--tailStart].length + 1;
  const midEnd = first < 0 ? headEnd : Math.min(take(first, 800_000), tailStart);
  return lines.slice(0, headEnd).join("\n") + (first > headEnd ? cut(first - headEnd) + lines.slice(first, midEnd).join("\n") : "") + (tailStart > Math.max(midEnd, headEnd) ? cut(tailStart - Math.max(midEnd, headEnd)) : "\n") + lines.slice(Math.max(tailStart, midEnd)).join("\n");
}
const SHOTS_FAIL = /^shots: ✗ (.+?) · [\d.]+s/, DENO_FAIL = /^(.+?) => ((?:\.\/|file:\/\/)\S+?):\d+:\d+$/, JEST_FAIL = /^\s+● (.+?)$/;
export function failuresOf(output: string): string[] {
  const names = new Set<string>();
  for (const l of strip(output).split("\n")) {
    const m = l.match(SHOTS_FAIL) ?? l.match(DENO_FAIL) ?? l.match(JEST_FAIL);
    if (m && !/^Console$/.test(m[1])) names.add(m[1].trim());
  }
  return [...names];
}
/** What the integrator is shown of a red step: each failure's own line, the first failure's details, the last lines. */
function explain(output: string, names: string[], lane = ""): string {
  const lines = redact(strip(output)).split("\n"), nameOf = (l: string) => (l.match(SHOTS_FAIL) ?? l.match(DENO_FAIL) ?? l.match(JEST_FAIL))?.[1]?.trim();
  const byName = new Map<string, string>(); // a failure's line from the lane, replaced by its line from the run alone when there is one
  for (const l of [...(lane ? redact(strip(lane)).split("\n") : []), ...lines]) { const n = nameOf(l); if (n && names.includes(n)) byName.set(n, l.slice(0, 700)); }
  const own = [...byName.values()].slice(0, 40);
  const e = lines.findIndex((l) => /^\s*ERRORS\s*$/.test(l)), f = lines.findIndex((l, i) => i > e && /^\s*FAILURES\s*$/.test(l));
  const errors = e >= 0 ? lines.slice(e, f > e ? f : e + 80).filter((l) => l.trim() && !/^\s+at /.test(l)).join("\n").slice(0, 6000) : "";
  return [...(own.length ? ["--- failing", ...own] : []), ...(errors ? ["--- details", errors] : []), "--- last lines", ...lines.slice(-30).map((l) => l.slice(0, 500))].join("\n");
}
/** The files a deno lane's failures are in (its `NAME => ./file:line:col` lines), and the failures with no such line. */
function denoFiles(output: string, failures: string[]) {
  const files = new Set<string>(), named = new Set<string>();
  for (const l of strip(output).split("\n")) { const m = l.match(DENO_FAIL); if (m) { files.add(m[2].replace(/^file:\/\//, "")); named.add(m[1].trim()); } }
  return { files: [...files], lost: failures.filter((f) => !named.has(f)) };
}
/** The story files that hold these story names (a name no file holds cannot be re-run alone). */
async function storyFiles(wt: string, failures: string[]) {
  const src = new Map<string, string>();
  for (const f of (await git(wt, "ls-files", "--cached", "--others", "--exclude-standard", "--", "e2e")).out.split("\n").filter((f) => /test\.(ts|tsx|mts|js|mjs|jsx)$/.test(f))) src.set(f, await Deno.readTextFile(`${wt}/${f}`).catch(() => ""));
  const files = new Set<string>(), lost: string[] = [];
  for (const n of failures) {
    const esc = JSON.stringify(n).slice(1, -1), hit = [...src].filter(([, s]) => s.includes(n) || s.includes(esc)).map(([f]) => f);
    if (hit.length) hit.forEach((f) => files.add(f)); else lost.push(n);
  }
  return { files: [...files].sort(), lost };
}
let gateRun = 0;
async function runStep(g: GateStep, wt: string, known: string[]): Promise<Step> {
  const t0 = Date.now(), base = `${OUT}/gate-log/${safe(g.name)}-${gateRun}`;
  say(`gate ${g.name}: started — ${g.cmd.slice(0, 100)}`);
  let r = { code: 1, out: "" }, runs = 0;
  const once = async () => {
    runs++;
    const budget = Math.min(g.minutes, left() - 0.5);
    if (budget <= 0) { r = { code: 125, out: `${r.out}\n(no time left before the VM's deadline to run this step)` }; return; }
    r = await sh(g.cmd, { cwd: wt, env: shotsEnv(`gate-${g.name}-${gateRun}-${runs}`), timeoutSec: budget * 60, logFile: `${base}-${runs}.raw.log` });
  };
  await once();
  if (r.code !== 0 && r.code !== 125 && !g.isolate && lastKill < t0) await once(); // no way to run its failures alone: the whole step, once more (not after the memory watchdog)
  const killed = lastKill >= t0; // the memory watchdog fired during this step: what it reported cannot be trusted
  const complete = ![124, 125, 137].includes(r.code) && !killed;
  let failures = failuresOf(r.out), flaky: string[] = [], isolated = false, alone = "";
  if (r.code !== 0 && complete && g.isolate && failures.length) {
    const { files, lost } = g.isolate.kind === "deno" ? denoFiles(r.out, failures) : await storyFiles(wt, failures);
    const budget = Math.min(g.isolate.minutes ?? 12, left() - 0.5);
    if (files.length && budget > 0) {
      const list = files.map(q).join(" "), cmd = g.isolate.cmd.includes("{}") ? g.isolate.cmd.replace("{}", list) : `${g.isolate.cmd} ${list}`;
      say(`gate ${g.name}: ${failures.length} failed in the lane — running ${files.length} file(s) alone`);
      const r2 = await sh(cmd, { cwd: g.isolate.cwd ? `${wt}/${g.isolate.cwd}` : wt, env: shotsEnv(`gate-${g.name}-${gateRun}-alone`), timeoutSec: budget * 60, logFile: `${base}-alone.raw.log` });
      const again = failuresOf(r2.out);
      alone = r2.out;
      if (r2.code === 0 || (again.length && ![124, 137].includes(r2.code))) { // a rerun that died without naming a test clears nothing
        isolated = true;
        const still = [...new Set([...failures.filter((f) => lost.includes(f) || again.includes(f)), ...(r2.code === 0 ? [] : again)])];
        flaky = failures.filter((f) => !still.includes(f)); failures = still;
      }
    }
  }
  const fresh = failures.filter((f) => !known.includes(f));
  const ok = !killed && (r.code === 0 || (complete && (failures.length > 0 || isolated) && fresh.length === 0));
  if (r.code !== 0) { await Deno.writeTextFile(`${base}-${runs}.log`, compact(r.out)); await upload(`${base}-${runs}.log`, `gate-log/${safe(g.name)}-${gateRun}-${runs}.log`); }
  if (alone && failures.length) { await Deno.writeTextFile(`${base}-alone.log`, compact(alone)); await upload(`${base}-alone.log`, `gate-log/${safe(g.name)}-${gateRun}-alone.log`); }
  const s: Step = { name: g.name, cmd: g.cmd, exit: r.code, ok, runs, secs: Math.round((Date.now() - t0) / 1000), counts: strip(r.out).split("\n").filter((l) => COUNTS.test(l)).slice(-6).map((l) => l.slice(0, 200)), failures, flaky, new_failures: fresh, isolated,
    tail: ok ? tail(r.out, 12) : killed ? `${watchdogNote}\n${explain(r.out, failures)}` : isolated && alone ? `${explain(alone, failures, r.out)}\n(run alone, file by file; in the full lane ${flaky.length} more failed and then passed alone)` : explain(r.out, failures) };
  say(`gate ${g.name} → ${ok ? "ok" : "RED"} (exit ${r.code}, ${failures.length} failing, ${fresh.length} new${flaky.length ? `, ${flaky.length} flaky (passed alone)` : ""}, ${runs} run${runs > 1 ? "s" : ""}, ${s.secs}s)`);
  return s;
}
/** Run the gate's steps in `wt`. In gate mode only the steps addressed to this VM, each handed back as it ends. */
async function gate(wt: string, mode: "gate" | "merge"): Promise<{ green: boolean; steps: Step[] }> {
  gateRun++;
  const steps: Step[] = [], known = Object.values(work.gateBaseline ?? {}).flat() as string[], head = (await git(wt, "rev-parse", "HEAD")).out;
  await Deno.mkdir(`${OUT}/gate-log`, { recursive: true });
  for (const g of ((work.gate ?? DEFAULT_GATE) as GateStep[]).filter((g) => mode === "merge" || (g.vm ?? 0) === IDX)) {
    const s = { ...await runStep(g, wt, known), head, vm: IDX };
    steps.push(s);
    if (mode === "gate") await putJson(`gate/step-${safe(g.name)}.json`, s);
  }
  return { green: steps.every((s) => s.ok), steps };
}
async function gateOnly() {
  const wt = `${WT}/gate`;
  await worktree(wt, work.start ?? BASE_SHA);
  await installIn(wt);
  const g = await gate(wt, "gate");
  await putJson("gate/gate.json", { head: (await git(wt, "rev-parse", "HEAD")).out, ref: work.start ?? BASE_SHA, green: g.green, gate: g.steps, vm: IDX, secs: secs() });
  return 0;
}

// ── mode: merge ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function merge() {
  const c = ctx(), wt = `${WT}/merge`, refs = (work.branches ?? []) as { slug: string; ref: string; status: string; summary: string }[];
  await worktree(wt, work.start ?? BASE_SHA, BASE);
  await installIn(wt);
  const unmerged = async () => { const u = []; for (const b of refs) if ((await git(wt, "merge-base", "--is-ancestor", b.ref, "HEAD")).code !== 0) u.push(b); return u; };
  const maxRounds = work.rounds ?? 3, steps = (work.gate ?? DEFAULT_GATE) as GateStep[];
  // red steps the full gate found on other VMs: the first round starts with them
  let round = 0, bundles = 0, bundle = "", saved = "", todo = await unmerged();
  let last: { green: boolean; steps: Step[] } | null = work.red?.length ? { green: false, steps: work.red } : null;
  let chain: Promise<void> = Promise.resolve();
  const save = () => (chain = chain.then(async () => {
    const tip = (await git(wt, "rev-parse", `refs/heads/${BASE}`)).out;
    if (tip === saved || tip === BASE_SHA) return;
    const name = `qa-loop-${++bundles}.bundle`;
    if (await putBundle(wt, BASE, `merge/${name}`)) { bundle = name; saved = tip; }
  }).catch((e) => say(`save: ${(e as Error).message}`)));
  beats.push(save);
  say(`merge: ${refs.length} refs, ${todo.length} not merged yet, start ${(work.start ?? BASE_SHA).slice(0, 40)}${last ? `, ${last.steps.length} red step(s) handed over` : ""}`);
  while (true) {
    if (todo.length || (last && !last.green)) {
      if (round >= maxRounds || left() < 8) break;
      round++;
      const file = `${OUT}/merge/round-${round}.json`;
      const r = await agent("merge", P.integrator(c, { wt, file, mins: Math.min(TMO.merge, left() - 1), refs: todo, total: refs.length, gateCmds: steps, red: (last?.steps ?? []).filter((s) => !s.ok), known: Object.values(work.gateBaseline ?? {}).flat() as string[], baseSha: BASE_SHA }),
        { cwd: wt, dir: `${OUT}/merge`, file, need: ["head", "notes"], label: `merge round ${round}`, env: shotsEnv("merge") });
      if (await git(wt, "rev-parse", "-q", "--verify", "MERGE_HEAD").then((x) => x.code === 0)) { await git(wt, "merge", "--abort"); say(`round ${round}: a merge was left half-done and was aborted`); }
      await checkpoint(wt, "the integrator");
      if (r.ok) await upload(file, `merge/round-${round}.json`);
      say(`merge round ${round} → ${r.ok ? "reported" : r.cutOff ? "cut off" : `failed (${(r.error ?? "").split("\n")[0].slice(0, 120)})`} at ${secs()}s`);
      await save();
      todo = await unmerged();
    }
    last = await gate(wt, "merge");
    await putJson(`merge/gate-${gateRun}.json`, { round, green: last.green, gate: last.steps });
    if ((last.green && !todo.length) || round >= maxRounds) break;
  }
  await checkpoint(wt, "the integrator");
  await save();
  const head = (await git(wt, "rev-parse", `refs/heads/${BASE}`)).out;
  const green = !!last?.green && !todo.length && !(work.red?.length && round === 0);
  await putJson("merge/final.json", { cycle: C, base: BASE, baseSha: BASE_SHA, head, green, rounds: round, not_merged: todo.map((b) => b.ref), gate: last?.steps ?? [], bundle, secs: secs() });
  say(`merge done at ${secs()}s: ${green ? "GREEN (quick lanes)" : "NOT GREEN"} · head ${head.slice(0, 8)} · ${round} round(s) · ${todo.length} not merged`);
  return 0;
}

if (import.meta.main) {
  say(`LOOP-008 ${work.mode} · cycle ${C} · ${HOST} · ${work.minutes} min VM`);
  await setup();
  const timer = setInterval(() => { beat().catch(() => {}); }, BEAT * 1000);
  const dog = setInterval(() => { watchdog().catch(() => {}); }, Number(E("QAVM_WATCH_SECS", "5")) * 1000);
  const rc = await ({ analyze, fix, merge, gate: gateOnly } as Record<string, () => Promise<number>>)[work.mode]?.() ?? (say(`unknown mode ${work.mode}`), 2);
  clearInterval(timer); clearInterval(dog);
  say(`done at ${secs()}s · exit ${rc} · ${used.size} objects uploaded`);
  for (let i = 0; beating && i < 100; i++) await new Promise((r) => setTimeout(r, 100));
  await beat().catch(() => {});
  Deno.exit(rc);
}
