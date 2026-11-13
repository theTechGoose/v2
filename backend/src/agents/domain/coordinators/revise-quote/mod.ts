import { Injectable } from "#danet/core";
import { type Lang, t } from "@core/i18n/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  isQuoteIssued,
  isQuoteLocked,
  versionOf,
} from "#documents/versions.ts";
import { pickChangeOrderTarget } from "@agents/domain/business/change-order-intent/mod.ts";
import {
  findLine,
  type LineChange,
  reviseLineItems,
  totalOf,
} from "@agents/domain/business/quote-line-revision/mod.ts";
import { describeQuoteRevision } from "@agents/domain/business/quote-revision-reply/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import {
  type ChangeOrderOffer,
  signedOfferAmount,
} from "#quote-flow/chat-change-order-offer.ts";

export interface ReviseQuoteInput {
  userId: string;
  lang: Lang;
  /** The conversation's bound quote, if any. */
  boundQuoteId?: string;
  customerName?: string;
  /** An explicit "Q-001" — resolves straight to that quote. */
  quoteNumber?: string;
  lines: LineChange[];
  remove: string[];
  /** What the user typed — the reply mentions a deposit ask (REQ-267). */
  userText: string;
  /** REQ-585 (demo-loop cycle 4, M4): the bound quote's job details, every
   *  language. A named "line" that is one of their bullets is said to be in
   *  the job details — never "I couldn't find a line called …". */
  jobDetails?: string;
  /** REQ-585: the job details were rewritten this same turn — a bullet the
   *  model also tried to revise needs no reply of its own. */
  jobDetailsUpdated?: boolean;
}

export type ReviseQuoteOutcome =
  | {
    kind: "pending_revision";
    quoteId: string;
    quoteNumber?: string;
    nextVersion: number;
  }
  | { kind: "draft_updated"; quoteId: string; quoteNumber?: string }
  /** signed — nothing changes (REQ-202). REQ-664 (cycle 5, m43): when the
   *  edit moves the price, the difference is offered as a change order. */
  | {
    kind: "locked";
    quoteId: string;
    quoteNumber?: string;
    changeOrderOffer?: ChangeOrderOffer;
  }
  /** a named line is not on the quote — nothing written. REQ-585:
   *  `inJobDetails` — every one is a job-details bullet, not a priced line. */
  | {
    kind: "no_such_line";
    quoteId: string;
    quoteNumber?: string;
    unmatched: string[];
    inJobDetails?: boolean;
  }
  | { kind: "ambiguous"; quoteIds: string[] }
  | { kind: "none" }
  | { kind: "ask_customer" };

export interface ReviseQuoteResult {
  /** The assistant's reply, in the contractor's language. */
  text: string;
  outcome: ReviseQuoteOutcome;
}

type LineItem = Quote["lineItems"][number];

/** REQ-585: the job details' bullets, one per line, list marks gone. */
function jobDetailsBullets(
  text: string | undefined,
): { description: string }[] {
  return (text ?? "").split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-•*·]|\d+[.)])\s*/u, "").trim())
    .filter(Boolean)
    .map((description) => ({ description }));
}

function money(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${
    (Math.abs(cents) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/**
 * REQ-664 (demo-loop cycle 5, m43): the change order a signed quote's line
 * edit amounts to — each repriced line's new total minus its old one, each
 * removed line credited. Undefined when a named line is not on the quote or
 * nothing moves the price (a reword only).
 */
function lockedChangeOrderOffer(
  lang: Lang,
  quote: Quote,
  input: Pick<ReviseQuoteInput, "lines" | "remove">,
): ChangeOrderOffer | undefined {
  const base = quote.lineItems ?? [];
  const rev = reviseLineItems(base, input.lines, input.remove);
  if (rev.unmatched.length > 0) return undefined;
  const delta = rev.estimatedTotal - totalOf(base);
  if (delta === 0) return undefined;
  const lineTotal = (l: LineItem) => (l.price ?? 0) * (l.quantity ?? 1);
  const parts: string[] = [];
  const names: string[] = [];
  const seen = new Set<number>();
  for (const c of input.lines) {
    const i = findLine(base, c.match);
    if (i < 0 || seen.has(i)) continue;
    const from = lineTotal(base[i]);
    if (
      typeof c.amountCents !== "number" || Math.trunc(c.amountCents) === from
    ) {
      continue;
    }
    seen.add(i);
    names.push(base[i].description);
    parts.push(t(lang, "chatCoordinator.reviseQuote.coLine", {
      line: base[i].description,
      from: money(from),
      to: money(Math.trunc(c.amountCents)),
    }));
  }
  for (const r of input.remove) {
    const i = findLine(base, r);
    if (i < 0 || seen.has(i)) continue;
    seen.add(i);
    names.push(base[i].description);
    parts.push(t(lang, "chatCoordinator.reviseQuote.coRemoved", {
      line: base[i].description,
      amount: money(-lineTotal(base[i])),
    }));
  }
  if (parts.length === 0) return undefined;
  return {
    quoteId: quote.id,
    ...(quote.number ? { quoteNumber: quote.number } : {}),
    deltaCents: delta,
    description: parts.join("; "),
    label: names.join(", "),
  };
}

/**
 * ReviseQuote — REQ-315 (demo-loop cycle 1, M26). "Change plumbing fixtures
 * to $1,300 on Q-001" changes THAT line of Dana's EXISTING quote; it never
 * appends a line (change_order) and never drafts a new quote (create_quote).
 *
 *   - the quote is found by its explicit number, else by the change-order
 *     target rules (the named customer's open quote, else the bound one);
 *   - a signed quote is left alone (REQ-202) — the reply says so;
 *   - every named line must be on the quote; otherwise nothing is written
 *     and the reply lists the quote's lines;
 *   - an issued, unsigned quote gets the change as its pending revision
 *     (REQ-201) — the reply says where to publish it; a draft is edited in
 *     place. Either way the reply says what changed (REQ-267).
 */
@Injectable()
export class ReviseQuote {
  constructor(
    private quotes: QuoteStore,
    private customers: CustomerStore,
  ) {}

  async run(input: ReviseQuoteInput): Promise<ReviseQuoteResult> {
    const { userId, lang } = input;
    const [quotes, customers] = await Promise.all([
      this.quotes.listByUser(userId),
      this.customers.listByUser(userId),
    ]);
    const nameOf = (q: Quote): string => {
      const c = customers.find((c) => c.id === q.customerId);
      return c?.name ?? q.customerSnapshot?.name ?? "";
    };
    const labelOf = (q: Quote): string =>
      [q.number, q.jobName || q.summary].filter(Boolean).join(" ");

    const target = pickChangeOrderTarget({
      quotes: quotes.map((q) => ({
        id: q.id,
        customerId: q.customerId,
        status: q.status,
        createdAt: q.createdAt,
        number: q.number,
        // REQ-654 (cycle 5, M10): the name the quote itself carries
        customerName: nameOf(q) || undefined,
        summary: q.summary,
      })),
      customers: customers.map((c) => ({ id: c.id, name: c.name })),
      customerName: input.customerName,
      quoteNumber: input.quoteNumber,
      boundQuoteId: input.boundQuoteId,
    });

    if (target.kind === "ask_customer") {
      return {
        text: t(lang, "chatCoordinator.reviseQuote.askCustomer"),
        outcome: target,
      };
    }
    if (target.kind === "none") {
      return {
        text: t(lang, "chatCoordinator.reviseQuote.none", {
          // an explicit number is what was looked up (and missed)
          name: input.quoteNumber ?? input.customerName ?? "",
        }),
        outcome: target,
      };
    }
    if (target.kind === "ambiguous") {
      const list = target.quoteIds
        .map((id) => quotes.find((q) => q.id === id)!)
        .map((q) =>
          `• ${labelOf(q)} — ${nameOf(q)} (${
            money(q.estimatedTotal ?? totalOf(q.lineItems ?? []))
          })`
        )
        .join("\n");
      return {
        text: t(lang, "chatCoordinator.reviseQuote.ambiguous", { list }),
        outcome: target,
      };
    }

    const quote = quotes.find((q) => q.id === target.quoteId)!;
    const vars = {
      job: labelOf(quote),
      name: nameOf(quote) || t(lang, "chatCoordinator.changeOrder.theCustomer"),
    };
    const ref = { quoteId: quote.id, quoteNumber: quote.number };

    if (isQuoteLocked(quote)) {
      // REQ-664 (demo-loop cycle 5, m43): the lines stay, but the edit's
      // difference is offered as a one-tap change order — pair 5 was told
      // to "make a change order instead" and had to re-type the whole ask.
      const offer = lockedChangeOrderOffer(lang, quote, input);
      const locked = t(lang, "chatCoordinator.reviseQuote.locked", vars);
      return {
        text: offer
          ? `${locked} ${
            t(lang, "chatCoordinator.reviseQuote.lockedOffer", {
              ...vars,
              amount: signedOfferAmount(offer.deltaCents),
              what: offer.label,
            })
          }`
          : locked,
        outcome: {
          kind: "locked",
          ...ref,
          ...(offer ? { changeOrderOffer: offer } : {}),
        },
      };
    }

    // The working copy: the pending revision when one exists (REQ-201).
    const base = (quote.pendingRevision?.lineItems as LineItem[] | undefined) ??
      quote.lineItems ?? [];
    // REQ-585 (demo-loop cycle 4, M4): pair 7's "change the cabinet line to
    // just say white shaker cabinets" named a JOB-DETAILS bullet; the reply
    // was "I couldn't find a line called … so I changed nothing" beside the
    // job details the same turn had just rewritten. A bullet is not a priced
    // line: it is left to the job details and said so — or, when they were
    // rewritten this turn, nothing more is said.
    const bullets = jobDetailsBullets(input.jobDetails);
    const isBullet = (name: string) =>
      bullets.length > 0 && findLine(base, name) < 0 &&
      findLine(bullets, name) >= 0;
    const inDetails = [...input.lines.map((l) => l.match), ...input.remove]
      .filter(isBullet);
    const lines = input.lines.filter((l) => !inDetails.includes(l.match));
    const remove = input.remove.filter((r) => !inDetails.includes(r));
    const detailsNote = inDetails.length > 0 && !input.jobDetailsUpdated
      ? t(lang, "chatCoordinator.reviseQuote.jobDetailsLine", {
        ...vars,
        line: inDetails.join('", "'),
      })
      : "";
    if (inDetails.length > 0 && lines.length === 0 && remove.length === 0) {
      return {
        text: detailsNote,
        outcome: {
          kind: "no_such_line",
          ...ref,
          unmatched: inDetails,
          inJobDetails: true,
        },
      };
    }
    const withNote = (text: string) =>
      detailsNote ? `${text} ${detailsNote}` : text;
    const rev = reviseLineItems(base, lines, remove);
    if (rev.unmatched.length > 0) {
      const list = base
        .map((l) =>
          `• ${l.description} — ${money((l.price ?? 0) * (l.quantity ?? 1))}`
        )
        .join("\n");
      return {
        text: withNote(t(lang, "chatCoordinator.reviseQuote.noSuchLine", {
          ...vars,
          line: rev.unmatched.join('", "'),
          list,
        })),
        outcome: { kind: "no_such_line", ...ref, unmatched: rev.unmatched },
      };
    }

    const asRevisionLine = (l: LineItem) => ({
      description: l.description,
      priceCents: (l.price ?? 0) * (l.quantity ?? 1),
    });
    const text = describeQuoteRevision(
      lang,
      base.map(asRevisionLine),
      rev.lineItems.map(asRevisionLine),
      input.userText,
    );
    const patch = {
      lineItems: rev.lineItems,
      estimatedTotal: rev.estimatedTotal,
    };

    // Issued, unsigned → the next version, published by the contractor.
    if (isQuoteIssued(quote)) {
      await this.quotes.setPending(quote.id, userId, patch);
      const nextVersion = versionOf(quote) + 1;
      return {
        text: withNote(
          `${text} ${
            t(lang, "chatCoordinator.reviseQuote.publishHint", {
              ...vars,
              version: nextVersion,
            })
          }`,
        ),
        outcome: { kind: "pending_revision", ...ref, nextVersion },
      };
    }

    // A draft → edited in place.
    await this.quotes.update(quote.id, userId, patch);
    return { text: withNote(text), outcome: { kind: "draft_updated", ...ref } };
  }
}
