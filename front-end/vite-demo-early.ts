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
/** the stand-in the server reads its URL from */
export const DEMO_EARLY_STAND_IN = "lib/demo-mode/early-src.ts";
/** its input (and chunk) in the browser's build */
const INPUT = "pm-demo-early";
/** the built chunk's URL, for a server built by another instance of this plugin in this process */
const BUILT = "__pmDemoEarlyChunk";

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
  let built: string | null = null;
  const trim = (r: string) => r.replace(/\/+$/, "");
  /** a module id as a plain path: no virtual prefix, no file URL, no query */
  const plain = (id: string) =>
    id.replace(/^\0/, "").replace(/^file:\/\//, "").replace(/[?#].*$/, "");
  const g = globalThis as { [BUILT]?: string };
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
                input: { [INPUT]: `${root}/${DEMO_EARLY_ENTRY}` },
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
        if (c.type === "chunk" && c.isEntry && c.name === INPUT) {
          built = `/${c.fileName}`;
          g[BUILT] = built;
        }
      }
    },
    load(this: Ctx, id: string) {
      if (this.environment?.name === "client") return null;
      if (plain(id) !== `${root}/${DEMO_EARLY_STAND_IN}`) return null;
      const src = dev
        ? `/@fs${root}/${DEMO_EARLY_ENTRY}`
        : built ?? g[BUILT] ?? null;
      return `export const DEMO_EARLY_SRC = ${JSON.stringify(src)};\n`;
    },
  };
}
