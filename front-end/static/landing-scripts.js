/* eslint-disable */
/* Plain-JS port of the prototype's inline landing script.
   Loaded via <script src="/landing-scripts.js" defer> from routes/index.tsx
   instead of running through Fresh's island hydration (which is currently
   broken for plain "post-effect" islands — module URL CORS error). */
(function () {
  "use strict";

  /* One dictionary for the whole landing page, served by
     routes/landing-dict.js.ts from front-end/lib/landing-dict.ts — the very
     object routes/index.tsx server-rendered this page from (P-19). Loaded by
     an earlier deferred <script>, so it is already here. */
  const I18N = globalThis.__PM_LANDING_DICT || { en: {}, es: {} };

  /* Offer numbers (P-08), SSR-injected from shared/quote-flow/landing-offers
     so no counter, price or trial length is ever re-typed in this file. */
  const OFFER = globalThis.__PM_OFFER || {};

  /* Fill a dictionary string's offer placeholders: {n} the social-proof
     counter the element names via data-count, {p} the from-price, {d} the
     free-trial length. Mirrors the `t()` helper in routes/index.tsx. */
  function fillOffer(text, el, lang) {
    if (text.indexOf("{") < 0) return text;
    const out = text
      .replace(/\{p\}/g, OFFER.priceFrom == null ? "" : OFFER.priceFrom)
      .replace(/\{d\}/g, OFFER.trialDays == null ? "" : OFFER.trialDays);
    const name = el && el.getAttribute("data-count");
    const counts = (OFFER.counts || {})[name] || {};
    return out.replace(/\{n\}/g, counts[lang] || "");
  }

  const DOC_CONTENT = {
    en: {
      quote: {
        title: "Quote",
        num: "#PM-2641",
        date: "April 26, 2026",
        lines: [
          ["Demolition & haul-off", "1", "$ 850", "$ 850"],
          ["Cabinets — solid maple", "12", "$ 350", "$ 4,200"],
          ["Quartz countertops (sq ft)", "42", "$ 95", "$ 3,990"],
          ["Plumbing & install labor", "3 days", "$ 650", "$ 1,950"],
        ],
        totals: [["Subtotal", "$ 10,990"], ["Tax (estimate)", "$ 880"], [
          "Estimate",
          "$ 11,870",
        ]],
        infoTitle: "Fair prices, not guesses",
        infoBody:
          "We pull from real construction pricing data — adjusted for today’s costs and your zip code. You get a low, mid, and high range so you know exactly where you stand.",
        infoList: [
          "Low / mid / high pricing ranges",
          "Local material costs, refreshed weekly",
          "Branded PDF you can text or email",
          "Edit anything in one tap",
        ],
      },
      contract: {
        title: "Contract",
        num: "#PM-2641-C",
        date: "April 26, 2026",
        lines: [
          ["Scope: Kitchen remodel — Hernández", "", "", "✓"],
          ["Start date", "", "", "May 2"],
          ["Substantial completion", "", "", "May 14"],
          ["Deposit (25%)", "", "", "$ 2,500"],
          ["Progress payment (50%)", "", "", "$ 5,495"],
          ["Final payment", "", "", "$ 2,995"],
        ],
        totals: [["Total contract value", "$ 10,990"], [
          "Signed by client",
          "✓ Apr 26",
        ], ["Status", "Active"]],
        infoTitle: "Contracts that protect you",
        infoBody:
          "One tap turns your quote into a real, lawyer-reviewed contract. Spell out the scope, the schedule, and the payments — so there are no surprises later.",
        infoList: [
          "State-specific terms, ready to go",
          "E-signature from your client",
          "Auto deposit + progress milestones",
          "Stored alongside the job, forever",
        ],
      },
      invoice: {
        title: "Invoice",
        num: "#PM-2641-I",
        date: "May 14, 2026",
        lines: [
          ["Kitchen remodel — completed", "", "", "$ 10,990"],
          ["Change order: under-cabinet lighting", "1", "$ 420", "$ 420"],
          ["Deposit received", "", "", "− $ 2,500"],
          ["Progress payment received", "", "", "− $ 5,495"],
        ],
        totals: [["Balance due", "$ 3,415"], ["Due by", "May 18, 2026"], [
          "Pay online",
          "tap to pay",
        ]],
        infoTitle: "Simple invoicing, paid faster",
        infoBody:
          "Job done? We turn the contract into an invoice. Track who’s paid, who hasn’t, and send a one-tap reminder when it’s time.",
        infoList: [
          "One-tap “pay now” link for clients",
          "Automatic payment reminders",
          "See balance due at a glance",
          "Export for taxes and bookkeeping",
        ],
      },
    },
    es: {
      quote: {
        title: "Cotización",
        num: "#PM-2641",
        date: "26 de abril de 2026",
        lines: [
          ["Demolición y limpieza", "1", "$ 850", "$ 850"],
          ["Gabinetes — maple sólido", "12", "$ 350", "$ 4,200"],
          ["Cubiertas de cuarzo (pie²)", "42", "$ 95", "$ 3,990"],
          ["Plomería e instalación", "3 días", "$ 650", "$ 1,950"],
        ],
        totals: [["Subtotal", "$ 10,990"], ["Impuesto (est.)", "$ 880"], [
          "Estimado",
          "$ 11,870",
        ]],
        infoTitle: "Precios justos, no adivinanzas",
        infoBody:
          "Sacamos los datos de precios reales de construcción — ajustados a costos de hoy y tu código postal. Rango bajo, medio y alto para que sepas dónde estás parado.",
        infoList: [
          "Rangos bajo / medio / alto",
          "Costos locales, refrescados cada semana",
          "PDF con tu marca para mandar",
          "Edita lo que sea con un toque",
        ],
      },
      contract: {
        title: "Contrato",
        num: "#PM-2641-C",
        date: "26 de abril de 2026",
        lines: [
          ["Alcance: Remodelación cocina — Hernández", "", "", "✓"],
          ["Fecha de inicio", "", "", "2 de mayo"],
          ["Terminación", "", "", "14 de mayo"],
          ["Anticipo (25%)", "", "", "$ 2,500"],
          ["Avance (50%)", "", "", "$ 5,495"],
          ["Pago final", "", "", "$ 2,995"],
        ],
        totals: [["Valor total", "$ 10,990"], [
          "Firmado por cliente",
          "✓ 26 abr",
        ], ["Estado", "Activo"]],
        infoTitle: "Contratos que te protegen",
        infoBody:
          "Un toque convierte tu cotización en un contrato real, revisado por abogados. Define alcance, calendario y pagos — sin sorpresas después.",
        infoList: [
          "Términos por estado, listos",
          "Firma electrónica del cliente",
          "Anticipos y avances automáticos",
          "Guardado con el trabajo para siempre",
        ],
      },
      invoice: {
        title: "Factura",
        num: "#PM-2641-I",
        date: "14 de mayo de 2026",
        lines: [
          ["Remodelación cocina — completada", "", "", "$ 10,990"],
          ["Orden de cambio: luces bajo gabinete", "1", "$ 420", "$ 420"],
          ["Anticipo recibido", "", "", "− $ 2,500"],
          ["Pago de avance recibido", "", "", "− $ 5,495"],
        ],
        totals: [["Saldo por pagar", "$ 3,415"], [
          "Vence",
          "18 de mayo de 2026",
        ], ["Paga en línea", "toca para pagar"]],
        infoTitle: "Facturación simple, cobrado más rápido",
        infoBody:
          "¿Trabajo terminado? Convertimos el contrato en factura. Lleva el control de quién pagó, quién no, y manda recordatorios con un toque.",
        infoList: [
          "Enlace de pago con un toque",
          "Recordatorios automáticos",
          "Saldo a la vista",
          "Exporta para impuestos y contabilidad",
        ],
      },
    },
  };

  const CHAT_SCRIPT = {
    en: [
      {
        side: "right",
        kind: "bubble",
        cls: "me",
        text:
          "Kitchen remodel for the Hernández family. Cabinets, quartz counters, 3 days labor.",
      },
      { side: "right", kind: "meta", text: "9:38 AM" },
      { side: "left", kind: "typing" },
      {
        side: "left",
        kind: "bubble",
        cls: "them",
        text: "Got it 👍 What zip code is the job in?",
      },
      {
        side: "left",
        kind: "bubble",
        cls: "them",
        text: "And rough square footage of countertop?",
      },
      {
        side: "right",
        kind: "bubble",
        cls: "me",
        text: "78704. About 42 sq ft of counter.",
      },
      { side: "left", kind: "typing" },
      {
        side: "left",
        kind: "bubble",
        cls: "them",
        text:
          "Perfect. Quote coming up — typical range for this is $10,800–$12,400.",
      },
      {
        side: "left",
        kind: "bubble",
        cls: "them",
        text: "Here’s your quote, ready to send:",
        style: "background:var(--mint-200)",
      },
      { side: "right", kind: "quote" },
      {
        side: "right",
        kind: "bubble",
        cls: "me",
        text: "Looks good. Send it to them.",
      },
      { side: "right", kind: "meta", text: "9:41 AM ✓ Sent to client" },
    ],
    es: [
      {
        side: "right",
        kind: "bubble",
        cls: "me",
        text:
          "Remodelación cocina para los Hernández. Gabinetes, cubierta de cuarzo, 3 días de mano de obra.",
      },
      { side: "right", kind: "meta", text: "9:38" },
      { side: "left", kind: "typing" },
      {
        side: "left",
        kind: "bubble",
        cls: "them",
        text: "Listo 👍 ¿Cuál es el código postal del trabajo?",
      },
      {
        side: "left",
        kind: "bubble",
        cls: "them",
        text: "¿Y aproximadamente cuántos pies² de cubierta?",
      },
      {
        side: "right",
        kind: "bubble",
        cls: "me",
        text: "78704. Como 42 pies² de cubierta.",
      },
      { side: "left", kind: "typing" },
      {
        side: "left",
        kind: "bubble",
        cls: "them",
        text: "Perfecto. Va la cotización — rango típico $10,800–$12,400.",
      },
      {
        side: "left",
        kind: "bubble",
        cls: "them",
        text: "Aquí está tu cotización, lista para enviar:",
        style: "background:var(--mint-200)",
      },
      { side: "right", kind: "quote" },
      {
        side: "right",
        kind: "bubble",
        cls: "me",
        text: "Se ve bien. Mándasela.",
      },
      { side: "right", kind: "meta", text: "9:41 ✓ Enviado al cliente" },
    ],
  };

  function quoteCardHTML(lang) {
    const t = lang === "es"
      ? {
        hd: "Cotización · #PM-2641",
        l1: "Gabinetes e instalación",
        l2: "Cubiertas de cuarzo",
        l3: "Demolición y mano de obra",
        total: "Total",
      }
      : {
        hd: "Quote · #PM-2641",
        l1: "Cabinets & install",
        l2: "Quartz countertops",
        l3: "Demo & labor",
        total: "Total",
      };
    return '<div class="quote-card"><div class="qc-head"><span>' + t.hd +
      '</span><span class="pdf">PDF</span></div><div class="row"><span>' +
      t.l1 + '</span><strong>$ 4,200</strong></div><div class="row"><span>' +
      t.l2 + '</span><strong>$ 3,990</strong></div><div class="row"><span>' +
      t.l3 + '</span><strong>$ 2,800</strong></div><div class="total"><span>' +
      t.total + "</span><span>$ 10,990</span></div></div>";
  }

  function toE164(raw) {
    const digits = (raw || "").replace(/\D/g, "");
    if ((raw || "").startsWith("+")) return "+" + digits;
    if (digits.length === 10) return "+1" + digits;
    return "+" + digits;
  }

  function formatPhone(v) {
    const d = (v || "").replace(/\D/g, "").slice(0, 10);
    if (!d) return "";
    if (d.length < 4) return "(" + d;
    if (d.length < 7) return "(" + d.slice(0, 3) + ") " + d.slice(3);
    return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
  }

  /* ===== state ===== */
  // Resolve the active language once: ?lang= (URL) > localStorage >
  // <html lang> (what the server just rendered, from the pm_lang cookie) >
  // "es". Honoring the SSR language keeps the first client pass a no-op
  // instead of re-painting the page in the other language (P-19).
  // Spanish-first — the app is built for Spanish-speaking contractors.
  // Mirror the result back to localStorage so it survives a query-less nav.
  // `chose` is true only when the visitor actually PICKED this language
  // (?lang= in the URL, or a stored choice from a previous toggle). A value
  // merely inherited from the server render is a default, not a preference.
  let chose = false;
  let curLang = (function () {
    try {
      const q = new URLSearchParams(location.search).get("lang");
      if (q === "en" || q === "es") {
        chose = true;
        return q;
      }
    } catch (_e) { /* ignore malformed URL */ }
    try {
      const s = localStorage.getItem("pm:lang");
      if (s === "en" || s === "es") {
        chose = true;
        return s;
      }
    } catch (_e) { /* storage unavailable */ }
    const ssr = document.documentElement.getAttribute("lang");
    return ssr === "en" || ssr === "es" ? ssr : "es";
  })();
  // Persist ONLY a real choice. Stamping the default here used to give every
  // first-time landing visitor a pm_lang cookie they never asked for, which
  // then outranked the document language on any customer quote/agreement/
  // invoice opened later in the same browser.
  if (chose) persistLangChoice(curLang);
  let activeDoc = "quote";

  /**
   * Digit grouping for COUNTS (documents sent, contractors) — mirrors
   * shared/quote-flow/landing-offers.ts#formatSocialProof: "48,217" (en) /
   * "48.217" (es). Intl is deliberately not used: Spanish CLDR sets
   * minimumGroupingDigits=2, so toLocaleString("es-ES") leaves 4-digit values
   * ungrouped and the counter would change shape mid-animation.
   *
   * MONEY is never formatted this way. Every amount on this page is US
   * dollars for a US client, so it stays US-grouped in BOTH languages
   * ("$10,990"): the es-ES form "$ 10.990" reads as eleven dollars to the
   * person receiving the quote.
   */
  function groupCount(n, lang) {
    const sep = lang === "es" ? "." : ",";
    return String(Math.trunc(Math.abs(n)))
      .replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }

  /** Set by the counter IIFE below; re-paints it on a language switch. */
  let paintCounter = null;

  /* ===== i18n ===== */
  /** localStorage + cookie, the one write path for a chosen language. */
  function persistLangChoice(lang) {
    try {
      localStorage.setItem("pm:lang", lang);
    } catch (_e) { /* storage unavailable */ }
    // Mirror into a cookie so the SSR routes (/login, /verify) render in the
    // chosen language instead of falling back to the browser's default.
    try {
      document.cookie = "pm_lang=" + lang +
        ";path=/;max-age=31536000;samesite=lax";
    } catch (_e) { /* noop */ }
  }

  function applyLang(lang) {
    curLang = lang;
    const dict = I18N[lang];
    // The <head> is part of the page's language too: the toggle used to flip
    // every visible string while leaving <html lang>, the tab title and the
    // meta description in the other language.
    document.documentElement.setAttribute("lang", lang);
    if (dict["head.title"]) document.title = dict["head.title"];
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && dict["head.metaDescription"]) {
      metaDesc.setAttribute("content", dict["head.metaDescription"]);
    }
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      const k = el.getAttribute("data-i18n");
      if (!k || dict[k] == null) return;
      const v = fillOffer(dict[k], el, lang);
      if (el.getAttribute("data-html") === "1") el.innerHTML = v;
      else el.textContent = v;
    });
    document.querySelectorAll(".rotor-track .word").forEach(function (w) {
      w.textContent = w.getAttribute("data-" + lang) || w.textContent;
    });
    const mq = document.getElementById("marquee-track");
    if (mq) {
      const span = mq.querySelector("span");
      const items = ((span && span.getAttribute("data-" + lang)) || "").split(
        "|",
      );
      mq.innerHTML = "";
      for (let i = 0; i < 2; i++) {
        const seg = document.createElement("span");
        items.forEach(function (item, j) {
          seg.appendChild(document.createTextNode(item));
          const dot = document.createElement("span");
          dot.className = "dot" + (j % 2 === 0 ? "" : " green");
          seg.appendChild(dot);
        });
        mq.appendChild(seg);
      }
    }
    renderDoc(activeDoc);
    renderChat();
    fitRotor();
    if (paintCounter) paintCounter();
    if (chose) persistLangChoice(lang);
    document.querySelectorAll(".lang-toggle button").forEach(function (b) {
      if (b.dataset.lang === lang) b.classList.add("on");
      else b.classList.remove("on");
    });
  }

  // Reflect the chosen language into the URL's ?lang= param (no reload) so it
  // stays shareable and re-seeds correctly on the next load.
  function writeLangToUrl(lang) {
    try {
      const url = new URL(location.href);
      if (url.searchParams.get("lang") === lang) return;
      url.searchParams.set("lang", lang);
      history.replaceState(null, "", url.href);
    } catch (_e) { /* ignore */ }
  }

  document.querySelectorAll(".lang-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      chose = true;
      applyLang(btn.dataset.lang);
      writeLangToUrl(btn.dataset.lang);
    });
  });

  /* ===== rotor ===== */
  function fitRotor() {
    const track = document.getElementById("rotor-track");
    if (!track) return;
    track.style.width = "auto";
    let max = 0;
    const probe = document.createElement("span");
    probe.style.cssText =
      "visibility:hidden;position:absolute;white-space:nowrap;font:inherit;";
    track.appendChild(probe);
    track.querySelectorAll(".word").forEach(function (w) {
      probe.textContent = w.textContent;
      max = Math.max(max, probe.offsetWidth);
    });
    track.removeChild(probe);
    track.style.width = (max + 4) + "px";
  }
  (function rotor() {
    const track = document.getElementById("rotor-track");
    if (!track) return;
    const words = Array.prototype.slice.call(track.querySelectorAll(".word"));
    if (!words.length) return;
    let i = 0;
    fitRotor();
    // Re-fit once the custom font has loaded — Safari's first measurement
    // happens against the fallback metric (narrower), so "contracts."
    // gets clipped to "contr" until we recompute. document.fonts.ready
    // resolves once the requested faces are usable.
    if (document.fonts && typeof document.fonts.ready?.then === "function") {
      document.fonts.ready.then(fitRotor);
    }
    // Belt-and-braces: re-fit after the next paint and 1s later in case
    // the font load event fires before document.fonts.ready in some
    // engines.
    requestAnimationFrame(fitRotor);
    setTimeout(fitRotor, 1000);

    // Deterministically render the rotor: exactly ONE word is active (.in),
    // the word it just replaced plays its exit (.out), and EVERY other word
    // is fully reset (no classes → hidden). Re-clearing all the other words
    // on every step is what guarantees only one word is ever visible: if a
    // transition or timer is skipped while the tab sits in the background or
    // on another macOS Space (rAF + timers freeze/throttle there), the next
    // step — or the visibilitychange handler — repairs the state instead of
    // letting stale ".in" words pile up and stack. No rAF/timeout is relied
    // on for correctness, so there's no queued burst to misfire on return.
    function render(active, prev) {
      for (let k = 0; k < words.length; k++) {
        words[k].classList.toggle("in", k === active);
        words[k].classList.toggle("out", k === prev && prev !== active);
      }
    }

    render(0, -1); // clean single-visible starting state
    setInterval(function () {
      const next = (i + 1) % words.length;
      render(next, i);
      i = next;
    }, 2200);

    // Coming back from another tab/window/Space can interrupt a transition
    // mid-flight — snap back to exactly one visible word.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) render(i, -1);
    });

    addEventListener("resize", fitRotor);
  })();

  /* ===== smooth scroll ===== */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      const id = (a.getAttribute("href") || "").slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      if (id === "contact") {
        setTimeout(function () {
          const f = document.getElementById("f-phone");
          if (f) f.focus({ preventScroll: true });
        }, 600);
      }
    });
  });

  /* ===== doc tabs ===== */
  function renderDoc(key) {
    activeDoc = key;
    const d = DOC_CONTENT[curLang][key];
    const $ = function (id) {
      return document.getElementById(id);
    };
    if (!$("doc-title")) return;
    $("doc-title").textContent = d.title;
    $("doc-num").textContent = d.num;
    $("doc-date").textContent = d.date;
    $("doc-lines").innerHTML = d.lines.map(function (l) {
      return '<div class="doc-line"><span class="desc">' + l[0] +
        '</span><span class="qty">' + l[1] + '</span><span class="rate">' +
        l[2] + '</span><span class="amt">' + l[3] + "</span></div>";
    }).join("");
    $("doc-totals").innerHTML = d.totals.map(function (t, i) {
      return '<div class="row' + (i === d.totals.length - 1 ? " total" : "") +
        '"><span>' + t[0] + "</span><span>" + t[1] + "</span></div>";
    }).join("");
    $("doc-info-title").textContent = d.infoTitle;
    $("doc-info-body").textContent = d.infoBody;
    const checkSvg =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    $("doc-info-list").innerHTML = d.infoList.map(function (x) {
      return "<li>" + checkSvg + " " + x + "</li>";
    }).join("");
  }
  document.querySelectorAll(".doc-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".doc-tab").forEach(function (x) {
        x.classList.remove("on");
      });
      tab.classList.add("on");
      renderDoc(tab.dataset.doc);
    });
  });

  /* ===== counter ===== */
  (function counter() {
    const el = document.getElementById("doc-counter-num");
    if (!el) return;
    // Single-sourced from shared/quote-flow/landing-offers.ts and injected by
    // routes/index.tsx as window.__PM_DOCS_SENT (P-08) — never a literal here.
    const target = Number(globalThis.__PM_DOCS_SENT) || 0;
    if (!target) return;
    let shown = 0;
    // Remembered so a language toggle re-groups the number that is already on
    // screen. It used to be painted once, behind a `fired` flag that was never
    // reset, so switching language left the other locale's grouping in place.
    paintCounter = function () {
      el.textContent = groupCount(shown, curLang);
    };
    let fired = false;
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !fired) {
          fired = true;
          const start = performance.now();
          const dur = 1800;
          const tick = function (ts) {
            const p = Math.min(1, (ts - start) / dur);
            const ease = 1 - Math.pow(1 - p, 3);
            shown = Math.round(target * ease);
            paintCounter();
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      });
    }, { threshold: 0.3 });
    io.observe(el);
  })();

  /* ===== chat reveal ===== */
  let revealTimers = [];
  let revealed = 0;
  function resetReveal() {
    revealTimers.forEach(function (id) {
      clearTimeout(id);
    });
    revealTimers = [];
    revealed = 0;
    document.querySelectorAll(".chat-step").forEach(function (s) {
      s.classList.remove("in");
    });
    const fill = document.getElementById("chat-fill");
    if (fill) fill.style.width = "0%";
  }
  function startReveal() {
    const steps = Array.prototype.slice.call(
      document.querySelectorAll(".chat-step"),
    );
    if (!steps.length || revealed) return;
    const body = document.getElementById("chat-body");
    if (!body) return;
    let delay = 0;
    steps.forEach(function (step, i) {
      const isTyping = step.querySelector(".typing");
      delay += isTyping ? 350 : (i === 0 ? 200 : 700);
      revealTimers.push(setTimeout(function () {
        step.classList.add("in");
        if (!isTyping && i > 0) {
          const prev = steps[i - 1];
          if (prev.querySelector(".typing")) prev.style.display = "none";
        }
        body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
        const fill = document.getElementById("chat-fill");
        if (fill) {
          fill.style.width = Math.round(((i + 1) / steps.length) * 100) + "%";
        }
      }, delay));
      if (isTyping) delay += 1100;
    });
    revealed = 1;
  }
  function renderChat() {
    const body = document.getElementById("chat-body");
    if (!body) return;
    body.innerHTML = "";
    CHAT_SCRIPT[curLang].forEach(function (s, i) {
      const step = document.createElement("div");
      step.className = "chat-step " + s.side;
      step.dataset.idx = String(i);
      if (s.kind === "bubble") {
        const b = document.createElement("div");
        b.className = "bubble " + (s.cls || "");
        b.textContent = s.text || "";
        if (s.style) b.style.cssText = s.style;
        step.appendChild(b);
      } else if (s.kind === "meta") {
        const m = document.createElement("div");
        m.className = "bubble-meta";
        m.textContent = s.text || "";
        step.appendChild(m);
      } else if (s.kind === "typing") {
        const t = document.createElement("div");
        t.className = "typing";
        t.innerHTML = "<span></span><span></span><span></span>";
        step.appendChild(t);
      } else if (s.kind === "quote") {
        step.innerHTML = quoteCardHTML(curLang);
      }
      body.appendChild(step);
    });
    resetReveal();
  }
  (function chatIo() {
    const phone = document.querySelector(".phone");
    if (!phone) return;
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        // Reveal once on first intersection; never reset, otherwise the bubbles
        // disappear when the user scrolls past on initial load and never come back.
        if (e.isIntersecting) {
          startReveal();
          io.disconnect();
        }
      });
    }, { threshold: 0.4 });
    io.observe(phone);
    // Belt-and-suspenders: if phone is already in view at load time, fire now.
    const r = phone.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) {
      startReveal();
      io.disconnect();
    }
  })();

  /* ===== contact form ===== */
  (function contactForm() {
    const form = document.getElementById("contact-form");
    const phoneInput = document.getElementById("f-phone");
    const meta = document.getElementById("cf-meta");
    if (!form || !phoneInput) return;

    phoneInput.addEventListener("input", function () {
      phoneInput.value = formatPhone(phoneInput.value);
    });

    /* Saved-phone chip — shown when localStorage has a previously
     * verified number, so returning users can one-tap log in. */
    const savedWrap = document.getElementById("cf-saved");
    const savedBtn = document.getElementById("cf-saved-btn");
    const savedPhoneEl = document.getElementById("cf-saved-phone");
    const savedDismiss = document.getElementById("cf-saved-dismiss");
    function readSavedPhone() {
      try {
        return localStorage.getItem("pm:last-phone");
      } catch (_) {
        return null;
      }
    }
    function clearSavedPhone() {
      try {
        localStorage.removeItem("pm:last-phone");
      } catch { /* ignore */ }
    }
    if (savedWrap && savedBtn && savedPhoneEl) {
      const saved = readSavedPhone();
      if (saved) {
        // Reuse formatPhone() for display.
        savedPhoneEl.textContent = formatPhone(saved.replace(/^\+1/, "")) ||
          saved;
        savedWrap.removeAttribute("hidden");
      }
      savedBtn.addEventListener("click", function () {
        const s = readSavedPhone();
        if (!s) return;
        phoneInput.value = formatPhone(s.replace(/^\+1/, ""));
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.dispatchEvent(new Event("submit", { cancelable: true }));
      });
      if (savedDismiss) {
        savedDismiss.addEventListener("click", function () {
          clearSavedPhone();
          savedWrap.setAttribute("hidden", "");
          phoneInput.focus();
        });
      }
    }

    /** Localized copy from the ONE landing dictionary, with an inline
     *  fallback so a dict that failed to load still shows a real message. */
    function copy(key, en, es) {
      const d = I18N[curLang] || {};
      return d[key] || (curLang === "es" ? es : en);
    }
    /** Paint the role="alert" #cf-meta and mark the field invalid. */
    function showError(text) {
      if (meta) meta.textContent = text;
      phoneInput.setAttribute("aria-invalid", "true");
      phoneInput.classList.add("signup-input--error");
      phoneInput.focus();
    }
    function clearError() {
      if (meta) meta.textContent = "";
      phoneInput.removeAttribute("aria-invalid");
      phoneInput.classList.remove("signup-input--error");
    }
    // Typing is the user answering the error — drop it as soon as they do.
    phoneInput.addEventListener("input", clearError);

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      const e164 = toE164(phoneInput.value);
      if (e164.replace(/\D/g, "").length < 10) {
        // P-07: this used to be a bare `.focus()` — no message, no request,
        // no visible change. On a phone that reads as a dead Sign-up button
        // at the literal top of the paid funnel. #cf-meta is role="alert"
        // and exists for exactly this.
        showError(copy(
          "cta.errPhone",
          "That doesn\u2019t look like a phone number. Enter your 10-digit US number.",
          "Ese n\u00famero no parece v\u00e1lido. Escribe tus 10 d\u00edgitos de EE. UU.",
        ));
        return;
      }
      clearError();
      const cta = form.querySelector(".cf-cta");
      const original = cta ? cta.innerHTML : "";
      if (cta) {
        cta.disabled = true;
        cta.innerHTML = curLang === "es"
          ? "<span>Enviando…</span>"
          : "<span>Sending…</span>";
      }
      try {
        const res = await fetch("/api/auth/send-otp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phoneNumber: e164, language: curLang }),
        });
        // UX-33: a 429 cooldown means a valid code is ALREADY in the user's
        // SMS — hand them to the code screen ("Te enviamos un código a …")
        // instead of painting the generic send-failure that invites retries.
        if (res.status === 429) {
          try {
            localStorage.setItem("pm:last-phone", e164);
          } catch { /* ignore */ }
          location.href = "/verify?phone=" + encodeURIComponent(e164) +
            "&lang=" + curLang;
          return;
        }
        if (!res.ok) throw new Error("send failed " + res.status);
        // Persist for next-visit one-tap. The /verify page also writes
        // this on successful verify (more authoritative), but writing
        // here means the chip works even if the user abandons verify.
        try {
          localStorage.setItem("pm:last-phone", e164);
        } catch { /* ignore */ }
        location.href = "/verify?phone=" + encodeURIComponent(e164) +
          "&lang=" + curLang;
      } catch {
        if (cta) {
          cta.disabled = false;
          cta.innerHTML = original;
        }
        showError(copy(
          "cta.errSend",
          "We couldn\u2019t send the code. Try again.",
          "No pudimos enviar el c\u00f3digo. Intenta otra vez.",
        ));
      }
    });
  })();

  /* ===== init ===== */
  applyLang(curLang);
  renderDoc("quote");
  renderChat();
})();
