export type KvOpen = (path?: string) => Promise<Deno.Kv>;

export interface KvCache {
  /** the one KV, opened on first call; REQ-073 — an open that fails is not remembered, the next caller opens again */
  get(): Promise<Deno.Kv>;
  /** close the KV (if it ever opened) and forget it */
  reset(): Promise<void>;
}

/** one KV per cache: `open` is called with `path()` once, and again only after a failure or a reset */
export function kvCache(open: KvOpen, path: () => string | undefined): KvCache {
  let kvPromise: Promise<Deno.Kv> | null = null;
  return {
    get() {
      if (!kvPromise) {
        const opening = open(path());
        kvPromise = opening;
        opening.catch(() => {
          if (kvPromise === opening) kvPromise = null;
        });
      }
      return kvPromise;
    },
    async reset() {
      const pending = kvPromise;
      kvPromise = null;
      if (!pending) return;
      try {
        (await pending).close();
      } catch {
        // an open that never succeeded has nothing to close
      }
    },
  };
}

/** the process's KV: `KV_PATH` or the platform default */
const processKv = kvCache((path) => Deno.openKv(path), () => Deno.env.get("KV_PATH") ?? undefined);

export function getKv(): Promise<Deno.Kv> {
  return processKv.get();
}

export function resetKv(): Promise<void> {
  return processKv.reset();
}
