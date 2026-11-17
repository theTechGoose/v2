/**
 * REQ-826 (demo-loop cycle dm2, issue p10) — the stage's "Now showing {name}'s other tab" banner
 * (REQ-645) printed the mirrored page's raw path, `/q/cfe16416-…?lang=en`. It names the page now:
 * the path is reduced to a page-name key (`demoMode.page.*`, localized in lang/*.json); the query
 * string, the hash and any ID are never shown. A page with no name of its own reads as its first
 * path segment ("/field-notes/…" → "Field notes"), and a first segment that is an ID as "another
 * page".
 */

/** first segment → the key for the page itself and, when an ID or sub-path follows, for one item */
const PAGES: Record<string, [list: string, item?: string]> = {
  dashboard: ["dashboard"],
  q: ["quote"],
  quotes: ["quotes", "quote"],
  i: ["invoice"],
  invoices: ["invoices", "invoice"],
  customers: ["customers", "customer"],
  clients: ["customers", "customer"],
  payments: ["payments"],
  pay: ["payment"],
  settings: ["settings"],
  assistant: ["assistant"],
  messages: ["messages"],
  "work-orders": ["workOrders", "workOrder"],
  wo: ["workOrder"],
  reports: ["reports"],
  plan: ["plan"],
  login: ["signIn"],
  verify: ["signIn"],
  welcome: ["welcome"],
  // REQ-826 AMENDMENT 2 (dm8, m5) — the pages the fallback printed raw ("(Field)", "(Terms)")
  field: ["field"],
  worker: ["worker"],
  terms: ["terms"],
  privacy: ["privacy"],
  "refund-policy": ["refundPolicy"],
  "sms-terms": ["smsTerms"],
  contracts: ["contracts", "contract"],
  co: ["contract"],
  admin: ["admin"],
  admins: ["admin"],
  contact: ["contact"],
  "accounts-manager": ["accounts"],
  ops: ["ops"],
  s: ["sign"],
  demo: ["demo"],
};

const KEY = "demoMode.page.";

/** an ID-like segment: a UUID, a number, or a long run of hex/alphanumerics with a digit */
function looksLikeId(seg: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /^\d+$/.test(seg) ||
    (seg.length >= 12 && /\d/.test(seg) && /^[A-Za-z0-9_-]+$/.test(seg));
}

function segments(path: string): string[] {
  return path.split(/[?#]/)[0].split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
}

/** the lang key naming the page at `path`, or null for a page with no name of its own */
export function pageLabelKey(path: string): string | null {
  const segs = segments(path);
  if (segs.length === 0) return `${KEY}home`;
  const first = segs[0].toLowerCase();
  const page = PAGES[first];
  if (page) return KEY + (segs.length > 1 && page[1] ? page[1] : page[0]);
  if (looksLikeId(segs[0])) return `${KEY}other`;
  return null;
}

/** the page's name for people: `tr` localizes a key; an unnamed page is named by its document
 *  title when one is known (REQ-826 AMENDMENT 3, demo-loop run 9 p1: a 404 page typed by hand
 *  read "(Outbox)" / "(Campo)" from its path; its title says "No encontramos esa página"), else
 *  its first segment */
export function pageLabel(
  path: string,
  tr: (key: string) => string,
  title?: string | null,
): string {
  const key = pageLabelKey(path);
  if (key) return tr(key);
  const named = titleName(title);
  if (named) return named;
  const seg = segments(path)[0].replace(/[-_]+/g, " ").trim();
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

/** REQ-826 AMENDMENT 3 — the page's own name out of its document title: the part before the
 *  app's " · DocuMonster" (or " | " / " - ") suffix, trimmed; nothing for an empty or bare
 *  app-name title */
export function titleName(title?: string | null): string {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const head = t.split(/\s[·|–—-]\s/)[0].trim();
  if (!head || /^documonster$/i.test(head)) return "";
  return head.length > 40 ? `${head.slice(0, 39)}…` : head;
}
