/* eslint-disable */
/* Plain-JS port of the prototype's inline landing script.
   Loaded via <script src="/landing-scripts.js" defer> from routes/index.tsx
   instead of running through Fresh's island hydration (which is currently
   broken for plain "post-effect" islands — module URL CORS error). */
(function () {
  "use strict";

  const I18N = {
    en: {
      "nav.features": "What We Do", "nav.how": "How It Works", "nav.pricing": "Pricing", "nav.cta": "Get Started",
      "hero.kickerPill": "For pros",
      "hero.kicker": "Built for contractors who work with their hands",
      "hero.h1a": "You do the work.", "hero.h1b": "We handle the",
      "hero.lead": "Quotes, contracts, and invoices done right — so you get paid what your work is worth. No apps to learn. Just text us.",
      "hero.cta1": "Get Started →", "hero.cta2": "See How It Works",
      "hero.trustStrong": "1,200+ contractors", "hero.trustRest": "getting paid faster",
      "hero.chip1": "Quote sent", "hero.chip2": "Contract signed", "hero.chip3": "Paid in full",
      "doc.q.tag": "Quote", "doc.q.title": "Kitchen remodel", "doc.q.l1": "Cabinets", "doc.q.l2": "Counters", "doc.q.l3": "Labor (3 days)", "doc.total": "Total",
      "doc.c.tag": "Contract", "doc.c.title": "Service Agreement",
      "doc.i.tag": "Invoice", "doc.i.title": "Final billing",
      "problem.eyebrow": "The problem", "problem.h2html": "Good work deserves <em>good paperwork</em>",
      "problem.lead": "You know your trade. But chasing down quotes on scrap paper and guessing at prices is costing you real money.",
      "problem.c1.h": "Leaving money on the table", "problem.c1.p": "Without solid pricing info, most contractors bid too low. That means less money in your pocket for the same hard work.",
      "problem.c2.h": "Paperwork that doesn’t look right", "problem.c2.p": "Handwritten quotes on notebook paper don’t build trust. Clients pick the contractor who looks like they have it together.",
      "problem.c3.h": "Hours you’re not getting paid for", "problem.c3.p": "Every hour figuring out paperwork is an hour you could be on a job site earning real money.",
      "docs.eyebrow": "One text. Three documents.", "docs.h2html": "Quote, contract, invoice — <em>handled</em>.",
      "docs.lead": "Send us a message. We send back a real document with real numbers — not a sketch on the back of an envelope.",
      "docs.tab.quote": "Quote", "docs.tab.contract": "Contract", "docs.tab.invoice": "Invoice",
      "docs.counter.label": "Documents sent so far",
      "docs.counter.t1": "Quotes", "docs.counter.t2": "Contracts", "docs.counter.t3": "Invoices", "docs.counter.t4": "Change orders",
      "feat.eyebrow": "What we do", "feat.h2html": "We take care of the <em>business side</em>",
      "feat.lead": "From the first quote to the final invoice — we handle it so you can stay on the job.",
      "feat.f1.h": "Fair prices, not guesses", "feat.f1.p": "Real construction pricing data, adjusted for today’s costs. Get a low, middle, and high range so you know exactly where you stand.",
      "feat.f2.h": "Contracts that protect you", "feat.f2.p": "One tap turns your quote into a real contract. Protect your work and look professional to your clients.",
      "feat.f3.h": "Simple invoicing", "feat.f3.p": "Job done? We turn it into an invoice. Keep track of who’s paid and who hasn’t — without a spreadsheet.",
      "feat.f4.h": "Just text us", "feat.f4.p": "No fancy apps. No complicated software. Text us the job details and we do the rest. Simple as that.",
      "how.eyebrow": "Straight to the point", "how.h2": "How it works",
      "how.lead": "Three steps. No forms. No software. We meet you where you already are — your phone.",
      "how.s1.h": "Tell us about the job", "how.s1.p": "Send us a text with the job details. We’ll ask you one question at a time — no long forms, no hassle.",
      "how.s2.h": "Check your quote", "how.s2.p": "We put together a professional quote with fair pricing. Look it over, change what you need, and give us the thumbs up.",
      "how.s3.h": "Send it and get paid", "how.s3.p": "Send the quote to your client. When the job’s done, we turn it into a contract and invoice. Everything’s in one place.",
      "demo.eyebrow": "See it in action", "demo.h2": "Just text us. We handle the rest.",
      "demo.lead": "Quotes, contracts, invoices — sent from your phone in seconds. No app to download. No software to learn.",
      "demo.quote": "I used to spend my Sundays writing quotes on notebook paper. Now I text these guys the job details from my truck and get a professional quote back in minutes. My close rate went through the roof.",
      "demo.role": "General Contractor · 12 years", "demo.online": "Online", "demo.message": "Message",
      "price.eyebrow": "Pricing", "price.h2html": "Pay us from <em>what we make you</em>",
      "price.lead": "Quotes, contracts, invoices, pricing, follow-ups — we run your back office so you can stay on the job site. And it pays for itself.",
      "price.without": "Without us", "price.with": "With us", "price.keep": "You keep", "price.keep2": "You keep",
      "price.w1": "Your guess at price", "price.w2": "Hours doing paperwork", "price.w2v": "~6 hrs", "price.w3": "Trust from clients", "price.w3v": "So-so",
      "price.u1": "Real-data pricing", "price.u2": "Our 10% fee", "price.u3": "Hours doing paperwork",
      "price.callout": "$850 more in your pocket.", "price.calloutSub": "A back office that pays for itself. Only charged when your client pays.",
      "price.cta": "Start Making More →",
      "cta.eyebrow": "Let’s go", "cta.h2": "Ready to get the paperwork off your plate?",
      "cta.lead": "Drop your number — we’ll text you a 6-digit code. Login or sign up, same form.",
      "cta.b1": "No setup fees, no contracts", "cta.b2": "First quote on us — for new pros", "cta.b3": "English & Spanish, every step",
      "cta.label": "Your phone number", "cta.btn": "Send my code",
      "cta.fine": "By submitting, you agree to receive a friendly text from us.",
      "cta.smsPreview": "Paperwork Monsters: Your code is 482-913. Don’t share it.",
      "cta.steps.phone": "Phone", "cta.steps.code": "Code", "cta.steps.in": "You’re in",
      "cta.useSaved": "Use", "cta.notYou": "Not you?",
      "footer.contact": "Contact", "footer.copy": "© 2026 Paperwork Monsters. All rights reserved.",
    },
    es: {
      "nav.features": "Qué hacemos", "nav.how": "Cómo funciona", "nav.pricing": "Precios", "nav.cta": "Empezar",
      "hero.kickerPill": "Para pros",
      "hero.kicker": "Hecho para contratistas que trabajan con las manos",
      "hero.h1a": "Tú haces el trabajo.", "hero.h1b": "Nosotros manejamos las",
      "hero.lead": "Cotizaciones, contratos y facturas bien hechos — para que cobres lo que tu trabajo vale. Sin apps que aprender. Solo escríbenos.",
      "hero.cta1": "Empezar →", "hero.cta2": "Ver cómo funciona",
      "hero.trustStrong": "+1.200 contratistas", "hero.trustRest": "cobrando más rápido",
      "hero.chip1": "Cotización enviada", "hero.chip2": "Contrato firmado", "hero.chip3": "Pagado completo",
      "doc.q.tag": "Cotización", "doc.q.title": "Remodelación cocina", "doc.q.l1": "Gabinetes", "doc.q.l2": "Cubiertas", "doc.q.l3": "Mano de obra (3 días)", "doc.total": "Total",
      "doc.c.tag": "Contrato", "doc.c.title": "Acuerdo de servicio",
      "doc.i.tag": "Factura", "doc.i.title": "Cobro final",
      "problem.eyebrow": "El problema", "problem.h2html": "Buen trabajo merece <em>buen papeleo</em>",
      "problem.lead": "Tú conoces tu oficio. Pero hacer cotizaciones en papel y adivinar precios te está costando dinero de verdad.",
      "problem.c1.h": "Dejas dinero en la mesa", "problem.c1.p": "Sin info real de precios, la mayoría de contratistas cotizan bajo. Menos dinero en tu bolsillo por el mismo trabajo duro.",
      "problem.c2.h": "Papeles que no se ven bien", "problem.c2.p": "Cotizaciones a mano en papel rayado no inspiran confianza. El cliente elige al que se ve organizado.",
      "problem.c3.h": "Horas que no te pagan", "problem.c3.p": "Cada hora batallando con papeles es una hora que podrías estar en obra ganando dinero.",
      "docs.eyebrow": "Un mensaje. Tres documentos.", "docs.h2html": "Cotización, contrato, factura — <em>listo</em>.",
      "docs.lead": "Mandanos un mensaje. Te regresamos un documento real con números reales — no un garabato en una servilleta.",
      "docs.tab.quote": "Cotización", "docs.tab.contract": "Contrato", "docs.tab.invoice": "Factura",
      "docs.counter.label": "Documentos enviados hasta hoy",
      "docs.counter.t1": "Cotizaciones", "docs.counter.t2": "Contratos", "docs.counter.t3": "Facturas", "docs.counter.t4": "Órdenes de cambio",
      "feat.eyebrow": "Qué hacemos", "feat.h2html": "Nos encargamos del <em>lado del negocio</em>",
      "feat.lead": "Desde la primera cotización hasta la factura final — nosotros lo manejamos para que tú sigas en la obra.",
      "feat.f1.h": "Precios justos, no adivinanzas", "feat.f1.p": "Datos reales de construcción ajustados a costos de hoy. Rango bajo, medio y alto para que sepas exactamente dónde estás parado.",
      "feat.f2.h": "Contratos que te protegen", "feat.f2.p": "Un toque convierte tu cotización en un contrato real. Protege tu trabajo y luce profesional con tus clientes.",
      "feat.f3.h": "Facturación sencilla", "feat.f3.p": "¿Trabajo terminado? Lo convertimos en factura. Lleva el control de quién pagó y quién no — sin hojas de cálculo.",
      "feat.f4.h": "Solo escríbenos", "feat.f4.p": "Sin apps complicadas. Sin software. Mándanos los detalles del trabajo por mensaje y nosotros hacemos el resto. Así de fácil.",
      "how.eyebrow": "Directo al grano", "how.h2": "Cómo funciona",
      "how.lead": "Tres pasos. Sin formularios. Sin software. Te encontramos donde ya estás — en tu celular.",
      "how.s1.h": "Cuéntanos del trabajo", "how.s1.p": "Mándanos un mensaje con los detalles. Te preguntamos una cosa a la vez — sin formularios largos.",
      "how.s2.h": "Revisa tu cotización", "how.s2.p": "Armamos una cotización profesional con precios justos. Revísala, cambia lo que necesites, y dale el visto bueno.",
      "how.s3.h": "Envía y cobra", "how.s3.p": "Mándale la cotización a tu cliente. Cuando termines el trabajo, lo convertimos en contrato y factura. Todo en un solo lugar.",
      "demo.eyebrow": "Mira cómo funciona", "demo.h2": "Solo escríbenos. Nosotros nos encargamos.",
      "demo.lead": "Cotizaciones, contratos, facturas — enviados desde tu celular en segundos. Sin app que descargar. Sin software que aprender.",
      "demo.quote": "Antes pasaba los domingos haciendo cotizaciones en papel rayado. Ahora les escribo desde la troca y me regresan una cotización pro en minutos. Mi cierre de ventas se disparó.",
      "demo.role": "Contratista General · 12 años", "demo.online": "En línea", "demo.message": "Mensaje",
      "price.eyebrow": "Precios", "price.h2html": "Páganos de <em>lo que te hacemos ganar</em>",
      "price.lead": "Cotizaciones, contratos, facturas, precios, seguimientos — corremos tu oficina para que tú sigas en la obra. Y se paga sola.",
      "price.without": "Sin nosotros", "price.with": "Con nosotros", "price.keep": "Te quedas con", "price.keep2": "Te quedas con",
      "price.w1": "Tu adivinanza de precio", "price.w2": "Horas en papeleo", "price.w2v": "~6 hrs", "price.w3": "Confianza del cliente", "price.w3v": "Más o menos",
      "price.u1": "Precios con datos reales", "price.u2": "Nuestra comisión 10%", "price.u3": "Horas en papeleo",
      "price.callout": "$850 más en tu bolsillo.", "price.calloutSub": "Una oficina que se paga sola. Solo cobramos cuando tu cliente paga.",
      "price.cta": "Empieza a ganar más →",
      "cta.eyebrow": "Vamos", "cta.h2": "¿Listo para quitarte el papeleo de encima?",
      "cta.lead": "Pon tu número — te enviamos un código de 6 dígitos. Entrar o registrarse, mismo formulario.",
      "cta.b1": "Sin cuotas iniciales, sin contratos", "cta.b2": "Primera cotización gratis — para nuevos pros", "cta.b3": "Inglés y español, en cada paso",
      "cta.label": "Tu número de teléfono", "cta.btn": "Enviar mi código",
      "cta.fine": "Al enviar, aceptas recibir un mensaje amigable de nuestra parte.",
      "cta.smsPreview": "Paperwork Monsters: Tu código es 482-913. No lo compartas.",
      "cta.steps.phone": "Teléfono", "cta.steps.code": "Código", "cta.steps.in": "Listo",
      "cta.useSaved": "Usar", "cta.notYou": "¿No eres tú?",
      "footer.contact": "Contacto", "footer.copy": "© 2026 Paperwork Monsters. Todos los derechos reservados.",
    }
  };

  const DOC_CONTENT = {
    en: {
      quote: { title: "Quote", num: "#PM-2641", date: "April 26, 2026",
        lines: [["Demolition & haul-off","1","$ 850","$ 850"],["Cabinets — solid maple","12","$ 350","$ 4,200"],["Quartz countertops (sq ft)","42","$ 95","$ 3,990"],["Plumbing & install labor","3 days","$ 650","$ 1,950"]],
        totals: [["Subtotal","$ 10,990"],["Tax (estimate)","$ 880"],["Estimate","$ 11,870"]],
        infoTitle: "Fair prices, not guesses",
        infoBody: "We pull from real construction pricing data — adjusted for today’s costs and your zip code. You get a low, mid, and high range so you know exactly where you stand.",
        infoList: ["Low / mid / high pricing ranges","Local material costs, refreshed weekly","Branded PDF you can text or email","Edit anything in one tap"] },
      contract: { title: "Contract", num: "#PM-2641-C", date: "April 26, 2026",
        lines: [["Scope: Kitchen remodel — Hernández","","","✓"],["Start date","","","May 2"],["Substantial completion","","","May 14"],["Deposit (25%)","","","$ 2,500"],["Progress payment (50%)","","","$ 5,495"],["Final payment","","","$ 2,995"]],
        totals: [["Total contract value","$ 10,990"],["Signed by client","✓ Apr 26"],["Status","Active"]],
        infoTitle: "Contracts that protect you",
        infoBody: "One tap turns your quote into a real, lawyer-reviewed contract. Spell out the scope, the schedule, and the payments — so there are no surprises later.",
        infoList: ["State-specific terms, ready to go","E-signature from your client","Auto deposit + progress milestones","Stored alongside the job, forever"] },
      invoice: { title: "Invoice", num: "#PM-2641-I", date: "May 14, 2026",
        lines: [["Kitchen remodel — completed","","","$ 10,990"],["Change order: under-cabinet lighting","1","$ 420","$ 420"],["Deposit received","","","− $ 2,500"],["Progress payment received","","","− $ 5,495"]],
        totals: [["Balance due","$ 3,415"],["Due by","May 18, 2026"],["Pay online","tap to pay"]],
        infoTitle: "Simple invoicing, paid faster",
        infoBody: "Job done? We turn the contract into an invoice. Track who’s paid, who hasn’t, and send a one-tap reminder when it’s time.",
        infoList: ["One-tap “pay now” link for clients","Automatic payment reminders","See balance due at a glance","Export for taxes and bookkeeping"] }
    },
    es: {
      quote: { title: "Cotización", num: "#PM-2641", date: "26 de abril de 2026",
        lines: [["Demolición y limpieza","1","$ 850","$ 850"],["Gabinetes — maple sólido","12","$ 350","$ 4.200"],["Cubiertas de cuarzo (pie²)","42","$ 95","$ 3.990"],["Plomería e instalación","3 días","$ 650","$ 1.950"]],
        totals: [["Subtotal","$ 10.990"],["Impuesto (est.)","$ 880"],["Estimado","$ 11.870"]],
        infoTitle: "Precios justos, no adivinanzas",
        infoBody: "Sacamos los datos de precios reales de construcción — ajustados a costos de hoy y tu código postal. Rango bajo, medio y alto para que sepas dónde estás parado.",
        infoList: ["Rangos bajo / medio / alto","Costos locales, refrescados cada semana","PDF con tu marca para mandar","Edita lo que sea con un toque"] },
      contract: { title: "Contrato", num: "#PM-2641-C", date: "26 de abril de 2026",
        lines: [["Alcance: Remodelación cocina — Hernández","","","✓"],["Fecha de inicio","","","2 de mayo"],["Terminación","","","14 de mayo"],["Anticipo (25%)","","","$ 2.500"],["Avance (50%)","","","$ 5.495"],["Pago final","","","$ 2.995"]],
        totals: [["Valor total","$ 10.990"],["Firmado por cliente","✓ 26 abr"],["Estado","Activo"]],
        infoTitle: "Contratos que te protegen",
        infoBody: "Un toque convierte tu cotización en un contrato real, revisado por abogados. Define alcance, calendario y pagos — sin sorpresas después.",
        infoList: ["Términos por estado, listos","Firma electrónica del cliente","Anticipos y avances automáticos","Guardado con el trabajo para siempre"] },
      invoice: { title: "Factura", num: "#PM-2641-I", date: "14 de mayo de 2026",
        lines: [["Remodelación cocina — completada","","","$ 10.990"],["Orden de cambio: luces bajo gabinete","1","$ 420","$ 420"],["Anticipo recibido","","","− $ 2.500"],["Pago de avance recibido","","","− $ 5.495"]],
        totals: [["Saldo por pagar","$ 3.415"],["Vence","18 de mayo de 2026"],["Paga en línea","toca para pagar"]],
        infoTitle: "Facturación simple, cobrado más rápido",
        infoBody: "¿Trabajo terminado? Convertimos el contrato en factura. Lleva el control de quién pagó, quién no, y manda recordatorios con un toque.",
        infoList: ["Enlace de pago con un toque","Recordatorios automáticos","Saldo a la vista","Exporta para impuestos y contabilidad"] }
    }
  };

  const CHAT_SCRIPT = {
    en: [
      { side: "right", kind: "bubble", cls: "me", text: "Kitchen remodel for the Hernández family. Cabinets, quartz counters, 3 days labor." },
      { side: "right", kind: "meta", text: "9:38 AM" },
      { side: "left", kind: "typing" },
      { side: "left", kind: "bubble", cls: "them", text: "Got it 👍 What zip code is the job in?" },
      { side: "left", kind: "bubble", cls: "them", text: "And rough square footage of countertop?" },
      { side: "right", kind: "bubble", cls: "me", text: "78704. About 42 sq ft of counter." },
      { side: "left", kind: "typing" },
      { side: "left", kind: "bubble", cls: "them", text: "Perfect. Quote coming up — typical range for this is $10,800–$12,400." },
      { side: "left", kind: "bubble", cls: "them", text: "Here’s your quote, ready to send:", style: "background:var(--mint-200)" },
      { side: "right", kind: "quote" },
      { side: "right", kind: "bubble", cls: "me", text: "Looks good. Send it to them." },
      { side: "right", kind: "meta", text: "9:41 AM ✓ Sent to client" },
    ],
    es: [
      { side: "right", kind: "bubble", cls: "me", text: "Remodelación cocina para los Hernández. Gabinetes, cubierta de cuarzo, 3 días de mano de obra." },
      { side: "right", kind: "meta", text: "9:38" },
      { side: "left", kind: "typing" },
      { side: "left", kind: "bubble", cls: "them", text: "Listo 👍 ¿Cuál es el código postal del trabajo?" },
      { side: "left", kind: "bubble", cls: "them", text: "¿Y aproximadamente cuántos pies² de cubierta?" },
      { side: "right", kind: "bubble", cls: "me", text: "78704. Como 42 pies² de cubierta." },
      { side: "left", kind: "typing" },
      { side: "left", kind: "bubble", cls: "them", text: "Perfecto. Va la cotización — rango típico $10.800–$12.400." },
      { side: "left", kind: "bubble", cls: "them", text: "Aquí está tu cotización, lista para enviar:", style: "background:var(--mint-200)" },
      { side: "right", kind: "quote" },
      { side: "right", kind: "bubble", cls: "me", text: "Se ve bien. Mándasela." },
      { side: "right", kind: "meta", text: "9:41 ✓ Enviado al cliente" },
    ],
  };

  function quoteCardHTML(lang) {
    const t = lang === "es"
      ? { hd: "Cotización · #PM-2641", l1: "Gabinetes e instalación", l2: "Cubiertas de cuarzo", l3: "Demolición y mano de obra", total: "Total" }
      : { hd: "Quote · #PM-2641", l1: "Cabinets & install", l2: "Quartz countertops", l3: "Demo & labor", total: "Total" };
    return '<div class="quote-card"><div class="qc-head"><span>' + t.hd + '</span><span class="pdf">PDF</span></div><div class="row"><span>' + t.l1 + '</span><strong>$ 4,200</strong></div><div class="row"><span>' + t.l2 + '</span><strong>$ 3,990</strong></div><div class="row"><span>' + t.l3 + '</span><strong>$ 2,800</strong></div><div class="total"><span>' + t.total + '</span><span>$ 10,990</span></div></div>';
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
  let curLang = (localStorage.getItem("pm:lang") || "en");
  if (curLang !== "en" && curLang !== "es") curLang = "en";
  let activeDoc = "quote";

  /* ===== i18n ===== */
  function applyLang(lang) {
    curLang = lang;
    const dict = I18N[lang];
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      const k = el.getAttribute("data-i18n");
      if (!k || dict[k] == null) return;
      if (el.getAttribute("data-html") === "1") el.innerHTML = dict[k];
      else el.textContent = dict[k];
    });
    document.querySelectorAll(".rotor-track .word").forEach(function (w) {
      w.textContent = w.getAttribute("data-" + lang) || w.textContent;
    });
    const mq = document.getElementById("marquee-track");
    if (mq) {
      const span = mq.querySelector("span");
      const items = ((span && span.getAttribute("data-" + lang)) || "").split("|");
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
    try { localStorage.setItem("pm:lang", lang); } catch (_) {}
    document.querySelectorAll(".lang-toggle button").forEach(function (b) {
      if (b.dataset.lang === lang) b.classList.add("on"); else b.classList.remove("on");
    });
  }

  document.querySelectorAll(".lang-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () { applyLang(btn.dataset.lang); });
  });

  /* ===== rotor ===== */
  let rotorInterval = null;
  function fitRotor() {
    const track = document.getElementById("rotor-track");
    if (!track) return;
    track.style.width = "auto";
    let max = 0;
    const probe = document.createElement("span");
    probe.style.cssText = "visibility:hidden;position:absolute;white-space:nowrap;font:inherit;";
    track.appendChild(probe);
    track.querySelectorAll(".word").forEach(function (w) { probe.textContent = w.textContent; max = Math.max(max, probe.offsetWidth); });
    track.removeChild(probe);
    track.style.width = (max + 4) + "px";
  }
  (function rotor() {
    const track = document.getElementById("rotor-track");
    if (!track) return;
    const words = Array.prototype.slice.call(track.querySelectorAll(".word"));
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
    rotorInterval = setInterval(function () {
      const cur = words[i];
      const next = words[(i + 1) % words.length];
      cur.classList.remove("in");
      cur.classList.add("out");
      next.classList.remove("out");
      requestAnimationFrame(function () { requestAnimationFrame(function () { next.classList.add("in"); }); });
      setTimeout(function () { cur.classList.remove("out"); }, 600);
      i = (i + 1) % words.length;
    }, 2200);
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
      if (id === "contact") setTimeout(function () { const f = document.getElementById("f-phone"); if (f) f.focus({ preventScroll: true }); }, 600);
    });
  });

  /* ===== doc tabs ===== */
  function renderDoc(key) {
    activeDoc = key;
    const d = DOC_CONTENT[curLang][key];
    const $ = function (id) { return document.getElementById(id); };
    if (!$("doc-title")) return;
    $("doc-title").textContent = d.title;
    $("doc-num").textContent = d.num;
    $("doc-date").textContent = d.date;
    $("doc-lines").innerHTML = d.lines.map(function (l) {
      return '<div class="doc-line"><span class="desc">' + l[0] + '</span><span class="qty">' + l[1] + '</span><span class="rate">' + l[2] + '</span><span class="amt">' + l[3] + '</span></div>';
    }).join("");
    $("doc-totals").innerHTML = d.totals.map(function (t, i) {
      return '<div class="row' + (i === d.totals.length - 1 ? " total" : "") + '"><span>' + t[0] + '</span><span>' + t[1] + '</span></div>';
    }).join("");
    $("doc-info-title").textContent = d.infoTitle;
    $("doc-info-body").textContent = d.infoBody;
    const checkSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    $("doc-info-list").innerHTML = d.infoList.map(function (x) { return "<li>" + checkSvg + " " + x + "</li>"; }).join("");
  }
  document.querySelectorAll(".doc-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".doc-tab").forEach(function (x) { x.classList.remove("on"); });
      tab.classList.add("on");
      renderDoc(tab.dataset.doc);
    });
  });

  /* ===== counter ===== */
  (function counter() {
    const el = document.getElementById("doc-counter-num");
    if (!el) return;
    const target = 48217;
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
            el.textContent = Math.round(target * ease).toLocaleString(curLang === "es" ? "es-ES" : "en-US");
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
    revealTimers.forEach(function (id) { clearTimeout(id); });
    revealTimers = [];
    revealed = 0;
    document.querySelectorAll(".chat-step").forEach(function (s) { s.classList.remove("in"); });
    const fill = document.getElementById("chat-fill");
    if (fill) fill.style.width = "0%";
  }
  function startReveal() {
    const steps = Array.prototype.slice.call(document.querySelectorAll(".chat-step"));
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
        if (fill) fill.style.width = Math.round(((i + 1) / steps.length) * 100) + "%";
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
      try { return localStorage.getItem("pm:last-phone"); } catch (_) { return null; }
    }
    function clearSavedPhone() {
      try { localStorage.removeItem("pm:last-phone"); } catch (_) {}
    }
    if (savedWrap && savedBtn && savedPhoneEl) {
      const saved = readSavedPhone();
      if (saved) {
        // Reuse formatPhone() for display.
        savedPhoneEl.textContent = formatPhone(saved.replace(/^\+1/, "")) || saved;
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

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      const e164 = toE164(phoneInput.value);
      if (e164.replace(/\D/g, "").length < 10) {
        phoneInput.focus();
        return;
      }
      const cta = form.querySelector(".cf-cta");
      const original = cta ? cta.innerHTML : "";
      if (cta) {
        cta.disabled = true;
        cta.innerHTML = curLang === "es" ? "<span>Enviando…</span>" : "<span>Sending…</span>";
      }
      try {
        const res = await fetch("/api/auth/send-otp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phoneNumber: e164, language: curLang }),
        });
        if (!res.ok) throw new Error("send failed " + res.status);
        // Persist for next-visit one-tap. The /verify page also writes
        // this on successful verify (more authoritative), but writing
        // here means the chip works even if the user abandons verify.
        try { localStorage.setItem("pm:last-phone", e164); } catch (_) {}
        location.href = "/verify?phone=" + encodeURIComponent(e164);
      } catch (err) {
        if (cta) {
          cta.disabled = false;
          cta.innerHTML = original;
        }
        if (meta) {
          meta.innerHTML = curLang === "es"
            ? '<span class="cf-meta__check">!</span><span style="color:var(--danger)">No pudimos enviar. Intenta otra vez.</span>'
            : '<span class="cf-meta__check">!</span><span style="color:var(--danger)">Couldn’t send. Try again.</span>';
        }
      }
    });
  })();

  /* ===== init ===== */
  applyLang(curLang);
  renderDoc("quote");
  renderChat();
})();
