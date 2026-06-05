import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";

/**
 * WipeAccount — irreversibly delete EVERY KV entry belonging to one user.
 *
 * This is deliberately store-agnostic: instead of wiring in all ~25 domain
 * stores (and silently missing whatever store gets added next quarter), it
 * sweeps the whole keyspace once and deletes anything that belongs to the
 * target user. An entry belongs to the user when ANY of these hold:
 *
 *   1. the userId appears as a segment of the KV key
 *      — covers `["user", userId]` and every `[*_by_user, userId, …]` index;
 *   2. the stored value is an object with `userId === target`
 *      — covers every primary record (invoice, quote, customer, session, …);
 *   3. the stored value IS the userId string
 *      — covers the `["user_by_phone", phone] → userId` reverse index.
 *
 * A second pass catches records that reference the user's data but carry no
 * userId of their own — specifically paperwork `view` open-events, which are
 * keyed by the quote/contract/invoice id they belong to. Any entry whose
 * `paperworkId` (or quote/invoice/contract id) points at a now-deleted record
 * is swept too, so no orphaned analytics survive the wipe.
 *
 * Deletes run in atomic batches (Deno KV caps a transaction at 1000 mutations).
 */
@Injectable()
export class WipeAccount {
  async run(userId: string): Promise<{ ok: true; deleted: number }> {
    const kv = await getKv();

    // Buffer the whole keyspace once. Dev/single-tenant KV is small; this keeps
    // the two-pass logic simple and avoids re-scanning the stream.
    const all: { key: Deno.KvKey; value: unknown }[] = [];
    for await (const e of kv.list({ prefix: [] })) {
      all.push({ key: e.key, value: e.value });
    }

    const toDelete: Deno.KvKey[] = [];
    const ownedIds = new Set<string>([userId]);

    // Pass 1 — direct ownership.
    const deferred: { key: Deno.KvKey; value: Record<string, unknown> }[] = [];
    for (const { key, value } of all) {
      const keyOwned = key.some((seg) => seg === userId);
      const isObj = value !== null && typeof value === "object";
      const valueOwned = isObj &&
        (value as Record<string, unknown>).userId === userId;
      const valueIsId = value === userId;

      if (keyOwned || valueOwned || valueIsId) {
        toDelete.push(key);
        if (isObj) {
          const id = (value as Record<string, unknown>).id;
          if (typeof id === "string") ownedIds.add(id);
        }
      } else if (isObj) {
        deferred.push({ key, value: value as Record<string, unknown> });
      }
    }

    // Pass 2 — records with no userId that reference an owned resource id.
    for (const { key, value } of deferred) {
      const ref = value.paperworkId ?? value.quoteId ?? value.invoiceId ??
        value.contractId;
      if (typeof ref === "string" && ownedIds.has(ref)) toDelete.push(key);
    }

    // Delete in atomic batches (stay well under the 1000-op transaction cap).
    const BATCH = 500;
    for (let i = 0; i < toDelete.length; i += BATCH) {
      let atomic = kv.atomic();
      for (const k of toDelete.slice(i, i + BATCH)) atomic = atomic.delete(k);
      await atomic.commit();
    }

    return { ok: true, deleted: toDelete.length };
  }
}
