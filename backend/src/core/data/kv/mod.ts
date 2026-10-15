let kvPromise: Promise<Deno.Kv> | null = null;

/** one KV per process; REQ-073 — an open that fails is not remembered, the next caller opens again */
export function getKv(): Promise<Deno.Kv> {
  if (!kvPromise) {
    const path = Deno.env.get("KV_PATH") ?? undefined;
    const opening = Deno.openKv(path);
    kvPromise = opening;
    opening.catch(() => {
      if (kvPromise === opening) kvPromise = null;
    });
  }
  return kvPromise;
}

export async function resetKv(): Promise<void> {
  const pending = kvPromise;
  kvPromise = null;
  if (!pending) return;
  try {
    (await pending).close();
  } catch {
    // an open that never succeeded has nothing to close
  }
}
