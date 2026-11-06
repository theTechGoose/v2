/**
 * REQ-200 — the id a client attaches to a create so a retry (a double tap,
 * a flaky network, a replayed request) never makes a second document:
 * the `Idempotency-Key` header, else `requestId` in the JSON body. The
 * body field is removed so it never lands on the stored record.
 */
export function requestIdOf(
  ctx: { req: { header(name: string): string | undefined } },
  body: unknown,
): string | undefined {
  const header = ctx.req.header("idempotency-key")?.trim();
  if (header) return header.slice(0, 200);
  if (body && typeof body === "object" && "requestId" in body) {
    const raw = (body as { requestId?: unknown }).requestId;
    delete (body as { requestId?: unknown }).requestId;
    if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, 200);
  }
  return undefined;
}
