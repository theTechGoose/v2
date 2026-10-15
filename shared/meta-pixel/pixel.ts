/**
 * REQ-080 — the Meta Pixel on the ad funnel: Raphael, 2026-10-15, "i want to
 * do facebook adverts here, need a tracking pixel to track conversions".
 *
 * The pure half, shared by the pages that carry the pixel (front-end) and
 * any server-side copy of the same events later (the Conversions API):
 *
 *  - WHICH pages load it: the ad funnel only — the two landings, the code
 *    page, the welcome wizard, the plan and pay pages, settings (the upgrade
 *    comes back there) and login. Never the dashboard, the assistant or a
 *    customer's document: those visitors are the users' customers and would
 *    pollute the ad audiences.
 *  - WHICH loader: Meta's on the real deploy with META_PIXEL_ID set; the
 *    app's own fake (`/meta-pixel-fake.js`, which records every call on
 *    `window.__pmPixel`) when DENO_DEPLOY is unset (REQ-318: the gate, a dev
 *    box and a pin run on fakes); nothing on the real deploy without an id —
 *    ads tracking never takes the site down.
 *  - The three conversions and their stable event ids, so a reload or a
 *    server-side copy of the same moment deduplicates on Meta's side:
 *    Lead (the OTP went out from a landing), CompleteRegistration (a new
 *    account reached /welcome), Subscribe (the receipt brought the person
 *    back with the plan active — with the plan's price).
 */
import { planById } from "../quote-flow/pricing-plans.ts";

export const REAL_PIXEL_LOADER =
  "https://connect.facebook.net/en_US/fbevents.js";
export const FAKE_PIXEL_LOADER = "/meta-pixel-fake.js";
/** fifteen digits, the shape of a real pixel id — obviously not one */
export const FAKE_PIXEL_ID = "000000000000000";

export interface PixelConfig {
  mode: "real" | "fake";
  id: string;
  loader: string;
}

export interface PixelEnv {
  META_PIXEL_ID?: string;
  /** REQ-318's switch (env/prod) … */
  DENO_DEPLOY?: string;
  /** … and the platform's own mark on a Deno Deploy isolate (what this repo's backend reads, REQ-001) */
  DENO_DEPLOYMENT_ID?: string;
}

/** the real loader only on the real deploy with an id; the fake elsewhere; null = nothing loads */
export function pixelConfig(env: PixelEnv): PixelConfig | null {
  const realDeploy = Boolean(env.DENO_DEPLOY?.trim()) ||
    Boolean(env.DENO_DEPLOYMENT_ID?.trim());
  const id = env.META_PIXEL_ID?.trim() ?? "";
  if (!realDeploy) {
    return { mode: "fake", id: FAKE_PIXEL_ID, loader: FAKE_PIXEL_LOADER };
  }
  return id ? { mode: "real", id, loader: REAL_PIXEL_LOADER } : null;
}

const PIXEL_PAGES = new Set([
  "/",
  "/landing",
  "/verify",
  "/welcome",
  "/login",
  "/settings",
]);
const PIXEL_PREFIXES = ["/plan/", "/pay/"];

/** the ad funnel's pages — the only ones that load the pixel */
export function isPixelPage(pathname: string): boolean {
  const p = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  return PIXEL_PAGES.has(p) ||
    PIXEL_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/**
 * Meta's own snippet, the loader's url swapped in, then init + PageView, then
 * the flush of any conversion script that ran BEFORE this one (a page's
 * <Head> content may land in the head ahead of the app's own; see
 * pixelEventScript).
 */
export function pixelBootScript(cfg: PixelConfig): string {
  return "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?" +
    "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;" +
    "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;" +
    "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window," +
    `document,'script','${cfg.loader}');` +
    `fbq('init','${cfg.id}');fbq('track','PageView');` +
    "if(window.__pmPxQ){window.__pmPxQ.forEach(function(e){fbq('track',e[0],e[1],{eventID:e[2]})});window.__pmPxQ=null}";
}

/** the no-script image Meta prescribes next to the snippet (the real loader only) */
export function pixelNoscriptSrc(id: string): string {
  return `https://www.facebook.com/tr?id=${
    encodeURIComponent(id)
  }&ev=PageView&noscript=1`;
}

export type PixelEventName = "Lead" | "CompleteRegistration" | "Subscribe";

export interface PixelEvent {
  name: PixelEventName;
  /** stable per moment: the same id on a reload (the browser guard) and on a server-side copy (Meta dedups) */
  eventId: string;
  params?: Record<string, string | number>;
}

/** FNV-1a, 32 bits, as eight hex digits — a key for a phone that is not the phone */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Lead — the code went out to this phone from a landing page */
export function leadEvent(phoneE164: string): PixelEvent {
  return {
    name: "Lead",
    eventId: `lead:${fnv1a(phoneE164.replace(/\D/g, ""))}`,
  };
}

/** CompleteRegistration — a new account reached the welcome wizard */
export function registrationEvent(userId: string): PixelEvent {
  return { name: "CompleteRegistration", eventId: `reg:${userId}` };
}

export interface SubscribedPlan {
  planId: string;
  status: "free" | "pending" | "active" | "past_due";
  dueId?: string;
  subscriptionId?: string;
}

/** the one query value /plan/return puts on its way back when the plan came back active */
export function subscribeMarker(plan: SubscribedPlan): string | null {
  if (plan.status !== "active") return null;
  const paid = (() => {
    try {
      return planById(plan.planId).priceCents > 0;
    } catch {
      return false;
    }
  })();
  if (!paid) return null;
  return `sub:${plan.planId}:${plan.dueId ?? plan.subscriptionId ?? "active"}`;
}

/** Subscribe — read back from the marker by the page the receipt lands on; null for anything else */
export function subscribeEventFrom(
  marker: string | null | undefined,
): PixelEvent | null {
  if (!marker) return null;
  const m = /^sub:([a-z0-9-]+):([^:]+)$/.exec(marker);
  if (!m) return null;
  let value: number;
  try {
    const plan = planById(m[1]);
    if (plan.priceCents <= 0) return null;
    value = plan.priceCents / 100;
  } catch {
    return null;
  }
  return {
    name: "Subscribe",
    eventId: marker,
    params: {
      value,
      currency: "USD",
      predicted_ltv: value * 12,
      content_name: m[1],
    },
  };
}

/**
 * The inline script a page renders for one conversion. Once per browser: a
 * localStorage key by event id (a reload of the code page, of the wizard or
 * of the receipt's landing never counts twice). If the snippet has not run
 * yet (head order), the call waits on `__pmPxQ` and the snippet flushes it.
 */
export function pixelEventScript(ev: PixelEvent): string {
  const key = JSON.stringify(`pm:px:${ev.eventId}`);
  const params = JSON.stringify(ev.params ?? {});
  const id = JSON.stringify(ev.eventId);
  return "(function(){try{if(localStorage.getItem(" + key +
    "))return;localStorage.setItem(" + key +
    ',"1")}catch(e){}' +
    `if(window.fbq){fbq("track",${
      JSON.stringify(ev.name)
    },${params},{eventID:${id}})}` +
    `else{(window.__pmPxQ=window.__pmPxQ||[]).push([${
      JSON.stringify(ev.name)
    },${params},${id}])}})();`;
}
