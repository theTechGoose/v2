// shots-lib/browser.ts — REQ-279: find a Playwright library and boot a headless
// browser, the same way on a box and on the host.
//
// Order: $SHOTS_PLAYWRIGHT (a module path — tests hand in a fake here) → the
// box's baked library (the one @playwright/mcp bundles; its chromium build is
// baked beside it, and Deno loads it through node's require in ~200 ms) → a
// global `playwright` under /usr/local/lib/node_modules → `npm:playwright`.
// A launch that fails is retried once with the executable
// PLAYWRIGHT_CHROMIUM_EXECUTABLE / ASTRAL_BIN_PATH names (a box's headless
// shell), because a library without its own browser download is the common
// host case.
import { createRequire } from "node:module";

// deno-lint-ignore no-explicit-any
export type PW = any;

const BAKED = "/usr/local/lib/node_modules/@playwright/mcp/";
const GLOBAL = "/usr/local/lib/node_modules/";

let loaded: { pw: PW; from: string } | null = null;

/** The Playwright module and where it came from. Cached per process. */
export async function loadPlaywright(): Promise<{ pw: PW; from: string }> {
  if (loaded) return loaded;
  const tried: string[] = [];
  const explicit = Deno.env.get("SHOTS_PLAYWRIGHT");
  const cands: Array<() => PW | Promise<PW>> = [];
  if (explicit) {
    cands.push(() => {
      tried.push(explicit);
      return createRequire(import.meta.url)(explicit);
    });
  }
  for (const base of [BAKED, GLOBAL]) {
    cands.push(() => {
      tried.push(base + "playwright");
      return createRequire(base)("playwright");
    });
  }
  cands.push(async () => {
    tried.push("npm:playwright");
    // the lib runs with NO import map of its own (installed under ~/.claude,
    // mapped into a repo by `shots run`), so the last resort is spelled out
    // deno-lint-ignore no-import-prefix
    return await import("npm:playwright@^1.50");
  });
  const errs: string[] = [];
  for (const c of cands) {
    try {
      const pw = await c();
      if (pw && pw.chromium) {
        loaded = { pw, from: tried[tried.length - 1] };
        return loaded;
      }
      errs.push(`${tried[tried.length - 1]}: no chromium export`);
    } catch (e) {
      errs.push(`${tried[tried.length - 1]}: ${String((e as Error)?.message ?? e).split("\n")[0]}`);
    }
  }
  throw new Error(
    "shots: no Playwright library found — tried " + errs.join("; ") +
      ". Install one: `deno run -A npm:playwright install chromium chromium-headless-shell` " +
      "(or point SHOTS_PLAYWRIGHT at a playwright module).",
  );
}

/** The baked headless shell under a Playwright browsers dir (a box bakes one
 *  under /opt/cache/ms-playwright for @playwright/mcp): the newest
 *  `chromium_headless_shell-<build>` — its arch dir is matched, never assumed
 *  (x86 chrome-linux/headless_shell, arm64 chrome-headless-shell-linux-arm64/
 *  chrome-headless-shell) — else the newest full `chromium-<build>`'s chrome;
 *  null when the dir holds none. The entrypoint's own glob, in Deno: a
 *  `claude --run` payload and the gate inside a box carry no ASTRAL_BIN_PATH
 *  (2026-10-20: every browser story "did not finish" there), and the library's
 *  own build number rarely matches the baked one. */
export async function bakedShell(dir: string): Promise<string | null> {
  const builds = async (prefix: string) => {
    const out: Array<[number, string]> = [];
    try {
      for await (const e of Deno.readDir(dir)) if (e.isDirectory && e.name.startsWith(prefix)) out.push([Number(e.name.slice(prefix.length)) || 0, `${dir}/${e.name}`]);
    } catch { /* no such dir */ }
    return out.sort((a, b) => b[0] - a[0]).map(([, p]) => p);
  };
  const exeIn = async (build: string, names: string[]) => {
    try {
      for await (const arch of Deno.readDir(build)) {
        if (!arch.isDirectory) continue;
        for (const n of names) {
          const p = `${build}/${arch.name}/${n}`;
          const st = await Deno.stat(p).catch(() => null);
          if (st?.isFile && (st.mode == null || (st.mode & 0o111) !== 0)) return p;
        }
      }
    } catch { /* unreadable build dir */ }
    return null;
  };
  for (const b of await builds("chromium_headless_shell-")) { const p = await exeIn(b, ["chrome-headless-shell", "headless_shell"]); if (p) return p; }
  for (const b of await builds("chromium-")) { const p = await exeIn(b, ["chrome"]); if (p) return p; }
  return null;
}

/** Boot the browser (headless, unless SHOTS_HEADED=1 or opts.headed). `launch` is the module's own — the caller (the lib)
 *  passes the ORIGINAL launch so the raw-launch guard on the module does not
 *  fire on our own boot. */
export async function bootBrowser(pw: PW, launch: (o: Record<string, unknown>) => Promise<PW>, opts: { headed?: boolean } = {}): Promise<PW> {
  // REQ-318: `shots run --prod` boots HEADED (SHOTS_HEADED=1) — the user watches
  const headless = !(opts.headed ?? Deno.env.get("SHOTS_HEADED") === "1");
  const first = await launch.call(pw.chromium, { headless }).catch((e: unknown) => e as Error);
  if (!(first instanceof Error)) return first;
  // a launcher-provided executable wins; else the baked shell on disk (a box)
  const exe = Deno.env.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE") || Deno.env.get("ASTRAL_BIN_PATH") || await bakedShell(Deno.env.get("PLAYWRIGHT_BROWSERS_PATH") || "/opt/cache/ms-playwright");
  if (exe) {
    const second = await launch.call(pw.chromium, { headless, executablePath: exe }).catch((e: unknown) => e as Error);
    if (!(second instanceof Error)) return second;
    throw new Error(
      `shots: the browser did not boot (${String(first.message).split("\n")[0]}); ` +
        `nor with executablePath=${exe} (${String(second.message).split("\n")[0]}). ` +
        "Install one: `deno run -A npm:playwright install chromium chromium-headless-shell`.",
    );
  }
  throw new Error(
    `shots: the browser did not boot (${String(first.message).split("\n")[0]}). ` +
      "Install one: `deno run -A npm:playwright install chromium chromium-headless-shell`, " +
      "or set PLAYWRIGHT_CHROMIUM_EXECUTABLE.",
  );
}
