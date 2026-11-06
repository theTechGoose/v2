import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import {
  DOC_KINDS,
  type DocKind,
  formatAccountNumber,
  formatDocNumber,
  type NumberingStarts,
  startFor,
} from "#documents/numbering.ts";
import { NUMBERING_PREFIX } from "@users/dto/numbering.ts";

/** ["doc_seq", userId, kind] → the counter; `next` is the number the next document gets. */
export const SEQ_PREFIX = "doc_seq";
/** ["account_seq"] → the global account counter; ["account_number", userId] → the account's number. */
const ACCOUNT_SEQ_KEY: Deno.KvKey = ["account_seq"];
const ACCOUNT_NUMBER_PREFIX = "account_number";
/** ["idem", userId, kind, key] → the id the request created (REQ-200). */
export const IDEM_PREFIX = "idem";

export interface SeqCounter {
  next: number;
  /** when the first number was issued — from then on the start is locked */
  firstIssuedAt: string;
  lastIssuedAt: string;
}

export interface Allocation {
  seq: number;
  number: string;
}

/** How many times a CAS commit is retried under contention before giving up. */
const MAX_ATTEMPTS = 200;

/**
 * In-process serialization per (account, kind): concurrent creates in one
 * isolate (a batch import, parallel requests) queue here instead of all
 * racing the compare-and-set, which then only has to settle cross-isolate
 * contention. Module-level so every DocNumbering instance shares it.
 */
const lanes = new Map<string, Promise<unknown>>();
async function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = lanes.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(work);
  lanes.set(key, run);
  try {
    return await run;
  } finally {
    if (lanes.get(key) === run) lanes.delete(key);
  }
}

/**
 * DocNumbering — the per-account document counters (REQ-198/199/200).
 *
 * `allocate` hands out the next number of a kind AND commits the caller's
 * writes in the same atomic transaction: the counter entry is checked
 * (compare-and-set), so two concurrent creates can never both take the
 * same number, and a record is never stored without its number having been
 * consumed. A failed commit (someone else moved the counter) is retried
 * with a fresh read; a commit the caller's own check refuses rejects.
 */
@Injectable()
export class DocNumbering {
  allocate(
    userId: string,
    kind: DocKind,
    writes: (
      atomic: Deno.AtomicOperation,
      allocation: Allocation,
    ) => Deno.AtomicOperation,
    maxAttempts = MAX_ATTEMPTS,
  ): Promise<Allocation> {
    return serialized(
      `${userId}/${kind}`,
      () => this.allocateNow(userId, kind, writes, maxAttempts),
    );
  }

  private async allocateNow(
    userId: string,
    kind: DocKind,
    writes: (
      atomic: Deno.AtomicOperation,
      allocation: Allocation,
    ) => Deno.AtomicOperation,
    maxAttempts: number,
  ): Promise<Allocation> {
    const kv = await getKv();
    const settings = await this.settings(userId);
    const key: Deno.KvKey = [SEQ_PREFIX, userId, kind];
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const entry = await kv.get<SeqCounter>(key);
      const seq = entry.value?.next ?? startFor(settings, kind);
      const now = new Date().toISOString();
      const counter: SeqCounter = {
        next: seq + 1,
        firstIssuedAt: entry.value?.firstIssuedAt ?? now,
        lastIssuedAt: now,
      };
      const allocation: Allocation = {
        seq,
        number: formatDocNumber(kind, seq),
      };
      const atomic = writes(
        kv.atomic().check(entry).set(key, counter),
        allocation,
      );
      const result = await atomic.commit();
      if (result.ok) return allocation;
      // Either the counter moved under us (retry) or the caller's own check
      // refused (the caller decides: see createIdempotent in the stores).
      const again = await kv.get<SeqCounter>(key);
      if (again.versionstamp === entry.versionstamp) {
        throw new AllocationRefused(kind, allocation);
      }
      // another isolate moved the counter: back off a little before re-reading
      if (attempt > 2) {
        await new Promise((r) => setTimeout(r, Math.min(50, attempt * 2)));
      }
    }
    throw new Error(
      `doc numbering: could not allocate a ${kind} number for ${userId} after ${maxAttempts} attempts`,
    );
  }

  /** The number the next document of `kind` will get, without issuing it. */
  async peek(userId: string, kind: DocKind): Promise<Allocation> {
    const kv = await getKv();
    const [entry, settings] = await Promise.all([
      kv.get<SeqCounter>([SEQ_PREFIX, userId, kind]),
      this.settings(userId),
    ]);
    const seq = entry.value?.next ?? startFor(settings, kind);
    return { seq, number: formatDocNumber(kind, seq) };
  }

  /** True once the first number of `kind` was issued — the start is then locked. */
  async hasIssued(userId: string, kind: DocKind): Promise<boolean> {
    const kv = await getKv();
    return (await kv.get<SeqCounter>([SEQ_PREFIX, userId, kind])).value !==
      null;
  }

  async issuedMap(userId: string): Promise<Record<DocKind, boolean>> {
    const out = {} as Record<DocKind, boolean>;
    for (const kind of DOC_KINDS) {
      out[kind] = await this.hasIssued(userId, kind);
    }
    return out;
  }

  async nextMap(userId: string): Promise<Record<DocKind, string>> {
    const out = {} as Record<DocKind, string>;
    for (const kind of DOC_KINDS) {
      out[kind] = (await this.peek(userId, kind)).number;
    }
    return out;
  }

  /** REQ-199: a setup reset — every sequence of the account restarts at its (settable again) start. */
  async resetSequences(userId: string): Promise<void> {
    const kv = await getKv();
    let atomic = kv.atomic();
    for (const kind of DOC_KINDS) {
      atomic = atomic.delete([SEQ_PREFIX, userId, kind]);
    }
    for await (const e of kv.list({ prefix: [IDEM_PREFIX, userId] })) {
      atomic = atomic.delete(e.key);
    }
    await atomic.commit();
  }

  /**
   * REQ-198: the account's own number — assigned the first time it is asked
   * for, from one global counter, and never changed after. Concurrent first
   * asks race on the per-account key, so exactly one assignment wins.
   */
  accountNumber(userId: string): Promise<string> {
    return serialized(`account/${userId}`, () => this.accountNumberNow(userId));
  }

  private async accountNumberNow(userId: string): Promise<string> {
    const kv = await getKv();
    const key: Deno.KvKey = [ACCOUNT_NUMBER_PREFIX, userId];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const existing = await kv.get<string>(key);
      if (existing.value) return existing.value;
      const counter = await kv.get<number>(ACCOUNT_SEQ_KEY);
      const seq = (counter.value ?? 0) + 1;
      const number = formatAccountNumber(seq);
      const result = await kv.atomic()
        .check(existing)
        .check(counter)
        .set(ACCOUNT_SEQ_KEY, seq)
        .set(key, number)
        .commit();
      if (result.ok) return number;
    }
    throw new Error(
      `doc numbering: could not assign an account number to ${userId}`,
    );
  }

  private async settings(userId: string): Promise<NumberingStarts | null> {
    const kv = await getKv();
    return (await kv.get<NumberingStarts>([NUMBERING_PREFIX, userId])).value;
  }
}

/** The caller's own atomic check refused the commit (the counter had not moved). */
export class AllocationRefused extends Error {
  constructor(readonly kind: DocKind, readonly allocation: Allocation) {
    super(`doc numbering: the ${kind} write was refused by its own check`);
    this.name = "AllocationRefused";
  }
}
