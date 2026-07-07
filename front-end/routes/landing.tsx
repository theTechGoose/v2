import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import TrialSignup from "../islands/TrialSignup.tsx";

// Toll-free support line (same number the dashboard "Call support" CTA dials).
const SUPPORT_PHONE = "+18667678399";
const SUPPORT_PHONE_DISPLAY = "(866) 767-8399";

function Check() {
  return (
    <span class="pm-chip__check" aria-hidden="true">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}

function DownArrow() {
  return (
    <div class="pm-step__arrow" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </div>
  );
}

/**
 * /landing — a standalone, shareable marketing page (distinct from the main
 * "/" landing). Simple top-to-bottom pitch with a working "Start My Free
 * Trial" phone form that reuses the OTP sign-up flow.
 */
export default define.page(function PromoLanding() {
  return (
    <>
      <Head>
        <title>
          Paperwork Monster — Your Spanish-speaking paperwork assistant
        </title>
        <meta
          name="description"
          content="Chat with us in Spanish. Your customers receive professional paperwork in English — quotes, invoices, contracts, and customer emails. Try free for 30 days."
        />
        <link rel="stylesheet" href="/promo.css" />
      </Head>

      <div class="pm">
        <div class="pm-wrap">
          {/* ---------- header ---------- */}
          <header class="pm-header">
            <a href="/landing" class="pm-brand">
              <img src="/logo-monster.png" alt="Paperwork Monster" />
              <span>Paperwork <em>Monster</em></span>
            </a>
          </header>

          {/* ---------- hero ---------- */}
          <section class="pm-hero">
            <p class="pm-hero__hook">
              Do paperwork after work? Or have paperwork that needs to go out?
              {" "}
              <strong>We can help.</strong>
            </p>
            <h1>
              Your <span class="pm-accent">Spanish-speaking</span>{" "}
              paperwork assistant.
            </h1>
            <p class="pm-hero__sub">
              <strong>Chat with us in Spanish.</strong>{" "}
              Your customers receive professional paperwork in{" "}
              <strong>English</strong>.
            </p>

            <div class="pm-prepare">
              <div class="pm-prepare__label">We prepare your</div>
              <div class="pm-chips">
                <span class="pm-chip"><Check /> Quotes</span>
                <span class="pm-chip"><Check /> Invoices</span>
                <span class="pm-chip"><Check /> Contracts</span>
                <span class="pm-chip"><Check /> Customer emails</span>
              </div>
            </div>

            <div class="pm-hero__cta">
              <a href="#trial" class="pm-btn pm-btn--primary">
                Start Your Free Trial
              </a>
            </div>
          </section>

          {/* ---------- free trial ---------- */}
          <section class="pm-trial" id="trial">
            <div class="pm-trial__card">
              <span class="pm-trial__badge">30 days free</span>
              <h2>Try Paperwork Monster FREE for 30 Days</h2>
              <p class="pm-trial__sub">
                <b>Unlimited paperwork.</b> No obligation.
              </p>

              <TrialSignup />

              <div class="pm-call">
                <p class="pm-call__q">Questions? Call us today.</p>
                <a class="pm-call__num" href={`tel:${SUPPORT_PHONE}`}>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                  </svg>
                  {SUPPORT_PHONE_DISPLAY}
                </a>
              </div>
            </div>
          </section>

          {/* ---------- how it works ---------- */}
          <section class="pm-how">
            <h2>How It Works</h2>
            <div class="pm-steps">
              <div class="pm-step">
                <div class="pm-step__num">1</div>
                <p>Chat with us in Spanish.</p>
              </div>
              <DownArrow />
              <div class="pm-step">
                <div class="pm-step__num">2</div>
                <p>We prepare your paperwork.</p>
              </div>
              <DownArrow />
              <div class="pm-step">
                <div class="pm-step__num">3</div>
                <p>Your customer receives professional English documents.</p>
              </div>
            </div>
          </section>
        </div>

        {/* ---------- closing ---------- */}
        <section class="pm-close">
          <div class="pm-wrap">
            <div class="pm-close__band">
              <h2>Stop Doing Paperwork.</h2>
              <p>
                Spend more time growing your business. We'll handle the
                paperwork.
              </p>
              <a href="#trial" class="pm-btn pm-btn--primary">
                Start Your Free Trial
              </a>
            </div>
          </div>
        </section>

        {/* ---------- footer ---------- */}
        <div class="pm-wrap">
          <footer class="pm-footer">
            <a href="/landing" class="pm-brand">
              <img src="/logo-monster.png" alt="" />
              <span>Paperwork <em>Monster</em></span>
            </a>
            <a class="pm-footer__phone" href={`tel:${SUPPORT_PHONE}`}>
              {SUPPORT_PHONE_DISPLAY}
            </a>
            <div class="pm-footer__copy">
              © 2026 Paperwork Monster. All rights reserved.
            </div>
          </footer>
        </div>
      </div>
    </>
  );
});
