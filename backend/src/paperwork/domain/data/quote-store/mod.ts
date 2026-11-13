import { Injectable } from "#danet/core";
import {
  QuotePriceError,
  storedQuotePriceProblem,
} from "#quote-flow/quote-price-guard.ts";
import { summarizeJobName } from "#quote-flow/job-name.ts";
import { messageLang } from "#quote-flow/message-language.ts";
import { withoutMoneySentences } from "#quote-flow/private-cost.ts";
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
import {
  type DocVersionRecord,
  effectivePendingRevision,
  firstIssueStamp,
  isQuoteLocked,
} from "#documents/versions.ts";
import {
  descriptionTranslationsStale,
  headingTranslationsStale,
  reconcileLineItemTranslations,
} from "#quote-flow/quote-translations.ts";
import type {
  CreateQuoteDto,
  Quote,
  QuoteDeliveryFields,
  UpdateQuoteDto,
} from "@paperwork/dto/quote.ts";

const PREFIX = "quote";
const INDEX_PREFIX = "quote_by_user";
/** REQ-241: the onboarding sample's number when no localized one is given. */
const SAMPLE_NUMBER = "SAMPLE";

/**
 * REQ-460 (demo-loop cycle 3, B1): a write that would change a SIGNED quote's
 * terms, lines or total. `reason` is REQ-202's word for it (`locked_signed`).
 */
export class QuoteSignedError extends Error {
  readonly reason = "locked_signed";
  constructor(public readonly fields: string[]) {
    super(`quote is signed: ${fields.join(", ")} can no longer change`);
    this.name = "QuoteSignedError";
  }
}

@Injectable()
export class QuoteStore {
  constructor(private numbering: DocNumbering = new DocNumbering()) {}

  async create(
    userId: string,
    input: CreateQuoteDto,
    opts?:
      & {
        jobNameLang?: "en" | "es";
        /** REQ-241: the mark an isSample quote shows instead of a Q- number */
        sampleNumber?: string;
        /** REQ-256: the onboarding sample takes no Q- number — the first
         *  real quote is Q-001. Written without an allocation. */
        unnumbered?: boolean;
      }
      & CreateNumberedOpts,
  ): Promise<Quote> {
    assertQuotePriced(input);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const quote: Quote = {
      ...input,
      ...withoutPrivatePricing(input),
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
    // REQ-248: a quote created already issued is published at birth
    Object.assign(quote, firstIssueStamp({ userId }, quote));
    // Roadmap p.8: every quote carries a ≤3-word job name platform-wide.
    // The LLM polish step supplies one on assistant-built quotes; API-created
    // quotes fall back to the deterministic summarizer. UX-29: the owner's
    // language governs the derivation — Spanish input must never come out
    // Title-Cased with a stopword tail ("El Patio De").
    if (!quote.jobName?.trim()) {
      const source = quote.summary?.trim() || quote.description?.trim();
      // REQ-579 (cycle 4, M14): the language the job was TYPED in names it —
      // Spanish typed in an English account is "Baño principal", never
      // "Baño Principal De"; the account language decides only when the
      // text can't tell.
      const typed = messageLang(
        `${quote.summary ?? ""} ${quote.description ?? ""}`,
      );
      if (source) {
        quote.jobName = summarizeJobName(source, typed ?? opts?.jobNameLang);
      }
    }
    // REQ-204: the customer as they are today travels with the document.
    const customerSnapshot = await snapshotCustomer(quote.customerId, userId);
    if (customerSnapshot) quote.customerSnapshot = customerSnapshot;
    if (opts?.unnumbered) {
      const kv = await getKv();
      const res = await kv.atomic()
        .set([PREFIX, id], quote)
        .set([INDEX_PREFIX, userId, id], id)
        .commit();
      if (!res.ok) throw new Error(`quote ${id}: write refused`);
      return quote;
    }
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

  /**
   * REQ-201: an edit to an issued quote waits here until published.
   * REQ-395 (demo M12): the patch is folded into what is already pending and
   * only what still differs from the live quote is kept — an edit back to the
   * published version leaves no pending revision at all.
   */
  async setPending(
    id: string,
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<Quote> {
    const existing = await this.getOwned(id, userId);
    const defined = withoutPrivatePricing(Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    ));
    const { pendingRevision: prior, ...live } = existing;
    const pending = effectivePendingRevision(
      live as unknown as Record<string, unknown>,
      { ...(prior ?? {}), ...defined },
    );
    // REQ-561 (demo M28): new job details make the per-language copies of
    // the old ones stale — Version N+1 carries none, so readers fall back to
    // the new text and the next translate run (send / preview) refills them.
    // Job details edited back to the live text take the cleared copies along.
    if (!("descriptionByLang" in defined)) {
      if ("description" in pending) pending.descriptionByLang = {};
      else delete pending.descriptionByLang;
    }
    const updated: Quote = {
      ...live,
      ...(Object.keys(pending).length ? { pendingRevision: pending } : {}),
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  /** REQ-395 (demo M12): drop an unwanted draft revision — the live quote stays as published. */
  async clearPending(id: string, userId: string): Promise<Quote> {
    const existing = await this.getOwned(id, userId);
    if (!existing.pendingRevision) return existing;
    const { pendingRevision: _p, ...rest } = existing;
    const updated: Quote = { ...rest, updatedAt: new Date().toISOString() };
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
    patch: UpdateQuoteDto & QuoteDeliveryFields,
  ): Promise<Quote | null> {
    const kv = await getKv();
    for (let attempt = 0; attempt < 20; attempt++) {
      const entry = await kv.get<Quote>([PREFIX, id]);
      if (!entry.value || entry.value.deletedAt) {
        throw new NotFoundError(PREFIX, id);
      }
      if (!predicate(entry.value)) return null;
      const definedPatch = withoutPrivatePricing(Object.fromEntries(
        Object.entries(patch).filter(([_, v]) => v !== undefined),
      ));
      const updated: Quote = {
        ...entry.value,
        ...firstIssueStamp(entry.value, definedPatch), // REQ-248
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
    patch: UpdateQuoteDto & QuoteDeliveryFields,
  ): Promise<Quote> {
    const existing = await this.getOwned(id, userId);
    const definedPatch = withoutPrivatePricing(Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    )) as Partial<Quote>;
    // REQ-460 (demo-loop cycle 3, B1): a signed quote's agreement is final.
    assertNotSigned(existing, definedPatch);
    // REQ-302: only the money fields the patch carries are judged — a lock
    // stamp or a translation never re-validates an old row.
    assertQuotePriced(definedPatch);
    // REQ-264 (M15): an edited text's cached translations are stale — drop
    // them (the next send re-translates); unchanged lines keep theirs.
    if (definedPatch.lineItems) {
      definedPatch.lineItems = reconcileLineItemTranslations(
        existing.lineItems,
        definedPatch.lineItems,
      );
    }
    const staleDescription = descriptionTranslationsStale(existing, patch);
    // REQ-400 (M5): a renamed job (or a new summary) without new per-language
    // text — the cached names describe the old one; the next translate run
    // (lock, preview, send) fills them again.
    const staleHeading = headingTranslationsStale(existing, patch);
    const updated: Quote = {
      ...existing,
      // REQ-248: the first issue is version 1's publication — who and when
      ...firstIssueStamp(existing, definedPatch),
      ...definedPatch,
      ...(staleDescription ? { descriptionByLang: undefined } : {}),
      ...(staleHeading.jobName ? { jobNameByLang: undefined } : {}),
      ...(staleHeading.summary ? { summaryByLang: undefined } : {}),
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  /** REQ-334 (demo-loop cycle 1, M25): the inverse of the lock stamp — drop
   *  `lockedAt` so a locked-but-unsent quote is a plain draft again.
   *  `update` ignores undefined, so this is its own write. */
  async unlock(id: string, userId: string): Promise<Quote> {
    const existing = await this.getOwned(id, userId);
    const { lockedAt: _lockedAt, ...rest } = existing;
    const updated: Quote = { ...rest, updatedAt: new Date().toISOString() };
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

/**
 * REQ-659 (demo-loop cycle 5, m53 / M14) — the one gate every write of a
 * quote's job details passes (chat create/update tools, the polish step, the
 * quick quote, "use what I wrote", PUT /quotes): the sentences and lines that
 * name a money amount or the contractor's private pricing (a markup, a rate,
 * a sub's or a material's cost) are dropped from `description` and from every
 * `descriptionByLang` copy. The price lives in the line items (REQ-261).
 * Returns a copy; fields the record does not carry stay absent.
 */
function withoutPrivatePricing<T extends object>(rec: T): T {
  const out = { ...rec } as Record<string, unknown>;
  if (typeof out.description === "string") {
    out.description = withoutMoneySentences(out.description);
  }
  const byLang = out.descriptionByLang;
  if (byLang && typeof byLang === "object") {
    out.descriptionByLang = Object.fromEntries(
      Object.entries(byLang as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === "string" ? withoutMoneySentences(v) : v,
      ]),
    );
  }
  return out as unknown as T;
}

/** REQ-460: the agreement fields a signed quote never changes again. */
const SIGNED_FIELDS = ["terms", "lineItems", "estimatedTotal"] as const;

/**
 * REQ-460 (demo-loop cycle 3, B1) — the last gate on the write path for a
 * SIGNED quote (REQ-202): a patch that would change its terms, its lines or
 * its total is refused, whoever the caller is. In the demo the terms wizard
 * wrote "Deposit + balance" onto an agreement the customer had already signed.
 * What is not the agreement still lands: stamps, delivery, a line's cached
 * translations (`descriptionByLang`), a rewrite of the values already there.
 */
function assertNotSigned(existing: Quote, patch: Partial<Quote>): void {
  if (!isQuoteLocked(existing)) return;
  const changed = SIGNED_FIELDS.filter((f) =>
    patch[f] !== undefined &&
    agreementValue(f, patch[f]) !== agreementValue(f, existing[f])
  );
  if (changed.length) throw new QuoteSignedError(changed);
}

/** A field's agreement content, comparable: lines without their cached translations. */
function agreementValue(field: string, value: unknown): string {
  if (field === "lineItems" && Array.isArray(value)) {
    return JSON.stringify(
      value.map((l) => ({
        description: l?.description,
        quantity: l?.quantity,
        unit: l?.unit,
        price: l?.price,
      })),
    );
  }
  if (field === "terms" && Array.isArray(value)) {
    return JSON.stringify(
      value.map((t) => ({
        stepId: t?.stepId,
        label: t?.label,
        value: t?.value,
      })),
    );
  }
  return JSON.stringify(value ?? null);
}

/**
 * REQ-302 (demo-loop cycle 1, B1 + M29) — the last gate on the write path: a
 * negative line, or an estimatedTotal at or below zero, never reaches KV,
 * whoever the caller is (chat coordinator, API, wizard). Judges only the
 * fields present: `lineItems` for the sign, `estimatedTotal` for the zero.
 */
function assertQuotePriced(
  fields: { lineItems?: Quote["lineItems"]; estimatedTotal?: number },
): void {
  const lines = fields.lineItems;
  if (lines) {
    const problem = storedQuotePriceProblem({
      lineItems: lines,
      // without an explicit total the sum of the lines is not judged here —
      // callers that persist lines without a total (an unpriced wizard
      // draft) are allowed; the total is judged when it is written
      estimatedTotal: typeof fields.estimatedTotal === "number"
        ? fields.estimatedTotal
        : 1,
    });
    if (problem) {
      throw new QuotePriceError(problem, `quote: ${problem}`);
    }
  } else if (
    typeof fields.estimatedTotal === "number" && !(fields.estimatedTotal > 0)
  ) {
    throw new QuotePriceError("no_total", "quote: no_total");
  }
}
