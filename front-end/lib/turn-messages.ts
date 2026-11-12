/**
 * REQ-585 (demo-loop cycle 4, M30) — a chat turn's messages, merged into the
 * thread. A wizard pick the contractor corrects in the chat ("empezamos la
 * próxima semana, no el próximo mes") is changed IN PLACE on the server and
 * comes back in the turn's newMessages with its own id: it replaces that
 * message where it sits. Every other message is new and appends, in order.
 */
export function mergeTurnMessages<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const changed = new Map(incoming.map((m) => [m.id, m]));
  const had = new Set(current.map((m) => m.id));
  return [
    ...current.map((m) => changed.get(m.id) ?? m),
    ...incoming.filter((m) => !had.has(m.id)),
  ];
}
