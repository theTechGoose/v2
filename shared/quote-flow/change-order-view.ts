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
import { shortDate } from "../documents/linked-view.ts";

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

/** REQ-689 (demo-loop cycle 5, p5): the /co intro line, by status. A pending
 *  order asks for review and approval; a decided one says what happened —
 *  never "approve to update your total" under an "Approved" headline. The
 *  total is the job's new total when the page has it (REQ-398 m25), else
 *  the invoice's. */
export function changeOrderIntro(
  co: {
    status?: string;
    decidedAt?: string;
    jobNewAmount?: number;
    newAmount?: number;
  },
  lang: "en" | "es",
  money: (cents: number) => string,
): { key: string; vars?: Record<string, string> } {
  if (co.status === "declined") {
    return { key: "changeOrderPublic.introDeclined" };
  }
  if (co.status !== "approved") return { key: "changeOrderPublic.intro" };
  const date = shortDate(co.decidedAt, lang);
  const totalCents = co.jobNewAmount ?? co.newAmount;
  if (!date || totalCents == null) {
    return { key: "changeOrderPublic.introApprovedPlain" };
  }
  return {
    key: "changeOrderPublic.introApproved",
    vars: { date, total: money(totalCents) },
  };
}
