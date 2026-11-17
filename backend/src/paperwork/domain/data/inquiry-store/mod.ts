/**
 * REQ-701 (demo-loop cycle 5, issue M21) — the questions clients send from
 * the public quote page ("Ask a question", POST /quotes/:id/inquiry).
 *
 * Before this the question lived only in a notification row and the alert
 * email/text: the quote panel the notice opened had nothing to show and
 * nothing to answer from ("Linda's question text is NOWHERE on that panel,
 * no reply box"). Each question is its own record — never a field on the
 * quote row, whose writes (edits, revisions, the signed lock) it must not
 * race — keyed under its quote, owned by the contractor:
 *
 *   ["quote_inquiry", quoteId, id]         → QuoteInquiry (userId on it)
 *   ["quote_inquiry_by_user", userId, id]  → quoteId (the owner's index)
 *
 * The account wipe (WipeAccount) takes both: the value carries the userId,
 * the index key holds it. The public page never reads this store.
 */
import { Injectable } from "#danet/core";
import { getKv, readMany } from "@core/data/kv/mod.ts";

const PREFIX = "quote_inquiry";
const BY_USER = "quote_inquiry_by_user";

/** What the contractor answered, from the quote panel (ReplyToInquiry). */
export interface QuoteInquiryAnswer {
  channel: "text" | "email";
  /** the E.164 number or email address it went to */
  to: string;
  message: string;
  at: string;
}

export interface QuoteInquiry {
  id: string;
  quoteId: string;
  /** the contractor who owns the quote */
  userId: string;
  /** the quote's customer when the question came in */
  customerId?: string;
  /** the client's question, verbatim (trimmed) */
  question: string;
  /** how the client asked to be reached back — free text (a phone, an email) */
  contactBack?: string;
  /** the name the client typed on the form */
  name?: string;
  /** the language of the page the client asked from */
  lang?: "en" | "es";
  createdAt: string;
  /** set once the contractor answered from the app */
  answeredAt?: string;
  answer?: QuoteInquiryAnswer;
}

export interface NewQuoteInquiry {
  quoteId: string;
  userId: string;
  customerId?: string;
  question: string;
  contactBack?: string;
  name?: string;
  lang?: string;
}

/** Caps: a question is a message, not a document; a name is a name. */
const MAX_QUESTION = 2000;
const MAX_CONTACT = 200;
const MAX_NAME = 120;

function clip(raw: string | undefined, max: number): string | undefined {
  const s = raw?.trim();
  return s ? s.slice(0, max) : undefined;
}

const newestFirst = (a: QuoteInquiry, b: QuoteInquiry) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

@Injectable()
export class QuoteInquiryStore {
  /** A public form can be sent again and again; one quote keeps at most this
   *  many questions (the alert and the notification still fire past it). */
  static readonly MAX_PER_QUOTE = 50;

  /** Store a client's question. Null when there is nothing to store (a blank
   *  question) or the quote already holds MAX_PER_QUOTE. */
  async create(input: NewQuoteInquiry): Promise<QuoteInquiry | null> {
    const question = clip(input.question, MAX_QUESTION);
    if (!question) return null;
    const kv = await getKv();
    let held = 0;
    for await (const _ of kv.list({ prefix: [PREFIX, input.quoteId] })) {
      if (++held >= QuoteInquiryStore.MAX_PER_QUOTE) return null;
    }
    const contactBack = clip(input.contactBack, MAX_CONTACT);
    const name = clip(input.name, MAX_NAME);
    const lang = input.lang === "en" || input.lang === "es"
      ? input.lang
      : undefined;
    const row: QuoteInquiry = {
      id: crypto.randomUUID(),
      quoteId: input.quoteId,
      userId: input.userId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      question,
      ...(contactBack ? { contactBack } : {}),
      ...(name ? { name } : {}),
      ...(lang ? { lang } : {}),
      createdAt: new Date().toISOString(),
    };
    const res = await kv.atomic()
      .set([PREFIX, row.quoteId, row.id], row)
      .set([BY_USER, row.userId, row.id], row.quoteId)
      .commit();
    if (!res.ok) throw new Error(`quote inquiry ${row.id}: write refused`);
    return row;
  }

  /** A quote's questions, newest first. */
  async listByQuote(quoteId: string): Promise<QuoteInquiry[]> {
    const kv = await getKv();
    const out: QuoteInquiry[] = [];
    for await (
      const e of kv.list<QuoteInquiry>({ prefix: [PREFIX, quoteId] })
    ) out.push(e.value);
    return out.sort(newestFirst);
  }

  async get(quoteId: string, id: string): Promise<QuoteInquiry | null> {
    const kv = await getKv();
    return (await kv.get<QuoteInquiry>([PREFIX, quoteId, id])).value ?? null;
  }

  /** The owner's questions not answered from the app yet, newest first. */
  async listOpenByUser(userId: string): Promise<QuoteInquiry[]> {
    const kv = await getKv();
    const keys: Deno.KvKey[] = [];
    for await (const e of kv.list<string>({ prefix: [BY_USER, userId] })) {
      keys.push([PREFIX, e.value, e.key[2] as string]);
    }
    const rows = await readMany<QuoteInquiry>(kv, keys);
    return rows
      .filter((r): r is QuoteInquiry =>
        !!r && r.userId === userId && !r.answeredAt
      )
      .sort(newestFirst);
  }

  /** Record the contractor's answer (compare-and-set on the record). */
  async markAnswered(
    quoteId: string,
    id: string,
    answer: Omit<QuoteInquiryAnswer, "at">,
  ): Promise<QuoteInquiry> {
    const kv = await getKv();
    for (let attempt = 0; attempt < 10; attempt++) {
      const entry = await kv.get<QuoteInquiry>([PREFIX, quoteId, id]);
      if (!entry.value) throw new Error(`quote inquiry ${id}: not found`);
      const at = new Date().toISOString();
      const updated: QuoteInquiry = {
        ...entry.value,
        answeredAt: at,
        answer: { ...answer, at },
      };
      const res = await kv.atomic().check(entry).set(entry.key, updated)
        .commit();
      if (res.ok) return updated;
    }
    throw new Error(`quote inquiry ${id}: answer kept losing the race`);
  }
}
