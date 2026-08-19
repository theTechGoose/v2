/**
 * Dual-platform dependency install (macOS host + OrbStack Linux VM share
 * this checkout's node_modules).
 *
 * `deno install --os <os>` PRUNES the other platform's native packages
 * (@esbuild/*, @rollup/rollup-*, fsevents) from node_modules/.deno, so a
 * plain install from one side breaks Vite on the other. This script installs
 * both sets and leaves them coexisting:
 *
 *   1. install --os darwin, then --os linux  → linux natives present,
 *      darwin store entries pruned but their scope symlinks left dangling
 *   2. scan .deno for dangling symlinks      → names the pruned entries
 *   3. install --os darwin again (cached, fast), stash those entries,
 *      install --os linux again, restore the stash
 *
 * Run from either machine:  deno task install:all
 */

const ROOT = new URL("..", import.meta.url).pathname;
const STORE = `${ROOT}node_modules/.deno`;

async function install(os: string): Promise<void> {
  const out = await new Deno.Command("deno", {
    args: ["install", "--os", os],
    cwd: ROOT,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) {
    console.error(new TextDecoder().decode(out.stderr));
    throw new Error(`deno install --os ${os} failed`);
  }
  console.log(`[install:all] deno install --os ${os} ✓`);
}

/** Store-entry names (first path segment under .deno/) targeted by dangling
 * symlinks anywhere in the store's per-package node_modules scopes. */
async function danglingStoreEntries(): Promise<Set<string>> {
  const missing = new Set<string>();
  // per-package scopes (.deno/<entry>/node_modules) plus the shared
  // fallback scope (.deno/node_modules itself)
  const scopes: string[] = [`${STORE}/node_modules`];
  for await (const entry of Deno.readDir(STORE)) {
    if (!entry.isDirectory || entry.name === "node_modules") continue;
    scopes.push(`${STORE}/${entry.name}/node_modules`);
  }
  for (const scope of scopes) {
    for (const dir of await scopeDirs(scope)) {
      for await (const link of Deno.readDir(dir)) {
        const path = `${dir}/${link.name}`;
        const info = await Deno.lstat(path).catch(() => null);
        if (!info?.isSymlink) continue;
        const alive = await Deno.stat(path).catch(() => null);
        if (alive) continue;
        // target is ../../../<store-entry>/node_modules/<pkg> — recover entry
        const target = await Deno.readLink(path);
        const seg = target.split("/").find((s) => s !== ".." && s.length > 0);
        if (seg) missing.add(seg);
      }
    }
  }
  return missing;
}

/** The scope dir itself plus any @scoped subdirectories; [] if absent. */
async function scopeDirs(scope: string): Promise<string[]> {
  const dirs: string[] = [];
  try {
    for await (const e of Deno.readDir(scope)) {
      if (e.isDirectory && e.name.startsWith("@")) dirs.push(`${scope}/${e.name}`);
    }
    dirs.push(scope);
  } catch {
    /* package with no deps — scope dir doesn't exist */
  }
  return dirs;
}

async function copyDir(src: string, dst: string): Promise<void> {
  await new Deno.Command("cp", { args: ["-R", src, dst] }).output();
}

await install("darwin");
await install("linux");

const pruned = await danglingStoreEntries();
if (pruned.size === 0) {
  console.log("[install:all] no pruned entries — both platforms already present");
} else {
  console.log(`[install:all] restoring pruned entries: ${[...pruned].join(", ")}`);
  const stash = await Deno.makeTempDir({ prefix: "dual-platform-stash-" });
  await install("darwin"); // rematerialize the pruned set from deno's cache
  for (const name of pruned) await copyDir(`${STORE}/${name}`, `${stash}/`);
  await install("linux"); // prunes them again — now restore from stash
  for (const name of pruned) await copyDir(`${stash}/${name}`, `${STORE}/`);
  await Deno.remove(stash, { recursive: true });
}

const leftover = await danglingStoreEntries();
if (leftover.size > 0) {
  console.error(
    `[install:all] STILL DANGLING after restore: ${[...leftover].join(", ")}`,
  );
  Deno.exit(1);
}
console.log("[install:all] done — node_modules serves both darwin and linux");
