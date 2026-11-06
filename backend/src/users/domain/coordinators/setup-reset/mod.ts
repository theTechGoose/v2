import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { DocNumbering } from "@core/data/doc-numbering/mod.ts";

/**
 * SetupReset — REQ-199: "a setup reset can clear test records and restart
 * numbering before going live". Unlike WipeAccount (which deletes the
 * account itself), this keeps the ACCOUNT and everything that configures
 * it, and deletes everything that is a record made with it:
 *
 *   kept:    the user, its phone index, its sessions, every profile blob
 *            (identity, address, insurance, tax, defaults, references,
 *            numbering), the plan, the account's admins, feature flags;
 *   cleared: customers, quotes, invoices, payments, change orders, views,
 *            short links, conversations, messages, files, field data,
 *            notifications, the document counters and the create
 *            idempotency keys — anything else that belongs to the account.
 *
 * Same store-agnostic sweep as WipeAccount (a key segment, a `userId`
 * field, or a bare userId value marks ownership; a second pass catches
 * rows that only reference an owned document), minus the keep list.
 */
@Injectable()
export class SetupReset {
  constructor(private numbering: DocNumbering = new DocNumbering()) {}

  async run(userId: string): Promise<{ ok: true; deleted: number }> {
    const kv = await getKv();
    const all: { key: Deno.KvKey; value: unknown }[] = [];
    for await (const e of kv.list({ prefix: [] })) {
      all.push({ key: e.key, value: e.value });
    }

    const toDelete: Deno.KvKey[] = [];
    const ownedIds = new Set<string>([userId]);
    const deferred: { key: Deno.KvKey; value: Record<string, unknown> }[] = [];
    for (const { key, value } of all) {
      const keyOwned = key.some((seg) => seg === userId);
      const isObj = value !== null && typeof value === "object";
      const valueOwned = isObj &&
        (value as Record<string, unknown>).userId === userId;
      const valueIsId = value === userId;
      if (keyOwned || valueOwned || valueIsId) {
        if (isKept(key)) continue;
        toDelete.push(key);
        if (isObj) {
          const id = (value as Record<string, unknown>).id;
          if (typeof id === "string") ownedIds.add(id);
        }
      } else if (isObj) {
        deferred.push({ key, value: value as Record<string, unknown> });
      }
    }
    for (const { key, value } of deferred) {
      const ref = value.paperworkId ?? value.quoteId ?? value.invoiceId ??
        value.contractId;
      if (typeof ref === "string" && ownedIds.has(ref) && !isKept(key)) {
        toDelete.push(key);
      }
    }
    const BATCH = 500;
    for (let i = 0; i < toDelete.length; i += BATCH) {
      let atomic = kv.atomic();
      for (const k of toDelete.slice(i, i + BATCH)) atomic = atomic.delete(k);
      await atomic.commit();
    }
    // The counters are keyed by the user too and were swept above; this
    // also clears the idempotency keys, so the reset is complete on its own.
    await this.numbering.resetSequences(userId);
    return { ok: true, deleted: toDelete.length };
  }
}

/** Key families that configure the account rather than record work with it. */
const KEEP_EXACT = new Set([
  "user",
  "user_by_phone",
  "session",
  "session_by_user",
  "otp",
  "plan",
  "account_number",
  "account_admin",
  "account_admin_by_user",
  "account_admin_by_phone",
  "account_recovery",
  "payments_link",
  "user_feature",
]);

export function isKept(key: Deno.KvKey): boolean {
  const head = key[0];
  if (typeof head !== "string") return false;
  if (KEEP_EXACT.has(head)) return true;
  return head.startsWith("profile_") || head.startsWith("plan_") ||
    head.startsWith("account_admin") || head.startsWith("payments_link");
}
