import { Injectable } from "#danet/core";
import { getKv, readMany } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import {
  joinBody,
  outboxPreview,
  splitBody,
} from "@communication/domain/business/outbox-entry/mod.ts";
import type { OutboxEntry, OutboxMessage } from "@communication/dto/outbox.ts";

const PREFIX = "outbox"; //       ["outbox", id]                                → OutboxEntry
const INDEX_PREFIX = "outbox_by_user"; // ["outbox_by_user", userId, createdAt, id] → id
const BODY_PREFIX = "outbox_body"; //    ["outbox_body", userId, id, page]          → string

/** Pages written per atomic commit — well under KV's 800 KB mutation cap. */
const PAGES_PER_COMMIT = 8;

/** What a sender records; the store stamps id, time, the list line and the pages. */
export type NewOutboxEntry =
  & Omit<OutboxEntry, "id" | "createdAt" | "preview" | "bodyPages">
  & {
    preview?: string;
    /** the content as sent; "" (or absent) when nothing went */
    body?: string;
  };

/**
 * OutboxStore — REQ-784 (demo-loop cycle dv1, issue d12): the business's
 * outbox, one entry per email or text to a customer, sent or not.
 *
 * Storage:
 *   ["outbox", id]                                 → OutboxEntry (no body)
 *   ["outbox_by_user", userId, createdAt, id]      → id (newest-first scan)
 *   ["outbox_body", userId, id, n]                 → page n of the body
 *
 * The body is paged (an email's HTML outgrows one KV value) and keyed under
 * the userId, so the account wipe (WipeAccount: any key holding the userId)
 * takes it with the rest. Pages land before the entry + index, so a torn
 * write is never listed.
 */
@Injectable()
export class OutboxStore {
  async record(input: NewOutboxEntry): Promise<OutboxEntry> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const { body = "", preview, ...facts } = input;
    const pages = splitBody(body);
    const entry = Object.fromEntries(
      Object.entries({
        ...facts,
        id,
        createdAt,
        preview: preview ??
          outboxPreview({
            channel: facts.channel,
            subject: facts.subject,
            body,
          }),
        bodyPages: pages.length,
      }).filter(([, v]) => v !== undefined),
    ) as unknown as OutboxEntry;
    const kv = await getKv();
    for (let i = 0; i < pages.length; i += PAGES_PER_COMMIT) {
      const batch = kv.atomic();
      for (let j = i; j < Math.min(i + PAGES_PER_COMMIT, pages.length); j++) {
        batch.set([BODY_PREFIX, entry.userId, id, j], pages[j]);
      }
      const res = await batch.commit();
      if (!res.ok) throw new Error("outbox: body commit failed");
    }
    const res = await kv.atomic()
      .set([PREFIX, id], entry)
      .set([INDEX_PREFIX, entry.userId, createdAt, id], id)
      .commit();
    if (!res.ok) throw new Error("outbox: entry commit failed");
    return entry;
  }

  /** The account's entries, newest first, without bodies. */
  async listByUser(
    userId: string,
    options: { limit?: number } = {},
  ): Promise<OutboxEntry[]> {
    const kv = await getKv();
    const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 200), 1000));
    const ids: string[] = [];
    const iter = kv.list<string>({ prefix: [INDEX_PREFIX, userId] }, {
      reverse: true,
      limit,
    });
    for await (const e of iter) ids.push(e.value);
    const recs = await readMany<OutboxEntry>(kv, ids.map((id) => [PREFIX, id]));
    return recs.filter((r): r is OutboxEntry => !!r && r.userId === userId);
  }

  /** One entry with its content as sent; another account's is refused. */
  async getOwned(id: string, userId: string): Promise<OutboxMessage> {
    const kv = await getKv();
    const r = await kv.get<OutboxEntry>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    if (r.value.userId !== userId) throw new ForbiddenError(PREFIX, id);
    const pages = await readMany<string>(
      kv,
      Array.from(
        { length: r.value.bodyPages ?? 0 },
        (_, n) => [BODY_PREFIX, userId, id, n],
      ),
    );
    return { ...r.value, body: joinBody(pages.map((p) => p ?? "")) };
  }
}
