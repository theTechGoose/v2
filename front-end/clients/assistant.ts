/**
 * HTTP client for the /assistant page.
 *
 * Wraps the backend's `agents/*` routes. The chat module is still being built
 * server-side — for v1 the page falls back to a static seed when the backend
 * returns an empty list (or 404).
 */
import { api, ApiError, type ApiOptions } from "../lib/api.ts";
import type { Quote } from "./dashboard.ts";

export type { Quote };

export type ConversationPhase = "chat" | "terms" | "send";

export interface Conversation {
  id: string;
  userId: string;
  title?: string;
  customerName?: string;
  preview?: string;
  phase?: ConversationPhase;
  unread?: boolean;
  updatedAt: number;
  createdAt: number;
  [k: string]: unknown;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  kind?: "text" | "voice" | "action" | "wizard";
  content: string;
  createdAt: number;
  [k: string]: unknown;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  [k: string]: unknown;
}

export interface ChatInput {
  conversationId?: string;
  content: string;
  kind?: "text" | "voice";
}

export interface ChatResult {
  conversationId: string;
  message?: Message;
  [k: string]: unknown;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) {
    if (err instanceof ApiError && err.status === 404) return fallback;
    throw err;
  }
}

export const assistantClient = {
  conversations: (limit = 50, opts: ApiOptions = {}) =>
    safe(() => api.get<Conversation[]>("/agents/conversations", { ...opts, query: { limit } }), []),

  conversation:  (id: string, opts: ApiOptions = {}) =>
    api.get<ConversationDetail>(`/agents/conversations/${id}`, opts),

  startConversation: (body: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.post<Conversation>("/agents/conversations", body, opts),

  transitionToTerms: (id: string, opts: ApiOptions = {}) =>
    api.post<ConversationDetail>(`/agents/conversations/${id}/transition-to-terms`, undefined, opts),

  chat: (input: ChatInput, opts: ApiOptions = {}) =>
    api.post<ChatResult>("/agents/chat", input, opts),

  /** Read-only quote preview shown in the right pane. Reuses /quotes/:id. */
  quote: (id: string, opts: ApiOptions = {}) =>
    api.get<Quote>(`/quotes/${id}`, opts),
};
