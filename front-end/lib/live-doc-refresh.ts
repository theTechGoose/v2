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

export interface PublicQuoteLike extends PublicQuotePayloadLike {
  version?: number;
}

/** /q: the server's projection left the view this page shows — the
 *  deriveQuoteView mode (open / accepted / declined), the headline state
 *  (an unissued draft became sent) or the published version. A sent →
 *  viewed flip is bookkeeping and changes nothing on the page. */
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
  return false;
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
