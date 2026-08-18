/**
 * Bounded LLM chat turn (P-10): the assistant's chat completion must not hang
 * on the OpenAI SDK defaults (600s × 2 retries). withChatTimeout races the
 * call against a deadline and surfaces a typed, retryable TimeoutError.
 *
 * Wiring target: OpenAILLMClient.respond wraps chat.completions.create
 * (backend/.../openai/mod.ts:80-101) — withChatTimeout(client.create(...)).
 */

export const DEFAULT_CHAT_TIMEOUT_MS = 30_000;

/** A chat turn exceeded its deadline — safe to retry. */
export class TimeoutError extends Error {
  constructor(message = `Chat turn timed out`) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Resolves with the promise's value when it settles before `ms`; rejects with
 * a TimeoutError once `ms` elapses first. Defaults to 30s.
 */
export function withChatTimeout<T>(
  promise: Promise<T>,
  ms: number = DEFAULT_CHAT_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`Chat turn timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
