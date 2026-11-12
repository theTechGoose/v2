/**
 * REQ-583 (demo-loop cycle 4, M2) — the pure reads behind a chat that sends
 * the invoice and records the payment it is told about.
 *
 * The chat model had no invoice or payment tool, and the only billing path in
 * code (REQ-368's AnswerBilling) only said where the bill stood:
 *   pair 1: "Linda paid the deposit $1,425 by Zelle today. Send her the
 *           invoice" → the deposit invoice's state; the Zelle payment ignored.
 *   pair 7: "she paid the deposit by check" → "You can check the payment
 *           status in the Invoices section.".
 *   pair 3: "send it to her now please", right after "INV-001 hasn't gone out
 *           yet — it's scheduled for Nov 19" → "I can't send the invoice
 *           directly…"; pair 9 the same in Spanish ("Mándala ahora…").
 *
 *   parsePaymentReport — "<customer> paid <amount> <how>": a payment to
 *                        record. Never a question, a "hasn't paid", a plan
 *                        ("will pay", "to be paid on completion") or what the
 *                        contractor paid someone else.
 *   parseSendInvoiceAsk — "send it (now)", "Mándala ahora", "Send INV-001
 *                        now" (the card's own button words). A general "send
 *                        him the invoice" is not one: it answers with where
 *                        the bill stands (REQ-368) and offers Send now.
 *   liveSendOffer      — the Send-now card the reply to the last message
 *                        offered — what a bare "send it" refers to.
 *   pickPaymentInvoice — which invoice a payment goes on, or ask.
 *   unsentInvoiceOf    — the job's invoice not sent yet (scheduled / draft).
 *   invoicesContext    — the job's invoices, as the chat model reads them.
 *   namedCustomer      — the one customer the message names.
 *
 * REQ-656 (demo-loop cycle 5, M9):
 *   parseJobDoneInvoiceAsk — "Trabajo terminado, necesito facturar: Jorge
 *                        Ruiz, …, $200" / "Job done, need to invoice": the
 *                        work is finished AND it is to be billed. Pair 8's
 *                        typed chip words drafted a quote; pair 1's on a
 *                        signed job only said when the invoice was scheduled.
 */
import type { PaymentMethod } from "@paperwork/dto/invoice.ts";
import { typedAmountsCents } from "@agents/domain/business/change-order-intent/mod.ts";
import { sameDocNumber } from "@agents/domain/business/invoice-removal-intent/mod.ts";
import { findCustomerNamedInText } from "#quote-flow/customer-dedupe.ts";
import { extractQuickQuotePrefill } from "#quote-flow/quick-quote-prefill.ts";

// ---------------------------------------------------------------------------
// "Linda paid the deposit $1,425 by Zelle"
// ---------------------------------------------------------------------------

export interface PaymentReport {
  /** What was paid, INTEGER CENTS — absent: the invoice's balance. */
  amountCents?: number;
  method?: PaymentMethod;
  /** "INV-002" as typed (upper-cased). */
  invoiceNumber?: string;
  /** "the deposit" = the first installment; "the balance" = the last. */
  which?: "deposit" | "balance";
  /** "check #1043" → "1043". */
  reference?: string;
}

const L = String.raw`(?<!\p{L})`;
const R = String.raw`(?!\p{L})`;

/** How it was paid — "Cash App" before "cash". */
const METHODS: readonly [RegExp, PaymentMethod][] = [
  [new RegExp(`${L}cash\\s*app${R}`, "iu"), "cashapp"],
  [new RegExp(`${L}zelle${R}`, "iu"), "zelle"],
  [new RegExp(`${L}venmo${R}`, "iu"), "venmo"],
  [new RegExp(`${L}pay\\s*pal${R}`, "iu"), "paypal"],
  [new RegExp(`${L}(?:checks?|cheques?)${R}`, "iu"), "check"],
  [new RegExp(`${L}(?:cash|efectivo)${R}`, "iu"), "cash"],
  [
    new RegExp(
      `${L}(?:(?:credit|debit)\\s+)?card${R}|${L}tarjeta${R}`,
      "iu",
    ),
    "card",
  ],
  [
    new RegExp(
      `${L}(?:ach|bank\\s+transfer|wire(?:\\s+transfer)?|direct\\s+deposit|transferencia(?:\\s+bancaria)?)${R}`,
      "iu",
    ),
    "ach",
  ],
];

/** The customer paid: "paid", "received the check", "the Zelle came in",
 *  "me pagó", "ya pagó", "recibí el pago", "está pagada". */
const PAID_RES: readonly RegExp[] = [
  new RegExp(`${L}paid${R}`, "iu"),
  new RegExp(
    String
      .raw`${L}(?:received|got|collected|cashed|deposited)\s+(?:(?:the|a|an|her|his|their|my|our|[\p{L}]+['’]s)\s+)?(?:\$|full\s+payment|payment|check|cheque|deposit|money|cash|zelle|venmo|cash\s*app|paypal|transfer|balance|final\s+payment)`,
    "iu",
  ),
  new RegExp(
    String
      .raw`${L}(?:payment|zelle|venmo|cash\s*app|paypal|check|cheque|transfer|deposit|money)${R}[^.!?]{0,40}?${L}(?:came\s+in|landed|cleared|arrived|went\s+through)${R}`,
    "iu",
  ),
  new RegExp(String.raw`${L}(?:me|nos)\s+pag(?:[oó]|aron)${R}`, "iu"),
  new RegExp(String.raw`${L}pag(?:ó|aron)${R}`, "iu"),
  new RegExp(String.raw`${L}(?:ha|han)\s+pagado${R}`, "iu"),
  new RegExp(String.raw`${L}(?:est[aá]|qued[oóaá])\s+pagad[ao]${R}`, "iu"),
  new RegExp(String.raw`${L}(?:recib[ií]|cobr[eé])${R}`, "iu"),
  new RegExp(
    String
      .raw`${L}me\s+(?:lleg[oó]|mand[oó]|envi[oó]|transfiri[oó]|dio|dieron|depositaron|deposit[oó])${R}`,
    "iu",
  ),
];

/** Not a payment that happened: negated, planned, a payment term, or the
 *  contractor paying someone else. */
const NOT_A_PAYMENT_RES: readonly RegExp[] = [
  new RegExp(
    String
      .raw`${L}(?:not|never|hasn['’]?t|haven['’]?t|hadn['’]?t|didn['’]?t|doesn['’]?t|don['’]?t|isn['’]?t|wasn['’]?t|won['’]?t|can['’]?t|cannot|nobody|yet\s+to|still\s+owes?)${R}`,
    "iu",
  ),
  new RegExp(
    String.raw`${L}(?:no|nunca|jam[aá]s)\s+(?:\p{L}+\s+){0,2}?pag`,
    "iu",
  ),
  new RegExp(
    String
      .raw`${L}(?:will|would|could|can|should|must|may|might|going\s+to|gonna|wants?\s+to|plans?\s+to|needs?\s+to|has\s+to|have\s+to|to|be|being|get|gets|getting)\s+(?:\p{L}+\s+)?(?:pay|paid)${R}`,
    "iu",
  ),
  new RegExp(
    String
      .raw`${L}(?:va|van|vas|voy)\s+a\s+pagar|${L}pagar[aá]n?${R}|${L}(?:quiere|puede|debe|tiene\s+que)\s+pagar${R}`,
    "iu",
  ),
  new RegExp(
    String
      .raw`${L}paid\s+(?:in\s+(?:full|\p{L}+\s+(?:installments?|payments?|parts?))\s+)?(?:upon|on|at|after|before|when|once)\s+(?:completion|finish(?:ing)?|signing|signature|the\s+end|delivery|done|approval|start)`,
    "iu",
  ),
  // "paid" describing a thing — "for paid parking", "the paid plan"
  new RegExp(
    String.raw`${L}(?:for|a|an|the|of|with|non|un)[\s-]+paid${R}`,
    "iu",
  ),
  new RegExp(
    String
      .raw`${L}(?:i|we)(?:['’]ve)?\s+(?:just\s+|already\s+|also\s+)?(?:\p{L}+\s+)?paid${R}`,
    "iu",
  ),
  new RegExp(
    String
      .raw`${L}paid\s+(?:\$\s?[\d,.]+\s+)?for\s+(?!(?:the\s+|her\s+|his\s+|their\s+|my\s+|our\s+)?(?:deposit|invoice|balance|job|work|bill|it|this|that|INV-\d+)${R})`,
    "iu",
  ),
];

/** A question: "?", "¿", or an auxiliary up front ("did she pay…"). */
const QUESTION_LEAD_RE =
  /^(?:did|does|do|has|have|had|is|was|were|will|would|could|can|should|when|why|how|whether|if)\b/i;

const DEPOSIT_RE = new RegExp(
  String
    .raw`${L}(?:(?<!direct\s)deposit|down\s*payment|first\s+(?:payment|installment)|anticipo|adelanto|enganche|(?<!un\s)dep[oó]sito|primer\s+pago)${R}`,
  "iu",
);
const BALANCE_RE = new RegExp(
  String
    .raw`${L}(?:balance|remaining|remainder|rest|final\s+(?:payment|invoice|installment)|last\s+(?:payment|invoice|installment)|second\s+(?:payment|half)|saldo|resto|restante|pago\s+final|[uú]ltimo\s+pago|segundo\s+pago)${R}`,
  "iu",
);
const INVOICE_NO_RE = /(?<![\p{L}\p{N}])INV-\d+(?![\p{L}\p{N}])/iu;
/** Something that ties the report to money owed — without one, "she paid"
 *  is too little to record. */
const PAYMENT_SIGNAL_RE = new RegExp(
  `${L}(?:invoice|bill|factura|in\\s+full|completo|todo)${R}`,
  "iu",
);
const REFERENCE_RES: readonly RegExp[] = [
  new RegExp(
    String
      .raw`${L}(?:check|cheque)\s*(?:#|no\.?|number|n[uú]mero)\s*([A-Za-z0-9-]{2,20})`,
    "iu",
  ),
  new RegExp(
    String
      .raw`${L}(?:ref(?:erence)?|confirmation|conf|transaction|tx)\s*(?:#|no\.?|number)?\s*:?\s*([A-Za-z0-9-]{3,30})`,
    "iu",
  ),
];
const DOLLARS_RE =
  /(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(?:dollars?|bucks|d[oó]lares)(?!\p{L})/iu;

/** The message's sentences, each with its own "?" / "¿". */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…\n])\s+|(?=[¿¡])/u).map((s) => s.trim())
    .filter(Boolean);
}

function amountIn(s: string): number | undefined {
  const typed = typedAmountsCents(s);
  if (typed.length > 0) return typed[0] > 0 ? typed[0] : undefined;
  const m = s.match(DOLLARS_RE);
  if (!m) return undefined;
  const cents = Number(m[1].replace(/,/g, "")) * 100 +
    (m[2] ? Number(m[2].padEnd(2, "0")) : 0);
  return cents > 0 ? cents : undefined;
}

/**
 * Read a payment the customer made ("Linda paid the deposit $1,425 by Zelle
 * today", "she paid the deposit by check", "Juan me pagó $450 por Zelle").
 * Undefined unless one sentence says it happened and ties it to money owed
 * (an amount, how, deposit / balance, an invoice).
 */
export function parsePaymentReport(text: string): PaymentReport | undefined {
  for (const s of sentences(text ?? "")) {
    if (!PAID_RES.some((re) => re.test(s))) continue;
    if (/\?\s*$/.test(s) || s.startsWith("¿") || QUESTION_LEAD_RE.test(s)) {
      continue;
    }
    if (NOT_A_PAYMENT_RES.some((re) => re.test(s))) continue;
    const out: PaymentReport = {};
    const amount = amountIn(s);
    if (amount !== undefined) out.amountCents = amount;
    const method = METHODS.find(([re]) => re.test(s))?.[1];
    if (method) out.method = method;
    const number = s.match(INVOICE_NO_RE)?.[0];
    if (number) out.invoiceNumber = number.toUpperCase();
    if (DEPOSIT_RE.test(s)) out.which = "deposit";
    else if (BALANCE_RE.test(s)) out.which = "balance";
    for (const re of REFERENCE_RES) {
      const m = s.match(re);
      if (m) {
        out.reference = m[1];
        break;
      }
    }
    if (Object.keys(out).length === 0 && !PAYMENT_SIGNAL_RE.test(s)) continue;
    return out;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// "send it now" / "Mándala ahora" / "Send INV-001 now"
// ---------------------------------------------------------------------------

export interface SendInvoiceAsk {
  /** The invoice named ("Send INV-001 now" — the card's button words). */
  invoiceNumber?: string;
  /** "text it" / "por mensaje" → text only; "email it" → email only. */
  channel?: "email" | "text";
}

const LEAD = String
  .raw`(?:(?:ok(?:ay)?|yes|yeah|yep|yup|sure|great|perfect|cool|thanks|thank\s+you|please|pls|go\s+ahead(?:\s+and)?|then|now|s[ií]|vale|dale|claro|perfecto|bueno|listo|gracias|entonces|ahora|por\s+favor|porfa)[\s,.!]+)*`;
const ASK = String
  .raw`(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:puedes|podr[ií]as)\s+)?`;
const NAME = String.raw`\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)?`;
const NOW_WORDS = String
  .raw`now|right\s+now|right\s+away|today|asap|early|already|please|pls|then|out|off|over|again|thanks|thank\s+you|by\s+(?:text|sms|email|e-mail)|via\s+(?:text|sms|email|e-mail)|ahora(?:\s+mismo)?|ya|hoy|de\s+una\s+vez|por\s+favor|porfa|porfavor|pf|por\s+(?:mensaje(?:\s+de\s+texto)?|texto|sms|correo|email|e-mail|whats(?:app)?)`;
/** After the ask: "now", "please"… then anything only past a punctuation
 *  mark ("Mándala ahora por favor, ya terminé hoy"). */
const TAIL = String
  .raw`(?:\s+(?:${NOW_WORDS}))*[\s.!?]*(?:[,;:.!?—–-]\s*.*)?$`;
const SEND_RES: readonly RegExp[] = [
  new RegExp(
    String
      .raw`^\s*${LEAD}${ASK}(?<verb>send|text|email|e-mail|shoot|fire\s+off|issue)(?:\s+(?:her|him|them))?(?:\s+(?:(?<num>INV-\d+)|it|that|this|that\s+one|this\s+one))?(?:\s+(?:off|out|over|along))?(?:\s+to\s+(?:her|him|them|the\s+(?:customer|client|homeowner)|(?<name>${NAME})))?${TAIL}`,
    "iu",
  ),
  new RegExp(
    String
      .raw`^\s*${LEAD}${ASK}(?<verb>(?:m[aá]nd|env[ií])(?:a|e)(?:sel[ao]|l[ao]|les?)?)(?:\s+(?<num>INV-\d+))?(?:\s+a\s+(?:(?:el|la)\s+cliente|ella|[eé]l|(?<name>${NAME})))?${TAIL}`,
    "iu",
  ),
];
/** Not now: "don't", "later", "tomorrow", "todavía no"… */
const NOT_NOW_RE = new RegExp(
  String
    .raw`${L}(?:don['’]?t|do\s+not|not\s+(?:yet|now|until)|later|tomorrow|next\s+(?:week|month)|until|todav[ií]a\s+no|a[uú]n\s+no|despu[eé]s|luego|mañana|hasta)${R}`,
  "iu",
);
const TEXT_CHANNEL_RE = new RegExp(
  String
    .raw`^\s*${LEAD}${ASK}text${R}|${L}(?:by|via)\s+(?:text|sms)${R}|${L}por\s+(?:mensaje|texto|sms|whats(?:app)?)${R}`,
  "iu",
);
const EMAIL_CHANNEL_RE = new RegExp(
  String
    .raw`^\s*${LEAD}${ASK}e-?mail${R}|${L}(?:by|via)\s+e-?mail${R}|${L}por\s+(?:correo|e-?mail)${R}`,
  "iu",
);

/** Read "send it now" — an ask to send the invoice in front of them NOW.
 *  Undefined for anything else, a later send, or a question. */
export function parseSendInvoiceAsk(text: string): SendInvoiceAsk | undefined {
  const s = (text ?? "").trim();
  if (!s || NOT_NOW_RE.test(s)) return undefined;
  for (const re of SEND_RES) {
    const m = s.match(re);
    if (!m) continue;
    // a person is named with a capital ("to Maria") — the `i` flag lets
    // \p{Lu} match "me", so it is checked here
    const name = m.groups?.name;
    if (name && (!/^\p{Lu}/u.test(name) || /^(?:me|us|myself)$/i.test(name))) {
      continue;
    }
    const out: SendInvoiceAsk = {};
    if (m.groups?.num) out.invoiceNumber = m.groups.num.toUpperCase();
    if (TEXT_CHANNEL_RE.test(s)) out.channel = "text";
    else if (EMAIL_CHANNEL_RE.test(s)) out.channel = "email";
    return out;
  }
  return undefined;
}

/** A thread message, as far as the offer needs it. */
export interface OfferMessage {
  role: string;
  kind: string;
  content?: string;
  payload?: Record<string, unknown> | unknown;
}

const UNSENT = new Set(["scheduled", "draft"]);

/** The Send-now card the reply to the latest message offered (an invoice
 *  not sent yet), or undefined — an older offer is not what "it" means. */
export function liveSendOffer(
  earlier: readonly OfferMessage[],
): { invoiceId: string; number?: string } | undefined {
  let lastUser = -1;
  earlier.forEach((m, i) => {
    if (m.role === "user") lastUser = i;
  });
  for (let i = earlier.length - 1; i > lastUser; i--) {
    const m = earlier[i];
    if (m.role !== "assistant" || m.kind !== "action_card") continue;
    const p = (m.payload ?? {}) as Record<string, unknown>;
    if (p.actionType !== "invoice" || p.offerSend !== true) continue;
    if (typeof p.invoiceId !== "string" || !p.invoiceId) continue;
    if (typeof p.status === "string" && !UNSENT.has(p.status)) continue;
    return {
      invoiceId: p.invoiceId,
      ...(typeof p.number === "string" && p.number ? { number: p.number } : {}),
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Which invoice
// ---------------------------------------------------------------------------

export interface PayableInvoice {
  id: string;
  number?: string;
  status?: string;
  amount?: number;
  paidCents?: number | null;
  paidAt?: string | null;
  installmentIndex?: number;
  installmentTotal?: number;
  createdAt?: string;
  scheduledFor?: string;
  dueDate?: string;
}

export type PaymentPick<T> =
  | { kind: "invoice"; invoice: T; amountCents: number }
  | { kind: "already_paid"; invoice: T }
  | { kind: "ask"; candidates: T[] }
  | { kind: "none" };

/** Out with the customer (REQ-397's open receivable statuses). */
const OPEN = new Set(["sent", "viewed", "claimed", "pending", "overdue"]);

export function balanceOf(inv: PayableInvoice): number {
  return Math.max(0, (inv.amount ?? 0) - (inv.paidCents ?? 0));
}

function isPaid(inv: PayableInvoice): boolean {
  return inv.status === "paid" || !!inv.paidAt ||
    ((inv.amount ?? 0) > 0 && balanceOf(inv) === 0);
}

function byInstallment(a: PayableInvoice, b: PayableInvoice): number {
  return (a.installmentIndex ?? 1) - (b.installmentIndex ?? 1) ||
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
}

/** "the deposit": the first installment of several; "the balance": the
 *  last. A one-invoice job's only invoice is either. */
function byWhich<T extends PayableInvoice>(
  live: readonly T[],
  which: "deposit" | "balance",
): T[] {
  const split = live.filter((i) => (i.installmentTotal ?? 1) > 1);
  if (split.length > 0) {
    if (which === "deposit") {
      return split.filter((i) => (i.installmentIndex ?? 1) === 1);
    }
    const last = Math.max(...split.map((i) => i.installmentIndex ?? 1));
    return split.filter((i) => (i.installmentIndex ?? 1) === last);
  }
  return live.length === 1 ? [live[0]] : [];
}

/**
 * The invoice a payment goes on, from `invoices` (the conversation's job's,
 * the named customer's, or — `amountMustMatch` — all of the contractor's):
 * the number named; else deposit / balance; else the one whose balance (or
 * amount) is the amount paid; else the only one still owed, or the only one
 * out with the customer. Two that fit → ask; nothing owed → already paid or
 * none. Across all invoices only an exact amount picks one.
 */
export function pickPaymentInvoice<T extends PayableInvoice>(
  invoices: readonly T[],
  report: PaymentReport,
  opts: { amountMustMatch?: boolean } = {},
): PaymentPick<T> {
  const live = invoices.filter((i) => (i.status ?? "") !== "void")
    .sort(byInstallment);
  const take = (inv: T): PaymentPick<T> =>
    isPaid(inv) ? { kind: "already_paid", invoice: inv } : {
      kind: "invoice",
      invoice: inv,
      amountCents: report.amountCents ?? balanceOf(inv),
    };
  if (report.invoiceNumber) {
    const hit = live.find((i) =>
      typeof i.number === "string" &&
      sameDocNumber(i.number, report.invoiceNumber!)
    );
    return hit ? take(hit) : { kind: "none" };
  }
  const unpaid = live.filter((i) => !isPaid(i));
  const amount = report.amountCents;
  const byAmount = (pool: readonly T[]): T[] => {
    if (amount === undefined) return [];
    const exact = pool.filter((i) => balanceOf(i) === amount);
    return exact.length > 0 ? exact : pool.filter((i) => i.amount === amount);
  };
  const narrow = (pool: T[]): PaymentPick<T> | undefined => {
    if (pool.length === 1) return take(pool[0]);
    const open = pool.filter((i) => OPEN.has(i.status ?? ""));
    if (open.length === 1) return take(open[0]);
    if (pool.length > 1) {
      return { kind: "ask", candidates: open.length > 1 ? open : pool };
    }
    return undefined;
  };

  if (opts.amountMustMatch) {
    let pool = byAmount(unpaid);
    if (report.which && pool.length > 1) {
      const which = byWhich(pool, report.which);
      if (which.length > 0) pool = which;
    }
    return narrow(pool) ?? { kind: "none" };
  }
  if (report.which) {
    const which = byWhich(live, report.which);
    if (which.length === 1) return take(which[0]);
  }
  const matched = narrow(byAmount(unpaid));
  if (matched) return matched;
  const rest = narrow(unpaid);
  if (rest) return rest;
  const lastPaid = live.filter(isPaid).at(-1);
  return lastPaid ? { kind: "already_paid", invoice: lastPaid } : {
    kind: "none",
  };
}

/** The job's first invoice not sent yet — scheduled or drafted, never void. */
export function unsentInvoiceOf<T extends PayableInvoice>(
  invoices: readonly T[],
): T | undefined {
  return invoices.filter((i) => UNSENT.has(i.status ?? ""))
    .sort(byInstallment)[0];
}

export function isUnsentInvoice(inv: { status?: string }): boolean {
  return UNSENT.has(inv.status ?? "");
}

// ---------------------------------------------------------------------------
// What the chat model reads
// ---------------------------------------------------------------------------

function usd(cents: number): string {
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/** The job's invoices, one line each — what is billed, scheduled, paid. */
export function invoicesContext(invoices: readonly PayableInvoice[]): string {
  const live = invoices.filter((i) => (i.status ?? "") !== "void")
    .sort(byInstallment);
  if (live.length === 0) return "";
  const lines = live.map((i) => {
    const total = i.installmentTotal ?? 1;
    const part = total > 1 ? ` (${i.installmentIndex ?? 1} of ${total})` : "";
    const head = `- ${i.number ?? i.id} ${usd(i.amount ?? 0)}${part}: `;
    const status = i.status ?? "draft";
    if (isPaid(i)) return `${head}paid`;
    if (status === "scheduled") {
      const when = i.scheduledFor ?? i.dueDate;
      return `${head}scheduled${
        when ? ` to go out ${when}` : ""
      } — not sent yet`;
    }
    if (status === "draft") return `${head}drafted — not sent yet`;
    const owed = `${usd(balanceOf(i))} still owed`;
    if (status === "claimed") {
      return `${head}the customer says they paid — not confirmed yet, ${owed}`;
    }
    return `${head}${status}${i.dueDate ? `, due ${i.dueDate}` : ""} — ${owed}`;
  });
  return ["Invoices on this quote:", ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Who
// ---------------------------------------------------------------------------

const fold = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** The one customer the message names: the whole name typed (REQ-386),
 *  else one customer's first name typed as a name ("…de Carmen."). */
export function namedCustomer<C extends { id: string; name: string }>(
  customers: readonly C[],
  text: string,
): C | undefined {
  const strict = findCustomerNamedInText([...customers], text);
  if (strict) return strict;
  const typed = new Set(
    (text ?? "").match(/\p{Lu}[\p{L}'’-]{2,}/gu)?.map(fold) ?? [],
  );
  const hits = customers.filter((c) => {
    const first = (c.name ?? "").trim().split(/\s+/)[0] ?? "";
    return first.length >= 3 && typed.has(fold(first));
  });
  return hits.length === 1 ? hits[0] : undefined;
}

// ---------------------------------------------------------------------------
// REQ-656 (demo-loop cycle 5, M9) — "Job done, need to invoice"
// ---------------------------------------------------------------------------

export interface JobDoneInvoiceAsk {
  /** The amount typed, INTEGER CENTS. */
  amountCents?: number;
  /** "Jorge Ruiz" — who to bill, as typed. */
  customerName?: string;
  customerEmail?: string;
}

/** The work is finished: "job done", "just finished", "the job is complete",
 *  "trabajo terminado", "ya terminé", "acabamos", "ya está hecho". */
const DONE_RES: readonly RegExp[] = [
  new RegExp(
    String
      .raw`${L}(?:done|finished|completed?|wrapped\s+up|all\s+set)${R}`,
    "iu",
  ),
  new RegExp(
    String
      .raw`${L}(?:terminad[oa]s?|termin[eé]|terminamos|terminaron|termin[oó]|acabad[oa]s?|acab[eé]|acabamos|acabaron|acab[oó]|completad[oa]s?|complet[eé]|completamos|finalizad[oa]s?|finalic[eé]|finalizamos)${R}`,
    "iu",
  ),
  new RegExp(
    String
      .raw`${L}(?:trabajo|obra|proyecto|servicio)\s+(?:ya\s+)?(?:est[aá]\s+|qued[oó]\s+)?(?:hech[oa]|list[oa])${R}`,
    "iu",
  ),
];
/** Not finished yet, or only once it is: "when it's done", "isn't done",
 *  "todavía no termino", "cuando termine". */
const NOT_DONE_RES: readonly RegExp[] = [
  new RegExp(
    String
      .raw`${L}(?:when|once|after|until|before|if|as\s+soon\s+as)\s+(?:\p{L}+['’]?\p{L}*\s+){0,4}?(?:done|finish|finished|complete|completed|wrapped)${R}`,
    "iu",
  ),
  new RegExp(
    String
      .raw`${L}(?:not|isn['’]?t|aren['’]?t|wasn['’]?t|haven['’]?t|hasn['’]?t|never)\s+(?:\p{L}+\s+){0,2}?(?:done|finished|complete|completed)${R}`,
    "iu",
  ),
  new RegExp(
    String
      .raw`${L}(?:no|todav[ií]a\s+no|a[uú]n\s+no)\s+(?:\p{L}+\s+){0,2}?(?:termin|acab|complet|finaliz|est[aá]\s+(?:hech|list|terminad))`,
    "iu",
  ),
  new RegExp(
    String
      .raw`${L}(?:cuando|una\s+vez\s+que|en\s+cuanto|hasta\s+que|si)\s+(?:\p{L}+\s+){0,3}?(?:termin|acab|complet|finalic|finalice|est[eé]\s+(?:hech|list))`,
    "iu",
  ),
];
/** And it is to be billed: "invoice", "bill him", "factura(r)", "cobrar". */
const BILL_RES: readonly RegExp[] = [
  new RegExp(String.raw`${L}invoic(?:e|es|ed|ing)${R}`, "iu"),
  new RegExp(String.raw`${L}bill${R}`, "iu"),
  new RegExp(String.raw`${L}fact[uú]r\p{L}*`, "iu"),
  new RegExp(String.raw`${L}c[oó]br(?:ar|arle|arles|ale|ales|a|o)${R}`, "iu"),
];
/** A quote asked for — that is drafting, not billing a finished job. */
const QUOTE_ASK_RE = new RegExp(
  String
    .raw`${L}(?:(?:make|draft|create|write|need|send)\s+(?:me\s+)?(?:a|an|the)\s+(?:quote|estimate|bid)|(?:haz(?:me)?|prepara(?:me)?|necesito)\s+(?:una\s+)?cotizaci[oó]n)${R}`,
  "iu",
);
/** Someone already paid / is reporting money in — REQ-583's payment path. */
const PAYMENT_REPORTED_RE = new RegExp(
  String
    .raw`${L}(?:paid|pag[oó]|pagaron|me\s+pag)${R}`,
  "iu",
);
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/u;
/** A person's name: 2–3 capitalised words. */
const PERSON = String.raw`\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){1,2}`;
const NAME_AFTER_RES: readonly RegExp[] = [
  // "facturar: Jorge Ruiz", "invoice Mike Ross", "factura a María López",
  // "bill Tom Baker", "for Carmen Ruiz", "de Juan Pérez", "para Ana Gómez"
  new RegExp(
    String
      .raw`${L}(?:invoice|bill|fact[uú]r\p{L}*|c[oó]br\p{L}*|for|para|de|a|to)\s*:?\s+(?:(?:a|to|for)\s+)?(${PERSON})`,
    "u",
  ),
];
/** Never a name: words that only look like one ("Que pague hoy"). */
const NOT_A_NAME_RE =
  /^(?:Que|The|This|That|Job|Trabajo|Q-\d+|INV-\d+)(?:\s|$)/u;

/**
 * Read "the job is finished — bill it" (REQ-656): the work is done (and not
 * "when it's done" / "todavía no"), billing is asked, no quote is asked, and
 * no payment is being reported. Undefined otherwise; else what the sentence
 * says about who and how much.
 */
export function parseJobDoneInvoiceAsk(
  text: string,
): JobDoneInvoiceAsk | undefined {
  const s = (text ?? "").trim();
  if (!s) return undefined;
  if (!DONE_RES.some((re) => re.test(s))) return undefined;
  if (NOT_DONE_RES.some((re) => re.test(s))) return undefined;
  if (!BILL_RES.some((re) => re.test(s))) return undefined;
  if (QUOTE_ASK_RE.test(s) || PAYMENT_REPORTED_RE.test(s)) return undefined;
  // a question about it ("Is the job done? Did you invoice her?")
  if (sentences(s).every((x) => /\?\s*$/.test(x) || x.startsWith("¿"))) {
    return undefined;
  }
  if (/^\s*(?:is|was|did|does|has|have|are)\b/i.test(s)) return undefined;

  const out: JobDoneInvoiceAsk = {};
  const prefill = extractQuickQuotePrefill(s);
  const amount = prefill.priceCents ?? amountIn(s);
  if (amount && amount > 0) out.amountCents = amount;
  let name = prefill.customerName?.trim() || undefined;
  if (!name) {
    for (const re of NAME_AFTER_RES) {
      for (const m of s.matchAll(new RegExp(re.source, re.flags + "g"))) {
        const candidate = m[1]?.trim();
        if (candidate && !NOT_A_NAME_RE.test(candidate)) {
          name = candidate;
          break;
        }
      }
      if (name) break;
    }
  }
  if (name) out.customerName = name;
  const email = s.match(EMAIL_RE)?.[0];
  if (email) out.customerEmail = email.toLowerCase();
  return out;
}
