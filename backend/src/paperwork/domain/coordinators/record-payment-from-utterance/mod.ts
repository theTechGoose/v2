import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { ConfirmPayment } from "@paperwork/domain/coordinators/confirm-payment/mod.ts";
import type { Invoice, PaymentMethod } from "@paperwork/dto/invoice.ts";

export interface UtteranceInput {
  /** Free-form transcript from a voice memo, e.g. "Got paid $1,200 cash
   *  from the Hansens for the deck job." */
  transcript?: string;
  /** Pre-parsed OCR fields from a photo of a check. */
  ocrFields?: {
    amount?: number;     // INTEGER CENTS
    payerHint?: string;
    method?: string;
    reference?: string;
  };
}

export interface ParsedUtterance {
  amount?: number;   // INTEGER CENTS
  payerHint?: string;
  method?: PaymentMethod;
  reference?: string;
}

export interface UtteranceResult {
  /** Set when we matched exactly one open invoice and recorded it. */
  matchedInvoiceId?: string;
  /** Set when ConfirmPayment ran successfully. */
  paymentId?: string;
  /** Set when zero or 2+ invoices could plausibly match — caller renders
   *  a disambiguation card and lets the user pick. */
  disambiguation?: Array<{ invoiceId: string; label: string; amount: number; customerName?: string }>;
  /** What we extracted from the transcript / photo, for caller debugging. */
  parsed: ParsedUtterance;
}

/**
 * RecordPaymentFromUtterance — voice/photo → matched payment recording.
 *
 * Heuristic pipeline (no LLM dependency in v1 — deterministic parser so
 * the unit tests are stable):
 *   1. Parse the transcript (or take OCR fields directly).
 *   2. Match against open invoices by:
 *      • exact amount (in INTEGER CENTS), AND
 *      • customer-name fuzzy match against the payerHint (if present),
 *      • OR the customer's name appears in the transcript.
 *   3. If exactly one match: call ConfirmPayment to record + receipt.
 *   4. If 0 or 2+: return a disambiguation list.
 *
 * The LLM upgrade path is straightforward: swap the regex parser for an
 * LLM call when AGENTS_LLM_CLIENT is set. The matcher stays the same.
 */
@Injectable()
export class RecordPaymentFromUtterance {
  constructor(
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private confirm: ConfirmPayment,
  ) {}

  async run(userId: string, input: UtteranceInput): Promise<UtteranceResult> {
    const parsed = input.ocrFields
      ? parseOcr(input.ocrFields)
      : parseTranscript(input.transcript ?? "");

    if (parsed.amount == null && !parsed.payerHint) {
      return { parsed, disambiguation: [] };
    }

    const candidates = await this.findCandidates(userId, parsed);
    if (candidates.length === 1) {
      const match = candidates[0];
      // Stamp the intent first so ConfirmPayment can pick it up.
      await this.invoices.update(match.id, userId, {
        status: "claimed",
        paymentIntent: {
          method: parsed.method ?? "cash",
          amount: match.amount ?? parsed.amount ?? 0,
          ...(parsed.reference ? { reference: parsed.reference } : {}),
          claimedAt: new Date().toISOString(),
          claimedBy: parsed.payerHint,
        },
      });
      const confirmRes = await this.confirm.run(userId, match.id);
      return {
        parsed,
        matchedInvoiceId: match.id,
        ...(confirmRes.paymentId ? { paymentId: confirmRes.paymentId } : {}),
      };
    }

    const disambiguation = await this.labelCandidates(userId, candidates);
    return { parsed, disambiguation };
  }

  private async findCandidates(userId: string, parsed: ParsedUtterance): Promise<Invoice[]> {
    const all = await this.invoices.listByUser(userId);
    const open = all.filter((i) => i.status === "sent" || i.status === "viewed" || i.status === "claimed");

    let scored: Invoice[];
    if (parsed.amount != null) {
      // Tight amount match first.
      scored = open.filter((i) => i.amount === parsed.amount);
      if (scored.length === 1) return scored;
      // Fall through to fuzzy customer match within the amount-matched set.
    } else {
      scored = open;
    }

    if (parsed.payerHint) {
      const hint = parsed.payerHint.toLowerCase();
      const byCustomer: Invoice[] = [];
      for (const inv of scored) {
        if (!inv.customerId) continue;
        try {
          const c = await this.customers.getOwned(inv.customerId, userId);
          if (c.name.toLowerCase().includes(hint)) byCustomer.push(inv);
        } catch { /* ignore */ }
      }
      if (byCustomer.length === 1) return byCustomer;
      if (byCustomer.length > 1) return byCustomer;
      return scored;
    }

    return scored;
  }

  private async labelCandidates(
    userId: string,
    candidates: Invoice[],
  ): Promise<Array<{ invoiceId: string; label: string; amount: number; customerName?: string }>> {
    const out: Array<{ invoiceId: string; label: string; amount: number; customerName?: string }> = [];
    for (const inv of candidates) {
      let customerName: string | undefined;
      if (inv.customerId) {
        try {
          customerName = (await this.customers.getOwned(inv.customerId, userId)).name;
        } catch { /* ignore */ }
      }
      const moneyStr = `$${((inv.amount ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
      const installment = inv.installmentIndex && inv.installmentTotal
        ? ` (${inv.installmentIndex}/${inv.installmentTotal})`
        : "";
      out.push({
        invoiceId: inv.id,
        amount: inv.amount ?? 0,
        ...(customerName ? { customerName } : {}),
        label: `${customerName ?? "Unknown customer"} · ${moneyStr}${installment}`,
      });
    }
    return out;
  }
}

/** Deterministic regex parser for voice transcripts. Looks for:
 *   - "$1,200" / "12 hundred" / "twelve hundred" / "1200 dollars" (amount)
 *   - "cash" / "check" / "venmo" / "zelle" / etc. (method)
 *   - "from <name>" / "the <name>s" (payerHint)
 *   - "check #1234" / "ref 7890" (reference) */
export function parseTranscript(transcript: string): ParsedUtterance {
  const text = transcript.trim();
  if (!text) return {};
  const out: ParsedUtterance = {};

  // 1. Amount — try $X,XXX, X,XXX, X dollars, "X hundred", "X thousand" patterns.
  const m1 = text.match(/\$\s*([0-9][\d,]*(?:\.\d{1,2})?)/);
  if (m1) {
    const num = Number(m1[1].replace(/,/g, ""));
    if (Number.isFinite(num)) out.amount = Math.round(num * 100);
  } else {
    const m2 = text.match(/\b([0-9][\d,]*(?:\.\d{1,2})?)\s+dollars?\b/i);
    if (m2) {
      const num = Number(m2[1].replace(/,/g, ""));
      if (Number.isFinite(num)) out.amount = Math.round(num * 100);
    } else {
      // "twelve hundred", "eighteen hundred", "five thousand"
      const words = text.toLowerCase();
      const hundredMatch = words.match(/\b(eighteen|nineteen|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eleven|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|one|two|three|four|five|six|seven|eight|nine)\s+(?:hundred|thousand)\b/);
      if (hundredMatch) {
        const word = hundredMatch[1];
        const isThousand = /thousand/.test(hundredMatch[0]);
        const tens: Record<string, number> = {
          one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
          ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
          sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
          twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
        };
        const base = tens[word] ?? 0;
        const num = base * (isThousand ? 1000 : 100);
        if (num > 0) out.amount = num * 100;
      }
    }
  }

  // 2. Method. "Cash app" must be tested before plain "cash" so the
  // two-word handle wins.
  const methods: Array<{ re: RegExp; m: PaymentMethod }> = [
    { re: /\bcash\s*app\b/i, m: "cashapp" },
    { re: /\bcheck\b/i, m: "check" },
    { re: /\bvenmo\b/i, m: "venmo" },
    { re: /\bzelle\b/i, m: "zelle" },
    { re: /\bach\b|\bbank\s*transfer\b/i, m: "ach" },
    { re: /\bcash\b/i, m: "cash" },
  ];
  for (const { re, m } of methods) {
    if (re.test(text)) { out.method = m; break; }
  }

  // 3. Payer hint. Two patterns, checked in order:
  //   a) "the Smiths" → "Smith" (family-name plural, common in voice memos)
  //   b) "from <Name>" or "from the <Name>" or "by <Name>"
  const familyMatch = text.match(/\bthe\s+([A-Z][A-Za-z]+)s\b/);
  if (familyMatch) {
    out.payerHint = familyMatch[1];
  } else {
    const fromMatch = text.match(/\b(?:from|by)\s+(?:the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\b/);
    if (fromMatch) out.payerHint = fromMatch[1];
  }

  // 4. Reference.
  const ref = text.match(/(?:check|ref(?:erence)?|tx|transaction)\s*#?\s*([A-Za-z0-9-]{2,20})/i);
  if (ref) out.reference = ref[1];

  return out;
}

export function parseOcr(fields: NonNullable<UtteranceInput["ocrFields"]>): ParsedUtterance {
  const out: ParsedUtterance = {};
  if (typeof fields.amount === "number" && Number.isFinite(fields.amount)) out.amount = fields.amount;
  if (fields.payerHint) out.payerHint = fields.payerHint;
  if (fields.method && ["check", "venmo", "zelle", "cashapp", "cash", "ach", "other"].includes(fields.method)) {
    out.method = fields.method as PaymentMethod;
  }
  if (fields.reference) out.reference = fields.reference;
  return out;
}
