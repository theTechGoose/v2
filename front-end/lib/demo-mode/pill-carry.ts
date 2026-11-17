/**
 * REQ-535 (demo-loop cycle 4, m13) — the customer's pill survives a page load. The app has no
 * client-side navigation: every link is a full load, the overlay mounts fresh with no demo, and
 * the pill was gone until the first /active answered, then said "Connecting…" for the 2-4 s the
 * new socket and the stage's presence took. This tab now keeps the demo it was in and whether it
 * was connected when its page went (sessionStorage — the tab's own, like REQ-436's tab key); the
 * next page seeds the pill from it at once, and when the page it came from was connected a moment
 * ago it keeps the Connected face for a short grace — "Connecting…" only if the link is still
 * not up when the grace runs out.
 */
import type { Presenter, Role } from "../../../shared/demo-mode/protocol.ts";
import {
  ADMIN_PATH,
  type EndedNotice,
  readEndedNotice,
} from "../../../shared/demo-mode/ended.ts";

/** where the tab keeps it */
export const PILL_CARRY_KEY = "pm:demo-pill";
/** how long a load from a connected page keeps saying Connected while its own link comes up */
export const PILL_CARRY_GRACE_MS = 5_000;
/** a page that went longer ago than this is not "a moment ago": nothing is carried */
export const PILL_CARRY_FRESH_MS = 30_000;

/** REQ-647 (cycle 5, m29) — an end carried to the next page is said there this long after */
export const PILL_ENDED_FRESH_MS = 120_000;

/** the demo as the overlay holds it */
export interface CarriedDemo {
  id: string;
  role: Role;
  presenterName: string;
  targetName: string;
  targetUserId: string;
  presenters: Presenter[];
}

/**
 * REQ-830 (demo-loop cycle dm2, p6) — where the pill was when its page went: folded to its
 * mini-pill or whole, the mini-pill's spot (`tabAt`), the whole pill's offset from home (`dock`) and
 * its whole size (`full`, when measured). The next page draws its first frame from it, never the
 * whole pill at home before the first measure folds and moves it.
 */
export interface PillPlace {
  tucked: boolean;
  tabAt: { x: number; y: number };
  dock: { x: number; y: number };
  full?: { w: number; h: number };
  /** REQ-379 AMENDMENT 2 — the WHOLE pill's size when last measured (the base form on a desktop;
   *  on a window that asks for the compact form the whole never renders, so it must be carried):
   *  the next page judges its form from it before paint */
  whole?: { w: number; h: number };
}

export interface Carried {
  demo: CarriedDemo;
  /** the page it came from was connected to the presenter */
  connected: boolean;
  /** REQ-830 — where its pill was (absent: not known, the pill starts home as before) */
  place?: PillPlace;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** keep this tab's demo, whether it is connected, and when (now); REQ-830 — and where its pill is */
export function keepDemo(
  store: Store | null | undefined,
  demo: CarriedDemo,
  connected: boolean,
  now: number,
  place?: PillPlace | null,
): void {
  try {
    store?.setItem(
      PILL_CARRY_KEY,
      JSON.stringify(
        place
          ? { demo, connected, at: now, place }
          : { demo, connected, at: now },
      ),
    );
  } catch { /* storage full or refused: the next page asks, as before */ }
}

/** the tab is in no demo any more */
export function forgetDemo(store: Store | null | undefined): void {
  try {
    store?.removeItem(PILL_CARRY_KEY);
  } catch { /* refused */ }
}

/**
 * REQ-647 (cycle 5, m29) — the demo ended: the tab keeps the notice (in the demo's place), so the
 * next page still says it, and no load after the end seeds a Connected pill
 */
export function keepEnded(
  store: Store | null | undefined,
  ended: EndedNotice,
  now: number,
): void {
  try {
    store?.setItem(PILL_CARRY_KEY, JSON.stringify({ ended, at: now }));
  } catch {
    /* storage full or refused: the next page says nothing, as before */
  }
}

/** REQ-647 — the end the last page of this tab left, if fresh and well formed — else null */
export function carriedEnded(
  store: Store | null | undefined,
  now: number,
): EndedNotice | null {
  try {
    const raw = store?.getItem(PILL_CARRY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const e = v?.ended;
    if (
      typeof v?.at !== "number" || now - v.at > PILL_ENDED_FRESH_MS ||
      now < v.at - 1_000
    ) return null;
    switch (e?.by) {
      case "you":
      case "unknown":
      case "expired":
        return { by: e.by };
      case "other":
        return typeof e.name === "string" && e.name.trim()
          ? { by: "other", name: e.name }
          : { by: "unknown" };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * REQ-647 (cycle 5, c2-p13-r) — /admin's handover (`?demo=ended&by=…`, a stage's End), read on
 * the server so the island paints it on first paint; null on any other page or address
 */
export function adminEndedNotice(
  pathname: string,
  search: string,
): EndedNotice | null {
  if (pathname !== ADMIN_PATH) return null;
  return readEndedNotice(search)?.notice ?? null;
}

const isPresenter = (p: unknown): p is Presenter =>
  typeof p === "object" && p !== null &&
  typeof (p as Presenter).userId === "string" &&
  typeof (p as Presenter).name === "string" &&
  typeof (p as Presenter).color === "string";

const isNum = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
const isXY = (v: unknown): v is { x: number; y: number } =>
  typeof v === "object" && v !== null &&
  isNum((v as { x: unknown }).x) && isNum((v as { y: unknown }).y);

/** REQ-830 — a kept placement, if well formed — else undefined (the pill starts home) */
function readPlace(v: unknown): PillPlace | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const p = v as Record<string, unknown>;
  if (typeof p.tucked !== "boolean" || !isXY(p.tabAt) || !isXY(p.dock)) {
    return undefined;
  }
  const out: PillPlace = {
    tucked: p.tucked,
    tabAt: { x: p.tabAt.x, y: p.tabAt.y },
    dock: { x: p.dock.x, y: p.dock.y },
  };
  if (p.full !== undefined) {
    const f = p.full as Record<string, unknown> | null;
    if (!f || !isNum(f.w) || !isNum(f.h)) return undefined;
    out.full = { w: f.w, h: f.h };
  }
  if (p.whole !== undefined) {
    const f = p.whole as Record<string, unknown> | null;
    if (!f || !isNum(f.w) || !isNum(f.h)) return undefined;
    out.whole = { w: f.w, h: f.h };
  }
  return out;
}

/** what the last page of this tab left, if it is fresh and well formed — else null */
export function carriedDemo(
  store: Store | null | undefined,
  now: number,
): Carried | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(PILL_CARRY_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    const d = v?.demo;
    if (
      typeof v?.at !== "number" || now - v.at > PILL_CARRY_FRESH_MS ||
      now < v.at - 1_000 ||
      typeof d?.id !== "string" || !d.id ||
      (d.role !== "viewer" && d.role !== "presenter") ||
      typeof d.presenterName !== "string" ||
      typeof d.targetName !== "string" ||
      typeof d.targetUserId !== "string" ||
      !Array.isArray(d.presenters) || !d.presenters.every(isPresenter)
    ) return null;
    const place = readPlace(v.place);
    return {
      ...(place ? { place } : {}),
      demo: {
        id: d.id,
        role: d.role,
        presenterName: d.presenterName,
        targetName: d.targetName,
        targetUserId: d.targetUserId,
        presenters: d.presenters.map((p: Presenter) => ({
          userId: p.userId,
          name: p.name,
          color: p.color,
        })),
      },
      connected: v.connected === true,
    };
  } catch {
    return null;
  }
}

/**
 * Is the pill's face Connected? The link is up (direct or relay); or this page loaded from a
 * connected one and the grace still runs (`carrying`) while its own link comes up — unless the
 * link already said the demo is over (ended, replaced, closed). REQ-647 (cycle 5, m29): nor once
 * /active denied the demo (`active` false; null — not answered yet; true — it has this demo).
 */
export function showsConnected(
  status: string,
  carrying: boolean,
  active: boolean | null = null,
): boolean {
  if (status === "direct" || status === "relay") return true;
  if (status === "ended" || status === "replaced" || status === "closed") {
    return false;
  }
  return carrying && active !== false;
}
