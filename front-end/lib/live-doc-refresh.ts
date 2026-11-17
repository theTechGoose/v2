/**
 * REQ-396 (demo-loop cycle 2, issue M13) — the open staff panel and the
 * customer's /q page follow the server after a sign / publish.
 *
 * REQ-321 made /i and the /quotes LIST re-read the server; the open quote
 * panel (its loader keyed on [openId, openTick]) and /q (PublicQuoteView's
 * one mount fetch) still read once, so a quote the client signed stayed
 * "Sent · Out for response" in the panel — with "Edit → Version 3" offered —
 * and an open /q tab kept its pad after the deal was signed elsewhere.
 */
import {
  deriveQuoteView,
  publicHeadlineState,
  type PublicQuotePayloadLike,
} from "../../shared/quote-flow/public-doc-state.ts";
import { type PollEnv, startPoll } from "./poll.ts";

/** the raw quote fields a client-side change moves (the card spreads the
 *  row, so the list card and `GET /quotes/:id` carry the same ones) */
export interface QuoteRowLike {
  status?: unknown;
  version?: unknown;
  acceptedAt?: unknown;
  lostAt?: unknown;
  publishedAt?: unknown;
}

const ROW_FIELDS: (keyof QuoteRowLike)[] = [
  "status",
  "version",
  "acceptedAt",
  "lostAt",
  "publishedAt",
];

/** true when the list's fresh card for the open quote says something the
 *  open panel does not: signed, declined, viewed, a new published version.
 *  Nothing open (or the quote gone from the list) is never a move. */
export function openQuoteMoved(
  open: QuoteRowLike | null | undefined,
  card: QuoteRowLike | null | undefined,
): boolean {
  if (!open || !card) return false;
  return ROW_FIELDS.some((k) => (open[k] ?? null) !== (card[k] ?? null));
}

/** REQ-493 (demo-loop c3 m7): the assistant chat's bound quote row moved on
 *  the server — signed, declined, a new version. The same fields as
 *  `openQuoteMoved`, but only the ones the chat's row holds (it never loads
 *  `publishedAt` / `lostAt`; a decline moves `status` as well), so a re-read
 *  that brings nothing new never replaces the row the chat works on. */
export function boundQuoteMoved(
  held: QuoteRowLike | null | undefined,
  fresh: QuoteRowLike | null | undefined,
): boolean {
  if (!held || !fresh) return false;
  return ROW_FIELDS.some((k) =>
    k in held && (held[k] ?? null) !== (fresh[k] ?? null)
  );
}

/** REQ-493: a related document's row, as much of it as a /q page shows (its
 *  state and money; the signed banner's next step is built from them) */
export interface LinkedRowLike {
  id?: unknown;
  status?: unknown;
  state?: unknown;
  version?: unknown;
  amountCents?: unknown;
  paidCents?: unknown;
  balanceCents?: unknown;
  deltaAmountCents?: unknown;
}

/** REQ-493: the related documents a /q page lists */
export interface LinkedDocsLike {
  invoices?: readonly LinkedRowLike[];
  changeOrders?: readonly LinkedRowLike[];
}

export interface PublicQuoteLike
  extends PublicQuotePayloadLike, LinkedDocsLike {
  version?: number;
}

const INVOICE_FIELDS: (keyof LinkedRowLike)[] = [
  "id",
  "status",
  "state",
  "version",
  "amountCents",
  "paidCents",
  "balanceCents",
];
const CHANGE_ORDER_FIELDS: (keyof LinkedRowLike)[] = [
  "id",
  "status",
  "version",
  "deltaAmountCents",
];

function linkedDocsKey(p: LinkedDocsLike): string {
  const pick = (
    rows: readonly LinkedRowLike[] | undefined,
    fields: (keyof LinkedRowLike)[],
  ) => (rows ?? []).map((r) => fields.map((k) => r?.[k] ?? null));
  return JSON.stringify([
    pick(p.invoices, INVOICE_FIELDS),
    pick(p.changeOrders, CHANGE_ORDER_FIELDS),
  ]);
}

/** REQ-493 (demo-loop c3 m7, pair 9): the related documents moved under the
 *  page — an invoice paid, claimed, added or republished, a change order
 *  decided. The owner's /q kept "paga los $450.00 pendientes" after the
 *  payment because only the quote's own view was compared. */
export function linkedDocsMoved(
  shown: LinkedDocsLike,
  fresh: LinkedDocsLike,
): boolean {
  return linkedDocsKey(shown) !== linkedDocsKey(fresh);
}

/** /q: the server's projection left the view this page shows — the
 *  deriveQuoteView mode (open / accepted / declined), the headline state
 *  (an unissued draft became sent), the published version, or (REQ-493) the
 *  related documents it lists. A sent → viewed flip of the quote is
 *  bookkeeping and changes nothing on the page. */
export function publicQuoteMoved(
  shown: PublicQuoteLike,
  fresh: PublicQuoteLike,
): boolean {
  if (deriveQuoteView(shown).mode !== deriveQuoteView(fresh).mode) return true;
  if (publicHeadlineState(shown) !== publicHeadlineState(fresh)) return true;
  if (
    typeof shown.version === "number" && typeof fresh.version === "number" &&
    shown.version !== fresh.version
  ) return true;
  return linkedDocsMoved(shown, fresh);
}

export const QUOTE_REFRESH_MS = 10_000;

export interface PublicQuoteRefreshOptions<T extends PublicQuoteLike> {
  quoteId: string;
  /** read at every tick — null while the page shows no document yet */
  shown: () => T | null | undefined;
  /** the fresh projection, when it left the shown view */
  onMoved: (fresh: T) => void;
  /** test seams */
  fetchJson?: (url: string) => Promise<unknown>;
  ms?: number;
  env?: Partial<PollEnv>;
}

async function browserFetchJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(String(r.status));
  return await r.json();
}

/** start re-reading the public quote; returns the stop function. The read
 *  carries `?refresh=1` so the server records no open for a poll. */
export function startPublicQuoteRefresh<T extends PublicQuoteLike>(
  opts: PublicQuoteRefreshOptions<T>,
): () => void {
  const fetchJson = opts.fetchJson ?? browserFetchJson;
  const url = `/api/quotes/${opts.quoteId}/public?refresh=1`;
  let stopped = false;
  const stop = startPoll(
    async () => {
      if (stopped || !opts.shown()) return;
      const fresh = await fetchJson(url);
      if (stopped || !fresh || typeof fresh !== "object") return;
      const shown = opts.shown();
      if (shown && publicQuoteMoved(shown, fresh as T)) {
        opts.onMoved(fresh as T);
      }
    },
    opts.ms ?? QUOTE_REFRESH_MS,
    { env: opts.env },
  );
  return () => {
    stopped = true;
    stop();
  };
}
