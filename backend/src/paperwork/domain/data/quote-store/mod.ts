import { Injectable } from "#danet/core";
import { summarizeJobName } from "#quote-flow/job-name.ts";
import { getKv, indexedIds, readMany } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import { DocNumbering } from "@core/data/doc-numbering/mod.ts";
import {
  createNumbered,
  type CreateNumberedOpts,
  listNumberedVersions,
  publishNumbered,
  snapshotCustomer,
} from "@core/data/numbered-store/mod.ts";
import type { DocVersionRecord } from "#documents/versions.ts";
import type {
  CreateQuoteDto,
  Quote,
  UpdateQuoteDto,
} from "@paperwork/dto/quote.ts";

const PREFIX = "quote";
const INDEX_PREFIX = "quote_by_user";
/** REQ-241: the onboarding sample's number when no localized one is given. */
const SAMPLE_NUMBER = "SAMPLE";

@Injectable()
export class QuoteStore {
  constructor(private numbering: DocNumbering = new DocNumbering()) {}

  async create(
    userId: string,
    input: CreateQuoteDto,
    opts?: {
      jobNameLang?: "en" | "es";
      /** REQ-241: the mark an isSample quote shows instead of a Q- number */
      sampleNumber?: string;
    } & CreateNumberedOpts,
  ): Promise<Quote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const quote: Quote = {
      ...input,
      id,
      userId,
      createdAt: now,
      updatedAt: now,
    };
    // Lifecycle (roadmap p.10): every quote is born a draft; send/view/accept
    // move it forward from there. (Set after the spread — the DTO's declared
    // class field materializes `status: undefined`, which would clobber a
    // spread-in default.)
    if (!quote.status) quote.status = "draft";
    // Roadmap p.8: every quote carries a ≤3-word job name platform-wide.
    // The LLM polish step supplies one on assistant-built quotes; API-created
    // quotes fall back to the deterministic summarizer. UX-29: the owner's
    // language governs the derivation — Spanish input must never come out
    // Title-Cased with a stopword tail ("El Patio De").
    if (!quote.jobName?.trim()) {
      const source = quote.summary?.trim() || quote.description?.trim();
      if (source) quote.jobName = summarizeJobName(source, opts?.jobNameLang);
    }
    // REQ-204: the customer as they are today travels with the document.
    const customerSnapshot = await snapshotCustomer(quote.customerId, userId);
    if (customerSnapshot) quote.customerSnapshot = customerSnapshot;
    // REQ-241: the onboarding sample (P-15) stays out of the owner's Q-
    // sequence — it would use up Q-001 and lock the starting number
    // (REQ-199). It carries its own mark instead of a Q- number.
    if (quote.isSample === true) {
      quote.number = opts?.sampleNumber ?? SAMPLE_NUMBER;
      quote.version = 1;
      const kv = await getKv();
      const res = await kv.atomic()
        .set([PREFIX, id], quote)
        .set([INDEX_PREFIX, userId, id], id)
        .commit();
      if (!res.ok) throw new Error("quote-store: sample create failed");
      return quote;
    }
    // REQ-198/200: the next Q- number, in the same transaction as the row.
    return await createNumbered(this.numbering, {
      userId,
      kind: "quote",
      prefix: PREFIX,
      indexPrefix: INDEX_PREFIX,
      record: quote,
    }, { requestId: opts?.requestId });
  }

  /** REQ-201: an edit to an issued quote waits here until published. */
  async setPending(
    id: string,
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<Quote> {
    const existing = await this.getOwned(id, userId);
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: Quote = {
      ...existing,
      pendingRevision: { ...(existing.pendingRevision ?? {}), ...defined },
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  /** REQ-201: publish a revision — same number, same link, next version; the replaced version is filed. */
  async publishRevision(
    id: string,
    userId: string,
    patch: Record<string, unknown>,
    by: DocVersionRecord["publishedBy"],
  ): Promise<Quote> {
    return await publishNumbered<Quote>({
      kind: "quote",
      prefix: PREFIX,
      id,
      patch,
      by,
      read: () => this.getOwned(id, userId),
    });
  }

  async listVersions(id: string, userId: string): Promise<DocVersionRecord[]> {
    await this.getOwned(id, userId);
    return await listNumberedVersions("quote", id);
  }

  /**
   * REQ-200: apply `patch` only while `predicate(current)` holds, compare-
   * and-set on the row, so concurrent callers cannot both succeed. Returns
   * null when the predicate failed (the caller answers 409).
   */
  async updateIf(
    id: string,
    predicate: (current: Quote) => boolean,
    patch: UpdateQuoteDto,
  ): Promise<Quote | null> {
    const kv = await getKv();
    for (let attempt = 0; attempt < 20; attempt++) {
      const entry = await kv.get<Quote>([PREFIX, id]);
      if (!entry.value || entry.value.deletedAt) {
        throw new NotFoundError(PREFIX, id);
      }
      if (!predicate(entry.value)) return null;
      const definedPatch = Object.fromEntries(
        Object.entries(patch).filter(([_, v]) => v !== undefined),
      );
      const updated: Quote = {
        ...entry.value,
        ...definedPatch,
        id: entry.value.id,
        userId: entry.value.userId,
        createdAt: entry.value.createdAt,
        updatedAt: new Date().toISOString(),
      };
      const result = await kv.atomic().check(entry).set([PREFIX, id], updated)
        .commit();
      if (result.ok) return updated;
    }
    throw new Error(`quote ${id}: conditional update kept losing the race`);
  }

  /** REQ-039 (NW-52): a deleted quote reads as not-found unless the caller
   *  asks for it (`includeDeleted`) — the row itself is never erased. */
  async get(
    id: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<Quote> {
    const kv = await getKv();
    const r = await kv.get<Quote>([PREFIX, id]);
    if (!r.value || (r.value.deletedAt && !opts.includeDeleted)) {
      throw new NotFoundError(PREFIX, id);
    }
    return r.value;
  }

  async getOwned(
    id: string,
    userId: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<Quote> {
    const q = await this.get(id, opts);
    if (q.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return q;
  }

  async listByUser(userId: string): Promise<Quote[]> {
    const kv = await getKv();
    const ids = await indexedIds(kv, [INDEX_PREFIX, userId]); // REQ-134 — read in batches
    const recs = await readMany<Quote>(kv, ids.map((id) => [PREFIX, id]));
    return recs.filter((q): q is Quote => !!q && !q.deletedAt);
  }

  /** Used by analytics + dashboard panels. Filters in-memory after the user-scoped fetch. */
  async listByUserAndStatus(userId: string, status: string): Promise<Quote[]> {
    const all = await this.listByUser(userId);
    return all.filter((q) => q.status === status);
  }

  async update(
    id: string,
    userId: string,
    patch: UpdateQuoteDto,
  ): Promise<Quote> {
    const existing = await this.getOwned(id, userId);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: Quote = {
      ...existing,
      ...definedPatch,
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  /** REQ-039 (NW-52): "do not delete data, flag it" — soft delete. The
   *  row and the owner index stay; reads and lists hide it. */
  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.getOwned(id, userId);
    const now = new Date().toISOString();
    const kv = await getKv();
    await kv.set([PREFIX, id], { ...existing, deletedAt: now, updatedAt: now });
  }
}
