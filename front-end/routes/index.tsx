import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { loadUser } from "../lib/auth.ts";
import PhoneChat, { type Bubble, type QuoteCopy } from "../islands/PhoneChat.tsx";

const DEMO_SCRIPT_EN: Bubble[] = [
  { side: "right", kind: "bubble", cls: "me",   text: "Kitchen remodel for the Hernández family. Cabinets, quartz counters, 3 days labor." },
  { side: "right", kind: "meta",   text: "9:38 AM" },
  { side: "left",  kind: "typing" },
  { side: "left",  kind: "bubble", cls: "them", text: "Got it 👍 What zip code is the job in?" },
  { side: "left",  kind: "bubble", cls: "them", text: "And rough square footage of countertop?" },
  { side: "right", kind: "bubble", cls: "me",   text: "78704. About 42 sq ft of counter." },
  { side: "left",  kind: "typing" },
  { side: "left",  kind: "bubble", cls: "them", text: "Perfect. Quote coming up — typical range for this is $10,800–$12,400." },
  { side: "left",  kind: "bubble", cls: "them", text: "Here's your quote, ready to send:", style: "background:var(--mint-200)" },
  { side: "right", kind: "quote" },
  { side: "right", kind: "bubble", cls: "me",   text: "Looks good. Send it to them." },
  { side: "right", kind: "meta",   text: "9:41 AM ✓ Sent to client" },
];

const DEMO_SCRIPT_ES: Bubble[] = [
  { side: "right", kind: "bubble", cls: "me",   text: "Remodelación cocina para los Hernández. Gabinetes, cubierta de cuarzo, 3 días de mano de obra." },
  { side: "right", kind: "meta",   text: "9:38" },
  { side: "left",  kind: "typing" },
  { side: "left",  kind: "bubble", cls: "them", text: "Listo 👍 ¿Cuál es el código postal del trabajo?" },
  { side: "left",  kind: "bubble", cls: "them", text: "¿Y aproximadamente cuántos pies² de cubierta?" },
  { side: "right", kind: "bubble", cls: "me",   text: "78704. Como 42 pies² de cubierta." },
  { side: "left",  kind: "typing" },
  { side: "left",  kind: "bubble", cls: "them", text: "Perfecto. Va la cotización — rango típico $10.800–$12.400." },
  { side: "left",  kind: "bubble", cls: "them", text: "Aquí está tu cotización, lista para enviar:", style: "background:var(--mint-200)" },
  { side: "right", kind: "quote" },
  { side: "right", kind: "bubble", cls: "me",   text: "Se ve bien. Mándasela." },
  { side: "right", kind: "meta",   text: "9:41 ✓ Enviado al cliente" },
];

const DEMO_QUOTE_EN: QuoteCopy = { hd: "Quote · #PM-2641", l1: "Cabinets & install", l2: "Quartz countertops", l3: "Demo & labor", total: "Total" };
const DEMO_QUOTE_ES: QuoteCopy = { hd: "Cotización · #PM-2641", l1: "Gabinetes e instalación", l2: "Cubiertas de cuarzo", l3: "Demolición y mano de obra", total: "Total" };

/**
 * Landing route — server-renders the prototype's HTML structure (verbatim from
 * Paperwork Monster Landing.html) with `data-i18n` attributes the
 * <LandingScripts> island substitutes on hydration. Styling lives in
 * /static/landing.css.
 */
export default define.page(async function Landing(ctx) {
  const user = await loadUser(ctx.req);
  if (user) return new Response(null, { status: 302, headers: { Location: "/dashboard" } });

  return (
    <>
      <Head>
        <title>Paperwork Monster — You do the work. We handle the paperwork.</title>
        <meta name="description" content="Quotes, contracts, and invoices done right — built for contractors. No app to install. Just text us." />
        <link rel="stylesheet" href="/landing.css" />
        <script src="/landing-scripts.js" defer></script>
      </Head>

      {/* ========== NAV ========== */}
      <div class="nav-wrap">
        <div class="container nav">
          <a href="#" class="brand">
            <img src="/logo-monster.png" alt="Paperwork Monster" />
            <span data-i18n="brand1">Paperwork</span>
            <em data-i18n="brand2" style="font-style:normal;color:var(--brand-green)">Monster</em>
          </a>

          <div class="lang-toggle" role="tablist" aria-label="Language">
            <button class="on" type="button" data-lang="en">I speak English</button>
            <button type="button" data-lang="es">Yo hablo Español</button>
          </div>

          <nav class="nav-links">
            <a href="#features" data-i18n="nav.features">What We Do</a>
            <a href="#how-it-works" data-i18n="nav.how">How It Works</a>
            <a href="#pricing" data-i18n="nav.pricing">Pricing</a>
          </nav>

          <a href="#contact" class="btn btn-primary cta-scroll" data-i18n="nav.cta">Get Started</a>
        </div>
      </div>

      {/* ========== HERO ========== */}
      <section class="hero">
        <div class="hero-dots"></div>
        <div class="container hero-grid">
          <div class="hero-copy">
            <div class="kicker">
              <span class="kicker-pill" data-i18n="hero.kickerPill">For pros</span>
              <span data-i18n="hero.kicker">Built for contractors who work with their hands</span>
            </div>

            <h1>
              <span data-i18n="hero.h1a">You do the work.</span><br />
              <span data-i18n="hero.h1b">We handle the</span>
              <span class="rotor">
                <span class="rotor-track" id="rotor-track">
                  <span class="word in" data-en="quotes." data-es="cotizaciones.">quotes.</span>
                  <span class="word"    data-en="contracts." data-es="contratos.">contracts.</span>
                  <span class="word"    data-en="invoices." data-es="facturas.">invoices.</span>
                  <span class="word"    data-en="paperwork." data-es="papeleo.">paperwork.</span>
                </span>
              </span>
            </h1>

            <p class="lead" data-i18n="hero.lead">
              Quotes, contracts, and invoices done right — so you get paid what your work is worth. No apps to learn. Just text us.
            </p>

            <div class="hero-ctas">
              <a href="#contact" class="btn btn-primary btn-lg" data-cta="primary" data-i18n="hero.cta1">Get Started →</a>
              <a href="#how-it-works" class="btn btn-outline" data-cta="secondary" data-i18n="hero.cta2">See How It Works</a>
            </div>

            <div class="hero-trust">
              <div class="avatars">
                <div class="av" style="background:var(--brand-pink)">MR</div>
                <div class="av" style="background:var(--brand-green)">JG</div>
                <div class="av" style="background:var(--brand-teal)">CL</div>
                <div class="av" style="background:var(--coffee-500)">TS</div>
              </div>
              <span><strong data-i18n="hero.trustStrong">1,200+ contractors</strong> <span data-i18n="hero.trustRest">getting paid faster</span></span>
            </div>
          </div>

          <div class="hero-visual" aria-hidden="true">
            <div class="hero-stage">
              <div class="hs-blob hs-blob--mint"></div>
              <div class="hs-blob hs-blob--pink"></div>

              <div class="hs-badge hs-badge--top">
                <span class="hs-badge__icon green">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                <span class="hs-badge__body">
                  <strong data-i18n="hero.chip1">Quote sent</strong>
                  <em>9:42 AM</em>
                </span>
              </div>

              <div class="hs-badge hs-badge--bottom">
                <span class="hs-badge__avatar" style="background:var(--brand-pink)">RH</span>
                <span class="hs-badge__body">
                  <strong>R. Hernández</strong>
                  <em data-i18n="hero.chip2">Contract signed</em>
                </span>
                <span class="hs-badge__icon pink" style="margin-left:auto">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              </div>

              <div class="hs-doc">
                <div class="hs-doc__head">
                  <span class="hs-doc__tag">Quote</span>
                  <span class="hs-doc__num">#PM-2641</span>
                </div>
                <h4 class="hs-doc__title" data-i18n="doc.q.title">Kitchen remodel</h4>
                <div class="hs-doc__client">R. Hernández · Apr 26</div>
                <div class="hs-doc__rows">
                  <div class="hs-doc__row"><span data-i18n="doc.q.l1">Cabinets</span><strong>$4,200.00</strong></div>
                  <div class="hs-doc__row"><span data-i18n="doc.q.l2">Counters</span><strong>$3,990.00</strong></div>
                  <div class="hs-doc__row"><span data-i18n="doc.q.l3">Labor (3 days)</span><strong>$1,950.00</strong></div>
                  <div class="hs-doc__row hs-doc__row--total"><span data-i18n="doc.total">Total</span><strong>$10,990.00</strong></div>
                </div>
                <div class="hs-doc__sign">
                  <div class="hs-doc__sign-line"></div>
                  <span class="hs-doc__sign-label">Signed ✓</span>
                </div>
              </div>

              <div class="hs-phone">
                <div class="hs-phone__notch"></div>
                <div class="hs-phone__screen">
                  <div class="hs-chat__hdr">
                    <span class="hs-chat__avatar">PM</span>
                    <span class="hs-chat__name">
                      <strong>Paperwork Monster</strong>
                      <em>Online • SMS</em>
                    </span>
                  </div>
                  <div class="hs-chat__body">
                    <div class="hs-bubble hs-bubble--me">Kitchen remodel for the Hernández family. Cabinets, quartz counters, 3 days labor.</div>
                    <div class="hs-bubble hs-bubble--them">Got it. Pulling comps now…</div>
                    <div class="hs-bubble hs-bubble--them hs-bubble--rich">
                      <div class="hs-rich__row"><span>Cabinets</span><strong>$4,200</strong></div>
                      <div class="hs-rich__row"><span>Counters</span><strong>$3,990</strong></div>
                      <div class="hs-rich__row"><span>Labor</span><strong>$1,950</strong></div>
                      <div class="hs-rich__total"><span>Total</span><strong>$10,990</strong></div>
                      <div class="hs-rich__cta">Send to client →</div>
                    </div>
                    <div class="hs-bubble hs-bubble--me hs-bubble--short">Send it 👍</div>
                  </div>
                  <div class="hs-chat__input">
                    <span class="hs-chat__input-text">Type a message…</span>
                    <span class="hs-chat__input-send">↑</span>
                  </div>
                </div>
              </div>

              <svg class="spark s1" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0l2.5 9.5L24 12l-9.5 2.5L12 24l-2.5-9.5L0 12l9.5-2.5z" /></svg>
              <svg class="spark s2" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0l2.5 9.5L24 12l-9.5 2.5L12 24l-2.5-9.5L0 12l9.5-2.5z" /></svg>
              <svg class="spark s3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0l2.5 9.5L24 12l-9.5 2.5L12 24l-2.5-9.5L0 12l9.5-2.5z" /></svg>
            </div>
          </div>
        </div>
      </section>

      {/* ========== MARQUEE ========== */}
      <div class="marquee" aria-hidden="true">
        <div class="marquee-track" id="marquee-track">
          <span
            data-en="30% average revenue increase|Professional quotes in minutes|Contracts with one tap|Invoices that track payments|No apps to download|Just text us"
            data-es="30% más ingresos en promedio|Cotizaciones pro en minutos|Contratos con un toque|Facturas que rastrean pagos|Sin apps que descargar|Solo escríbenos"
          ></span>
        </div>
      </div>

      {/* ========== PROBLEM ========== */}
      <section class="problem">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow-pill" data-i18n="problem.eyebrow">The problem</span>
            <h2 data-i18n="problem.h2html" data-html="1">Good work deserves <em>good paperwork</em></h2>
            <p data-i18n="problem.lead">You know your trade. But chasing down quotes on scrap paper and guessing at prices is costing you real money.</p>
          </div>

          <div class="problem-grid">
            <div class="problem-card">
              <span class="num">01</span>
              <h3 data-i18n="problem.c1.h">Leaving money on the table</h3>
              <p data-i18n="problem.c1.p">Without solid pricing info, most contractors bid too low. That means less money in your pocket for the same hard work.</p>
            </div>
            <div class="problem-card">
              <span class="num">02</span>
              <h3 data-i18n="problem.c2.h">Paperwork that doesn't look right</h3>
              <p data-i18n="problem.c2.p">Handwritten quotes on notebook paper don't build trust. Clients pick the contractor who looks like they have it together.</p>
            </div>
            <div class="problem-card">
              <span class="num">03</span>
              <h3 data-i18n="problem.c3.h">Hours you're not getting paid for</h3>
              <p data-i18n="problem.c3.p">Every hour figuring out paperwork is an hour you could be on a job site earning real money.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ========== DOCUMENTS / TABS ========== */}
      <section class="docs">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow-pill" data-i18n="docs.eyebrow">One text. Three documents.</span>
            <h2 data-i18n="docs.h2html" data-html="1">Quote, contract, invoice — <em>handled</em>.</h2>
            <p data-i18n="docs.lead">Send us a message. We send back a real document with real numbers — not a sketch on the back of an envelope.</p>
          </div>

          <div class="doc-tabs" role="tablist">
            <button class="doc-tab on" data-doc="quote"><span class="step">01</span> <span data-i18n="docs.tab.quote">Quote</span></button>
            <button class="doc-tab" data-doc="contract"><span class="step">02</span> <span data-i18n="docs.tab.contract">Contract</span></button>
            <button class="doc-tab" data-doc="invoice"><span class="step">03</span> <span data-i18n="docs.tab.invoice">Invoice</span></button>
          </div>

          <div class="doc-stage">
            <div class="doc-mockup">
              <div class="doc-mockup-header">
                <h5 id="doc-title">Quote</h5>
                <div class="num">
                  <strong id="doc-num">#PM-2641</strong>
                  <span id="doc-date">April 26, 2026</span>
                </div>
              </div>
              <div id="doc-lines"></div>
              <div class="doc-totals" id="doc-totals"></div>
            </div>

            <div class="doc-info" id="doc-info">
              <h3 id="doc-info-title"></h3>
              <p id="doc-info-body"></p>
              <ul id="doc-info-list"></ul>
            </div>
          </div>

          <div class="doc-counter">
            <div>
              <div class="label" data-i18n="docs.counter.label">Documents sent so far</div>
              <div class="big" id="doc-counter-num">0</div>
            </div>
            <div class="types">
              <span data-i18n="docs.counter.t1">Quotes</span>
              <span data-i18n="docs.counter.t2">Contracts</span>
              <span data-i18n="docs.counter.t3">Invoices</span>
              <span data-i18n="docs.counter.t4">Change orders</span>
            </div>
          </div>
        </div>
      </section>

      {/* ========== FEATURES ========== */}
      <section class="features" id="features">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow-pill" data-i18n="feat.eyebrow">What we do</span>
            <h2 data-i18n="feat.h2html" data-html="1">We take care of the <em>business side</em></h2>
            <p data-i18n="feat.lead">From the first quote to the final invoice — we handle it so you can stay on the job.</p>
          </div>

          <div class="features-grid">
            <div class="feature">
              <div class="feature-icon pink">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4" /><path d="M12 18v4" /><path d="M4.93 4.93l2.83 2.83" /><path d="M16.24 16.24l2.83 2.83" /><path d="M2 12h4" /><path d="M18 12h4" /><circle cx="12" cy="12" r="4" /></svg>
              </div>
              <div>
                <h3 data-i18n="feat.f1.h">Fair prices, not guesses</h3>
                <p data-i18n="feat.f1.p">Real construction pricing data, adjusted for today's costs. Get a low, middle, and high range so you know exactly where you stand.</p>
              </div>
            </div>

            <div class="feature">
              <div class="feature-icon green">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
              </div>
              <div>
                <h3 data-i18n="feat.f2.h">Contracts that protect you</h3>
                <p data-i18n="feat.f2.p">One tap turns your quote into a real contract. Protect your work and look professional to your clients.</p>
              </div>
            </div>

            <div class="feature">
              <div class="feature-icon teal">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="15" x2="15" y2="15" /><line x1="9" y1="11" x2="15" y2="11" /></svg>
              </div>
              <div>
                <h3 data-i18n="feat.f3.h">Simple invoicing</h3>
                <p data-i18n="feat.f3.p">Job done? We turn it into an invoice. Keep track of who's paid and who hasn't — without a spreadsheet.</p>
              </div>
            </div>

            <div class="feature">
              <div class="feature-icon coffee">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
              </div>
              <div>
                <h3 data-i18n="feat.f4.h">Just text us</h3>
                <p data-i18n="feat.f4.p">No fancy apps. No complicated software. Text us the job details and we do the rest. Simple as that.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========== HOW IT WORKS ========== */}
      <section class="how" id="how-it-works">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow-pill" data-i18n="how.eyebrow">Straight to the point</span>
            <h2 data-i18n="how.h2">How it works</h2>
            <p data-i18n="how.lead">Three steps. No forms. No software. We meet you where you already are — your phone.</p>
          </div>

          <div class="how-grid">
            <div class="how-step">
              <div class="num-circle">1</div>
              <h3 data-i18n="how.s1.h">Tell us about the job</h3>
              <p data-i18n="how.s1.p">Send us a text with the job details. We'll ask you one question at a time — no long forms, no hassle.</p>
            </div>
            <div class="how-step">
              <div class="num-circle">2</div>
              <h3 data-i18n="how.s2.h">Check your quote</h3>
              <p data-i18n="how.s2.p">We put together a professional quote with fair pricing. Look it over, change what you need, and give us the thumbs up.</p>
            </div>
            <div class="how-step">
              <div class="num-circle">3</div>
              <h3 data-i18n="how.s3.h">Send it and get paid</h3>
              <p data-i18n="how.s3.p">Send the quote to your client. When the job's done, we turn it into a contract and invoice. Everything's in one place.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ========== DEMO ========== */}
      <section class="demo">
        <div class="container demo-grid">
          <div class="demo-info">
            <span class="eyebrow-pill" data-i18n="demo.eyebrow">See it in action</span>
            <h2 data-i18n="demo.h2">Just text us. We handle the rest.</h2>
            <p data-i18n="demo.lead">Quotes, contracts, invoices — sent from your phone in seconds. No app to download. No software to learn.</p>

            <div class="testimonial">
              <span class="quote-mark">"</span>
              <p data-i18n="demo.quote">I used to spend my Sundays writing quotes on notebook paper. Now I text these guys the job details from my truck and get a professional quote back in minutes. My close rate went through the roof.</p>
              <div class="who">
                <div class="av">MR</div>
                <div>
                  <strong>Mike R.</strong>
                  <span data-i18n="demo.role">General Contractor · 12 years</span>
                </div>
              </div>
            </div>
          </div>

          <PhoneChat
            script={DEMO_SCRIPT_EN}
            scriptEs={DEMO_SCRIPT_ES}
            quote={DEMO_QUOTE_EN}
            quoteEs={DEMO_QUOTE_ES}
            messageCopy="Message"
            messageCopyEs="Mensaje"
            autoPlayOnView
          />
        </div>
      </section>

      {/* ========== PRICING ========== */}
      <section class="pricing" id="pricing">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow-pill" data-i18n="price.eyebrow">Pricing</span>
            <h2 data-i18n="price.h2html" data-html="1">Pay us from <em>what we make you</em></h2>
            <p data-i18n="price.lead">Quotes, contracts, invoices, pricing, follow-ups — we run your back office so you can stay on the job site. And it pays for itself.</p>
          </div>

          <div class="pricing-card">
            <div class="pricing-math">
              <div class="math-col">
                <div class="label" data-i18n="price.without">Without us</div>
                <div class="price">$5,000</div>
                <div class="breakdown">
                  <div class="line"><span data-i18n="price.w1">Your guess at price</span><span>$5,000</span></div>
                  <div class="line"><span data-i18n="price.w2">Hours doing paperwork</span><span data-i18n="price.w2v">~6 hrs</span></div>
                  <div class="line"><span data-i18n="price.w3">Trust from clients</span><span data-i18n="price.w3v">So-so</span></div>
                  <div class="keep"><span data-i18n="price.keep">You keep</span><span style="float:right">$5,000</span></div>
                </div>
              </div>

              <div class="math-arrow">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
              </div>

              <div class="math-col us">
                <div class="label" data-i18n="price.with">With us</div>
                <div class="price" style="color:var(--brand-green)">$6,500</div>
                <div class="breakdown">
                  <div class="line"><span data-i18n="price.u1">Real-data pricing</span><span>$6,500</span></div>
                  <div class="line fee"><span data-i18n="price.u2">Our 10% fee</span><span>− $650</span></div>
                  <div class="line"><span data-i18n="price.u3">Hours doing paperwork</span><span>0</span></div>
                  <div class="keep"><span data-i18n="price.keep2">You keep</span><span style="float:right">$5,850</span></div>
                </div>
              </div>
            </div>

            <div class="pricing-callout">
              <div>
                <div class="ptext" data-i18n="price.callout">$850 more in your pocket.</div>
                <div class="psub" data-i18n="price.calloutSub">A back office that pays for itself. Only charged when your client pays.</div>
              </div>
              <a href="#contact" class="btn-white cta-scroll" data-i18n="price.cta">Start Making More →</a>
            </div>
          </div>
        </div>
      </section>

      {/* ========== CONTACT ========== */}
      <section class="contact" id="contact">
        <div class="container">
          <div class="contact-card">
            <div class="contact-info">
              <span class="eyebrow-pill" data-i18n="cta.eyebrow">Let's go</span>
              <ol class="pm-steps" aria-label="Sign-in steps">
                <li class="pm-steps__item pm-steps__item--active">
                  <span class="pm-steps__dot">1</span>
                  <span class="pm-steps__label" data-i18n="cta.steps.phone">Phone</span>
                </li>
                <span class="pm-steps__bar" aria-hidden="true"></span>
                <li class="pm-steps__item">
                  <span class="pm-steps__dot">2</span>
                  <span class="pm-steps__label" data-i18n="cta.steps.code">Code</span>
                </li>
                <span class="pm-steps__bar" aria-hidden="true"></span>
                <li class="pm-steps__item">
                  <span class="pm-steps__dot">3</span>
                  <span class="pm-steps__label" data-i18n="cta.steps.in">You're in</span>
                </li>
              </ol>
              <h2 data-i18n="cta.h2">Ready to get the paperwork off your plate?</h2>
              <p data-i18n="cta.lead">Drop your number — we'll text you a 6-digit code. Login or sign up, same form.</p>
              <ul class="checks">
                <li><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg> <span data-i18n="cta.b1">No setup fees, no contracts</span></li>
                <li><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg> <span data-i18n="cta.b2">First quote on us — for new pros</span></li>
                <li><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg> <span data-i18n="cta.b3">English & Spanish, every step</span></li>
              </ul>
            </div>

            <form class="contact-form" id="contact-form">
              {/* Saved-phone chip — populated by LandingScripts when localStorage.pm:last-phone is present. */}
              <div class="cf-saved" id="cf-saved" hidden>
                <span class="cf-saved__hint" data-i18n="cta.useSaved">Use</span>
                <button type="button" class="cf-saved__btn" id="cf-saved-btn">
                  <span id="cf-saved-phone">(xxx) xxx-xxxx</span>
                </button>
                <button type="button" class="cf-saved__dismiss" id="cf-saved-dismiss" data-i18n="cta.notYou">Not you?</button>
              </div>

              <div class="cf-phone">
                <div class="cf-phone__hdr">
                  <span class="cf-phone__avatar">PM</span>
                  <span class="cf-phone__name">
                    <strong>Paperwork Monster</strong>
                    <em>Online <span class="cf-phone__live"></span></em>
                  </span>
                  <span class="cf-phone__call" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" /></svg>
                  </span>
                </div>

                <div class="cf-phone__body" id="cf-phone-body">
                  <div class="cf-bubble cf-bubble--them">
                    <span>👋 Welcome to <strong>Paperwork Monster</strong>.</span>
                  </div>
                  <div class="cf-bubble cf-bubble--them" id="cf-bubble-sms">
                    <span data-i18n="cta.smsPreview">Paperwork Monster: Your code is 482-913. Don't share it.</span>
                  </div>
                  <div class="cf-meta" id="cf-meta">
                    <span class="cf-meta__check">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-left:-5px"><polyline points="20 6 9 17 4 12" /></svg>
                    </span>
                    <span>Delivered · Auto-fills on iOS</span>
                  </div>
                </div>

                <div class="cf-phone__compose">
                  <span class="cf-phone__plus" aria-hidden="true">+</span>
                  <label for="f-phone" class="cf-phone__field">
                    <input id="f-phone" name="phone" type="tel" placeholder="Tap to enter your number" required autocomplete="tel" inputmode="tel" />
                  </label>
                  <button class="cf-phone__send" type="submit" aria-label="Send">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                  </button>
                </div>
              </div>

              <button class="cf-cta submit" type="submit">
                <span data-i18n="cta.btn">Send my code</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
              </button>

              <div class="cf-trust">
                <div class="cf-trust__avatars">
                  <span class="cf-trust__av" style="background:var(--brand-pink)">JG</span>
                  <span class="cf-trust__av" style="background:var(--brand-teal)">CL</span>
                  <span class="cf-trust__av" style="background:var(--coffee-500)">TS</span>
                </div>
                <div class="cf-trust__text">
                  <strong>34 contractors</strong> signed up this week
                </div>
              </div>

              <div class="fine" data-i18n="cta.fine">By submitting, you agree to receive a friendly text from us.</div>
            </form>
          </div>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer class="footer">
        <div class="container footer-row">
          <a href="#" class="brand">
            <img src="/logo-monster.png" alt="" />
            <span>Paperwork</span><em style="font-style:normal;color:var(--brand-green)">Monster</em>
          </a>
          <div class="links">
            <a href="#features" data-i18n="nav.features">What We Do</a>
            <a href="#how-it-works" data-i18n="nav.how">How It Works</a>
            <a href="#pricing" data-i18n="nav.pricing">Pricing</a>
            <a href="#contact" data-i18n="footer.contact">Contact</a>
          </div>
          <div class="copy" data-i18n="footer.copy">© 2026 Paperwork Monster. All rights reserved.</div>
        </div>
      </footer>

    </>
  );
});
