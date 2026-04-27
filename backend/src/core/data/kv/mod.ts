let kvPromise: Promise<Deno.Kv> | null = null;

export function getKv(): Promise<Deno.Kv> {
  if (!kvPromise) {
    const path = Deno.env.get("KV_PATH") ?? undefined;
    kvPromise = Deno.openKv(path);
  }
  return kvPromise;
}

export async function resetKv(): Promise<void> {
  if (kvPromise) {
    const kv = await kvPromise;
    kv.close();
    kvPromise = null;
  }
}
