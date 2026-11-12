/**
 * REQ-496 (demo-loop cycle 3, m36) — the ONE renderer for a notification's
 * title, shared by the backend feed (`localizeNotification`, P-59) and the
 * topbar ticker (DashTopbar), so the ticker can re-render the title in the
 * live UI language the instant the EN/ES switch flips — instead of showing
 * the server's string, rendered in the language `user.language` held at
 * fetch time, until a coalesced refetch lands (seconds later).
 *
 * Callers pass their own lookup (`t(lang, …)` on the backend, `tFor(lang, …)`
 * on the front-end); both read the same /lang/en.json + /lang/es.json.
 */
import { sentenceCase } from "./format-helpers.ts";

export type NotifVars = Record<string, string | number>;
export type NotifTranslate = (key: string, vars?: NotifVars) => string;

/** The fields a feed row carries for re-rendering (P-59). */
export interface LocalizableNotification {
  title: string;
  titleKey?: string;
  titleParams?: NotifVars;
}

/** PaymentMethod enum → the "paid <phrase>" label shared with /invoices. */
const METHOD_PHRASE_KEY: Record<string, string> = {
  ach: "invoicesPage.method.ach",
  card: "invoicesPage.method.card",
  cash: "invoicesPage.method.cash",
  cashapp: "invoicesPage.method.cashApp",
  check: "invoicesPage.method.check",
  other: "invoicesPage.method.other",
  paypal: "invoicesPage.method.paypal",
  venmo: "invoicesPage.method.venmo",
  zelle: "invoicesPage.method.zelle",
};

/** Integer cents → "$450" / "$1,234.50" (whole dollars drop the cents). */
function fmtCents(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    })
  }`;
}

/**
 * REQ-224 (demo M36 / i18n-formatting-m14): raw domain values are formatted
 * at render time, in the viewer's language — never baked into the stored
 * params.
 *   - `amountCents` (integer cents) → `{amount}` as dollars ("$450").
 *     A legacy numeric `amount` is the same integer cents; a string
 *     `amount` is pre-formatted.
 *   - `method` (the PaymentMethod enum, "zelle") → its localized phrase.
 */
function renderParams(
  tr: NotifTranslate,
  params?: NotifVars,
  lang?: "en" | "es",
): NotifVars {
  if (!params) return {};
  const out: NotifVars = { ...params };
  // REQ-589 (demo-loop cycle 4, m15): the job's name in the reader's
  // language (`job_en` / `job_es`, from the quote's jobNameByLang), else the
  // one name the event carried.
  const jobInLang = lang ? params[`job_${lang}`] : undefined;
  if (typeof jobInLang === "string" && jobInLang.trim()) out.job = jobInLang;
  delete out.job_en;
  delete out.job_es;
  if (typeof params.amountCents === "number") {
    out.amount = fmtCents(params.amountCents);
  } else if (typeof params.amount === "number") {
    out.amount = fmtCents(params.amount);
  }
  delete out.amountCents;
  if (typeof params.method === "string") {
    const key = METHOD_PHRASE_KEY[params.method];
    if (key) out.method = tr(key);
  }
  return out;
}

/**
 * Render a notification template. A default `{name}` (the localized "your
 * client" fallback) is injected first so a name-less event still reads in
 * the viewer's language, then overridden by any real params.
 */
export function renderNotifString(
  tr: NotifTranslate,
  key: string,
  params?: NotifVars,
  lang?: "en" | "es",
): string {
  return tr(key, {
    name: tr("notify.fallbackClient"),
    ...renderParams(tr, params, lang),
  });
}

/**
 * The title as the feed shows it: re-rendered from `titleKey` + params and
 * sentence-cased (P-59); a legacy row without a key keeps its stored title.
 */
export function notificationTitle(
  tr: NotifTranslate,
  n: LocalizableNotification,
  lang?: "en" | "es",
): string {
  if (!n.titleKey) return n.title;
  return sentenceCase(
    renderNotifString(tr, n.titleKey, n.titleParams, lang),
  );
}
