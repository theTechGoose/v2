/**
 * REQ-567 (demo-loop cycle 4, m37) — a collapsible track's open state.
 *
 * Only a user's own toggle is remembered. The old QuoteTrack wrote its state
 * from a mount effect, so a visit while a track was empty (defaultOpen false)
 * stored "0", and that "0" hid the track after it gained items. Values are
 * now "open" / "closed"; a legacy "0" / "1" may have been written that way and
 * is ignored.
 */

export interface TrackStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const OPEN = "open";
const CLOSED = "closed";

/** The state a track mounts in: forceOpen, then the user's toggle, then defaultOpen. */
export function initialTrackOpen(o: {
  storage?: TrackStorage | null;
  storageKey?: string;
  defaultOpen: boolean;
  forceOpen?: boolean;
}): boolean {
  if (o.forceOpen) return true;
  if (!o.storage || !o.storageKey) return o.defaultOpen;
  let raw: string | null = null;
  try {
    raw = o.storage.getItem(o.storageKey);
  } catch { /* storage unavailable */ }
  if (raw === OPEN) return true;
  if (raw === CLOSED) return false;
  return o.defaultOpen;
}

/** A user toggle: returns the new state and remembers it. */
export function toggleTrackOpen(
  storage: TrackStorage | null | undefined,
  storageKey: string | undefined,
  current: boolean,
): boolean {
  const next = !current;
  if (storage && storageKey) {
    try {
      storage.setItem(storageKey, next ? OPEN : CLOSED);
    } catch { /* storage unavailable */ }
  }
  return next;
}
