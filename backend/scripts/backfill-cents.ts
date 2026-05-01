/**
 * One-shot backfill: legacy KV rows persisted dollar-shaped money values
 * (e.g. estimatedTotal: 350 for a $350 quote) before the cents migration
 * landed. The new fmtMoney(cents) divides by 100 → renders "$3.50" for
 * any pre-migration row. This script multiplies the affected fields ×
 * 100 and stamps `_centsMigrated: true` so reruns are no-ops.
 *
 * Run:  deno run -A --unstable-kv backend/scripts/backfill-cents.ts
 *       --env-file=.env if KV_PATH lives there.
 *
 * Flags: --dry-run logs without writing; --verbose prints every row.
 *
 * Fields touched (others stay untouched by design):
 *   Quote.estimatedTotal, Quote.lineItems[].price
 *   Contract.totalAmount
 *   Invoice.amount
 *   Payment.amount
 */

interface Migrated { _centsMigrated?: boolean }
interface QuoteRow extends Migrated {
  id: string;
  estimatedTotal?: number;
  lineItems?: { price?: number; [k: string]: unknown }[];
  [k: string]: unknown;
}
interface ContractRow extends Migrated {
  id: string;
  totalAmount?: number;
  [k: string]: unknown;
}
interface InvoiceRow extends Migrated {
  id: string;
  amount?: number;
  [k: string]: unknown;
}
interface PaymentRow extends Migrated {
  id: string;
  amount?: number;
  [k: string]: unknown;
}

const args = new Set(Deno.args);
const DRY_RUN = args.has("--dry-run");
const VERBOSE = args.has("--verbose");

function log(msg: string): void {
  console.log(msg);
}

function vlog(msg: string): void {
  if (VERBOSE) console.log(msg);
}

const x100 = (n: number | undefined): number | undefined =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) : n;

async function migrateOne<T extends Migrated>(
  kv: Deno.Kv,
  prefix: string,
  transform: (row: T) => { row: T; touched: boolean },
): Promise<{ scanned: number; migrated: number; skipped: number }> {
  let scanned = 0, migrated = 0, skipped = 0;
  for await (const e of kv.list<T>({ prefix: [prefix] })) {
    scanned++;
    const row = e.value;
    if (!row || row._centsMigrated) {
      skipped++;
      continue;
    }
    const { row: next, touched } = transform(row);
    next._centsMigrated = true;
    if (DRY_RUN) {
      vlog(`[dry-run] ${prefix} ${(row as { id?: string }).id ?? "?"} touched=${touched}`);
    } else {
      await kv.set(e.key, next);
      vlog(`[write]   ${prefix} ${(row as { id?: string }).id ?? "?"} touched=${touched}`);
    }
    migrated++;
  }
  return { scanned, migrated, skipped };
}

async function main(): Promise<void> {
  const path = Deno.env.get("KV_PATH") ?? undefined;
  log(`opening KV (path=${path ?? "<default>"}) dry-run=${DRY_RUN}`);
  const kv = await Deno.openKv(path);

  const quotes = await migrateOne<QuoteRow>(kv, "quote", (q) => {
    let touched = false;
    if (typeof q.estimatedTotal === "number") {
      q.estimatedTotal = x100(q.estimatedTotal)!;
      touched = true;
    }
    if (Array.isArray(q.lineItems)) {
      q.lineItems = q.lineItems.map((li) => {
        if (typeof li.price === "number") {
          touched = true;
          return { ...li, price: x100(li.price)! };
        }
        return li;
      });
    }
    return { row: q, touched };
  });
  log(`quotes:    scanned=${quotes.scanned} migrated=${quotes.migrated} skipped=${quotes.skipped}`);

  const contracts = await migrateOne<ContractRow>(kv, "contract", (c) => {
    let touched = false;
    if (typeof c.totalAmount === "number") {
      c.totalAmount = x100(c.totalAmount)!;
      touched = true;
    }
    return { row: c, touched };
  });
  log(`contracts: scanned=${contracts.scanned} migrated=${contracts.migrated} skipped=${contracts.skipped}`);

  const invoices = await migrateOne<InvoiceRow>(kv, "invoice", (i) => {
    let touched = false;
    if (typeof i.amount === "number") {
      i.amount = x100(i.amount)!;
      touched = true;
    }
    return { row: i, touched };
  });
  log(`invoices:  scanned=${invoices.scanned} migrated=${invoices.migrated} skipped=${invoices.skipped}`);

  const payments = await migrateOne<PaymentRow>(kv, "payment", (p) => {
    let touched = false;
    if (typeof p.amount === "number") {
      p.amount = x100(p.amount)!;
      touched = true;
    }
    return { row: p, touched };
  });
  log(`payments:  scanned=${payments.scanned} migrated=${payments.migrated} skipped=${payments.skipped}`);

  kv.close();
  log(DRY_RUN ? "done (dry-run)" : "done");
}

if (import.meta.main) {
  await main();
}
