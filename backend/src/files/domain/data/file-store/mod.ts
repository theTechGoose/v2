import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import { chunk, sha256Hex, unchunk } from "@files/domain/business/chunk/mod.ts";
import type { FileRecord } from "@files/dto/file.ts";

const META_PREFIX  = "file_meta";          // [META_PREFIX, id]                → FileRecord
const PAGE_PREFIX  = "file_page";          // [PAGE_PREFIX, id, pageIndex]     → Uint8Array
const INDEX_PREFIX = "file_by_user";       // [INDEX_PREFIX, userId, id]       → id

/**
 * FileStore — chunked binary storage backed by Deno KV.
 *
 * Bytes are split into 60KiB pages (Deno KV's value cap is ~64KiB). The
 * meta record + every page write happens in one atomic op so a failed
 * mid-upload never leaves dangling pages.
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
    const op = kv.atomic()
      .set([META_PREFIX, id], meta)
      .set([INDEX_PREFIX, input.userId, id], id);
    pages.forEach((page, i) => op.set([PAGE_PREFIX, id, i], page));
    const result = await op.commit();
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
    const op = kv.atomic()
      .delete([META_PREFIX, id])
      .delete([INDEX_PREFIX, userId, id]);
    for (let i = 0; i < meta.pageCount; i++) op.delete([PAGE_PREFIX, id, i]);
    await op.commit();
  }
}
