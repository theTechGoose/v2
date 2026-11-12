/**
 * REQ-391 (demo-loop cycle 2, M4 + m21) — what the customer's page knows, as it goes (`pagehide`),
 * about what comes next: "navigating" when a page of this app is coming, "closing" otherwise.
 *
 * Measured in Chromium (2026-11-12): the Navigation API's `navigate` event fires BEFORE pagehide
 * for every navigation the page starts or sees — a link click, `location.href`, a form, a
 * `location.reload()`, a history step, even the browser's Back button — and never for a closed
 * tab, the address bar (or `page.goto`), or the browser's own reload button. So a navigate to
 * another document of this origin means the next page of the app is on its way; nothing seen
 * means none is known (the stage then says at once that it is waiting — a URL typed into the
 * address bar comes back as a new tab, and the stage follows it).
 *
 * Where the Navigation API is missing, a plain click on a link to another page of the app, or a
 * form sent, stands in for it. A reload from the keyboard (F5, Ctrl/Cmd+R) counts too: the page
 * sees the key before the browser reloads it. A navigation that failed is forgotten, and so is
 * one NAV_PENDING_MS old (the page never went).
 */
import type { LeaveWhy } from "../../../shared/demo-mode/protocol.ts";

/** a navigation older than this, whose page never went, is not the one it goes for */
export const NAV_PENDING_MS = 30_000;

type Listener = (e: Event) => void;
interface Target {
  addEventListener(type: string, f: Listener, opts?: unknown): void;
  removeEventListener(type: string, f: Listener, opts?: unknown): void;
}

/** what the hint listens on: the window (its location, clicks, forms, keys) and its navigation */
export interface LeaveHintHost extends Target {
  location: { href: string; origin: string };
  navigation?: Target;
}

export interface LeaveHint {
  why(): LeaveWhy;
  stop(): void;
}

interface NavigateLike {
  destination?: { url?: string; sameDocument?: boolean };
  downloadRequest?: string | null;
}
interface ClickLike {
  target?: { closest?(sel: string): unknown } | null;
  button?: number;
  defaultPrevented?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}
interface AnchorLike {
  href?: string;
  target?: string;
  hasAttribute?(name: string): boolean;
}
interface SubmitLike {
  defaultPrevented?: boolean;
  target?: { action?: string; target?: string } | null;
}
interface KeyLike {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function watchLeaveHint(
  host: LeaveHintHost,
  now: () => number = () => Date.now(),
): LeaveHint {
  let pendingAt = 0;
  const mark = () => void (pendingAt = now());
  const url = (href: string | undefined): URL | null => {
    try {
      return href ? new URL(href, host.location.href) : null;
    } catch {
      return null;
    }
  };
  /** another document of this app: same origin, and not just this page's #fragment */
  const anotherPage = (href: string | undefined): boolean => {
    const u = url(href);
    if (!u || u.origin !== host.location.origin) return false;
    const here = url(host.location.href);
    return !(here && u.hash &&
      u.href.split("#")[0] === here.href.split("#")[0]);
  };
  const inThisTab = (target: string | undefined) =>
    !target || target === "_self";

  const onNavigate = (ev: Event) => {
    const e = ev as unknown as NavigateLike;
    if (e.destination?.sameDocument || e.downloadRequest) return;
    if (anotherPage(e.destination?.url)) mark();
  };
  const onNavigateError = () => void (pendingAt = 0);
  const onClick = (ev: Event) => {
    const e = ev as unknown as ClickLike;
    if (e.defaultPrevented || (e.button ?? 0) !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target?.closest?.("a[href]") as AnchorLike | null | undefined;
    if (!a || !inThisTab(a.target) || a.hasAttribute?.("download")) return;
    if (anotherPage(a.href)) mark();
  };
  const onSubmit = (ev: Event) => {
    const e = ev as unknown as SubmitLike;
    if (e.defaultPrevented || !e.target) return;
    if (!inThisTab(e.target.target)) return;
    if (anotherPage(e.target.action || host.location.href)) mark();
  };
  const onKey = (ev: Event) => {
    const e = ev as unknown as KeyLike;
    const k = (e.key ?? "").toLowerCase();
    if (k === "f5" || (k === "r" && (e.ctrlKey || e.metaKey))) mark();
  };

  const nav = host.navigation;
  const on: [Target, string, Listener, unknown][] = [
    [host, "keydown", onKey, true],
  ];
  if (nav) {
    on.push([nav, "navigate", onNavigate, undefined]);
    on.push([nav, "navigateerror", onNavigateError, undefined]);
  } else {
    // no Navigation API: what the app did not handle itself (bubbled up, not prevented)
    on.push([host, "click", onClick, undefined]);
    on.push([host, "submit", onSubmit, undefined]);
  }
  for (const [t, type, f, opts] of on) t.addEventListener(type, f, opts);

  return {
    why: () =>
      pendingAt > 0 && now() - pendingAt < NAV_PENDING_MS
        ? "navigating"
        : "closing",
    stop() {
      for (const [t, type, f, opts] of on) t.removeEventListener(type, f, opts);
    },
  };
}
