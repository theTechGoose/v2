import { Injectable } from "#danet/core";
import { getKv, indexedIds, readMany } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import { DocNumbering } from "@core/data/doc-numbering/mod.ts";
import {
  createNumbered,
  type CreateNumberedOpts,
} from "@core/data/numbered-store/mod.ts";
import type {
  CreateCustomerDto,
  Customer,
  UpdateCustomerDto,
} from "@crm/dto/customer.ts";
import { addressWrite } from "@crm/domain/business/customer-address/mod.ts"; // REQ-625
import { versionOf } from "#documents/versions.ts"; // REQ-1144

const PREFIX = "customer";

/** compare-and-set retries before an unversioned edit gives up (REQ-1144) */
const MAX_CAS_ATTEMPTS = 5;

/**
 * REQ-1144 (LOOP-007 q3, q3-74): an edit made on a version the customer has
 * moved past. Carries the current record so the caller can show it — the
 * controller answers 409 `{ error: "stale_version", currentVersion, customer }`.
 */
export class StaleCustomerVersionError extends Error {
  readonly status: number = 409;
  constructor(public current: Customer) {
    super(`customer ${current.id} is at version ${versionOf(current)}`);
    this.name = "StaleCustomerVersionError";
  }
}
const INDEX_PREFIX = "customer_by_user"; // [INDEX_PREFIX, userId, customerId] → customerId

/**
 * CustomerStore — per-user customer records.
 *
 * Storage:
 *   ["customer", customerId]                    → Customer (carries userId)
 *   ["customer_by_user", userId, customerId]    → customerId  (cheap listByUser)
 *
 * Every write is atomic across the record + the user-scoped index, so
 * `listByUser` never sees ghosts after a delete or owner-mismatched
 * records (the index is only ever written under the rightful userId).
 *
 * `getOwned(id, userId)` is the canonical read path for controllers:
 *   - missing record → NotFoundError
 *   - owned by someone else → ForbiddenError
 *   - owned → returns Customer
 *
 * Use `get(id)` only inside admin/internal flows where ownership is
 * enforced separately (e.g. customer-facing /public endpoints that look
 * up the resource by id directly without a session).
 */
@Injectable()
export class CustomerStore {
  constructor(private numbering: DocNumbering = new DocNumbering()) {}

  async create(
    userId: string,
    input: CreateCustomerDto,
    opts: CreateNumberedOpts = {},
  ): Promise<Customer> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const customer: Customer = {
      ...input,
      ...addressWrite(undefined, input), // REQ-625: parts → the composed address
      id,
      userId,
      createdAt: now,
      updatedAt: now,
    };
    // REQ-198/200: the next C- number, in the same transaction as the row.
    const stored = await createNumbered<Customer & { version?: number }>(
      this.numbering,
      {
        userId,
        kind: "customer",
        prefix: PREFIX,
        indexPrefix: INDEX_PREFIX,
        record: customer,
      },
      opts,
    );
    const { version: _v, ...out } = stored;
    return out;
  }

  /** REQ-039 (NW-52): a deleted customer reads as not-found unless the
   *  caller asks for it (`includeDeleted`) — the row is never erased. */
  async get(
    id: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<Customer> {
    const kv = await getKv();
    const result = await kv.get<Customer>([PREFIX, id]);
    if (!result.value || (result.value.deletedAt && !opts.includeDeleted)) {
      throw new NotFoundError(PREFIX, id);
    }
    return result.value;
  }

  async getOwned(
    id: string,
    userId: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<Customer> {
    const customer = await this.get(id, opts);
    if (customer.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return customer;
  }

  async listByUser(userId: string): Promise<Customer[]> {
    const kv = await getKv();
    const ids = await indexedIds(kv, [INDEX_PREFIX, userId]); // REQ-134 — read in batches
    const recs = await readMany<Customer>(kv, ids.map((id) => [PREFIX, id]));
    return recs.filter((c): c is Customer => !!c && !c.deletedAt);
  }

  /**
   * REQ-625 edit. REQ-1144 (LOOP-007 q3, q3-74): every edit bumps `version`
   * and is written compare-and-set on the row's versionstamp, so two saves
   * can never both land on the same version. A patch carrying `version` that
   * is not the stored one is refused with StaleCustomerVersionError (the
   * stale form would put back values someone else changed). A patch without
   * `version` (a one-field change: the language picker, a rename) applies to
   * whatever is current, retrying if a concurrent edit got there first.
   */
  async update(
    id: string,
    userId: string,
    patch: UpdateCustomerDto,
  ): Promise<Customer> {
    const { version: expected, ...fields } = patch;
    const definedPatch = Object.fromEntries(
      Object.entries(fields).filter(([_, v]) => v !== undefined),
    );
    const kv = await getKv();
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const entry = await kv.get<Customer>([PREFIX, id]);
      const existing = entry.value;
      if (!existing || existing.deletedAt) throw new NotFoundError(PREFIX, id);
      if (existing.userId !== userId) throw new ForbiddenError(PREFIX, id);
      const current = versionOf(existing);
      if (expected !== undefined && expected !== current) {
        throw new StaleCustomerVersionError(existing);
      }
      const updated: Customer = {
        ...existing,
        ...definedPatch,
        ...addressWrite(existing, fields), // REQ-625: recompose from the merged parts
        id: existing.id,
        userId: existing.userId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        version: current + 1,
      };
      // REQ-715: "" (or null) clears the customer's language — the field is
      // gone, never a stored ""
      if (!updated.language) delete updated.language;
      const res = await kv.atomic()
        .check({ key: [PREFIX, id], versionstamp: entry.versionstamp })
        .set([PREFIX, id], updated)
        .commit();
      if (res.ok) return updated;
      // someone else saved in between: a versioned edit re-reads and is
      // refused above; an unversioned one re-applies on the newer record
    }
    throw new StaleCustomerVersionError(await this.getOwned(id, userId));
  }

  /** REQ-039 (NW-52): soft delete — flagged, never erased. */
  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.getOwned(id, userId);
    const now = new Date().toISOString();
    const kv = await getKv();
    await kv.set([PREFIX, id], { ...existing, deletedAt: now, updatedAt: now });
  }
}
