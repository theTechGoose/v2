/**
 * The ONE landing dictionary for the root page ("/").
 *
 * Single source of truth (P-19): `routes/index.tsx` renders every
 * `data-i18n` node from it at SSR time — so a `pm_lang=es` request paints
 * Spanish immediately instead of English-then-flip — and the browser gets
 * the very same object from `/landing-dict.js` (routes/landing-dict.js.ts)
 * as `window.__PM_LANDING_DICT`, which `static/landing-scripts.js` uses for
 * the client-side language toggle. One dict, two consumers, no drift.
 *
 * It is served from its own URL rather than inlined in the page so the
 * Spanish page never ships English copy (and vice versa).
 *
 * Placeholders are filled from `shared/quote-flow/landing-offers.ts` — never
 * re-typed here (P-08):
 *   {n} — a social-proof counter, localized by `formatSocialProof`; the
 *         element names which one via `data-count="<key>"`.
 *   {p} — the from-price in dollars (LANDING_OFFER.priceFromCents).
 *   {d} — the free-trial length in days (LANDING_OFFER.trialDays).
 */

import { PRICING_PLANS } from "../../shared/quote-flow/pricing-plans.ts";

export type LandingLang = "en" | "es";

export const LANDING_DICT: Record<LandingLang, Record<string, string>> = {
  en: {
    // <head> copy, so the client-side language toggle can retitle the page
    // instead of leaving an English <title> over Spanish copy.
    "head.title":
      "Paperwork Monster — You do the work. We handle the paperwork.",
    "head.metaDescription":
      "Quotes, contracts, and invoices done right — built for contractors. No app to install. Just chat with us.",
    "nav.features": "What We Do",
    "brand1": "Paperwork",
    "brand2": "Monster",
    "nav.how": "How It Works",
    "nav.pricing": "Pricing",
    "nav.cta": "Get Started",
    "nav.login": "Log in",
    "hero.kickerPill": "For pros",
    "hero.kicker": "Built for contractors who work with their hands",
    "hero.h1a": "You do the work.",
    "hero.h1b": "We handle the",
    "hero.lead":
      "You communicate with us in Spanish. Everything goes out to your clients in perfect English. No apps to learn. Just chat with us.",
    "hero.cta1": "Get Started →",
    "hero.cta2": "See How It Works",
    "hero.trustStrong": "{n}+ contractors",
    "hero.trustRest": "getting paid faster",
    "hero.chatStatus": "Online • SMS",
    "hero.chip1": "Quote sent",
    "hero.chip2": "Contract signed",
    "hero.chip3": "Paid in full",
    "doc.q.tag": "Quote",
    "doc.q.title": "Kitchen remodel",
    "doc.q.l1": "Cabinets",
    "doc.q.l2": "Counters",
    "doc.q.l3": "Labor (3 days)",
    "doc.q.signed": "Signed ✓",
    "doc.total": "Total",
    "doc.c.tag": "Contract",
    "doc.c.title": "Service Agreement",
    "doc.i.tag": "Invoice",
    "doc.i.title": "Final billing",
    "problem.eyebrow": "The problem",
    "problem.h2html": "Good work deserves <em>good paperwork</em>",
    "problem.lead":
      "You know your trade. But chasing down quotes on scrap paper and guessing at prices is costing you real money.",
    "problem.c1.h": "Leaving money on the table",
    "problem.c1.p":
      "Without solid pricing info, most contractors bid too low. That means less money in your pocket for the same hard work.",
    "problem.c2.h": "Paperwork that doesn’t look right",
    "problem.c2.p":
      "Handwritten quotes on notebook paper don’t build trust. Clients pick the contractor who looks like they have it together.",
    "problem.c3.h": "Hours you’re not getting paid for",
    "problem.c3.p":
      "Every hour figuring out paperwork is an hour you could be on a job site earning real money.",
    "docs.eyebrow": "One text. Three documents.",
    "docs.h2html": "Quote, contract, invoice — <em>handled</em>.",
    "docs.lead":
      "Send us a message. We send back a real document with real numbers — not a sketch on the back of an envelope.",
    "docs.tab.quote": "Quote",
    "docs.tab.contract": "Contract",
    "docs.tab.invoice": "Invoice",
    "docs.counter.label": "Documents sent so far",
    "docs.counter.t1": "Quotes",
    "docs.counter.t2": "Contracts",
    "docs.counter.t3": "Invoices",
    "docs.counter.t4": "Change orders",
    "feat.eyebrow": "What we do",
    "feat.h2html": "We take care of the <em>business side</em>",
    "feat.lead":
      "From the first quote to the final invoice — we handle it so you can stay on the job.",
    "feat.f1.h": "Fair prices, not guesses",
    "feat.f1.p":
      "Real construction pricing data, adjusted for today’s costs. Get a low, middle, and high range so you know exactly where you stand.",
    "feat.f2.h": "Contracts that protect you",
    "feat.f2.p":
      "One tap turns your quote into a real contract. Protect your work and look professional to your clients.",
    "feat.f3.h": "Simple invoicing",
    "feat.f3.p":
      "Job done? We turn it into an invoice. Keep track of who’s paid and who hasn’t — without a spreadsheet.",
    "feat.f4.h": "Just chat with us",
    "feat.f4.p":
      "No fancy apps. Text us the job details and we do the rest. Simple as that.",
    "how.eyebrow": "Straight to the point",
    "how.h2": "How it works",
    "how.lead":
      "Three steps. No forms. We meet you where you already are — your phone.",
    "how.s1.h": "Chat with us",
    "how.s1.p":
      "Send us a text with the job details. We’ll ask you one question at a time — no long forms, no hassle.",
    "how.s2.h": "Check your paperwork",
    "how.s2.p":
      "We put together professional paperwork with fair pricing. Look it over, change what you need, and give us the thumbs up.",
    "how.s3.h": "Send it and get paid",
    "how.s3.p":
      "Send the paperwork to your client. When the job’s done, we turn it into an invoice. Everything’s in one place.",
    "demo.eyebrow": "See it in action",
    "demo.h2": "Just chat with us. We handle the rest.",
    "demo.lead":
      "Quotes, contracts, invoices — sent from your phone in seconds. No app to download.",
    "demo.quote":
      "Having a quick turn for the quotes frees up my mind and has allowed me to quote more jobs and fill my pipeline much quicker.",
    "demo.role": "Four Brothers",
    "demo.online": "Online",
    "demo.message": "Message",
    "price.eyebrow": "Pricing",
    "price.plans.h2html": "Flat monthly pricing. <em>No surprises.</em>",
    "price.plans.lead":
      "Your whole back office — quotes, contracts, invoices, follow-ups — for one flat monthly price. No setup fees, cancel anytime.",
    "price.plans.cta": "Get started",
    "price.plans.trial": "Free for {d} days. Cancel anytime.",
    "price.permo": "/month",
    "price.t1.name": "Starter",
    "price.t1.blurb":
      "Legitimize your business for less than an ad-free Netflix subscription.",
    "price.t2.name": "Pro",
    "price.t2.badge": "Most popular",
    "price.t2.blurb":
      "Win more jobs and get paid faster — without the chasing.",
    "price.t3.name": "Crew",
    "price.t3.blurb": "For crews that run several jobs a week.",
    "cta.eyebrow": "Let’s go",
    "cta.h2": "Ready to get the paperwork off your plate?",
    "cta.lead":
      "Drop your number — we’ll text you a 6-digit code. Login or sign up, same form.",
    "cta.b1": "No setup fees, no contracts",
    "cta.fromPrice": "Plans from ${p}/month",
    "cta.b3": "English & Spanish, every step",
    "cta.label": "Your phone number",
    "cta.btn": "Sign up",
    "cta.fine": "By submitting, you agree to receive a friendly text from us.",
    "cta.smsPreview":
      "Paperwork Monster: Your code is 482-913. Don’t share it.",
    "cta.steps.phone": "Phone",
    "cta.steps.code": "Code",
    "cta.steps.in": "You’re in",
    "cta.useSaved": "Use",
    "cta.notYou": "Not you?",
    // Signup form errors. #cf-meta is role="alert" — a bad number used to
    // produce nothing at all (P-07), which on a phone reads as a dead button.
    "cta.errPhone":
      "That doesn’t look like a phone number. Enter your 10-digit US number.",
    "cta.errSend": "We couldn’t send the code. Try again.",
    "cta.trustRest": "already on Paperwork Monster",
    "footer.contact": "Contact",
    "footer.copy": "© 2026 Paperwork Monster. All rights reserved.",
  },
  es: {
    "head.title":
      "Paperwork Monster — Tú haces el trabajo. Nosotros el papeleo.",
    "head.metaDescription":
      "Cotizaciones, contratos y facturas bien hechos — creados para contratistas. Sin apps que instalar. Solo chatea con nosotros.",
    "nav.features": "Qué hacemos",
    "brand1": "Paperwork",
    "brand2": "Monster",
    "nav.how": "Cómo funciona",
    "nav.pricing": "Precios",
    "nav.cta": "Empezar",
    "nav.login": "Entrar",
    "hero.kickerPill": "Para pros",
    "hero.kicker": "Hecho para contratistas que trabajan con las manos",
    "hero.h1a": "Tú haces el trabajo.",
    "hero.h1b": "Nosotros manejamos",
    "hero.lead":
      "Nos escribes en español. Todo sale a tus clientes en inglés perfecto. Sin apps que aprender. Solo chatea con nosotros.",
    "hero.cta1": "Empezar →",
    "hero.cta2": "Ver cómo funciona",
    "hero.trustStrong": "+{n} contratistas",
    "hero.trustRest": "cobrando más rápido",
    "hero.chatStatus": "En línea • SMS",
    "hero.chip1": "Cotización enviada",
    "hero.chip2": "Contrato firmado",
    "hero.chip3": "Pagado completo",
    "doc.q.tag": "Cotización",
    "doc.q.title": "Remodelación cocina",
    "doc.q.l1": "Gabinetes",
    "doc.q.l2": "Cubiertas",
    "doc.q.l3": "Mano de obra (3 días)",
    "doc.q.signed": "Firmado ✓",
    "doc.total": "Total",
    "doc.c.tag": "Contrato",
    "doc.c.title": "Acuerdo de servicio",
    "doc.i.tag": "Factura",
    "doc.i.title": "Cobro final",
    "problem.eyebrow": "El problema",
    "problem.h2html": "Buen trabajo merece <em>buen papeleo</em>",
    "problem.lead":
      "Tú conoces tu oficio. Pero hacer cotizaciones en papel y adivinar precios te está costando dinero de verdad.",
    "problem.c1.h": "Dejas dinero en la mesa",
    "problem.c1.p":
      "Sin info real de precios, la mayoría de contratistas cotizan bajo. Menos dinero en tu bolsillo por el mismo trabajo duro.",
    "problem.c2.h": "Papeles que no se ven bien",
    "problem.c2.p":
      "Cotizaciones a mano en papel rayado no inspiran confianza. El cliente elige al que se ve organizado.",
    "problem.c3.h": "Horas que no te pagan",
    "problem.c3.p":
      "Cada hora batallando con papeles es una hora que podrías estar en obra ganando dinero.",
    "docs.eyebrow": "Un mensaje. Tres documentos.",
    "docs.h2html": "Cotización, contrato, factura — <em>listo</em>.",
    "docs.lead":
      "Mandanos un mensaje. Te regresamos un documento real con números reales — no un garabato en una servilleta.",
    "docs.tab.quote": "Cotización",
    "docs.tab.contract": "Contrato",
    "docs.tab.invoice": "Factura",
    "docs.counter.label": "Documentos enviados hasta hoy",
    "docs.counter.t1": "Cotizaciones",
    "docs.counter.t2": "Contratos",
    "docs.counter.t3": "Facturas",
    "docs.counter.t4": "Órdenes de cambio",
    "feat.eyebrow": "Qué hacemos",
    "feat.h2html": "Nos encargamos del <em>lado del negocio</em>",
    "feat.lead":
      "Desde la primera cotización hasta la factura final — nosotros lo manejamos para que tú sigas en la obra.",
    "feat.f1.h": "Precios justos, no adivinanzas",
    "feat.f1.p":
      "Datos reales de construcción ajustados a costos de hoy. Rango bajo, medio y alto para que sepas exactamente dónde estás parado.",
    "feat.f2.h": "Contratos que te protegen",
    "feat.f2.p":
      "Un toque convierte tu cotización en un contrato real. Protege tu trabajo y luce profesional con tus clientes.",
    "feat.f3.h": "Facturación sencilla",
    "feat.f3.p":
      "¿Trabajo terminado? Lo convertimos en factura. Lleva el control de quién pagó y quién no — sin hojas de cálculo.",
    "feat.f4.h": "Solo chatea con nosotros",
    "feat.f4.p":
      "Sin apps complicadas. Mándanos los detalles del trabajo por mensaje y nosotros hacemos el resto. Así de fácil.",
    "how.eyebrow": "Directo al grano",
    "how.h2": "Cómo funciona",
    "how.lead":
      "Tres pasos. Sin formularios. Te encontramos donde ya estás — en tu celular.",
    "how.s1.h": "Chatea con nosotros",
    "how.s1.p":
      "Mándanos un mensaje con los detalles. Te preguntamos una cosa a la vez — sin formularios largos.",
    "how.s2.h": "Revisa tu papeleo",
    "how.s2.p":
      "Armamos papeleo profesional con precios justos. Revísalo, cambia lo que necesites, y dale el visto bueno.",
    "how.s3.h": "Envía y cobra",
    "how.s3.p":
      "Mándale el papeleo a tu cliente. Cuando termines el trabajo, lo convertimos en factura. Todo en un solo lugar.",
    "demo.eyebrow": "Mira cómo funciona",
    "demo.h2": "Solo chatea con nosotros. Nosotros nos encargamos.",
    "demo.lead":
      "Cotizaciones, contratos, facturas — enviados desde tu celular en segundos. Sin app que descargar.",
    "demo.quote":
      "Tener respuestas rápidas en las cotizaciones me libera la mente y me ha permitido cotizar más trabajos y llenar mi cartera mucho más rápido.",
    "demo.role": "Four Brothers",
    "demo.online": "En línea",
    "demo.message": "Mensaje",
    "price.eyebrow": "Precios",
    "price.plans.h2html": "Precio fijo al mes. <em>Sin sorpresas.</em>",
    "price.plans.lead":
      "Toda tu oficina — cotizaciones, contratos, facturas, seguimientos — por un precio fijo al mes. Sin cuotas iniciales, cancela cuando quieras.",
    "price.plans.cta": "Empezar",
    "price.plans.trial": "Prueba gratis por {d} días. Cancela cuando quieras.",
    "price.permo": "/mes",
    "price.t1.name": "Starter",
    "price.t1.blurb":
      "Legitima tu negocio por menos de lo que cuesta Netflix sin anuncios.",
    "price.t2.name": "Pro",
    "price.t2.badge": "El más popular",
    "price.t2.blurb":
      "Gana más trabajos y cobra más rápido — sin andar persiguiendo pagos.",
    "price.t3.name": "Crew",
    "price.t3.blurb": "Para cuadrillas que manejan varios trabajos por semana.",
    "cta.eyebrow": "Vamos",
    "cta.h2": "¿Listo para quitarte el papeleo de encima?",
    "cta.lead":
      "Pon tu número — te enviamos un código de 6 dígitos. Entrar o registrarse, mismo formulario.",
    "cta.b1": "Sin cuotas iniciales, sin contratos",
    "cta.fromPrice": "Planes desde ${p} al mes",
    "cta.b3": "Inglés y español, en cada paso",
    "cta.label": "Tu número de teléfono",
    "cta.btn": "Regístrate",
    "cta.fine":
      "Al enviar, aceptas recibir un mensaje amigable de nuestra parte.",
    "cta.smsPreview":
      "Paperwork Monster: Tu código es 482-913. No lo compartas.",
    "cta.steps.phone": "Teléfono",
    "cta.steps.code": "Código",
    "cta.steps.in": "Listo",
    "cta.useSaved": "Usar",
    "cta.notYou": "¿No eres tú?",
    "cta.errPhone":
      "Ese número no parece válido. Escribe tus 10 dígitos de EE. UU.",
    "cta.errSend": "No pudimos enviar el código. Intenta otra vez.",
    "cta.trustRest": "ya en Paperwork Monster",
    "footer.contact": "Contacto",
    "footer.copy": "© 2026 Paperwork Monster. Todos los derechos reservados.",
  },
};

/**
 * Plan features are NOT written above: they are projected here from the ONE
 * source both landing pages read (shared/quote-flow/pricing-plans.ts) onto the
 * `price.t<tier>.f<n>` data-i18n keys this page's markup and client-side
 * language toggle use. `/` and `/landing` sold the same three prices with
 * different promises until this became a single list.
 */
for (const lang of ["en", "es"] as const) {
  PRICING_PLANS.forEach((plan, tier) => {
    plan.features.forEach((feature, n) => {
      LANDING_DICT[lang][`price.t${tier + 1}.f${n + 1}`] = lang === "es"
        ? feature.es
        : feature.en;
    });
  });
}
