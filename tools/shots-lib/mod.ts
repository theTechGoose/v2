// #shots — REQ-279: the page a durable e2e story drives, and the evidence it
// leaves behind for the reviewer.
//
//   import { story } from "#shots";
//   Deno.test("REQ-123: a user signs in", (t) =>
//     story(t, async ({ page, expect, http, skip }) => {
//       await page.goto("/login");            // → <story>/001-goto.png
//       await page.fill("#email", "a@b.c");   // → 002-fill.png
//       await page.click("#go");              // → 003-click.png
//       await expect.see("welcome");          // an assertion (counted)
//     }));
//
// One story = one Deno.test = one user story; its name ("REQ-NNN: …") names
// the folder under $SHOTS_DIR. Every goto / click / fill / press / selectOption
// / check / uncheck / dblclick / type on the page takes ONE screenshot AFTER
// the action, stamped (story · step · action · target · url) so a frame is
// never anonymous — and so does every action on a Locator the page handed out
// (`page.locator(…)`, `getByRole/Text/Label/TestId/Placeholder/Title/AltText`,
// `frameLocator`, through any `first/last/nth/filter/and/or/getBy*` chain):
// click / dblclick / fill / press / selectOption / check / uncheck / type /
// setInputFiles / hover / tap / clear, the target being the locator's own
// string form. The usual Playwright idioms all leave frames. `http(path, init)` is a fetch against BASE_URL that writes one
// request/response transcript per call (a backend's evidence). A story that
// ends with ZERO assertions fails — looking is not testing. `skip(reason)`
// records a skipped story with its reason instead of pretending.
//
// The runner (`shots run`) supplies BASE_URL and SHOTS_DIR; a test never
// starts a server and never writes under the worktree. The browser is the one
// `browser.ts` finds; `chromium.launch` on that module is guarded — a launch
// this lib did not make throws, because a raw page leaves no evidence.
//
// Source of truth: claude-tools/claude-home/tools/shots-lib/mod.ts (tested by
// code-workflow/shell/shots.test.ts + shots.e2e.test.ts).
import { bootBrowser, loadPlaywright, type PW } from "./browser.ts";

// REQ-345: under the gate a frame never waits on a web font. A story that
// pulled a remote font blew its 90 s screenshot budget ("waiting for fonts to
// load…", v2 meta-pixel-tracking, 2026-10-15) — a flake the change did not
// cause. With WT_GATE=1 (or SHOTS_BLOCK_FONTS=1) requests to these hosts are
// aborted; a font the app serves itself still loads. Host-exact, subdomains
// included; anything that is not a URL is not a font host.
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "use.typekit.net", "p.typekit.net", "fonts.bunny.net"];
export function isFontHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return FONT_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

export type Action =
  | "goto"
  | "click"
  | "fill"
  | "press"
  | "selectOption"
  | "check"
  | "uncheck"
  | "dblclick"
  | "type"
  | "setInputFiles"
  | "hover"
  | "tap"
  | "clear"
  | "http";

export interface Step {
  n: number;
  action: Action;
  target: string;
  url: string;
  png?: string;
  transcript?: string;
  stamp: string;
  at: string;
}
export interface Transcript {
  n: number;
  method: string;
  path: string;
  status: number;
  file: string;
}
export interface StoryRecord {
  v: 1;
  id: string;
  name: string;
  file: string;
  status: "running" | "pass" | "fail" | "skipped";
  reason?: string;
  assertions: number;
  steps: Step[];
  transcripts: Transcript[];
  /** REQ-352: `<slug>/net.jsonl` once the page made a request — one line per
   *  request: {step, method, url, status, at} */
  net?: string;
  startedAt: string;
  endedAt?: string;
}

const ACTIONS: Action[] = ["goto", "click", "fill", "press", "selectOption", "check", "uncheck", "dblclick", "type"];

// ── naming ───────────────────────────────────────────────────────────────────
/** "REQ-275: play starts the bed — the page says playing" →
 *  "REQ-275-play-starts-the-bed-the-page-says-playing". Bounded, no edge dash. */
export function storySlug(name: string): string {
  const s = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length <= 80) return s;
  return s.slice(0, 80).replace(/-+$/g, "").replace(/-[^-]*$/, (m) => (m.length > 20 ? "" : m)).replace(/-+$/g, "");
}
function storyId(name: string): string {
  const m = name.match(/^([A-Za-z]+-\d+)/);
  return m ? m[1] : storySlug(name).slice(0, 40);
}
const pad3 = (n: number) => String(n).padStart(3, "0");
const pathSlug = (p: string) => p.replace(/^\//, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";

// ── environment ──────────────────────────────────────────────────────────────
function shotsDir(): string {
  const d = Deno.env.get("SHOTS_DIR");
  if (!d) {
    throw new Error("shots: SHOTS_DIR is not set — run stories through `shots run` (or `deno task test:e2e`), not bare `deno test`");
  }
  return d.replace(/\/+$/, "");
}
export function baseUrl(): string {
  const b = Deno.env.get("BASE_URL");
  if (!b) throw new Error("shots: BASE_URL is not set — the runner starts `serve` and hands the url in; a story never starts a server");
  return b.replace(/\/+$/, "");
}
function resolveUrl(u: string): string {
  if (/^[a-z]+:/i.test(u)) return u;
  return baseUrl() + (u.startsWith("/") ? u : "/" + u);
}

// ── the record ───────────────────────────────────────────────────────────────
/** REQ-352: one request the page made, as net.jsonl records it */
export interface NetLine {
  step: number;
  method: string;
  url: string;
  status: number | null;
  at: string;
}
class Story {
  rec: StoryRecord;
  dir: string;
  folder: string;
  private seq = 0;
  /** true while a page action runs: a request started then belongs to the step about to be numbered */
  acting = false;
  /** REQ-352: the page's requests, in memory for expect.requested and appended to net.jsonl */
  net: NetLine[] = [];
  constructor(public t: Deno.TestContext) {
    this.dir = shotsDir();
    const name = t.name;
    const slug = storySlug(name);
    this.folder = `${this.dir}/${slug}`;
    Deno.mkdirSync(this.folder, { recursive: true });
    Deno.mkdirSync(`${this.dir}/stories`, { recursive: true });
    this.rec = {
      v: 1,
      id: storyId(name),
      name,
      file: originPath(t),
      status: "running",
      assertions: 0,
      steps: [],
      transcripts: [],
      startedAt: new Date().toISOString(),
    };
    this.write();
  }
  get slug(): string {
    return storySlug(this.rec.name);
  }
  next(): number {
    return ++this.seq;
  }
  write(): void {
    const tmp = `${this.dir}/stories/.${this.slug}.json.tmp`;
    Deno.writeTextFileSync(tmp, JSON.stringify(this.rec, null, 2) + "\n");
    Deno.renameSync(tmp, `${this.dir}/stories/${this.slug}.json`);
  }
  /** REQ-352: the step a request started under — the one in flight, else the last one */
  netStep(): number {
    return this.acting ? this.seq + 1 : this.seq;
  }
  netRecord(line: NetLine): void {
    this.net.push(line);
    const rel = `${this.slug}/net.jsonl`;
    try {
      Deno.writeTextFileSync(`${this.dir}/${rel}`, JSON.stringify(line) + "\n", { append: true });
      if (this.rec.net !== rel) {
        this.rec.net = rel;
        this.write();
      }
    } catch { /* the evidence dir is gone — the in-memory list still serves the assertion */ }
  }
  stamp(n: number, action: string, target: string, url: string): string {
    return `${this.rec.id} · #${n} · ${action} ${target} · ${url}`.slice(0, 300);
  }
  finish(status: "pass" | "fail" | "skipped", reason?: string): void {
    this.rec.status = status;
    if (reason) this.rec.reason = reason;
    this.rec.endedAt = new Date().toISOString();
    this.write();
  }
}

function originPath(t: Deno.TestContext): string {
  try {
    const o = (t as unknown as { origin?: string }).origin;
    if (o && o.startsWith("file://")) return decodeURIComponent(new URL(o).pathname);
    return o ?? "";
  } catch {
    return "";
  }
}

// ── expect ───────────────────────────────────────────────────────────────────
export interface Expect {
  (cond: unknown, msg: string): void;
  eq(a: unknown, b: unknown, msg: string): void;
  /** the page shows this text (waits up to `timeout` ms) — an assertion */
  see(text: string, opts?: { timeout?: number }): Promise<void>;
  /** the page does NOT show this text right now — an assertion */
  notSee(text: string): Promise<void>;
  /** REQ-352: the page made a request whose url matches (string = substring,
   *  RegExp = test), optionally with this method, within `timeout` ms — an
   *  assertion. Evidence that is not a pixel: a tracking call, an event sent. */
  requested(pattern: RegExp | string, opts?: { method?: string; timeout?: number }): Promise<void>;
}

/** The assertion counter's face. `see` needs a page; without one it throws. */
export function makeExpect(counter: { count: number }, page?: PW, net: () => NetLine[] = () => []): Expect {
  const fn = ((cond: unknown, msg: string) => {
    counter.count++;
    if (!cond) throw new Error(`expectation failed: ${msg}`);
  }) as Expect;
  fn.eq = (a, b, msg) => {
    counter.count++;
    if (a !== b) throw new Error(`expectation failed: ${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  };
  fn.see = async (text, opts) => {
    counter.count++;
    if (!page) throw new Error("expect.see needs a page — use story(t, …).page first");
    try {
      // 15 s: under the gate three lanes share the machine (load 16 on 16 cores
      // was measured) and a page that needs 6 s is not a page that never showed
      await page.getByText(text).first().waitFor({ timeout: opts?.timeout ?? 15000 });
    } catch (e) {
      throw new Error(`expectation failed: the page never showed "${text}" (${String((e as Error)?.message ?? e).split("\n")[0]})`);
    }
  };
  fn.notSee = async (text) => {
    counter.count++;
    if (!page) throw new Error("expect.notSee needs a page");
    const n = await page.getByText(text).count?.() ?? 0;
    if (n > 0) throw new Error(`expectation failed: the page shows "${text}" and should not`);
  };
  fn.requested = async (pattern, opts) => {
    counter.count++;
    const match = (l: NetLine) =>
      (typeof pattern === "string" ? l.url.includes(pattern) : pattern.test(l.url)) &&
      (!opts?.method || l.method.toUpperCase() === opts.method.toUpperCase());
    const deadline = Date.now() + (opts?.timeout ?? 15000);
    for (;;) {
      if (net().some(match)) return;
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const seen = net();
    const first = seen.slice(0, 5).map((l) => `${l.method} ${l.url}`).join(", ");
    throw new Error(`expectation failed: no request matched ${String(pattern)}${opts?.method ? ` (${opts.method})` : ""} (${seen.length} request(s) seen${seen.length ? ": " + first : ""})`);
  };
  return fn;
}

// ── the raw-launch guard ─────────────────────────────────────────────────────
const ORIGINAL_LAUNCH = new WeakMap<object, (o: Record<string, unknown>) => Promise<PW>>();
let arming = false;
function guarded(pw: PW): (o: Record<string, unknown>) => Promise<PW> {
  const ch = pw.chromium;
  if (!ORIGINAL_LAUNCH.has(ch)) {
    const orig = ch.launch.bind(ch);
    ORIGINAL_LAUNCH.set(ch, orig);
    try {
      Object.defineProperty(ch, "launch", {
        configurable: true,
        writable: true,
        value: (o: Record<string, unknown>) => {
          if (!arming) throw new Error("use story(t) from #shots — a raw page leaves no evidence (chromium.launch outside the lib is refused)");
          return orig(o);
        },
      });
    } catch { /* a frozen module: the static scan in `shots run` still catches it */ }
  }
  return ORIGINAL_LAUNCH.get(ch)!;
}

// ── the worker's browser (REQ-386) ───────────────────────────────────────────
// A browser per story launched and killed a whole Chromium (browser, GPU and
// renderer processes) for every story, on twice the cores' workers beside the
// unit and int lanes: the Mac under massive load. Now a worker process boots ONE
// browser, at its first story, and every story gets a context of its own. A
// boot that failed is not kept (the next story tries again and fails with its
// own reason); a browser that disconnected (crashed) is booted again. Playwright
// kills the browser when the worker process exits.
let shared: Promise<PW> | null = null;
async function sharedBrowser(): Promise<PW> {
  const b = await shared?.catch(() => null);
  if (b && (typeof b.isConnected !== "function" || b.isConnected())) return b;
  shared = (async () => {
    const pw = await playwright();
    const launch = guarded(pw);
    arming = true;
    try {
      return await bootBrowser(pw, launch);
    } finally {
      arming = false;
    }
  })();
  return await shared;
}

/** The Playwright module the lib uses — guarded: `chromium.launch` on it
 *  throws unless the lib is the caller. Exposed for tests and for locators. */
export async function playwright(): Promise<PW> {
  const { pw } = await loadPlaywright();
  guarded(pw);
  return pw;
}

// ── the page wrapper ─────────────────────────────────────────────────────────
// Locator-returning methods hand back a PROXIED Locator: its actions shoot too
// (target = the locator's own string form), and its chaining methods stay
// proxied, so `page.getByRole("button", { name: "go" }).click()` leaves a frame
// exactly like `page.click("#go")`.
const LOCATOR_MAKERS = ["locator", "getByRole", "getByText", "getByLabel", "getByTestId", "getByPlaceholder", "getByTitle", "getByAltText", "frameLocator"];
const LOCATOR_ACTIONS = ["click", "dblclick", "fill", "press", "selectOption", "check", "uncheck", "type", "setInputFiles", "hover", "tap", "clear"];
const LOCATOR_CHAIN = ["first", "last", "nth", "filter", "locator", "and", "or", "getByRole", "getByText", "getByLabel", "getByTestId", "getByPlaceholder", "getByTitle", "getByAltText", "frameLocator"];

function locatorName(loc: PW): string {
  try {
    const s = String(loc.toString());
    // playwright prints "locator('#x')" / "getByRole('button', { name: 'go' })"
    return s.replace(/^Locator@/, "").slice(0, 160);
  } catch {
    return "locator";
  }
}

function wrapLocator(loc: PW, page: PW, s: Story): PW {
  return new Proxy(loc, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && LOCATOR_ACTIONS.includes(prop)) {
        return async (...args: unknown[]) => {
          s.acting = true;
          try {
            const out = await (target[prop] as (...a: unknown[]) => Promise<unknown>).apply(target, args);
            await shoot(page, s, prop as Action, locatorName(target));
            return out;
          } finally {
            s.acting = false;
          }
        };
      }
      if (typeof prop === "string" && LOCATOR_CHAIN.includes(prop)) {
        return (...args: unknown[]) => wrapLocator((target[prop] as (...a: unknown[]) => PW).apply(target, args), page, s);
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

function wrapPage(page: PW, s: Story): PW {
  return new Proxy(page, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && (ACTIONS as string[]).includes(prop)) {
        return async (...args: unknown[]) => {
          if (prop === "goto" && typeof args[0] === "string") args[0] = resolveUrl(args[0]);
          s.acting = true;
          try {
            const out = await (target[prop] as (...a: unknown[]) => Promise<unknown>).apply(target, args);
            await shoot(target, s, prop as Action, String(args[0] ?? ""));
            return out;
          } finally {
            s.acting = false;
          }
        };
      }
      if (typeof prop === "string" && LOCATOR_MAKERS.includes(prop)) {
        return (...args: unknown[]) => wrapLocator((target[prop] as (...a: unknown[]) => PW).apply(target, args), target, s);
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

const STAMP_IN = `(function (text) {
  var d = document.createElement("div");
  d.id = "__shots_stamp";
  d.textContent = text;
  d.style.cssText = "position:fixed;left:0;bottom:0;right:0;z-index:2147483647;background:#111;color:#fff;" +
    "font:12px/1.4 ui-monospace,Menlo,monospace;padding:4px 8px;opacity:.92;pointer-events:none;white-space:pre-wrap";
  (document.body || document.documentElement).appendChild(d);
})(__TEXT__)`;
const STAMP_OUT = `(function () { var d = document.getElementById("__shots_stamp"); if (d) d.remove(); })()`;

async function shoot(page: PW, s: Story, action: Action, targetText: string): Promise<void> {
  const n = s.next();
  const url = safeUrl(page);
  const stamp = s.stamp(n, action, targetText, url);
  const rel = `${s.slug}/${pad3(n)}-${action}.png`;
  const path = `${s.dir}/${rel}`;
  // the stamp is injected as SOURCE TEXT: a callback here would need the dom
  // lib, and a dom reference in a Deno graph re-types the whole repo
  // (memory: dom-lib-reference-leaks-repo-wide)
  try {
    await page.evaluate(STAMP_IN.replace("__TEXT__", JSON.stringify(stamp)));
  } catch { /* no document yet — the frame is still taken; the json carries the stamp */ }
  // a frame on a loaded box (the gate runs three lanes beside a live fleet) can
  // take longer than the page's 15 s default; the frame is the evidence, so give
  // it the navigation budget rather than fail a story that did its work
  await page.screenshot({ path, fullPage: false, timeout: 90_000 });
  try {
    await page.evaluate(STAMP_OUT);
  } catch { /* navigated away — fine */ }
  s.rec.steps.push({ n, action, target: targetText, url, png: rel, stamp, at: new Date().toISOString() });
  s.write();
}
function safeUrl(page: PW): string {
  try {
    return String(page.url());
  } catch {
    return "";
  }
}

// ── http ─────────────────────────────────────────────────────────────────────
export interface Exchange {
  req: { method: string; url: string; headers: Record<string, string>; body: string };
  res: { status: number; statusText: string; headers: Record<string, string>; body: string };
}
/** The transcript text: request line + headers + body, blank line, status line
 *  + headers + body. */
export function transcriptText(req: Exchange["req"], res: Exchange["res"]): string {
  const u = new URL(req.url);
  const lines = [`${req.method} ${u.pathname}${u.search} HTTP/1.1`, `host: ${u.host}`];
  for (const [k, v] of Object.entries(req.headers)) if (k.toLowerCase() !== "host") lines.push(`${k}: ${v}`);
  lines.push("", req.body ?? "", "", `HTTP/1.1 ${res.status} ${res.statusText}`.trimEnd());
  for (const [k, v] of Object.entries(res.headers)) lines.push(`${k}: ${v}`);
  lines.push("", res.body ?? "");
  return lines.join("\n") + "\n";
}

function makeHttp(s: Story): (input: string, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = resolveUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const reqHeaders: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((v, k) => (reqHeaders[k] = v));
    const reqBody = init?.body == null ? "" : typeof init.body === "string" ? init.body : "<binary body>";
    const res = await fetch(url, init);
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (resHeaders[k] = v));
    const text = await res.clone().text();
    const n = s.next();
    const u = new URL(url);
    const rel = `${s.slug}/${pad3(n)}-${method}-${pathSlug(u.pathname)}.txt`;
    await Deno.writeTextFile(
      `${s.dir}/${rel}`,
      transcriptText({ method, url, headers: reqHeaders, body: reqBody }, { status: res.status, statusText: res.statusText, headers: resHeaders, body: text }),
    );
    s.rec.transcripts.push({ n, method, path: u.pathname, status: res.status, file: rel });
    s.rec.steps.push({ n, action: "http", target: `${method} ${u.pathname}`, url, transcript: rel, stamp: s.stamp(n, "http", `${method} ${u.pathname}`, url), at: new Date().toISOString() });
    s.write();
    return res;
  };
}

// ── skip ─────────────────────────────────────────────────────────────────────
class SkipSignal extends Error {
  constructor(public why: string) {
    super(`skipped: ${why}`);
  }
}

// ── the claim (REQ-383) ──────────────────────────────────────────────────────
/** True when this process is the first to claim the story: the file
 *  `<dir>/<slug>` is created atomically (createNew), naming the worker
 *  (SHOTS_WORKER, else the pid) — a second claim, from any process, finds it
 *  there and answers false. */
export async function claim(dir: string, slug: string): Promise<boolean> {
  await Deno.mkdir(dir, { recursive: true });
  try {
    await Deno.writeTextFile(`${dir}/${slug}`, `${Deno.env.get("SHOTS_WORKER") || Deno.pid}\n`, { createNew: true });
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) return false;
    throw e;
  }
}

// ── story ────────────────────────────────────────────────────────────────────
export interface StoryTools {
  /** a Playwright page; each action is followed by one stamped screenshot */
  page: PW;
  expect: Expect;
  http: (input: string, init?: RequestInit) => Promise<Response>;
  /** record this story as skipped with a reason and stop, without failing */
  skip: (why: string) => never;
  /** the served app's base url */
  baseUrl: string;
  /** this story's evidence folder */
  folder: string;
}

/** Run one user story: boots a page (unless `opts.browser` is false — the
 *  `http()` form), hands the tools over, records the outcome, closes the
 *  browser. Fails with "no assertion" when `fn` returned without asserting
 *  anything. */
export async function story(
  t: Deno.TestContext,
  fn: (s: StoryTools) => Promise<void> | void,
  opts: { browser?: boolean } = {},
): Promise<void> {
  // Bare `deno test` (no runner): the story cannot run — there is no served
  // app and nowhere to leave frames. Say so on stderr and step aside instead of
  // failing, so a repo's plain suite stays runnable; under the gate the runner
  // ALWAYS sets both, and a story that skips here never reaches the index.
  if (!Deno.env.get("BASE_URL") || !Deno.env.get("SHOTS_DIR")) {
    console.error(`shots: "${t.name}" not run — no BASE_URL/SHOTS_DIR: stories run through \`shots run\` (deno task test:e2e), not bare deno test`);
    return;
  }
  // REQ-383: `shots run` starts several workers over the same files; the first
  // to reach a story claims it (one atomic file create) and the others pass by
  const claims = Deno.env.get("SHOTS_CLAIM_DIR");
  if (claims && !(await claim(claims, storySlug(t.name)))) return;
  const s = new Story(t);
  const counter = { count: 0 };
  let context: PW | null = null;
  let rawPage: PW | null = null;
  let page: PW | null = null;
  if (opts.browser !== false) {
    let browser: PW;
    try {
      browser = await sharedBrowser();
    } catch (e) {
      // a browser that did not boot is this story's FAILURE, with the reason on
      // its record — not a record left "running" that the index can only call
      // "did not finish" (2026-10-20: thirteen of those said nothing of the cause)
      s.finish("fail", (e instanceof Error ? e.message : String(e)).split("\n")[0]);
      throw e;
    }
    // REQ-386: a context per story — its own cookies, storage and cache, as
    // isolated as a browser of its own, at a fraction of the cost
    context = await browser.newContext();
    rawPage = await context.newPage();
    // REQ-345: no gate frame waits on a remote font host (defensive — a fake
    // page without route() just runs unblocked)
    if ((Deno.env.get("WT_GATE") === "1" || Deno.env.get("SHOTS_BLOCK_FONTS") === "1") && typeof rawPage.route === "function") {
      await rawPage.route((u: URL) => isFontHost(String(u)), (route: PW) => route.abort());
    }
    // Budgets sized for the gate, not for a quiet laptop (REQ-278): the e2e lane
    // runs beside the unit and int lanes while several servers boot, and a
    // page's FIRST render is a cold SSR — measured 30 s+ at load 11 on 16 cores,
    // ~1 s alone. Navigation gets 90 s; a locator wait keeps `see`'s 15 s.
    rawPage.setDefaultNavigationTimeout(90_000);
    rawPage.setDefaultTimeout(15_000);
    // REQ-352: every request the page makes is evidence too — recorded per step
    // with its status once the response lands (null when it never does). A
    // page without on() (a fake) records nothing, silently.
    if (typeof rawPage.on === "function") {
      const pending = new Map<unknown, NetLine>();
      try {
        rawPage.on("request", (req: PW) => {
          try {
            pending.set(req, { step: s.netStep(), method: String(req.method()), url: String(req.url()), status: null, at: new Date().toISOString() });
          } catch { /* a request object that will not say — not evidence */ }
        });
        rawPage.on("response", (res: PW) => {
          try {
            const line = pending.get(res.request());
            if (!line) return;
            pending.delete(res.request());
            s.netRecord({ ...line, status: Number(res.status()) });
          } catch { /* same */ }
        });
        rawPage.on("requestfailed", (req: PW) => {
          try {
            const line = pending.get(req);
            if (!line) return;
            pending.delete(req);
            s.netRecord(line);
          } catch { /* same */ }
        });
      } catch { /* a page that has on() but not these events — nothing recorded */ }
    }
    page = wrapPage(rawPage, s);
  }
  const expect = makeExpect(counter, rawPage ?? undefined, () => s.net);
  const tools: StoryTools = {
    page: page ?? new Proxy({}, {
      get() {
        throw new Error("this story has no page — use story(t, …) for a browser, http(t, …) is transcripts only");
      },
    }),
    expect,
    http: makeHttp(s),
    skip: (why: string) => {
      throw new SkipSignal(why);
    },
    baseUrl: baseUrl(),
    folder: s.folder,
  };
  let failure: Error | null = null;
  try {
    await fn(tools);
    if (counter.count === 0) failure = new Error(`${s.rec.name}: no assertion — a story must assert what the user would see (expect / expect.see / expect.eq)`);
  } catch (e) {
    if (e instanceof SkipSignal) {
      s.finish("skipped", e.why);
      await closeAll();
      return;
    }
    failure = e instanceof Error ? e : new Error(String(e));
  }
  s.rec.assertions = counter.count;
  if (failure) {
    s.finish("fail", failure.message.split("\n")[0]);
    await closeAll();
    throw failure;
  }
  s.finish("pass");
  await closeAll();

  async function closeAll() {
    try {
      await rawPage?.close();
    } catch { /* gone */ }
    try {
      await context?.close();
    } catch { /* gone */ }
  }
}

/** A story with no browser: only http transcripts. Same rules. */
export const http = (t: Deno.TestContext, fn: (s: Omit<StoryTools, "page">) => Promise<void> | void) =>
  story(t, fn, { browser: false });
