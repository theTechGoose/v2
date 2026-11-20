// shots-lib/cli.ts — REQ-279: the `shots` program (the shim `tools/shots`
// execs this).
//
//   shots run [paths…] [-- <deno test flags>]   the e2e lane: serve (unless
//                                               BASE_URL is given), run the
//                                               stories under e2e/ on WORKERS
//                                               that each claim the next story
//                                               (REQ-386: one per core) with
//                                               #shots mapped in, fold the
//                                               evidence index, exit with the
//                                               tests' rc
//   shots probe                                 0 when a browser boots here,
//                                               3 when not (with the install line)
//   shots run --prod [paths…]                   REQ-318: the USER's run on the REAL
//                                               services — DENO_DEPLOY=true for the
//                                               served app and the stories, a HEADED
//                                               browser, stories one at a time,
//                                               evidence under
//                                               ~/.claude/worktree-ready/<session|user>/evidence-prod;
//                                               refused (exit 2) when a Claude
//                                               session variable is set, stdin is
//                                               not a TTY, or no display can show a
//                                               browser. Never the gate's.
//   shots --help
//
// The evidence dir is $SHOTS_DIR (default
// ~/.claude/worktree-ready/<session>/evidence) and is REFUSED inside the git
// root — evidence never enters the tree (REQ-246 kept). The import map is
// generated per run: the repo's own deno.json imports made absolute (so the
// map can live outside the repo) + `#shots` → the lib beside this program.
// A story file that imports playwright itself is named and refused before
// anything runs — a raw page leaves no evidence.
//
// exit: the tests' rc · 2 refused (evidence inside the tree, no e2e files, a raw
//       playwright import, serve never answered) · 3 no browser (probe).
// Source of truth: claude-tools/claude-home/tools/shots-lib/cli.ts (tested by
// code-workflow/shell/shots.test.ts + shots.e2e.test.ts).
import { storySlug, transcriptText, type StoryRecord } from "./mod.ts";
import { bootBrowser, loadPlaywright } from "./browser.ts";

export { storySlug, transcriptText };

const say = (s: string) => console.error(`shots: ${s}`);

// ── paths ────────────────────────────────────────────────────────────────────
export function insideRoot(dir: string, root: string): boolean {
  const d = dir.replace(/\/+$/, "");
  const r = root.replace(/\/+$/, "");
  return d === r || d.startsWith(r + "/");
}

async function gitRoot(cwd: string): Promise<string> {
  const { code, stdout } = await new Deno.Command("git", { args: ["rev-parse", "--show-toplevel"], cwd, stdout: "piped", stderr: "null" }).output();
  if (code !== 0) throw new Error("not inside a git repository");
  return await Deno.realPath(new TextDecoder().decode(stdout).trim());
}

function libPath(): string {
  return decodeURIComponent(new URL("./mod.ts", import.meta.url).pathname);
}

// ── the import map ───────────────────────────────────────────────────────────
export interface ImportMap {
  imports: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}
function absolutize(v: string, base: string): string {
  if (/^(\.\.?\/|\/)/.test(v)) return new URL(v, base).href;
  return v;
}
/** The repo's imports (relative → file:// absolute, so the map may live
 *  anywhere) plus `#shots` → the installed lib. The lib wins over a repo's own
 *  `#shots`. */
export function buildImportMap(repoRoot: string, denoJson: ImportMap | null | undefined, lib: string): ImportMap {
  const base = `file://${repoRoot.replace(/\/+$/, "")}/`;
  const imports: Record<string, string> = {};
  for (const [k, v] of Object.entries(denoJson?.imports ?? {})) imports[k] = absolutize(v, base);
  imports["#shots"] = `file://${lib}`;
  const out: ImportMap = { imports };
  if (denoJson?.scopes) {
    out.scopes = {};
    for (const [scope, m] of Object.entries(denoJson.scopes)) {
      const sm: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) sm[k] = absolutize(v, base);
      out.scopes[absolutize(scope, base)] = sm;
    }
  }
  return out;
}

async function readDenoJson(root: string): Promise<ImportMap | null> {
  for (const f of ["deno.json", "deno.jsonc"]) {
    try {
      const txt = await Deno.readTextFile(`${root}/${f}`);
      return JSON.parse(stripJsonc(txt)) as ImportMap;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue;
      throw new Error(`${f}: ${(e as Error).message}`);
    }
  }
  return null;
}
function stripJsonc(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1");
}

// ── the raw-playwright scan ──────────────────────────────────────────────────
const RAW = /(from\s+["'](npm:)?playwright["']|import\(\s*["'](npm:)?playwright["']|require\(\s*["']playwright["']|\bchromium\.launch\s*\()/;
async function* walkTs(p: string): AsyncGenerator<string> {
  const st = await Deno.stat(p).catch(() => null);
  if (!st) return;
  if (st.isFile) {
    if (/\.(ts|tsx|mts|js|mjs|jsx)$/.test(p)) yield p;
    return;
  }
  for await (const e of Deno.readDir(p)) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    yield* walkTs(`${p}/${e.name}`);
  }
}
/** Files under `paths` that reach for playwright themselves. */
export async function scanRawPlaywright(paths: string[]): Promise<Array<{ file: string; line: string }>> {
  const out: Array<{ file: string; line: string }> = [];
  for (const p of paths) {
    for await (const f of walkTs(p.replace(/\/+$/, ""))) {
      const txt = await Deno.readTextFile(f);
      for (const line of txt.split("\n")) {
        const m = RAW.exec(line);
        // a comment, or a match that sits inside a template literal opened on
        // this line (a fixture quoting the offending code), is not a story
        // reaching for playwright
        if (m && !/^\s*\/\//.test(line) && !line.slice(0, m.index).includes("`")) {
          out.push({ file: f, line: line.trim() });
          break;
        }
      }
    }
  }
  return out;
}

// ── the index ────────────────────────────────────────────────────────────────
export interface Index {
  v: 1;
  at: string;
  baseUrl: string;
  rc: number;
  /** REQ-318: a `--prod` run (DENO_DEPLOY=true, the user's), and whether the browser was headed */
  prod?: boolean;
  headed?: boolean;
  counts: { pass: number; fail: number; skipped: number; total: number };
  /** every url a story visited (goto) — what "an e2e test drives this page" means */
  pages: string[];
  stories: StoryRecord[];
}
export async function foldIndex(dir: string, meta: { baseUrl: string; rc: number; prod?: boolean; headed?: boolean }): Promise<Index> {
  const stories: StoryRecord[] = [];
  try {
    for await (const e of Deno.readDir(`${dir}/stories`)) {
      if (!e.name.endsWith(".json") || e.name.startsWith(".")) continue;
      try {
        const r = JSON.parse(await Deno.readTextFile(`${dir}/stories/${e.name}`)) as StoryRecord;
        if (r.status === "running") {
          r.status = "fail";
          r.reason = "did not finish — the test threw before the story ended, or the run was cut";
        }
        stories.push(r);
      } catch (err) {
        say(`unreadable story record ${e.name}: ${(err as Error).message}`);
      }
    }
  } catch { /* no stories dir: nothing ran */ }
  stories.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }) || a.name.localeCompare(b.name));
  const counts = { pass: 0, fail: 0, skipped: 0, total: stories.length };
  for (const s of stories) counts[s.status as "pass" | "fail" | "skipped"]++;
  const pages = [...new Set(stories.flatMap((s) => s.steps.filter((st) => st.action === "goto").map((st) => st.url)))].sort();
  const idx: Index = { v: 1, at: new Date().toISOString(), baseUrl: meta.baseUrl, rc: meta.rc, ...(meta.prod ? { prod: true, headed: !!meta.headed } : {}), counts, pages, stories };
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/index.json`, JSON.stringify(idx, null, 2) + "\n");
  await Deno.writeTextFile(`${dir}/index.html`, renderIndexHtml(idx));
  return idx;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export function renderIndexHtml(idx: Index): string {
  const color = { pass: "#2a7", fail: "#c33", skipped: "#a80" } as Record<string, string>;
  const story = (s: StoryRecord) =>
    `<section class="story ${esc(s.status)}">
<h2><span class="badge" style="background:${color[s.status] ?? "#888"}">${esc(s.status)}</span> ${esc(s.name)}</h2>
<p class="meta">${esc(s.file)} · ${s.assertions} assertion${s.assertions === 1 ? "" : "s"} · ${s.steps.length} step${s.steps.length === 1 ? "" : "s"}${s.reason ? ` · <b>${esc(s.reason)}</b>` : ""}</p>
<div class="steps">${
      s.steps.map((st) =>
        st.png
          ? `<figure><a href="${esc(st.png)}"><img loading="lazy" src="${esc(st.png)}" alt="${esc(st.stamp)}"></a><figcaption>#${st.n} ${esc(st.action)} <code>${esc(st.target)}</code><br><small>${esc(st.url)}</small></figcaption></figure>`
          : `<figure class="txt"><a href="${esc(st.transcript)}">#${st.n} ${esc(st.target)}</a><figcaption><small>${esc(st.url)}</small></figcaption></figure>`
      ).join("\n")
    }</div>
</section>`;
  return `<!doctype html><meta charset="utf-8"><title>shots — ${esc(idx.counts.pass)}/${esc(idx.counts.total)} pass</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:0;padding:16px 24px;background:#fafafa;color:#222}
h1{font-size:18px;margin:0 0 4px}.sum{color:#555;margin:0 0 20px}
.story{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px 16px;margin:0 0 16px}
.story h2{font-size:15px;margin:0 0 2px}.badge{color:#fff;border-radius:4px;padding:1px 6px;font-size:12px;text-transform:uppercase}
.meta{color:#666;margin:0 0 10px;font-size:12px}
.steps{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0;width:280px}figure img{width:280px;border:1px solid #ccc;border-radius:4px;background:#eee}
figcaption{font-size:12px;color:#444;margin-top:4px}figure.txt{width:auto;padding:6px 10px;border:1px dashed #bbb;border-radius:4px}
</style>
<h1>shots — ${idx.counts.pass} pass · ${idx.counts.fail} fail · ${idx.counts.skipped} skipped</h1>
<p class="sum">${esc(idx.baseUrl)} · ${esc(idx.at)} · rc ${idx.rc} · pages: ${idx.pages.map((p) => `<code>${esc(p)}</code>`).join(" ") || "none"}</p>
${idx.stories.map(story).join("\n") || "<p>no stories ran</p>"}
`;
}

// ── the workers (REQ-383) ─────────────────────────────────────────────────────
// `deno test --parallel` runs test MODULES in parallel and never the tests
// inside one, so a file of 142 stories ran them one after another on one
// worker (code-map, 14m20s for 167 stories). Now `jobs` WORKERS each load the
// whole lane and every story is CLAIMED by the first worker to reach it — one
// atomic file create under $SHOTS_DIR/.claims (the lib, `claim()`) — so the
// balance is dynamic: a worker that drew a long story is simply passed by the
// others. No plan, no history, no filter to escape: a 40 s story and forty 1 s
// ones end together. The files are type-checked ONCE before; the workers run
// --no-check. A worker's test that another worker claimed returns at once and
// is not in the evidence; the index folds what ran, exactly once each.
export const GIB = 2 ** 30;
/** The bytes this process may use: inside a container the cgroup's limit (v2
 *  memory.max, else v1 memory.limit_in_bytes — a session box has 12 GiB, a
 *  `claude --run` box 4 GiB, while the kernel reports the whole VM), else the
 *  machine's memory. */
export async function memoryBudget(): Promise<number> {
  for (const p of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const v = (await Deno.readTextFile(p)).trim();
      const n = Number(v);
      if (v && v !== "max" && Number.isFinite(n) && n > 0 && n < 2 ** 60) return n;
    } catch { /* not a container, or not this cgroup version */ }
  }
  try {
    return Deno.systemMemoryInfo().total;
  } catch {
    return 8 * GIB;
  }
}
/** How many workers: SHOTS_JOBS, else DENO_JOBS, else the cores (REQ-386:
 *  twice the cores, each launching a chromium per story beside the unit and int
 *  lanes, put the Mac under massive load; a worker now keeps one browser) —
 *  capped at one worker per GiB of `mem` (a deno test process and a headless
 *  chromium together), never below two: a 12 GiB box ran 32 workers beside
 *  its unit lane on 2026-10-20 and the kernel killed the whole box (OOM, 137). */
export function jobsOf(env: Record<string, string | undefined>, cores: number, mem = Infinity): number {
  for (const k of ["SHOTS_JOBS", "DENO_JOBS"]) {
    const v = Number(env[k]);
    if (Number.isInteger(v) && v > 0) return v;
  }
  return Math.max(2, Math.min(cores || 1, Math.floor(mem / GIB)));
}
/** The story files under `targets`, as `--plan` lists them (tracked + untracked, never ignored). */
async function storyFiles(root: string, targets: string[]): Promise<string[]> {
  const ls = await new Deno.Command("git", { args: ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...targets], cwd: root, stdout: "piped", stderr: "null" }).output();
  return new TextDecoder().decode(ls.stdout).split("\n").filter((f) => /(^|\/)([^/]*[_.])?test\.(ts|tsx|mts|js|mjs|jsx)$/.test(f)).sort();
}
/** The tests of a file, in order, each with whether it is a STORY — its body
 *  reaches for `story(` or `http(` of `#shots` — or a plain test: a name that
 *  is a string literal (", ', or a template with no `${}`) or the
 *  `{ name: "…" }` form; null when a name is not a literal or there is no
 *  Deno.test( at all. Comments and strings are walked, so a `Deno.test(`
 *  inside either is not a test. A plain test knows nothing of claims, so it
 *  would run in EVERY worker (this repo's runner tests, twelve times, 2026-10-20):
 *  worker 1 runs the whole file and the others take a filter of the stories. */
export function listTests(src: string): Array<{ name: string; story: boolean }> | null {
  const out: Array<{ name: string; story: boolean }> = [];
  const shots = /from\s+["']#shots["']/.test(src);
  let i = 0, found = false;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); if (e < 0) break; i = e + 2; continue; }
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); if (i < 0) break; continue; }
    if (src.startsWith("Deno.test(", i) && !/[\w$.]/.test(src[i - 1] ?? "")) {
      found = true;
      let j = i + "Deno.test(".length;
      while (j < n && /\s/.test(src[j])) j++;
      if (src[j] === "{") {
        const m = /^\{\s*name\s*:\s*/.exec(src.slice(j));
        if (!m) return null;
        j += m[0].length;
      }
      const lit = readLiteral(src, j);
      if (!lit) return null;
      let k = lit.end;
      while (k < n && /\s/.test(src[k])) k++;
      if (src[k] !== ",") return null;   // "a" + b, a template with a hole, a call: not a literal name
      // the body: up to the next Deno.test( or the end — a story calls story( or http( of #shots in it
      const next = src.indexOf("Deno.test(", k);
      const body = src.slice(k, next < 0 ? n : next);
      out.push({ name: lit.value, story: shots && /\b(?:story|http)\s*\(/.test(body) });
      i = k;
      continue;
    }
    i++;
  }
  return found ? out : null;
}
/** The index just past the string that opens at `i`, or -1 when it never closes. */
function skipString(src: string, i: number): number {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") { j++; continue; }
    if (src[j] === q) return j + 1;
    if (q !== "`" && src[j] === "\n") return j + 1;   // an unterminated line string: move on
  }
  return -1;
}
/** A string literal at `i`: its unescaped value and the index past it; null
 *  when there is none, or it is a template with a hole. */
function readLiteral(src: string, i: number): { value: string; end: number } | null {
  const q = src[i];
  if (q !== '"' && q !== "'" && q !== "`") return null;
  let v = "";
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") {
      const e = src[j + 1];
      v += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e === "0" ? "\0" : e ?? "";
      j++;
      continue;
    }
    if (q === "`" && c === "$" && src[j + 1] === "{") return null;
    if (c === q) return { value: v, end: j + 1 };
    if (q !== "`" && c === "\n") return null;
    v += c;
  }
  return null;
}
/** Whether a story file asks for its stories IN ORDER: a line `// shots: in
 *  order` at its top. Its stories then run on worker 1 alone, in the file's
 *  order (the other workers' filter leaves them out), while every other file
 *  still spreads — for stories that share one served state (a fake registry
 *  launched into and closed, a bell played and paused: this repo's meta and
 *  bell stories, RED at once the moment they ran side by side, 2026-10-20). */
export function inOrder(src: string): boolean {
  return /^\s*\/\/\s*shots:\s*in\s+order\b/m.test(src);
}
/** A story's key in the duration history: its file and its name. */
export const storyKey = (file: string, name: string) => `${file}::${name}`;
/** The seconds every story took, from a run's index, over the ones it had: a
 *  story that did not run keeps its last seconds. */
export function mergeDurations(prev: Record<string, number>, idx: { stories: Array<{ file: string; name: string; startedAt?: string; endedAt?: string }> }): Record<string, number> {
  const next = { ...prev };
  for (const s of idx.stories) {
    if (!s.startedAt || !s.endedAt) continue;
    const secs = (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000;
    if (Number.isFinite(secs) && secs > 0) next[storyKey(s.file, s.name)] = Math.round(secs * 10) / 10;
  }
  return next;
}
/** The names of the `n` longest stories known — the first pass's, so the 40 s
 *  story is claimed first and never ends the lane alone. */
export function longestFirst(durations: Record<string, number>, n: number): string[] {
  return Object.entries(durations).filter(([, v]) => Number.isFinite(v) && v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k]) => k.slice(k.indexOf("::") + 2));
}
const RE_META = /[\\^$.|?*+()[\]{}\/-]/g;
/** `deno test --filter` takes `/regex/`: an anchored alternation of the names,
 *  every metacharacter escaped (proven on names holding ( ) $ . / | [ ] { } ^ + \). */
export function filterFor(names: string[]): string {
  return `/^(?:${names.map((s) => s.replace(RE_META, (c) => "\\" + c)).join("|")})$/`;
}
async function repoKey(root: string): Promise<string> {
  const r = await new Deno.Command("git", { args: ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd: root, stdout: "piped", stderr: "null" }).output();
  return (new TextDecoder().decode(r.stdout).trim() || root).replace(/[^A-Za-z0-9]/g, "-");
}
/** Where the per-repo story seconds live: SHOTS_HISTORY_DIR, else
 *  ~/.claude/shots/durations — shared by every worktree of the repo (the key is
 *  the git common dir), outside every tree. */
const historyDir = () => (Deno.env.get("SHOTS_HISTORY_DIR") || `${Deno.env.get("HOME") ?? ""}/.claude/shots/durations`).replace(/\/+$/, "");
async function readDurations(root: string): Promise<Record<string, number>> {
  try {
    const v = JSON.parse(await Deno.readTextFile(`${historyDir()}/${await repoKey(root)}.json`));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
async function writeDurations(root: string, d: Record<string, number>): Promise<void> {
  try {
    await Deno.mkdir(historyDir(), { recursive: true });
    await Deno.writeTextFile(`${historyDir()}/${await repoKey(root)}.json`, JSON.stringify(d, null, 1) + "\n");
  } catch (e) {
    say(`the story seconds could not be kept (${(e as Error).message}) — the next run has no first pass`);
  }
}
const DOT_LINE = /^\s*(?:\x1b\[[0-9;]*m)*\.(?:\x1b\[[0-9;]*m)*\s*$/;
interface Pass {
  label: string;
  /** the block header's prefix: "" for one pass, "pass 1 · " / "pass 2 · " for two */
  prefix: string;
  args: string[];
  /** the args of every worker but the first (a filter of the stories alone), when they differ */
  others?: string[];
}
/** `jobs` workers at once, each running the passes one after another ON ITS
 *  OWN — no barrier between the passes, so a worker done with its long stories
 *  moves on to the short ones while a slower one is still on a long story —
 *  each told its id (SHOTS_WORKER/<pass>, what its claims carry). When every
 *  worker has ended, each worker's block per pass is printed — the stories it
 *  claimed (counted from the claim files), its rc and seconds, its output
 *  without the dot reporter's dots — so thirty-two interleaved runners stay
 *  readable. rc 1 when any worker is red. */
async function runWorkers(passes: Pass[], jobs: number, root: string, env: Record<string, string>, claims: string): Promise<number> {
  const dec = new TextDecoder();
  const done = await Promise.all(Array.from({ length: jobs }, async (_, i) => {
    const out: Array<{ pass: Pass; id: string; code: number; secs: number; out: string }> = [];
    for (const pass of passes) {
      const id = `${pass.label}/${i + 1}`, t0 = Date.now();
      const p = await new Deno.Command("deno", { args: i === 0 || !pass.others ? pass.args : pass.others, cwd: root, env: { ...env, SHOTS_WORKER: id }, stdout: "piped", stderr: "piped" }).output();
      out.push({ pass, id, code: p.code, secs: Math.round((Date.now() - t0) / 1000), out: (dec.decode(p.stdout) + dec.decode(p.stderr)).split("\n").filter((l) => !DOT_LINE.test(l)).join("\n").trim() });
    }
    return { i, out };
  }));
  const mine = new Map<string, number>();
  for await (const e of Deno.readDir(claims)) {
    const who = (await Deno.readTextFile(`${claims}/${e.name}`).catch(() => "")).trim();
    mine.set(who, (mine.get(who) ?? 0) + 1);
  }
  let rc = 0;
  for (const pass of passes) {
    for (const w of done) {
      const r = w.out.find((x) => x.pass === pass)!;
      const ran = mine.get(r.id) ?? 0;
      say(`── ${pass.prefix}worker ${w.i + 1}/${jobs} · ran ${ran} stor${ran === 1 ? "y" : "ies"} · rc ${r.code} in ${r.secs}s ──`);
      if (r.out) console.error(r.out);
      if (r.code !== 0) rc = 1;
    }
  }
  return rc;
}

// ── serve ────────────────────────────────────────────────────────────────────
export function freePort(): number {
  const l = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const p = (l.addr as Deno.NetAddr).port;
  l.close();
  return p;
}
async function waitReady(base: string, ms: number, alive: () => boolean = () => true): Promise<boolean> {
  const t0 = Date.now();
  const u = new URL(base);
  while (Date.now() - t0 < ms) {
    if (!alive()) return false;
    try {
      const c = await Deno.connect({ hostname: u.hostname, port: Number(u.port) });
      c.close();
      const r = await fetch(base + "/", { signal: AbortSignal.timeout(3000) }).catch(() => null);
      if (r) {
        await r.body?.cancel();
        if (r.status < 500) return true;
      }
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

interface Served {
  base: string;
  stop: () => Promise<void>;
}
async function startServe(root: string, runner: string[], prod = false): Promise<Served> {
  const port = freePort();
  const base = `http://127.0.0.1:${port}`;
  // WT_GATE=1: the same role as the gate's server — a repo's serve skips its
  // daemon-only boot work under it. A --prod serve is the REAL thing (REQ-318):
  // DENO_DEPLOY=true and no gate marker.
  const env: Record<string, string> = { ...Deno.env.toObject(), PORT: String(port), BASE_URL: base };
  if (prod) env.DENO_DEPLOY = "true";
  else env.WT_GATE = "1";
  const child = new Deno.Command(runner[0], {
    args: [...runner.slice(1), "serve"],
    cwd: root,
    env,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  let gone = false;
  child.status.then(() => (gone = true));
  say(`serve: ${runner.join(" ")} serve on ${base} (pid ${child.pid})`);
  const stop = async () => {
    if (gone) return;
    try {
      child.kill("SIGTERM");
    } catch { /* gone */ }
    const dead = await Promise.race([child.status.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 5000))]);
    if (!dead) {
      try {
        child.kill("SIGKILL");
      } catch { /* gone */ }
      await child.status;
    }
    say(`serve: stopped (pid ${child.pid})`);
  };
  const ok = await waitReady(base, Number(Deno.env.get("SHOTS_SERVE_TIMEOUT") || 60000), () => !gone);
  if (!ok) {
    await stop();
    throw new Error(`serve never answered on ${base} within the timeout (or exited) — \`${runner.join(" ")} serve\` must listen on $PORT`);
  }
  return { base, stop };
}

/** How this repo's tasks are run: deno task / npm run / make. */
async function taskRunner(root: string): Promise<string[]> {
  for (const f of ["deno.json", "deno.jsonc"]) if (await exists(`${root}/${f}`)) return ["deno", "task"];
  if (await exists(`${root}/package.json`)) return ["npm", "run", "--silent"];
  if (await exists(`${root}/Makefile`)) return ["make"];
  return ["deno", "task"];
}
const exists = (p: string) => Deno.stat(p).then(() => true).catch(() => false);

// ── run ──────────────────────────────────────────────────────────────────────
function defaultShotsDir(): string {
  const home = Deno.env.get("HOME") ?? "";
  const sid = Deno.env.get("CLAUDE_CODE_SESSION_ID") || Deno.env.get("CLAUDE_SESSION_ID") || "nosession";
  return `${home}/.claude/worktree-ready/${sid}/evidence`;
}
/** REQ-318: the user's prod evidence — beside the session's lane evidence, or
 *  under `user` when a person typed it in their own terminal (no session). */
export function prodEvidenceDir(home: string, env: Record<string, string | undefined>): string {
  const sid = env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || "user";
  return `${home}/.claude/worktree-ready/${sid}/evidence-prod`;
}
const SESSION_VARS = ["CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "CLAUDE_BOOT_WINDOW_ID"];
/** REQ-318: why `--prod` must not run here — a Claude session, no TTY, no
 *  display — or null when a person at a terminal typed it. The test seam
 *  SHOTS_PROD_UNATTENDED=1 lifts the TTY/display checks only, never the
 *  session check. */
export function prodRefusal(env: Record<string, string | undefined>, isTTY: boolean, os: string): string | null {
  for (const v of SESSION_VARS) {
    if (env[v]) return `${v} is set — this is a Claude session, and test:e2e:prod is the user's command: a person types it in their own terminal, never an agent`;
  }
  if (env.SHOTS_PROD_UNATTENDED === "1") return null;
  if (!isTTY) return "stdin is not a TTY — test:e2e:prod is the user's command, typed at a terminal (a headed browser needs someone watching)";
  if (os === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return "no display (DISPLAY / WAYLAND_DISPLAY unset) — a headed browser cannot open here; test:e2e:prod runs on the user's Mac";
  return null;
}

async function run(argvIn: string[]): Promise<number> {
  // REQ-316: `--plan` (anywhere, even after `--`, where a gate appends it) lists
  // the story files the run would take, one per line, and runs nothing
  const plan = argvIn.includes("--plan");
  const prodMode = argvIn.includes("--prod");
  const argv = argvIn.filter((a) => a !== "--plan" && a !== "--prod");
  const dd = argv.indexOf("--");
  const paths = (dd >= 0 ? argv.slice(0, dd) : argv).filter((a) => a !== "");
  const extra = dd >= 0 ? argv.slice(dd + 1) : [];
  const root = await gitRoot(Deno.cwd());
  if (plan) {
    const targets = paths.length ? paths : ["e2e/"];
    const ls = await new Deno.Command("git", { args: ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...targets], cwd: root, stdout: "piped", stderr: "null" }).output();
    const files = new TextDecoder().decode(ls.stdout).split("\n").filter((f) => /(^|\/)([^/]*[_.])?test\.(ts|tsx|mts|js|mjs|jsx)$/.test(f)).sort();
    for (const f of files) console.log(f);
    return 0;
  }
  // REQ-318: --prod is the user's run — refused to an agent, before anything starts
  let headed = false;
  if (prodMode) {
    const why = prodRefusal(Deno.env.toObject(), Deno.stdin.isTerminal(), Deno.build.os);
    if (why) {
      say(`REFUSED — ${why}`);
      return 2;
    }
    headed = Deno.env.get("SHOTS_PROD_UNATTENDED") !== "1";
  }
  const dir = (Deno.env.get("SHOTS_DIR") || (prodMode ? prodEvidenceDir(Deno.env.get("HOME") ?? "", Deno.env.toObject()) : defaultShotsDir())).replace(/\/+$/, "");
  if (insideRoot(await Deno.realPath(dir).catch(() => dir), root)) {
    say(`REFUSED — SHOTS_DIR ${dir} is inside the worktree ${root}; evidence never enters the tree (default: ~/.claude/worktree-ready/<session>/evidence)`);
    return 2;
  }
  const targets = paths.length ? paths : ["e2e/"];
  const present: string[] = [];
  for (const t of targets) if (await exists(`${root}/${t}`) || await exists(t)) present.push(t);
  if (!present.length) {
    say(`REFUSED — nothing to run: ${targets.join(" ")} not found under ${root}. Durable stories live in e2e/<name>/<name>.e2e.test.ts (rune layout).`);
    return 2;
  }
  const raw = await scanRawPlaywright(present.map((p) => (p.startsWith("/") ? p : `${root}/${p}`)));
  if (raw.length) {
    say("REFUSED — a story reaches for playwright itself; use `story(t)` from #shots so every action leaves a frame:");
    for (const r of raw) say(`  ${r.file.replace(root + "/", "")}: ${r.line}`);
    return 2;
  }
  // a fresh evidence dir per run: old frames must not be read as this run's
  await Deno.remove(dir, { recursive: true }).catch(() => {});
  await Deno.mkdir(`${dir}/stories`, { recursive: true });
  const map = buildImportMap(root, await readDenoJson(root), libPath());
  const mapPath = `${dir}/.import-map.json`;
  await Deno.writeTextFile(mapPath, JSON.stringify(map, null, 2) + "\n");

  let served: Served | null = null;
  let base = Deno.env.get("BASE_URL")?.replace(/\/+$/, "") ?? "";
  const runner = await taskRunner(root);
  if (!base) {
    try {
      served = await startServe(root, runner, prodMode);
    } catch (e) {
      say(`REFUSED — ${(e as Error).message}`);
      return 2;
    }
    base = served.base;
  } else {
    say(`BASE_URL given (${base}) — not starting serve`);
  }
  let rc = 1;
  try {
    const t0 = Date.now();
    const storyEnv: Record<string, string> = { ...Deno.env.toObject(), SHOTS_DIR: dir, BASE_URL: base };
    if (prodMode) {
      storyEnv.DENO_DEPLOY = "true";
      if (headed) storyEnv.SHOTS_HEADED = "1";
    }
    // REQ-383: `jobs` workers claiming the stories — or, --prod, ONE worker
    // (one story at a time, the user watching the headed browser)
    const mem = await memoryBudget();
    const jobs = prodMode ? 1 : jobsOf(Deno.env.toObject(), navigator.hardwareConcurrency, mem);
    const files = await storyFiles(root, present);
    const claims = `${dir}/.claims`;
    await Deno.mkdir(claims, { recursive: true });
    storyEnv.SHOTS_CLAIM_DIR = claims;
    if (prodMode) say(`PROD — DENO_DEPLOY=true for serve and stories, ${headed ? "HEADED browser" : "headless (SHOTS_PROD_UNATTENDED=1)"}, evidence → ${dir}`);
    // checked once, up front: a type error is RED before a worker starts, and
    // no worker pays the check again
    const chk = files.length ? await new Deno.Command("deno", { args: ["check", "--import-map", mapPath, ...files], cwd: root, env: storyEnv, stdout: "piped", stderr: "piped" }).output() : null;
    if (chk && chk.code !== 0) {
      say("deno check failed — nothing ran:");
      console.error((new TextDecoder().decode(chk.stdout) + new TextDecoder().decode(chk.stderr)).trimEnd());
      rc = 1;
    } else {
      const base_ = ["test", "-A", "--no-check", "--reporter=dot", "--import-map", mapPath, ...present];
      // the first pass: the longest stories known from the last runs, so one of
      // them is never the story claimed last; the caller's own --filter, or
      // --prod, is one pass as given
      const ownFilter = extra.some((a) => a === "--filter" || a.startsWith("--filter="));
      const long = prodMode || ownFilter ? [] : longestFirst(await readDurations(root), jobs);
      // the stories by name, from the files: every worker but the first runs
      // those alone, so a plain test — no claim — runs once, in worker 1
      let plain = 0, ordered = 0;
      const storyNames: string[] = [], orderedNames = new Set<string>();
      for (const f of files) {
        const src = await Deno.readTextFile(`${root}/${f}`);
        const tests = listTests(src);
        if (!tests) continue;   // unreadable: its tests are worker 1's alone unless they claim
        const serial = inOrder(src);
        for (const t of tests) {
          if (!t.story) plain++;
          else if (serial) { ordered++; orderedNames.add(t.name); }   // worker 1's, in the file's order
          else storyNames.push(t.name);
        }
      }
      const storiesOnly = storyNames.length && !ownFilter ? ["--filter", filterFor(storyNames)] : null;
      const longSpread = long.filter((n) => !orderedNames.has(n));
      say(`${files.length} story file(s) → ${jobs} worker(s), each claiming the next story (${navigator.hardwareConcurrency} cores, ${(mem / GIB).toFixed(1)} GiB: one worker per GiB, at most one per core${chk ? `; deno check ok in ${Math.round((Date.now() - t0) / 1000)}s` : ""}); deno ${base_.join(" ")} ${extra.join(" ")}  (SHOTS_DIR=${dir})`);
      const whole: Pass = { label: longSpread.length ? "2" : "1", prefix: longSpread.length ? "pass 2 · " : "", args: [...base_, ...extra], ...(storiesOnly || ordered ? { others: [...base_, ...(storiesOnly ?? ["--filter", (storyNames.length ? filterFor(storyNames) : "/^(?!)/")]), ...extra] } : {}) };
      const passes: Pass[] = longSpread.length ? [{ label: "1", prefix: "pass 1 · ", args: [...base_, "--filter", filterFor(longSpread), ...extra] }, whole] : [whole];
      if (plain || ordered) say(`${plain} plain test(s) and ${ordered} stor${ordered === 1 ? "y" : "ies"} in order beside ${storyNames.length} stories: worker 1 runs those once, in order, the other workers take the spread stories alone`);
      if (longSpread.length) say(`pass 1 (the ${longSpread.length} longest, from the last runs' seconds) then pass 2 (the rest), each worker on its own`);
      rc = await runWorkers(passes, jobs, root, storyEnv, claims);
    }
    say(`tests finished rc ${rc} in ${Math.round((Date.now() - t0) / 1000)}s`);
  } finally {
    await served?.stop();
  }
  const idx = await foldIndex(dir, { baseUrl: base, rc, prod: prodMode, headed });
  for (const st of idx.stories) {   // one line per story, as it ran (REQ-383: the workers' blocks carry only counts)
    const secs = st.startedAt && st.endedAt ? ` · ${Math.round((Date.parse(st.endedAt) - Date.parse(st.startedAt)) / 100) / 10}s` : "";
    say(`${st.status === "pass" ? "✓" : st.status === "fail" ? "✗" : "–"} ${st.name}${secs}${st.reason ? ` · ${st.reason}` : ""}`);
  }
  if (!prodMode) await writeDurations(root, mergeDurations(await readDurations(root), idx));   // REQ-383: this run's seconds choose the next first pass
  say(`evidence: ${dir}/index.html — ${idx.counts.pass} pass · ${idx.counts.fail} fail · ${idx.counts.skipped} skipped (${idx.pages.length} page${idx.pages.length === 1 ? "" : "s"})`);
  if (rc === 0 && idx.counts.fail > 0) rc = 1; // a story recorded as failed but the runner said 0 — never green
  return rc;
}

async function probe(): Promise<number> {
  try {
    const { pw, from } = await loadPlaywright();
    const b = await bootBrowser(pw, pw.chromium.launch);
    await b.close();
    say(`browser OK (${from})`);
    return 0;
  } catch (e) {
    say((e as Error).message);
    return 3;
  }
}

const HELP = `shots — the e2e lane's runner (REQ-279)

  shots run [paths…] [-- <deno test flags>]   run the stories under e2e/ (or paths)
                                               on workers that each claim the next
                                               story (REQ-383: SHOTS_JOBS, else
                                               DENO_JOBS, else the cores; one
                                               browser per worker, a context per
                                               story, REQ-386)
                                               with #shots mapped in;
                                               starts \`serve\` on a free port unless
                                               BASE_URL is set; leaves one stamped
                                               screenshot per action + index.html
                                               under $SHOTS_DIR; exits with the tests' rc
  shots run --prod [paths…]                    REQ-318: the USER's run on the REAL services —
                                               DENO_DEPLOY=true for the served app and the
                                               stories, a HEADED browser, stories one at a
                                               time, evidence under
                                               ~/.claude/worktree-ready/<session|user>/evidence-prod.
                                               Refused (exit 2) in a Claude session, without a
                                               TTY, or without a display. Never part of the gate.
  shots probe                                  0 when a browser boots here, 3 when not
  shots --help

env: SHOTS_DIR (default ~/.claude/worktree-ready/<session>/evidence — never inside
     the repo) · BASE_URL (given by the gate; else serve is started) ·
     SHOTS_JOBS (workers; default the cores, one per GiB of the cgroup's
     or the machine's memory) · SHOTS_HISTORY_DIR (the
     stories' seconds per repo, for the first pass; default
     ~/.claude/shots/durations) · SHOTS_PLAYWRIGHT (a playwright module path) ·
     SHOTS_SERVE_TIMEOUT (ms, 60000)
`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "run":
      return await run(rest);
    case "probe":
      return await probe();
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      return cmd ? 0 : 2;
    default:
      say(`unknown command ${cmd}`);
      console.error(HELP);
      return 2;
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
