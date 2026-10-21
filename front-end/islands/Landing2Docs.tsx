import { useState } from "preact/hooks";

/**
 * REQ-110 — Raphael, 2026-10-21, the launch checklist: "Update 'One message. Three documents.'
 * Show a quote, contract, and invoice that visitors can click through. Use R Hernandez
 * consistently across all three previews so it is clear they belong to the same example. Keep the
 * presentation simple and make all three document types easy to see."
 *
 * The proof band's one card is three: the quote, the agreement and the invoice for the same job —
 * R. Hernández's kitchen remodel, #PM-2641, $10,990 — one tab each, the quote first. The tabs are
 * named in the page's language (`labels`, handed down by the route); the documents themselves are
 * the English ones the customer gets, which is the pitch. The three render server-side with the
 * quote open, so the card is there before the island wakes.
 */
export type DocId = "quote" | "contract" | "invoice";

export interface Landing2DocsLabels {
  quote: string;
  contract: string;
  invoice: string;
}

const TABS: readonly DocId[] = ["quote", "contract", "invoice"];

const JOB = "Kitchen remodel";
const CUSTOMER = "R. Hernández";
const REF = "PM-2641";
const LINES: readonly [string, string][] = [
  ["Cabinets & installation", "$4,200.00"],
  ["Quartz countertops", "$3,990.00"],
  ["Demolition & labor (3 days)", "$2,800.00"],
];
const TOTAL = "$10,990.00";

function Quote() {
  return (
    <div class="l2-card l2-quote" lang="en" data-cy="l2-doc" data-doc="quote">
      <div class="l2-quote__head">
        <div>
          <div class="l2-quote__title">QUOTE #{REF}</div>
          <div class="l2-quote__for">{JOB} · Prepared for {CUSTOMER}</div>
        </div>
        <span class="l2-pill">Signed ✓</span>
      </div>
      <div class="l2-quote__lines">
        {LINES.map(([what, amount]) => (
          <div class="l2-quote__line" key={what}>
            <span>{what}</span>
            <strong>{amount}</strong>
          </div>
        ))}
      </div>
      <div class="l2-quote__foot">
        <span class="l2-quote__sig">{CUSTOMER}</span>
        <span class="l2-quote__total">{TOTAL}</span>
      </div>
    </div>
  );
}

function Contract() {
  return (
    <div class="l2-card l2-quote" lang="en" data-cy="l2-doc" data-doc="contract">
      <div class="l2-quote__head">
        <div>
          <div class="l2-quote__title">AGREEMENT #{REF}</div>
          <div class="l2-quote__for">{JOB} · {CUSTOMER}</div>
        </div>
        <span class="l2-pill">Signed ✓</span>
      </div>
      <div class="l2-quote__lines">
        <div class="l2-quote__line">
          <span>Scope of Work</span>
          <strong>Cabinets, quartz countertops, demolition</strong>
        </div>
        <div class="l2-quote__line">
          <span>Start</span>
          <strong>Mon, Nov 3</strong>
        </div>
        <div class="l2-quote__line">
          <span>Time to complete</span>
          <strong>3 days</strong>
        </div>
        <div class="l2-quote__line">
          <span>Payment</span>
          <strong>50% deposit · balance on completion</strong>
        </div>
      </div>
      <div class="l2-quote__foot">
        <span class="l2-quote__sig">{CUSTOMER}</span>
        <span class="l2-quote__total">{TOTAL}</span>
      </div>
    </div>
  );
}

function Invoice() {
  return (
    <div class="l2-card l2-quote" lang="en" data-cy="l2-doc" data-doc="invoice">
      <div class="l2-quote__head">
        <div>
          <div class="l2-quote__title">INVOICE #{REF}-1</div>
          <div class="l2-quote__for">{JOB} · Billed to {CUSTOMER}</div>
        </div>
        <span class="l2-pill">Paid ✓</span>
      </div>
      <div class="l2-quote__lines">
        {LINES.map(([what, amount]) => (
          <div class="l2-quote__line" key={what}>
            <span>{what}</span>
            <strong>{amount}</strong>
          </div>
        ))}
        <div class="l2-quote__line">
          <span>Deposit received</span>
          <strong>−$5,495.00</strong>
        </div>
      </div>
      <div class="l2-quote__foot">
        <span class="l2-quote__sig">Balance paid · {CUSTOMER}</span>
        <span class="l2-quote__total">{TOTAL}</span>
      </div>
    </div>
  );
}

export default function Landing2Docs({ labels }: { labels: Landing2DocsLabels }) {
  const [open, setOpen] = useState<DocId>("quote");
  return (
    <div class="l2-docs" data-cy="l2-docs">
      <div class="l2-doc-tabs" role="tablist" aria-label={`${labels.quote} · ${labels.contract} · ${labels.invoice}`}>
        {TABS.map((id) => (
          <button
            type="button"
            key={id}
            class="l2-doc-tab"
            role="tab"
            data-cy="l2-doc-tab"
            data-doc={id}
            aria-selected={open === id}
            onClick={() => setOpen(id)}
          >
            {labels[id]}
          </button>
        ))}
      </div>
      {open === "quote" ? <Quote /> : open === "contract" ? <Contract /> : <Invoice />}
    </div>
  );
}
