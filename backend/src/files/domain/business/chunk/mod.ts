/**
 * Pure helpers for splitting/joining files into 64KiB pages.
 *
 * Deno KV has a hard ~64KiB-per-value limit. Anything bigger has to be
 * sharded across multiple keys. We pick 60KiB per page to leave headroom
 * for the JSON envelope KV puts around binary values.
 */

export const PAGE_SIZE = 60 * 1024;     // 60 KiB

export function chunk(bytes: Uint8Array, pageSize: number = PAGE_SIZE): Uint8Array[] {
  if (bytes.length === 0) return [];
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += pageSize) {
    out.push(bytes.slice(offset, offset + pageSize));
  }
  return out;
}

export function unchunk(pages: Uint8Array[]): Uint8Array {
  const total = pages.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of pages) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** SHA-256 of the bytes — for de-dup + integrity checks. Returns lowercase hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
