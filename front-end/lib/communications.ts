/**
 * REQ-915/916 — the Phone page's pure helpers: the inbox order, a thread's
 * timeline (texts and calls merged by time), status → chip, E.164 display and
 * input, the number shop's query, and a call-log row. No I/O; the island and
 * the jest units both read these.
 */
import type {
  Call,
  CallStatus,
  HandledBy,
  TextMessage,
  TextStatus,
  Thread,
} from "../clients/communications.ts";

export interface Chip {
  cls: string;
  key: string;
}

/** threads newest first (by their last message), a copy */
export function sortThreads<T extends Pick<Thread, "lastMessageAt">>(
  threads: T[],
): T[] {
  return [...threads].sort((a, b) =>
    Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)
  );
}

export type TimelineItem =
  | { kind: "text"; id: string; at: string; text: TextMessage }
  | { kind: "call"; id: string; at: string; call: Call };

/** a thread's texts and calls in one list, oldest first (a call is placed at its start) */
export function timeline(
  texts: Pick<TextMessage, "id" | "createdAt">[],
  calls: Pick<Call, "id" | "startedAt" | "createdAt">[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...texts.map((t) => ({
      kind: "text" as const,
      id: t.id,
      at: t.createdAt,
      text: t as TextMessage,
    })),
    ...calls.map((c) => ({
      kind: "call" as const,
      id: c.id,
      at: c.startedAt ?? c.createdAt,
      call: c as Call,
    })),
  ];
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const TEXT_CHIP: Record<TextStatus, string> = {
  queued: "chip--muted",
  sending: "chip--muted",
  sent: "chip--teal",
  delivered: "chip--green",
  undelivered: "chip--pink",
  failed: "chip--pink",
  received: "chip--teal",
  dev: "chip--amber",
};

export function textChip(status: TextStatus): Chip {
  return {
    cls: TEXT_CHIP[status] ?? "chip--muted",
    key: `comms.status.${status}`,
  };
}

const CALL_CHIP: Record<CallStatus, string> = {
  queued: "chip--muted",
  initiated: "chip--muted",
  ringing: "chip--teal",
  "in-progress": "chip--teal",
  completed: "chip--green",
  busy: "chip--amber",
  "no-answer": "chip--pink",
  failed: "chip--pink",
  canceled: "chip--muted",
};

export function callChip(status: CallStatus): Chip {
  return {
    cls: CALL_CHIP[status] ?? "chip--muted",
    key: `comms.callStatus.${status}`,
  };
}

/** "+18435550100" → "(843) 555-0100"; anything not a US/CA number is shown as given */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** what someone typed → E.164 (10 digits are US), or null when it cannot be a number */
export function toE164(input: string): string | null {
  const s = input.trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) {
    return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** the number shop's search box: three digits are an area code, anything else a word in the number */
export function shopQuery(
  input: string,
): { areaCode: string } | { contains: string } | null {
  const s = input.trim();
  const digits = s.replace(/[()\s-]/g, "");
  if (/^\d{3}$/.test(digits)) {
    return /^[2-9]\d{2}$/.test(digits) ? { areaCode: digits } : null;
  }
  const word = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!word || /^\d+$/.test(word) && word.length < 3) return null;
  return { contains: word };
}

/** seconds → "m:ss"; absent → "—" */
export function formatDuration(sec: number | undefined | null): string {
  if (sec === undefined || sec === null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** the API said this user has no line (409 no_line) — the page is the number shop */
export function isNoLine(e: unknown): boolean {
  const err = e as { status?: unknown; body?: unknown } | null;
  if (!err || err.status !== 409) return false;
  const code = err.body && typeof err.body === "object"
    ? (err.body as { code?: unknown }).code
    : undefined;
  return code === undefined || code === "no_line";
}

export interface CallRow {
  id: string;
  dirKey: string;
  peer: string;
  status: Chip;
  handledKey: string;
  duration: string;
  at: string;
}

/** one row of the Calls tab */
export function callRow(
  c: Pick<
    Call,
    | "id"
    | "peer"
    | "direction"
    | "status"
    | "handledBy"
    | "durationSec"
    | "startedAt"
    | "createdAt"
  >,
): CallRow {
  return {
    id: c.id,
    dirKey: `comms.calls.dir.${c.direction}`,
    peer: formatPhone(c.peer),
    status: callChip(c.status),
    handledKey: `comms.handledBy.${c.handledBy as HandledBy}`,
    duration: formatDuration(c.durationSec),
    at: c.startedAt ?? c.createdAt,
  };
}

/** calls newest first, a copy */
export function sortCalls<T extends Pick<Call, "startedAt" | "createdAt">>(
  calls: T[],
): T[] {
  return [...calls].sort((a, b) =>
    Date.parse(b.startedAt ?? b.createdAt) -
    Date.parse(a.startedAt ?? a.createdAt)
  );
}

/** a short local time for a list row */
export function shortTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
