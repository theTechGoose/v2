/**
 * REQ-471 (demo-loop cycle 3, issue p8-pair2-d): the /quotes route reads the
 * pipeline on the SSR side so the first HTML already carries the quote
 * cards, instead of a skeleton that waits for hydration + a client fetch.
 *
 * Same three reads the island's loadPipeline() makes (GET /quotes, the
 * 90-day win rate, the insight line), through the in-process backend with
 * the caller's session. A list that can't be read gives `null`: the island
 * then starts on its skeleton and fetches, exactly as before.
 */
import type { Insight, QuoteCard, WinRate } from "../clients/quotes.ts";
import { ssrBackendGetAuthed } from "./backend-fetch.ts";

export interface QuotesSeed {
  cards: QuoteCard[];
  winRate: WinRate | null;
  insight: Insight | null;
}

type AuthedGet = <T>(
  path: string,
  sessionId: string | undefined,
) => Promise<{ ok: boolean; status: number; data?: T }>;

export async function loadQuotesSeed(
  sessionId: string | undefined,
  get: AuthedGet = ssrBackendGetAuthed,
): Promise<QuotesSeed | null> {
  if (!sessionId) return null;
  const read = <T>(path: string) =>
    get<T>(path, sessionId).catch(() => ({ ok: false, status: 0 }) as const);
  const [list, winRate, insight] = await Promise.all([
    read<QuoteCard[]>("/quotes"),
    read<WinRate>("/analytics/quotes/win-rate?days=90"),
    read<Insight>("/analytics/quotes/insight"),
  ]);
  if (!list.ok || !("data" in list) || !Array.isArray(list.data)) return null;
  return {
    cards: list.data,
    winRate: winRate.ok && "data" in winRate && winRate.data
      ? winRate.data
      : null,
    insight: insight.ok && "data" in insight && insight.data
      ? insight.data
      : null,
  };
}
