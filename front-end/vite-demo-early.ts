/**
 * REQ-648 (demo-loop cycle 5, M3 + c4-m28) — the customer's early demo script, served.
 *
 * `_app.tsx` links lib/demo-mode/demo-early.ts as a module script of its own: it must not wait for
 * the islands (Fresh boots every island from ONE module script, which runs only once all of them
 * are in). Its URL is not the same everywhere: in dev Vite serves the source itself
 * (`/@fs/<path>`); in a build it is an input of the browser's build of its own (`pm-demo-early`)
 * and its chunk's name carries a hash. So the server reads it from lib/demo-mode/early-src.ts,
 * which this plugin replaces on the server's side. Fresh builds the browser first, so the chunk's
 * name is known by the time the server is built; none known: no early script (null), and the
 * overlay opens the link itself as before.
 */
import process from "node:process";

/** the early script, from the front-end's root */
export const DEMO_EARLY_ENTRY = "lib/demo-mode/demo-early.ts";
/** REQ-892 — the session-less page's rejoin script, served the same way */
export const DEMO_REJOIN_ENTRY = "lib/demo-mode/demo-rejoin.ts";
/** the stand-in the server reads both URLs from */
export const DEMO_EARLY_STAND_IN = "lib/demo-mode/early-src.ts";
/** each script: the constant the stand-in exports, its source, its input (and chunk) in the
 *  browser's build, and the global its built chunk's URL is kept in for a server built by another
 *  instance of this plugin in this process */
const SCRIPTS = [
  {
    name: "DEMO_EARLY_SRC",
    entry: DEMO_EARLY_ENTRY,
    input: "pm-demo-early",
    built: "__pmDemoEarlyChunk",
  },
  {
    name: "DEMO_REJOIN_SRC",
    entry: DEMO_REJOIN_ENTRY,
    input: "pm-demo-rejoin",
    built: "__pmDemoRejoinChunk",
  },
] as const;

type Ctx = { environment?: { name?: string } };
type Chunk = {
  type: string;
  isEntry?: boolean;
  name?: string;
  fileName: string;
};

export function demoEarly() {
  let root = "";
  let dev = true;
  const built = new Map<string, string>();
  const trim = (r: string) => r.replace(/\/+$/, "");
  /** a module id as a plain path: no virtual prefix, no file URL, no query */
  const plain = (id: string) =>
    id.replace(/^\0/, "").replace(/^file:\/\//, "").replace(/[?#].*$/, "");
  const g = globalThis as unknown as Record<string, string | undefined>;
  return {
    name: "pm-demo-early",
    enforce: "pre" as const,
    sharedDuringBuild: true,
    config(cfg: { root?: string }, env: { command: string }) {
      root = trim(cfg.root ?? process.cwd());
      dev = env.command !== "build";
      if (dev) return undefined;
      return {
        environments: {
          client: {
            build: {
              rollupOptions: {
                input: Object.fromEntries(
                  SCRIPTS.map((s) => [s.input, `${root}/${s.entry}`]),
                ),
              },
            },
          },
        },
      };
    },
    configResolved(c: { root: string }) {
      root = trim(c.root);
    },
    generateBundle(this: Ctx, _o: unknown, bundle: Record<string, Chunk>) {
      if (this.environment?.name !== "client") return;
      for (const c of Object.values(bundle)) {
        if (c.type !== "chunk" || !c.isEntry) continue;
        const s = SCRIPTS.find((s) => s.input === c.name);
        if (!s) continue;
        built.set(s.input, `/${c.fileName}`);
        g[s.built] = `/${c.fileName}`;
      }
    },
    load(this: Ctx, id: string) {
      if (this.environment?.name === "client") return null;
      if (plain(id) !== `${root}/${DEMO_EARLY_STAND_IN}`) return null;
      return SCRIPTS.map((s) => {
        const src = dev
          ? `/@fs${root}/${s.entry}`
          : built.get(s.input) ?? g[s.built] ?? null;
        return `export const ${s.name} = ${JSON.stringify(src)};\n`;
      }).join("");
    },
  };
}
