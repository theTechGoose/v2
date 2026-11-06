/**
 * numbered-store — what every numbered, versioned document store shares
 * (REQ-198/200/201/204): the create that takes the next number atomically
 * (and answers a retried request with the document it already made), the
 * publish that files the replaced version, and the customer snapshot.
 */
import { getKv } from "@core/data/kv/mod.ts";
import {
  AllocationRefused,
  DocNumbering,
  IDEM_PREFIX,
} from "@core/data/doc-numbering/mod.ts";
import type { DocKind } from "#documents/numbering.ts";
import {
  applyRevision,
  type DocVersionRecord,
  versionOf,
} from "#documents/versions.ts";

/** ["doc_version", kind, id, version] → the filed version. */
export const VERSION_PREFIX = "doc_version";

/** The fields every numbered document carries (REQ-198/201). */
export interface NumberedFields {
  /** "INV-001" — assigned at creation, never changed, never reused. */
  number?: string;
  /** the number's integer, for ordering */
  seq?: number;
  /** 1 at creation; +1 per published revision */
  version?: number;
  publishedAt?: string;
  publishedBy?: DocVersionRecord["publishedBy"];
  /** edits to an issued document waiting to be published */
  pendingRevision?: Record<string, unknown>;
  /** the customer as they were when the document was created / last published (REQ-204) */
  customerSnapshot?: CustomerSnapshot;
}

export interface CustomerSnapshot {
  name?: string;
  businessName?: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
  /** the customer's own number ("C-001") */
  number?: string;
}

/** The customer on file, as a snapshot — undefined when there is none / the owner differs. */
export async function snapshotCustomer(
  customerId: string | undefined,
  ownerId: string,
): Promise<CustomerSnapshot | undefined> {
  if (!customerId) return undefined;
  const kv = await getKv();
  const c =
    (await kv.get<Record<string, unknown>>(["customer", customerId])).value;
  if (!c || c.userId !== ownerId) return undefined;
  const pick = (
    k: string,
  ) => (typeof c[k] === "string" && (c[k] as string).trim()
    ? c[k] as string
    : undefined);
  const snap: CustomerSnapshot = {
    ...(pick("name") ? { name: pick("name") } : {}),
    ...(pick("businessName") ? { businessName: pick("businessName") } : {}),
    ...(pick("email") ? { email: pick("email") } : {}),
    ...(pick("phoneNumber") ? { phoneNumber: pick("phoneNumber") } : {}),
    ...(pick("address") ? { address: pick("address") } : {}),
    ...(pick("number") ? { number: pick("number") } : {}),
  };
  return Object.keys(snap).length ? snap : undefined;
}

export interface CreateNumberedOpts {
  /** REQ-200: a retried request with the same id gets the first document back */
  requestId?: string;
}

/**
 * Take the next number of `kind` for `userId` and store `record` under
 * [prefix, id] + [indexPrefix, userId, id] in the same transaction. With a
 * requestId, the create is idempotent per (user, kind, requestId).
 */
export async function createNumbered<
  T extends { id: string; userId: string } & NumberedFields,
>(
  numbering: DocNumbering,
  args: {
    userId: string;
    kind: DocKind;
    prefix: string;
    indexPrefix: string;
    record: T;
    extraWrites?: (
      atomic: Deno.AtomicOperation,
      record: T,
    ) => Deno.AtomicOperation;
  },
  opts: CreateNumberedOpts = {},
): Promise<T> {
  const kv = await getKv();
  const idemKey: Deno.KvKey | null = opts.requestId
    ? [IDEM_PREFIX, args.userId, args.kind, opts.requestId]
    : null;
  if (idemKey) {
    const seen = await kv.get<string>(idemKey);
    if (seen.value) {
      return (await kv.get<T>([args.prefix, seen.value])).value as T;
    }
  }
  let stored: T = args.record;
  try {
    await numbering.allocate(args.userId, args.kind, (atomic, allocation) => {
      stored = {
        ...args.record,
        number: allocation.number,
        seq: allocation.seq,
        version: versionOf(args.record),
      };
      let op = atomic
        .set([args.prefix, stored.id], stored)
        .set([args.indexPrefix, args.userId, stored.id], stored.id);
      if (idemKey) {
        op = op.check({ key: idemKey, versionstamp: null }).set(
          idemKey,
          stored.id,
        );
      }
      if (args.extraWrites) op = args.extraWrites(op, stored);
      return op;
    });
    return stored;
  } catch (err) {
    if (err instanceof AllocationRefused && idemKey) {
      const seen = await kv.get<string>(idemKey);
      if (seen.value) {
        return (await kv.get<T>([args.prefix, seen.value])).value as T;
      }
    }
    throw err;
  }
}

/**
 * Publish a revision (REQ-201): file the live version, apply the patch,
 * advance the version, refresh the customer snapshot. Compare-and-set on
 * the record so two publishes cannot both advance from the same version.
 */
export async function publishNumbered<
  T extends
    & { id: string; userId: string; customerId?: string }
    & NumberedFields,
>(
  args: {
    kind: DocKind;
    prefix: string;
    id: string;
    patch: Record<string, unknown>;
    by: DocVersionRecord["publishedBy"];
    read: () => Promise<T>;
    /** anything to do to the next record before it is written (totals, balances) */
    finish?: (next: T) => T | Promise<T>;
  },
): Promise<T> {
  const kv = await getKv();
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await args.read();
    const entry = await kv.get<T>([args.prefix, args.id]);
    const now = new Date().toISOString();
    const { next, filed } = applyRevision(
      current as T & Record<string, unknown>,
      args.patch,
      args.by,
      now,
    );
    const customerSnapshot = await snapshotCustomer(
      next.customerId,
      next.userId,
    );
    let finished: T = {
      ...next,
      ...(customerSnapshot ? { customerSnapshot } : {}),
    };
    if (args.finish) finished = await args.finish(finished);
    const result = await kv.atomic()
      .check(entry)
      .set([args.prefix, args.id], finished)
      .set([VERSION_PREFIX, args.kind, args.id, filed.version], filed)
      .commit();
    if (result.ok) return finished;
  }
  throw new Error(`publish: ${args.kind} ${args.id} kept changing underneath`);
}

/** The filed versions of a document, oldest first (the live record is the current version). */
export async function listNumberedVersions(
  kind: DocKind,
  id: string,
): Promise<DocVersionRecord[]> {
  const kv = await getKv();
  const out: DocVersionRecord[] = [];
  for await (
    const e of kv.list<DocVersionRecord>({ prefix: [VERSION_PREFIX, kind, id] })
  ) {
    out.push(e.value);
  }
  return out.sort((a, b) => a.version - b.version);
}
