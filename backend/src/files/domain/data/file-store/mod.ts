import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import { chunk, sha256Hex, unchunk } from "@files/domain/business/chunk/mod.ts";
import type { FileRecord } from "@files/dto/file.ts";

const META_PREFIX  = "file_meta";          // [META_PREFIX, id]                → FileRecord
const PAGE_PREFIX  = "file_page";          // [PAGE_PREFIX, id, pageIndex]     → Uint8Array
const INDEX_PREFIX = "file_by_user";       // [INDEX_PREFIX, userId, id]       → id

/**
 * How many 60KiB pages to write per atomic commit. Deno KV caps a single
 * atomic mutation at 819,200 bytes total; 10 pages ≈ 600KiB leaves ample
 * headroom for the per-key envelope. Committing everything in one op (the
 * old behaviour) returned a 500 once an upload crossed ~768KB.
 */
const PAGES_PER_COMMIT = 10;

/**
 * FileStore — chunked binary storage backed by Deno KV.
 *
 * Bytes are split into 60KiB pages (Deno KV's value cap is ~64KiB). Pages
 * are written in batched atomic commits (see PAGES_PER_COMMIT) that stay
 * under KV's atomic-mutation byte cap, with the meta record + per-user
 * index committed LAST. The read path keys off the meta record, so a
 * half-written upload is simply invisible — a torn file can never be read
 * or listed. An aborted upload leaves only unreachable orphan pages.
 *
 * Per-user index keeps `listByUser` cheap. Cross-user access is gated
 * via `getOwned` (mirrors the rest of the codebase's pattern).
 */
@Injectable()
export class FileStore {
  async create(input: { userId: string; filename: string; mimeType: string; bytes: Uint8Array }): Promise<FileRecord> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const pages = chunk(input.bytes);
    const meta: FileRecord = {
      id,
      userId:    input.userId,
      filename:  input.filename,
      mimeType:  input.mimeType,
      sizeBytes: input.bytes.length,
      pageCount: pages.length,
      sha256:    await sha256Hex(input.bytes),
      createdAt,
    };
    const kv = await getKv();
    // Write the binary pages first, in batches small enough to stay under
    // KV's per-atomic-mutation byte cap. Meta + index land in the final
    // commit so the file only becomes readable/listable once every page is
    // durably stored.
    for (let i = 0; i < pages.length; i += PAGES_PER_COMMIT) {
      const batch = kv.atomic();
      for (let j = i; j < Math.min(i + PAGES_PER_COMMIT, pages.length); j++) {
        batch.set([PAGE_PREFIX, id, j], pages[j]);
      }
      const res = await batch.commit();
      if (!res.ok) throw new Error("file create: page commit failed");
    }
    const result = await kv.atomic()
      .set([META_PREFIX, id], meta)
      .set([INDEX_PREFIX, input.userId, id], id)
      .commit();
    if (!result.ok) throw new Error("file create commit failed");
    return meta;
  }

  async getMeta(id: string): Promise<FileRecord> {
    const kv = await getKv();
    const r = await kv.get<FileRecord>([META_PREFIX, id]);
    if (!r.value) throw new NotFoundError("file", id);
    return r.value;
  }

  async getOwnedMeta(id: string, userId: string): Promise<FileRecord> {
    const meta = await this.getMeta(id);
    if (meta.userId !== userId) throw new ForbiddenError("file", id);
    return meta;
  }

  async readBytes(id: string): Promise<Uint8Array> {
    const meta = await this.getMeta(id);
    const kv = await getKv();
    const pages: Uint8Array[] = [];
    for (let i = 0; i < meta.pageCount; i++) {
      const r = await kv.get<Uint8Array>([PAGE_PREFIX, id, i]);
      if (!r.value) throw new Error(`file ${id} page ${i} missing`);
      pages.push(r.value);
    }
    return unchunk(pages);
  }

  async readOwnedBytes(id: string, userId: string): Promise<Uint8Array> {
    await this.getOwnedMeta(id, userId);
    return await this.readBytes(id);
  }

  async listByUser(userId: string): Promise<FileRecord[]> {
    const kv = await getKv();
    const out: FileRecord[] = [];
    for await (const e of kv.list<string>({ prefix: [INDEX_PREFIX, userId] })) {
      const r = await kv.get<FileRecord>([META_PREFIX, e.value]);
      if (r.value) out.push(r.value);
    }
    return out;
  }

  /**
   * Patch a subset of metadata fields. Used for async transcription
   * results; never accepts userId/id/sizeBytes/sha256/pageCount changes
   * (those are immutable post-create).
   */
  async updateMeta(
    id: string,
    userId: string,
    patch: Partial<Pick<FileRecord, "transcriptStatus" | "transcript" | "transcriptError">>,
  ): Promise<FileRecord> {
    const existing = await this.getOwnedMeta(id, userId);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: FileRecord = { ...existing, ...definedPatch };
    const kv = await getKv();
    await kv.set([META_PREFIX, id], updated);
    return updated;
  }

  async delete(id: string, userId: string): Promise<void> {
    const meta = await this.getOwnedMeta(id, userId);
    const kv = await getKv();
    // Drop meta + index first so the file is immediately unreadable and
    // unlisted, then remove its pages in batches (a multi-batch file can
    // exceed KV's per-atomic-mutation limits). Any page that survives an
    // aborted delete is just unreachable garbage.
    await kv.atomic()
      .delete([META_PREFIX, id])
      .delete([INDEX_PREFIX, userId, id])
      .commit();
    for (let i = 0; i < meta.pageCount; i += PAGES_PER_COMMIT) {
      const batch = kv.atomic();
      for (let j = i; j < Math.min(i + PAGES_PER_COMMIT, meta.pageCount); j++) {
        batch.delete([PAGE_PREFIX, id, j]);
      }
      await batch.commit();
    }
  }
}
