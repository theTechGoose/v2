/**
 * REQ-235 — the end of a demo, said on both sides and asked before it happens; pure, shared by
 * the overlay island (the customer's pill and /admin), the stage island and jest.
 *
 *   - who ended it, as the reader says it (`whoEnded` → `endedText`): the customer reads
 *     "{presenter} ended the demo" or "You ended the demo"; a stage reads "{customer} ended the
 *     demo", "{colleague} ended the demo" or "You ended the demo"; "The demo ended" when nobody
 *     can be named. The wire says it: `ended` carries the presenter's `pid` (protocol.ts).
 *     REQ-296 — "The demo expired after two hours" when it reached its time (`reason: "expired"`):
 *     nobody is named, on either side.
 *   - a stage's notice rides its hop to /admin as `?demo=ended&by=you|other&name=…`
 *     (`endedHref`); /admin reads it once (`readEndedNotice`) and drops it from the address.
 *   - End asks first (`endConfirm`): the first click asks "End for everyone?"; Yes counts after
 *     END_ARM_MS (the second click of a double click on End never ends a demo); Keep going puts
 *     End back. REQ-300 (demo cycle 1, M4): the question has no clock of its own — it used to
 *     cancel itself after 4 s, before an agent or a reading human had answered, so Yes landed on
 *     nothing. It now stays up until answered, Escape, or a click outside the pill (EndDemo).
 */
import type { EndReason, Presenter, Role } from "./protocol.ts";

/** who ended it, from the reader's side: themselves, someone by name, or nobody nameable */
export type EndedNotice =
  | { by: "you" }
  | { by: "other"; name: string }
  | { by: "unknown" }
  /** REQ-296 — it reached its two hours */
  | { by: "expired" };

/** the side reading the end: the customer (viewer), or a stage (a presenter, by pid) */
export interface EndedReader {
  role: Role;
  /** REQ-214 — a presenter's own id */
  pid?: string | null;
  presenters: Presenter[];
  /** a stage: the customer's name */
  targetName?: string;
  /** the customer: the opener of a demo written before the presenter list */
  presenterName?: string;
}

/** the staff's page, where a stage hands its presenter back (REQ-153 AMENDMENT) */
export const ADMIN_PATH = "/admin";
/** a name the address carries is cut to this */
export const NAME_MAX = 80;
/** how long Yes waits before it counts: longer than a double click's second click */
export const END_ARM_MS = 400;

const named = (name: string | undefined): EndedNotice => {
  const n = (name ?? "").trim().slice(0, NAME_MAX);
  return n ? { by: "other", name: n } : { by: "unknown" };
};

/** who ended it, from `ended` and what the reader knows of the demo */
export function whoEnded(
  ended: { by: Role; pid?: string; reason?: EndReason },
  reader: EndedReader,
): EndedNotice {
  // REQ-296 — the clock ended it: nobody to name, whatever `by` says
  if (ended.reason === "expired") return { by: "expired" };
  const { presenters } = reader;
  if (reader.role === "viewer") {
    if (ended.by === "viewer") return { by: "you" };
    if (ended.pid) {
      return named(presenters.find((p) => p.userId === ended.pid)?.name);
    }
    // no pid (a server before REQ-235): the one presenter, or a demo's opener before the list
    if (presenters.length === 1) return named(presenters[0].name);
    return presenters.length === 0
      ? named(reader.presenterName)
      : { by: "unknown" };
  }
  if (ended.by === "viewer") return named(reader.targetName);
  if (ended.pid) {
    if (ended.pid === reader.pid) return { by: "you" };
    return named(presenters.find((p) => p.userId === ended.pid)?.name);
  }
  // no pid: alone on the demo, it was this presenter
  return presenters.length <= 1 ? { by: "you" } : { by: "unknown" };
}

/** the dictionary line for a notice */
export function endedText(
  n: EndedNotice,
): { key: string; vars?: { name: string } } {
  if (n.by === "you") return { key: "demoMode.endedByYou" };
  if (n.by === "expired") return { key: "demoMode.expired" };
  if (n.by === "other") {
    return { key: "demoMode.endedBy", vars: { name: n.name } };
  }
  return { key: "demoMode.ended" };
}

/** /admin, saying who ended it */
export function endedHref(n: EndedNotice): string {
  const q = new URLSearchParams({ demo: "ended" });
  if (n.by === "you") q.set("by", "you");
  if (n.by === "expired") q.set("by", "expired");
  if (n.by === "other") {
    q.set("by", "other");
    q.set("name", n.name.slice(0, NAME_MAX));
  }
  return `${ADMIN_PATH}?${q}`;
}

/** the notice an address carries, and the address's own parameters without it; null when none */
export function readEndedNotice(
  search: string,
): { notice: EndedNotice; rest: string } | null {
  const q = new URLSearchParams(search);
  if (q.get("demo") !== "ended") return null;
  const by = q.get("by");
  const notice: EndedNotice = by === "you"
    ? { by: "you" }
    : by === "expired"
    ? { by: "expired" }
    : by === "other"
    ? named(q.get("name") ?? "")
    : { by: "unknown" };
  for (const k of ["demo", "by", "name"]) q.delete(k);
  const rest = q.toString();
  return { notice, rest: rest ? `?${rest}` : "" };
}

/** End's question: up or not, and whether Yes counts yet */
export interface EndAsk {
  asking: boolean;
  armed: boolean;
}

export interface EndConfirm {
  /** End was clicked: ask */
  ask(): void;
  /** Yes: ends (once), when asked and armed */
  confirm(): void;
  /** Keep going */
  cancel(): void;
  /** stop the clock (unmount) */
  dispose(): void;
}

const IDLE: EndAsk = { asking: false, armed: false };

export function endConfirm(o: {
  onChange: (s: EndAsk) => void;
  onEnd: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}): EndConfirm {
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as number));
  let s: EndAsk = IDLE;
  // REQ-300: only the arm ticks; nothing clears the question but an answer
  let timers: unknown[] = [];
  const set = (next: EndAsk) => {
    s = next;
    o.onChange(next);
  };
  const stop = () => {
    for (const h of timers) clearTimer(h);
    timers = [];
  };
  return {
    ask() {
      if (s.asking) return;
      set({ asking: true, armed: false });
      timers = [
        setTimer(() => set({ asking: true, armed: true }), END_ARM_MS),
      ];
    },
    confirm() {
      if (!s.asking || !s.armed) return;
      stop();
      set(IDLE);
      o.onEnd();
    },
    cancel() {
      if (!s.asking) return;
      stop();
      set(IDLE);
    },
    dispose: stop,
  };
}
