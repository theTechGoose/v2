import { useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";

export default function AsstDocPane() {
  const [tab, setTab] = useState<"quote" | "context" | "log">("quote");

  return (
    <aside class="docpane">
      <div class="docpane__tabs">
        <button type="button" class={`docpane__tab ${tab === "quote" ? "docpane__tab--active" : ""}`} onClick={() => setTab("quote")}>
          <I d={ICN.quote} size={14} /> Quote <span class="docpane__tab-count">DRAFT</span>
        </button>
        <button type="button" class={`docpane__tab ${tab === "context" ? "docpane__tab--active" : ""}`} onClick={() => setTab("context")}>
          <I d={ICN.user} size={14} /> Client
        </button>
        <button type="button" class={`docpane__tab ${tab === "log" ? "docpane__tab--active" : ""}`} onClick={() => setTab("log")}>
          <I d={ICN.clock} size={14} /> Log
        </button>
      </div>
      <div class="docpane__body">
        <div class="docket">
          <div class="docket__title">
            <I d={ICN.sparkle} size={11} sw={2.5} />
            Bossie's docket · today
          </div>
          <div class="docket__items">
            <div class="docket__item">
              <div class="docket__item-num">3</div>
              <div class="docket__item-label">Quotes drafted</div>
            </div>
            <div class="docket__item">
              <div class="docket__item-num">7</div>
              <div class="docket__item-label">Nudges sent</div>
            </div>
            <div class="docket__item">
              <div class="docket__item-num">2</div>
              <div class="docket__item-label">Invoices created</div>
            </div>
            <div class="docket__item">
              <div class="docket__item-num">$8.4k</div>
              <div class="docket__item-label">Out the door</div>
            </div>
          </div>
        </div>

        <div class="doc">
          <div class="doc__head">
            <div class="doc__type">Quote · Q-2026-041</div>
            <div class="doc__title">2-Car Garage Epoxy Floor</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
              <div>
                <div class="doc__meta-label">Client</div>
                <div class="doc__meta-val">Tom &amp; Linda K.</div>
              </div>
              <div>
                <div class="doc__meta-label">Issued</div>
                <div class="doc__meta-val">Apr 28, 2026</div>
              </div>
              <div>
                <div class="doc__meta-label">Valid through</div>
                <div class="doc__meta-val">May 28, 2026</div>
              </div>
              <div>
                <div class="doc__meta-label">Job site</div>
                <div class="doc__meta-val">412 Elm St.</div>
              </div>
            </div>
          </div>
          <div class="doc__lines">
            <div class="doc__line">
              <div>
                <div class="doc__line-name">Surface prep &amp; concrete grinding</div>
                <div class="doc__line-qty">~480 sqft · 1 day · includes oil-stain treatment</div>
              </div>
              <div class="doc__line-amt">$840</div>
            </div>
            <div class="doc__line">
              <div>
                <div class="doc__line-name">Polyaspartic 3-coat system</div>
                <div class="doc__line-qty">Primer + base + topcoat · 480 sqft</div>
              </div>
              <div class="doc__line-amt">$1,680</div>
            </div>
            <div class="doc__line">
              <div>
                <div class="doc__line-name">Decorative flakes &amp; sealing</div>
                <div class="doc__line-qty">Gray blend · UV-stable sealant</div>
              </div>
              <div class="doc__line-amt">$520</div>
            </div>
            <div class="doc__line">
              <div>
                <div class="doc__line-name">Materials &amp; mobilization</div>
                <div class="doc__line-qty">Crew of 2 · 1 truck</div>
              </div>
              <div class="doc__line-amt">$360</div>
            </div>
          </div>
          <div class="doc__totals">
            <div class="doc__totals-row">
              <span>Subtotal</span><span>$3,400</span>
            </div>
            <div class="doc__totals-row">
              <span>Tax (estimated)</span><span>included</span>
            </div>
            <div class="doc__totals-row doc__totals-row--grand">
              <span><strong>Total</strong></span><strong>$3,400</strong>
            </div>
          </div>
        </div>
      </div>
      <div class="docpane__cta">
        <button type="button" class="docpane__cta-btn"><I d={ICN.eye} size={13} /> Preview</button>
        <button type="button" class="docpane__cta-btn docpane__cta-btn--primary"><I d={ICN.send} size={13} /> Send to client</button>
      </div>
    </aside>
  );
}
