import { Injectable } from "#danet/core";
import { publishPendingInvoice, publishPendingQuote, senderAsPublisher } from "@paperwork/domain/business/publish-pending/mod.ts";
import { isFictionalUsNumber } from "@users/domain/business/normalize-phone/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { buildInvoiceSms, smsJobName } from "#quote-flow/sms-i18n.ts";
import {
  outboundSenderFirstName,
  senderIdentityRefusal,
} from "#quote-flow/outbound-identity.ts";
import { resolveCommsLanguage } from "#quote-flow/comms-language.ts";
import {
  customerOnDocument,
  docRefWithVersion,
  docTitle,
  type RenderedCustomer,
} from "@paperwork/domain/business/doc-render/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { SITE_ORIGIN } from "#quote-flow/site-meta.ts";

export type PaperworkKind = "quote" | "invoice";

export interface SendPaperworkSmsInput {
  kind: PaperworkKind;
  resourceId: string;
  /** Optional override; otherwise resolved from the linked customer's phoneNumber. */
  to?: string;
  /** Per-send language override (the "Send in <lang>" button). When set it
   *  wins over the contractor's stored `commsLanguage` default. */
  language?: "en" | "es";
}

export interface SendPaperworkSmsResult {
  ok: boolean;
  /** E.164 number the dispatch was actually sent to (after resolution). */
  to: string;
  /** Twilio message SID, when delivery happened. */
  sid?: string;
  /** Reason if it failed (or 'dev_mode_no_dispatch'). */
  reason?: string;
  /** REQ-030: the provider's raw error text, for logs. */
  detail?: string;
  /** P-06/UX-26 machine-readable needs-name refusal marker. */
  needsName?: boolean;
}

/**
 * SendPaperworkSms — render + dispatch a quote/invoice text.
 *
 * Mirrors SendPaperworkEmail: resolves the customer phone from the bound
 * resource when `to` is omitted, composes a short SMS body with a public
 * link to the document, and hands off to SmsService (Twilio).
 *
 * In dev (no TWILIO_ACCOUNT_SID), SmsService logs the body to stdout and
 * returns ok=true with reason='dev_mode_no_dispatch' — so the chat
 * divider message can still say "sent" without actually billing Twilio.
 */
@Injectable()
export class SendPaperworkSms {
  constructor(
    private quotes: QuoteStore,
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private sms: SmsService,
    private shortlinks: ShortLinkStore,
    private commsLog: LogPaperworkMessage,
  ) {}

  async run(
    userId: string,
    input: SendPaperworkSmsInput,
  ): Promise<SendPaperworkSmsResult> {
    const sender = await this.tryGetUser(userId);
    const rawBiz = await this.tryGetBusinessIdentity(userId);

    // UX-26: THE one pre-dispatch identity gate. Every SMS dispatch —
    // controller routes AND the assistant's send path — inherits it
    // here: no compose, no dispatch, no comms-log with a placeholder identity.
    const refusal = senderIdentityRefusal({
      userName: sender?.name,
      businessName: rawBiz?.businessName ?? rawBiz?.legalName,
    });
    if (refusal) return refusal;

    // UX-28: ONE commsLanguage resolution for every outbound (explicit
    // per-send pick → stored Settings default → en). An explicit pick is
    // adopted as the stored default when none exists yet, so every later
    // dispatch for this contractor resolves to the same answer.
    const lang = resolveCommsLanguage({
      override: input.language,
      identityCommsLanguage: rawBiz?.commsLanguage,
    });
    if (
      (input.language === "en" || input.language === "es") &&
      rawBiz?.commsLanguage !== "en" && rawBiz?.commsLanguage !== "es"
    ) {
      try {
        await this.identity.upsert(userId, { commsLanguage: input.language });
      } catch (err) {
        console.warn("[send-paperwork-sms] commsLanguage adopt failed:", err);
      }
    }
    // Overriding commsLanguage on the resolved identity lets every
    // downstream body/subject helper honor the resolution without new params.
    const senderBiz = {
      ...(rawBiz ?? {}),
      commsLanguage: lang,
    } as BusinessIdentity;

    let recipient: string | undefined = input.to;
    let body: string;
    let customerIdForLog: string | undefined;
    let quoteForStamp: Quote | undefined;

    if (input.kind === "quote") {
      // REQ-201: a send publishes what is pending — the link must show what was sent
      const quote = await publishPendingQuote(this.quotes, input.resourceId, userId, senderAsPublisher(userId, sender?.name));
      quoteForStamp = quote;
      const customer = await this.tryGetCustomer(userId, quote.customerId);
      customerIdForLog = customer?.id;
      // the live number first (a corrected typo should reach them), the snapshot's otherwise
      if (!recipient) recipient = customer?.phoneNumber ?? customerOnDocument(quote, customer)?.phoneNumber;
      const shortUrl = await this.mintShortUrl(userId, {
        kind: "quote",
        id: quote.id,
      });
      body = renderQuoteBody(quote, customer, sender, senderBiz, shortUrl);
    } else {
      const invoice = await publishPendingInvoice(this.invoices, input.resourceId, userId, senderAsPublisher(userId, sender?.name));
      const customer = await this.tryGetCustomer(userId, invoice.customerId);
      customerIdForLog = customer?.id;
      if (!recipient) recipient = customer?.phoneNumber ?? customerOnDocument(invoice, customer)?.phoneNumber;
      const shortUrl = await this.mintShortUrl(userId, {
        kind: "invoice",
        id: invoice.id,
      });
      body = renderInvoiceBody(
        invoice,
        customer,
        sender,
        shortUrl,
        senderBiz?.commsLanguage === "es" ? "es" : "en",
      );
    }

    if (!recipient) {
      return {
        ok: false,
        reason:
          "no recipient: pass `to` or attach a customer with a phone number",
        to: "",
      };
    }

    const e164 = normalizeE164(recipient);
    if (!e164) {
      return {
        ok: false,
        reason: `invalid phone: ${recipient}`,
        to: recipient,
      };
    }
    // REQ-030 (NW-25): the contractor reads the reason — their UI language.
    const uiLang: "en" | "es" = sender?.language === "es" ? "es" : "en";
    // A fictional 555 number never reaches Twilio (it would answer 21211);
    // say so in words instead of a raw provider error.
    if (isFictionalUsNumber(e164)) {
      return {
        ok: false,
        reason: t(uiLang, "sms.fictionalNumber"),
        detail: `fictional number: ${e164}`,
        to: e164,
      };
    }

    const sent = await this.sms.send({ to: e164, body });
    // A recognised Twilio rejection arrives as a lang key — translate it.
    const result = !sent.ok && sent.reason && /^sms\./.test(sent.reason)
      ? { ...sent, reason: t(uiLang, sent.reason) }
      : sent;

    // NW-10 (REQ-003): stamp the quote's lifecycle on the first successful
    // text — status→"sent" + sentAt→now, idempotent, mirroring
    // SendPaperworkEmail. Without this an SMS-only send left the quote
    // "draft" forever (the /quotes stage derivation reads sentAt).
    if (result.ok && input.kind === "quote" && quoteForStamp && !quoteForStamp.sentAt) {
      await this.quotes.update(input.resourceId, userId, {
        status: "sent",
        sentAt: new Date().toISOString(),
      });
    }

    // Comms trail (roadmap p.8): record the dispatch in the customer's
    // thread so every outbound text is queryable per document.
    if (result.ok) {
      await this.commsLog.run({
        userId,
        customerId: customerIdForLog,
        channel: "text",
        content: body,
        toAddress: e164,
        paperworkId: input.resourceId,
        paperworkType: input.kind,
      });
    }

    return { ...result, to: e164 };
  }

  private async tryGetCustomer(
    userId: string,
    customerId: string | undefined,
  ): Promise<Customer | undefined> {
    if (!customerId) return undefined;
    try {
      return await this.customers.getOwned(customerId, userId);
    } catch {
      return undefined;
    }
  }

  private async tryGetUser(userId: string): Promise<User | undefined> {
    try {
      return await this.users.get(userId);
    } catch {
      return undefined;
    }
  }

  private async tryGetBusinessIdentity(
    userId: string,
  ): Promise<BusinessIdentity | undefined> {
    try {
      return await this.identity.get(userId) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Mint (or reuse) a short code for the resource and return the
   *  customer-facing /s/<code> URL. Falls back to the canonical
   *  long URL if the codegen path throws for any reason. */
  private async mintShortUrl(
    userId: string,
    r: { kind: "quote" | "invoice"; id: string },
  ): Promise<string> {
    try {
      const link = await this.shortlinks.findOrCreate(userId, r.kind, r.id);
      return `${APP_URL}/s/${link.code}`;
    } catch (err) {
      // findOrCreate now always yields a code (random, else deterministic), so
      // this only trips on a catastrophic KV failure where we genuinely can't
      // persist a code — the long URL is then the only link that still works.
      console.warn(
        `[send-paperwork-sms] shortlink mint failed for ${r.kind}:${r.id}; falling back to long URL:`,
        err,
      );
      const path = r.kind === "quote" ? `/q/${r.id}` : `/i/${r.id}`;
      return `${APP_URL}${path}`;
    }
  }
}

// ---------- public URL ------------------------------------------------------

/** SMS links must be reachable for the customer — localhost is useless
 *  in their inbox. So if APP_URL is set, we always honor it (no FORCE
 *  flag gymnastics). Falls back to the prod host in prod, localhost
 *  in dev as a last resort. */
const APP_URL = (() => {
  const explicit = Deno.env.get("APP_URL")?.trim() || undefined;
  if (explicit) return explicit;
  const isProd = Deno.env.get("APP_ENV")?.toLowerCase() === "prod" ||
    !!Deno.env.get("DENO_DEPLOYMENT_ID");
  return isProd ? SITE_ORIGIN : "http://localhost:5280";
})();

// ---------- bodies ----------------------------------------------------------

/** UX-26: the shared helper never yields the placeholder's first token. */
function senderFirst(u: User | undefined): string | undefined {
  return outboundSenderFirstName(u?.name);
}

function customerFirst(c: RenderedCustomer | undefined): string | undefined {
  return (c?.name?.trim() || c?.businessName?.trim())?.split(/\s+/)[0] || undefined;
}

function fmtUSD(cents: number | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  }`;
}

/** Roadmap p.8 template:
 *    Hi {customerFirst}, this is {senderFirst} from {businessName}.
 *
 *    Your quote for {jobName} is ready: {url}
 *
 *    Please let me know if you have any questions. I look forward to working with you!
 *
 *  Fallbacks: drop the salutation line when customerFirst is missing,
 *  drop the "from {businessName}" suffix when businessName is missing,
 *  fall back to `summary` then "your project" when jobName is missing.
 */
export function renderQuoteBody(
  q: Quote,
  c: Customer | undefined,
  sender: User | undefined,
  senderBiz: BusinessIdentity | undefined,
  url: string,
): string {
  const lang = senderBiz?.commsLanguage === "es" ? "es" : "en";
  // REQ-204: an issued quote greets the customer as snapshotted when issued
  const hi = customerFirst(customerOnDocument(q, c));
  const who = senderFirst(sender);
  const biz = businessName(senderBiz);
  // P-27: project the job name in the send language (jobNameByLang[lang]),
  // exactly like the email path — never the raw wrong-language jobName.
  // REQ-204 / REQ-201: the text names the document — "… for <job> (Q-001 · Version 2)".
  const jobName = `${smsJobName(q, lang)} (${docRefWithVersion(q, lang)})`;
  return composeSmsBody({
    hi,
    who,
    biz,
    jobName,
    url,
    lang,
  });
}

function composeSmsBody(p: {
  hi: string | undefined;
  who: string | undefined;
  biz: string | undefined;
  jobName: string;
  url: string;
  /** Roadmap p.13: neutral LatAm Spanish when the contractor's language is es. */
  lang?: "en" | "es";
}): string {
  const lang = p.lang === "es" ? "es" : "en";
  const intro = p.hi
    ? p.who && p.biz
      ? t(lang, "paperworkSms.intro.hiWhoBiz", {
        hi: p.hi,
        who: p.who,
        biz: p.biz,
      })
      : p.who
      ? t(lang, "paperworkSms.intro.hiWho", { hi: p.hi, who: p.who })
      : t(lang, "paperworkSms.intro.hi", { hi: p.hi })
    : p.who && p.biz
    ? t(lang, "paperworkSms.intro.whoBiz", { who: p.who, biz: p.biz })
    : p.who
    ? t(lang, "paperworkSms.intro.who", { who: p.who })
    : null;
  // Roadmap p.9: brand the deliverable as "Quote + Agreement".
  const lines: string[] = [];
  if (intro) lines.push(intro);
  lines.push(
    t(lang, "paperworkSms.body.ready", { jobName: p.jobName, url: p.url }),
  );
  lines.push(t(lang, "paperworkSms.body.closing"));
  return lines.join("\n\n");
}

function businessName(b: BusinessIdentity | undefined): string | undefined {
  const name = b?.businessName?.trim() || b?.legalName?.trim();
  return name || undefined;
}

export function renderInvoiceBody(
  i: Invoice,
  cust: Customer | undefined,
  sender: User | undefined,
  url: string,
  lang: "en" | "es" = "en",
): string {
  // P-49: the shared builder guarantees a capitalized sentence start for
  // unnamed customers ("Tu factura…" / "Your invoice…"), greeting otherwise.
  // REQ-169: the bill closes by thanking the customer, not "I look forward to working with you"
  // REQ-204 / REQ-201: the customer as snapshotted when the bill was issued,
  // and the bill named by number and version ("Invoice INV-5000 · Version 2").
  return buildInvoiceSms({
    customerFirstName: customerFirst(customerOnDocument(i, cust)),
    contractorFirstName: senderFirst(sender),
    amount: fmtUSD(i.amount),
    url,
    lang,
  }) + "\n\n" + docTitle("invoice", i, lang) + "\n\n" + t(lang, "paperworkSms.body.invoiceClosing");
}

// ---------- phone normalization --------------------------------------------

function normalizeE164(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}
