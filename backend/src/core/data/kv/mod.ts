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

// ---- REQ-134 — records behind an index are read in batches, never one KV read per record -----

/** KV answers at most ten keys per getMany */
export const KV_GET_MANY_MAX = 10;
/** how many getMany calls are in flight together */
const READ_LANES = 8;

export function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** the records at `keys`, in key order, `null` where there is none: getMany in chunks of ten, eight chunks in flight */
export async function readMany<T>(kv: Pick<Deno.Kv, "getMany">, keys: readonly Deno.KvKey[]): Promise<(T | null)[]> {
  if (keys.length === 0) return [];
  const chunks = chunksOf(keys, KV_GET_MANY_MAX);
  const out: (T | null)[] = new Array(keys.length).fill(null);
  for (const lane of chunksOf(chunks.map((c, i) => [c, i] as const), READ_LANES)) {
    await Promise.all(lane.map(async ([chunk, i]) => {
      const entries = await kv.getMany<T[]>(chunk as Deno.KvKey[]);
      entries.forEach((e, j) => out[i * KV_GET_MANY_MAX + j] = (e.value as T | null) ?? null);
    }));
  }
  return out;
}

/** the values of an index under `prefix` — the ids it points at, in key order */
export async function indexedIds(kv: Pick<Deno.Kv, "list">, prefix: Deno.KvKey): Promise<string[]> {
  const ids: string[] = [];
  for await (const e of kv.list<string>({ prefix })) ids.push(e.value);
  return ids;
}
