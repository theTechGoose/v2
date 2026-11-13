/**
 * REQ-630 — every way the business gets paid, one tap away. Pure rules shared by the backend
 * (validation on save, the public projection, the invoice email/text) and the front-end (the
 * settings card, the buttons on /i/:id):
 *
 * - deep links with the amount prefilled where the platform allows it — Venmo
 *   (`venmo.com/<user>?txn=pay&amount=&note=`), Cash App (`cash.app/$tag/<amount>`), PayPal.me
 *   (`paypal.me/<handle>/<amount>USD`); Zelle has no link, so it is a value to copy;
 * - "other payment links" the business adds by NAME + URL (any platform — "Extra Pay", Square,
 *   a bank portal), https only;
 * - the public projection: the old `{ method, handle }` rows unchanged, then one
 *   `{ method: "link", id, name, url }` row per enabled, safe link (extend, never rename).
 */

/** At most this many custom payment links per business. */
export const MAX_PAY_LINKS = 10;
/** A link's name is a button label — short. */
export const PAY_LINK_NAME_MAX = 40;
const URL_MAX = 2048;

/** A custom payment link as stored under `acceptedPaymentMethods.links`. */
export interface PayLink {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

/** One row of the public projection (`acceptedMethods` on /invoices/:id/public). */
export interface PublicPayMethod {
  method: string;
  handle?: string;
  /** `method: "link"` only */
  id?: string;
  name?: string;
  url?: string;
}

/** A pay button on the invoice page: a link to open, or a value to copy. */
export type PayButton =
  | {
    kind: "link";
    key: string;
    method: string;
    label: string;
    href: string;
    /** the handle the link pays, shown under the label */
    detail?: string;
  }
  | { kind: "copy"; key: string; method: string; label: string; value: string };

const BRAND: Record<string, string> = {
  venmo: "Venmo",
  cashapp: "Cash App",
  paypal: "PayPal",
  zelle: "Zelle",
};

// ---------------------------------------------------------------- URLs

/** An https URL safe to put in an href, normalized — or null. No credentials, a real host. */
export function safeHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > URL_MAX) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".")) return null;
  return u.toString() === `${s}/` ? s : u.toString();
}

function amountString(cents: number | undefined): string | undefined {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) {
    return undefined;
  }
  return (Math.round(cents) / 100).toFixed(2);
}

/** Strip a pasted profile URL down to its last path segment. */
function lastSegment(raw: string, hosts: RegExp): string {
  const s = raw.trim();
  const m = s.match(
    new RegExp(
      `^(?:https?://)?(?:www\\.)?${hosts.source}/(?:u/)?([^/?#]+)`,
      "i",
    ),
  );
  return m ? decodeURIComponent(m[1]) : s;
}

/** "@Hans-Hansen" / "venmo.com/u/hans" → "Hans-Hansen"; null when it cannot be a username. */
export function venmoUsername(handle?: string): string | null {
  if (!handle) return null;
  const s = lastSegment(handle, /venmo\.com/).replace(/^@/, "");
  return /^[A-Za-z0-9_-]{1,30}$/.test(s) ? s : null;
}

/** "$AcmeRoof" / "cash.app/$acme" → "AcmeRoof"; a cashtag starts with a letter. */
export function cashtagOf(handle?: string): string | null {
  if (!handle) return null;
  const s = lastSegment(handle, /cash\.app/).replace(/^\$/, "");
  return /^[A-Za-z][A-Za-z0-9_-]{0,19}$/.test(s) ? s : null;
}

/** "acmeroof" / "@acmeroof" / "paypal.me/acmeroof" → "acmeroof"; an email is not a PayPal.me. */
export function paypalMeHandle(handle?: string): string | null {
  if (!handle || handle.includes("@") && !handle.trim().startsWith("@")) {
    return null;
  }
  const s = lastSegment(handle, /paypal\.me/).replace(/^@/, "");
  return /^[A-Za-z0-9]{1,20}$/.test(s) ? s : null;
}

export function venmoPayUrl(
  handle: string | undefined,
  amountCents?: number,
  note?: string,
): string | null {
  const user = venmoUsername(handle);
  if (!user) return null;
  const amt = amountString(amountCents);
  const n = note?.trim();
  return `https://venmo.com/${encodeURIComponent(user)}?txn=pay${
    amt ? `&amount=${amt}` : ""
  }${n ? `&note=${encodeURIComponent(n)}` : ""}`;
}

export function cashAppPayUrl(
  handle: string | undefined,
  amountCents?: number,
): string | null {
  const tag = cashtagOf(handle);
  if (!tag) return null;
  const amt = amountString(amountCents);
  return `https://cash.app/$${tag}${amt ? `/${amt}` : ""}`;
}

export function paypalPayUrl(
  handle: string | undefined,
  amountCents?: number,
): string | null {
  const h = paypalMeHandle(handle);
  if (!h) return null;
  const amt = amountString(amountCents);
  return `https://paypal.me/${h}${amt ? `/${amt}USD` : ""}`;
}

// ---------------------------------------------------------------- the stored list

export type PayLinksCheck =
  | { ok: true; links: PayLink[] }
  | {
    ok: false;
    reason:
      | "not_list"
      | "too_many"
      | "name_missing"
      | "name_too_long"
      | "url_invalid"
      | "url_not_https";
    index?: number;
  };

function mintId(taken: Set<string>): string {
  for (;;) {
    const id = `l-${Math.random().toString(36).slice(2, 10)}`;
    if (!taken.has(id)) return id;
  }
}

/** Validate + normalize the business's custom links (trimmed names, https URLs, ids kept or minted). */
export function checkPayLinks(raw: unknown): PayLinksCheck {
  if (!Array.isArray(raw)) return { ok: false, reason: "not_list" };
  if (raw.length > MAX_PAY_LINKS) return { ok: false, reason: "too_many" };
  const taken = new Set<string>();
  const out: PayLink[] = [];
  for (let index = 0; index < raw.length; index++) {
    const r = (raw[index] ?? {}) as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) return { ok: false, reason: "name_missing", index };
    if (name.length > PAY_LINK_NAME_MAX) {
      return { ok: false, reason: "name_too_long", index };
    }
    const rawUrl = typeof r.url === "string" ? r.url.trim() : "";
    const url = safeHttpsUrl(rawUrl);
    if (!url) {
      return {
        ok: false,
        reason: /^http:\/\/[^/]+\.[^/]+/i.test(rawUrl)
          ? "url_not_https"
          : "url_invalid",
        index,
      };
    }
    let id = typeof r.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(r.id)
      ? r.id
      : "";
    if (!id || taken.has(id)) id = mintId(taken);
    taken.add(id);
    out.push({ id, name, url, enabled: r.enabled !== false });
  }
  return { ok: true, links: out };
}

// ---------------------------------------------------------------- the public projection

type Toggle = { enabled?: boolean } | null | undefined;
interface LooseMethods {
  check?: Toggle & { mailTo?: string };
  venmo?: Toggle & { handle?: string };
  zelle?: Toggle & { handle?: string };
  cashapp?: Toggle & { cashtag?: string };
  paypal?: Toggle & { handle?: string };
  cash?: Toggle;
  ach?: Toggle & { instructions?: string };
  card?: Toggle & { instructions?: string; url?: string };
  other?: Toggle & { instructions?: string };
  links?: unknown;
}

/** The contractor's accepted methods as the public page reads them. ACH carries only its
 *  customer-facing instructions (never routing/account numbers). */
export function projectPayMethods(apm: unknown): PublicPayMethod[] {
  const m = (apm ?? undefined) as LooseMethods | undefined;
  if (!m || typeof m !== "object") return [];
  const out: PublicPayMethod[] = [];
  if (m.check?.enabled) out.push({ method: "check", handle: m.check.mailTo });
  if (m.venmo?.enabled) out.push({ method: "venmo", handle: m.venmo.handle });
  if (m.zelle?.enabled) out.push({ method: "zelle", handle: m.zelle.handle });
  if (m.cashapp?.enabled) {
    out.push({ method: "cashapp", handle: m.cashapp.cashtag });
  }
  if (m.paypal?.enabled) {
    out.push({ method: "paypal", handle: m.paypal.handle });
  }
  if (m.cash?.enabled) out.push({ method: "cash" });
  if (m.ach?.enabled) out.push({ method: "ach", handle: m.ach.instructions });
  if (m.card?.enabled) {
    // REQ-782 — the business's card pay link (its own Stripe / Square / PayPal checkout page);
    // an owner who pasted the link into the instructions (the old placeholder said so) counts too
    const url = safeHttpsUrl(m.card.url) ?? safeHttpsUrl(m.card.instructions);
    out.push({
      method: "card",
      handle: m.card.instructions,
      ...(url ? { url } : {}),
    });
  }
  if (m.other?.enabled) {
    out.push({ method: "other", handle: m.other.instructions });
  }
  if (Array.isArray(m.links)) {
    for (const l of m.links as Array<Record<string, unknown>>) {
      if (!l || l.enabled === false) continue;
      const url = safeHttpsUrl(l.url);
      const name = typeof l.name === "string" ? l.name.trim() : "";
      if (!url || !name || typeof l.id !== "string") continue;
      out.push({ method: "link", id: l.id, name, url });
    }
  }
  return out;
}

const APP_ORDER = ["venmo", "cashapp", "paypal"] as const;

/** The buttons for /i/:id: the app links (amount prefilled), the custom links, then what can only
 *  be copied (Zelle, a PayPal email, a handle that makes no link). */
export function payButtons(
  methods: PublicPayMethod[],
  opts: { amountCents?: number; note?: string } = {},
): PayButton[] {
  const links: PayButton[] = [];
  const copies: PayButton[] = [];
  for (const method of APP_ORDER) {
    const m = methods.find((x) => x.method === method);
    if (!m) continue;
    const href = method === "venmo"
      ? venmoPayUrl(m.handle, opts.amountCents, opts.note)
      : method === "cashapp"
      ? cashAppPayUrl(m.handle, opts.amountCents)
      : paypalPayUrl(m.handle, opts.amountCents);
    if (href) {
      links.push({
        kind: "link",
        key: method,
        method,
        label: BRAND[method],
        href,
        ...(m.handle?.trim() ? { detail: m.handle.trim() } : {}),
      });
    } else if (m.handle?.trim()) {
      copies.push({
        kind: "copy",
        key: method,
        method,
        label: BRAND[method],
        value: m.handle.trim(),
      });
    }
  }
  for (const m of methods) {
    if (m.method !== "link" || !m.url || !m.name || !m.id) continue;
    const href = safeHttpsUrl(m.url);
    if (!href) continue;
    links.push({
      kind: "link",
      key: `link-${m.id}`,
      method: "link",
      label: m.name,
      href,
    });
  }
  const zelle = methods.find((x) => x.method === "zelle");
  if (zelle?.handle?.trim()) {
    copies.push({
      kind: "copy",
      key: "zelle",
      method: "zelle",
      label: BRAND.zelle,
      value: zelle.handle.trim(),
    });
  }
  return [...links, ...copies];
}

/** The online ways to pay, by name, for the invoice text and email: "card" (when the business
 *  takes cards on its Stripe) first, then the apps, Zelle and the custom links. */
export function payWayNames(
  methods: PublicPayMethod[],
  opts: { card: boolean },
): string[] {
  const out: string[] = opts.card || hasCardPayLink(methods) ? ["card"] : [];
  for (const method of [...APP_ORDER, "zelle"]) {
    const m = methods.find((x) => x.method === method);
    if (m?.handle?.trim()) out.push(BRAND[method]);
  }
  for (const m of methods) {
    if (m.method === "link" && m.name) out.push(m.name);
  }
  return out;
}

/**
 * REQ-630 AMENDMENT — "is payment set up?": any of the nine methods switched on, or any enabled
 * custom link with a safe https URL. The one rule every checklist / onboarding / assistant check uses,
 * so a business paid only through its own links ("Extra Pay") is never nagged to set up payments.
 */
export function hasAnyPayWay(apm: unknown): boolean {
  if (!apm || typeof apm !== "object") return false;
  for (const [key, m] of Object.entries(apm as Record<string, unknown>)) {
    if (key === "links") {
      if (!Array.isArray(m)) continue;
      if (
        m.some((l) =>
          l && typeof l === "object" &&
          (l as { enabled?: unknown }).enabled !== false &&
          safeHttpsUrl((l as { url?: unknown }).url) !== null
        )
      ) return true;
      continue;
    }
    if (m && typeof m === "object" && (m as { enabled?: unknown }).enabled === true) return true;
  }
  return false;
}

// ---------------------------------------------------------------- REQ-782: card = a separate portal

/**
 * REQ-782 (demo-loop dv1, d10) — Raphael: "Card payments should be a link to a separate portal."
 * The business's card pay link, as typed in Settings: empty clears it; otherwise https only.
 */
export type CardPayUrlCheck =
  | { ok: true; url: string | undefined }
  | { ok: false; reason: "url_not_https" | "url_invalid" };

export function checkCardPayUrl(raw: unknown): CardPayUrlCheck {
  if (raw === undefined || raw === null) return { ok: true, url: undefined };
  if (typeof raw !== "string") return { ok: false, reason: "url_invalid" };
  const s = raw.trim();
  if (!s) return { ok: true, url: undefined };
  const url = safeHttpsUrl(s);
  if (url) return { ok: true, url };
  return {
    ok: false,
    reason: /^http:\/\/[^/]+\.[^/]+/i.test(s) ? "url_not_https" : "url_invalid",
  };
}

/** The projected methods carry a card pay link. */
export function hasCardPayLink(methods: PublicPayMethod[]): boolean {
  return methods.some((m) => m.method === "card" && !!safeHttpsUrl(m.url));
}

/** Where "Pay by card" goes: the business's own Stripe → our card portal page `/i/:id/pay`
 *  (the widget charges the balance on their key); else their own Square (REQ-803) → Square's
 *  hosted checkout for the balance (the button asks the server for it; `href` is the portal
 *  page, the no-script way); else their card pay link; else nowhere — no button, never a dead
 *  end. One card provider at a time (REQ-803): Stripe first if both were ever on. */
export type CardPayWay =
  | { kind: "portal"; href: string }
  | { kind: "square"; href: string }
  | { kind: "link"; href: string; host: string };

export function cardPayWay(opts: {
  invoiceId: string;
  stripe: boolean;
  /** REQ-803 — the business's own Square is connected */
  square?: boolean;
  methods: PublicPayMethod[];
  lang?: string;
}): CardPayWay | null {
  const portal = `/i/${encodeURIComponent(opts.invoiceId)}/pay${
    opts.lang === "es" ? "?lang=es" : ""
  }`;
  if (opts.stripe) return { kind: "portal", href: portal };
  if (opts.square) return { kind: "square", href: portal };
  const card = opts.methods.find((m) => m.method === "card");
  const href = safeHttpsUrl(card?.url);
  if (!href) return null;
  return { kind: "link", href, host: new URL(href).hostname };
}
