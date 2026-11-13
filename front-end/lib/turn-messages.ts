/**
 * REQ-585 (demo-loop cycle 4, M30) — a chat turn's messages, merged into the
 * thread. A wizard pick the contractor corrects in the chat ("empezamos la
 * próxima semana, no el próximo mes") is changed IN PLACE on the server and
 * comes back in the turn's newMessages with its own id: it replaces that
 * message where it sits. Every other message is new and appends, in order.
 *
 * REQ-662 (demo-loop cycle 5, m19): the appended messages land in createdAt
 * order — the order the server stores and a reload shows — so nothing moves
 * on reload. Messages without createdAt keep the order they came in.
 */
export function mergeTurnMessages<
  T extends { id: string; createdAt?: string | number },
>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const changed = new Map(incoming.map((m) => [m.id, m]));
  const had = new Set(current.map((m) => m.id));
  return [
    ...current.map((m) => changed.get(m.id) ?? m),
    ...byCreatedAt(incoming.filter((m) => !had.has(m.id))),
  ];
}

/**
 * REQ-662 (demo-loop cycle 5, m19 — pair 5): "Lock it in" on a draft card.
 * The clicked draft card leaves the live view (REQ-318 hides it on reload
 * too) and the server's locked card + terms CTA append. Everything else in
 * the thread stays — the chat edits and replies after the card used to be
 * cut off (`slice(0, idx)`) and only came back on reload.
 */
export function mergeLockedCard<
  T extends { id: string; createdAt?: string | number },
>(
  current: readonly T[],
  clickedCardId: string,
  incoming: readonly T[],
): T[] {
  return mergeTurnMessages(
    current.filter((m) => m.id !== clickedCardId),
    incoming,
  );
}

/** Stable sort by createdAt (an ISO string on the wire, a number in some
 *  typings); when any message has no usable time, the order stays as sent. */
function byCreatedAt<T extends { createdAt?: string | number }>(
  list: T[],
): T[] {
  const at = (m: T) =>
    typeof m.createdAt === "number"
      ? m.createdAt
      : typeof m.createdAt === "string"
      ? Date.parse(m.createdAt)
      : NaN;
  if (list.some((m) => Number.isNaN(at(m)))) return list;
  return list
    .map((m, i) => ({ m, i, t: at(m) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(({ m }) => m);
}
