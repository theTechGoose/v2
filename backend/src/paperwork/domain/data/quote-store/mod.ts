import { Injectable } from "#danet/core";
import { summarizeJobName } from "#quote-flow/job-name.ts";
import { getKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type {
  CreateQuoteDto,
  Quote,
  UpdateQuoteDto,
} from "@paperwork/dto/quote.ts";

const PREFIX = "quote";
const INDEX_PREFIX = "quote_by_user";

@Injectable()
export class QuoteStore {
  async create(
    userId: string,
    input: CreateQuoteDto,
    opts?: { jobNameLang?: "en" | "es" },
  ): Promise<Quote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const quote: Quote = { ...input, id, userId, createdAt: now, updatedAt: now };
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
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], quote)
      .set([INDEX_PREFIX, userId, id], id)
      .commit();
    return quote;
  }

  async get(id: string): Promise<Quote> {
    const kv = await getKv();
    const r = await kv.get<Quote>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<Quote> {
    const q = await this.get(id);
    if (q.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return q;
  }

  async listByUser(userId: string): Promise<Quote[]> {
    const kv = await getKv();
    const out: Quote[] = [];
    for await (const e of kv.list<string>({ prefix: [INDEX_PREFIX, userId] })) {
      const r = await kv.get<Quote>([PREFIX, e.value]);
      if (r.value) out.push(r.value);
    }
    return out;
  }

  /** Used by analytics + dashboard panels. Filters in-memory after the user-scoped fetch. */
  async listByUserAndStatus(userId: string, status: string): Promise<Quote[]> {
    const all = await this.listByUser(userId);
    return all.filter((q) => q.status === status);
  }

  async update(id: string, userId: string, patch: UpdateQuoteDto): Promise<Quote> {
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

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.getOwned(id, userId);
    const kv = await getKv();
    await kv.atomic()
      .delete([PREFIX, id])
      .delete([INDEX_PREFIX, existing.userId, id])
      .commit();
  }
}
