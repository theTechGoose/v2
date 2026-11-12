/**
 * REQ-398 (demo-loop cycle 2, M15 + m25) — the public change-order page
 * (/co/:id), pure.
 *
 * A change order adjusts ONE invoice, but the customer reads its numbers as
 * the job's. On a 50/50 job the +$850 order lands on INV-002 ($9,600), so the
 * page read "Current total $9,600 → New total $10,450" while the job went
 * $19,200 → $20,050. `changeOrderJobTotals` is the job side: the quote's
 * agreed total (REQ-205 ledger: quote total + approved change orders) before
 * and after THIS order.
 *
 * `changeOrderPreview` mirrors REQ-306's `internalPreview` for quotes: the
 * business's own viewer of a pending order previews it — no approve form —
 * unless the in-person override `?as=customer&confirm=1` is on.
 *
 * All amounts are INTEGER CENTS.
 */
import { type LedgerQuote, quoteTotalCents } from "../documents/ledger.ts";
import { hasSignOverride } from "./public-doc-state.ts";

export interface JobTotalsChangeOrder {
  id: string;
  status?: string;
  deltaAmountCents: number;
}

export interface ChangeOrderJobTotals {
  /** the job's agreed total without this order */
  beforeCents: number;
  /** the job's agreed total with this order */
  afterCents: number;
}

/** The job's agreed total before and after change order `coId`. Every OTHER
 *  approved order is part of the agreement; pending and declined ones are
 *  not. An approved `coId` is never counted twice. */
export function changeOrderJobTotals(
  quote: LedgerQuote,
  changeOrders: readonly JobTotalsChangeOrder[],
  coId: string,
): ChangeOrderJobTotals {
  const others = changeOrders
    .filter((c) => c.id !== coId && c.status === "approved")
    .reduce((s, c) => s + Math.round(c.deltaAmountCents), 0);
  const beforeCents = Math.max(0, quoteTotalCents(quote) + others);
  const self = changeOrders.find((c) => c.id === coId);
  const afterCents = Math.max(
    0,
    beforeCents + Math.round(self?.deltaAmountCents ?? 0),
  );
  return { beforeCents, afterCents };
}

/** True when the page shows the "Preview — approving is disabled" banner in
 *  place of the approve form. */
export function changeOrderPreview(
  payload: { internal?: boolean; status?: string },
  search: string | undefined | null,
): boolean {
  if (payload.internal !== true) return false;
  if (payload.status !== "pending") return false;
  return !hasSignOverride(search);
}

/** REQ-685 (demo-loop cycle 5, m42): what a change order's version changed
 *  against the filed one before it — only the fields that moved. */
export interface ChangeOrderChanges {
  description?: { from: string; to: string };
  deltaAmountCents?: { from: number; to: number };
}

interface ChangeOrderContent {
  description?: unknown;
  deltaAmountCents?: unknown;
}

/** REQ-685: compare the previous version's content with the live order;
 *  undefined when there is no previous version or nothing a customer reads
 *  moved. */
export function changeOrderChanges(
  before: ChangeOrderContent | null | undefined,
  after: ChangeOrderContent | null | undefined,
): ChangeOrderChanges | undefined {
  if (!before || !after) return undefined;
  const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
  const cents = (v: unknown) => typeof v === "number" ? Math.round(v) : 0;
  const out: ChangeOrderChanges = {};
  if (text(before.description) !== text(after.description)) {
    out.description = {
      from: text(before.description),
      to: text(after.description),
    };
  }
  if (cents(before.deltaAmountCents) !== cents(after.deltaAmountCents)) {
    out.deltaAmountCents = {
      from: cents(before.deltaAmountCents),
      to: cents(after.deltaAmountCents),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

const CO_CHANGE_WORDS = {
  en: { amount: "Amount", description: "Description" },
  es: { amount: "Monto", description: "Descripción" },
} as const;

function signedUsd(cents: number): string {
  const abs = (Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${cents < 0 ? "−" : "+"}$${abs}`;
}

function clipPhrase(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > 40 ? `${one.slice(0, 37).trimEnd()}…` : one;
}

/** REQ-685: "Amount +$1,600.00 → +$1,800.00 · Description: “a” → “b”" —
 *  the {changes} of public.doc.whatChanged on /co; "" when nothing moved. */
export function changeOrderChangeLine(
  c: ChangeOrderChanges,
  lang: "en" | "es" = "en",
): string {
  const w = CO_CHANGE_WORDS[lang === "es" ? "es" : "en"];
  const parts: string[] = [];
  if (c.deltaAmountCents) {
    parts.push(
      `${w.amount} ${signedUsd(c.deltaAmountCents.from)} → ${
        signedUsd(c.deltaAmountCents.to)
      }`,
    );
  }
  if (c.description) {
    parts.push(
      `${w.description}: “${clipPhrase(c.description.from)}” → “${
        clipPhrase(c.description.to)
      }”`,
    );
  }
  return parts.join(" · ");
}
