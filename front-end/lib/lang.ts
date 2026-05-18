/**
 * Language signal — single source of truth for EN/ES.
 *
 * Server: read from Accept-Language / cookie / query.
 * Client: subscribed to by islands; toggled by <LangToggle />, persisted to localStorage.
 */
import { signal } from "@preact/signals";

export type Lang = "en" | "es";

export const langSignal = signal<Lang>("en");

interface Card { t: string; d: string }

interface Strings {
  "nav.features": string;
  "nav.how": string;
  "nav.pricing": string;
  "nav.contact": string;
  "nav.signin": string;
  "hero.kicker": string;
  "hero.title.before": string;
  "hero.title.after": string;
  "hero.rotor": readonly string[];
  "hero.lede": string;
  "hero.cta.primary": string;
  "hero.cta.outline": string;
  "marquee.items": string;
  "problems.eyebrow": string;
  "problems.title": string;
  "problems.cards": readonly Card[];
  "docs.eyebrow": string;
  "docs.title": string;
  "docs.tabs": readonly string[];
  "features.eyebrow": string;
  "features.title": string;
  "features.items": readonly Card[];
  "how.eyebrow": string;
  "how.title": string;
  "how.steps": readonly Card[];
  "demo.eyebrow": string;
  "demo.title": string;
  "pricing.eyebrow": string;
  "pricing.title": string;
  "pricing.without": string;
  "pricing.with": string;
  "pricing.withoutPrice": string;
  "pricing.withPrice": string;
  "pricing.withoutNotes": readonly string[];
  "pricing.withNotes": readonly string[];
  "contact.eyebrow": string;
  "contact.title": string;
  "contact.lede": string;
  "contact.phone": string;
  "contact.cta": string;
  "contact.placeholder": string;
  "footer.tagline": string;
  "verify.h1": string;
  "verify.lede": string;
  "verify.cta": string;
  "verify.editPhone": string;
  "verify.resend": string;
  "verify.resendIn": string;
  "verify.errInvalid": string;
  "verify.errExpired": string;
  "verify.errRate": string;
  "welcome.back": string;
  "cta.steps.phone": string;
  "cta.steps.code": string;
  "cta.steps.in": string;
}

export const STRINGS: Record<Lang, Strings> = {
  en: {
    "nav.features": "Features",
    "nav.how": "How it works",
    "nav.pricing": "Pricing",
    "nav.contact": "Get started",
    "nav.signin": "Sign in",
    "hero.kicker": "Built for contractors",
    "hero.title.before": "Quote, contract, and invoice — without the",
    "hero.title.after": ".",
    "hero.rotor": ["paperwork", "headache", "delay", "missed payment"],
    "hero.lede": "Bossie texts your client, drafts the docs, and gets you paid. You just say yes.",
    "hero.cta.primary": "Get my number",
    "hero.cta.outline": "See how it works",
    "marquee.items": "Quotes · Contracts · Invoices · Reminders · Payments · Reviews",
    "problems.eyebrow": "The problem",
    "problems.title": "Three things that kill small contractors",
    "problems.cards": [
      { t: "Slow quotes",     d: "Estimates take days to write up. Clients move on." },
      { t: "Vague contracts", d: "Job-detail creep eats your margin and your weekends." },
      { t: "Late invoices",   d: "Sent too late or never sent at all. Cash gets squeezed." },
    ],
    "docs.eyebrow": "Live preview",
    "docs.title": "What Bossie sends, on your behalf",
    "docs.tabs": ["Quote", "Contract", "Invoice"],
    "features.eyebrow": "What you get",
    "features.title": "Everything the office never had time for",
    "features.items": [
      { t: "Bilingual SMS",   d: "EN/ES out of the box. Texts that sound like you." },
      { t: "Auto reminders",  d: "Polite nudges until they pay. No awkward calls." },
      { t: "Real signatures", d: "Tap-to-sign contracts. Court-ready." },
      { t: "Photo intake",    d: "Customers snap pics, Bossie writes the job details." },
    ],
    "how.eyebrow": "How it works",
    "how.title": "Three steps. No app to install.",
    "how.steps": [
      { t: "Forward the lead",   d: "Drop the customer's number into the chat." },
      { t: "Approve the draft",  d: "Bossie writes a quote — you tap to send." },
      { t: "Get paid",           d: "Invoice goes out, Bossie chases the balance." },
    ],
    "demo.eyebrow": "Real conversation",
    "demo.title": "It feels like texting your best foreman",
    "pricing.eyebrow": "Pricing",
    "pricing.title": "Pay for what works",
    "pricing.without": "Without Bossie",
    "pricing.with": "With Bossie",
    "pricing.withoutPrice": "$0/mo",
    "pricing.withPrice": "$49/mo",
    "pricing.withoutNotes": ["Hours on paperwork", "Late invoices", "Lost leads"],
    "pricing.withNotes": ["Quotes in minutes", "Auto-paid invoices", "Bilingual replies"],
    "contact.eyebrow": "Get started",
    "contact.title": "Drop your number — Bossie texts you in 60 seconds",
    "contact.lede": "We'll send a 6-digit code to log you in. No app to install.",
    "contact.phone": "Mobile number",
    "contact.cta": "Text me the code",
    "contact.placeholder": "(512) 555-1234",
    "footer.tagline": "Paperwork Monster — built for contractors who'd rather be on the truck.",
    "verify.h1": "Check your phone",
    "verify.lede": "We just texted a 6-digit code to",
    "verify.cta": "Verify",
    "verify.editPhone": "Wrong number? Edit",
    "verify.resend": "Resend code",
    "verify.resendIn": "Resend in {n}s",
    "verify.errInvalid": "That code didn't match. Try again.",
    "verify.errExpired": "Code expired — request a new one.",
    "verify.errRate": "Too many tries. Wait a minute and try again.",
    "welcome.back": "Welcome back, {firstName}.",
    "cta.steps.phone": "Phone",
    "cta.steps.code": "Code",
    "cta.steps.in": "You're in",
  },
  es: {
    "nav.features": "Funciones",
    "nav.how": "Cómo funciona",
    "nav.pricing": "Precios",
    "nav.contact": "Empezar",
    "nav.signin": "Entrar",
    "hero.kicker": "Hecho para contratistas",
    "hero.title.before": "Cotiza, firma y cobra — sin el",
    "hero.title.after": ".",
    "hero.rotor": ["papeleo", "dolor de cabeza", "retraso", "pago atrasado"],
    "hero.lede": "Bossie le escribe a tu cliente, redacta los documentos y te hace cobrar. Tú solo dices que sí.",
    "hero.cta.primary": "Empezar",
    "hero.cta.outline": "Ver cómo funciona",
    "marquee.items": "Cotizaciones · Contratos · Facturas · Recordatorios · Pagos · Reseñas",
    "problems.eyebrow": "El problema",
    "problems.title": "Tres cosas que hunden a los contratistas",
    "problems.cards": [
      { t: "Cotizaciones lentas", d: "Tardas días en mandar el estimado. El cliente se va." },
      { t: "Contratos vagos",     d: "El alcance crece y se come tu margen y tus fines de semana." },
      { t: "Facturas tarde",      d: "Llegan tarde o nunca. El flujo de caja se ahoga." },
    ],
    "docs.eyebrow": "Vista previa",
    "docs.title": "Lo que Bossie envía por ti",
    "docs.tabs": ["Cotización", "Contrato", "Factura"],
    "features.eyebrow": "Lo que recibes",
    "features.title": "Todo lo que la oficina nunca tuvo tiempo de hacer",
    "features.items": [
      { t: "SMS bilingüe",            d: "Inglés/Español sin configurar nada." },
      { t: "Recordatorios automáticos", d: "Empujones amables hasta que pagan." },
      { t: "Firmas reales",           d: "Contratos firmados con un toque." },
      { t: "Fotos del cliente",       d: "Tu cliente toma fotos y Bossie cotiza el trabajo." },
    ],
    "how.eyebrow": "Cómo funciona",
    "how.title": "Tres pasos. Sin app que instalar.",
    "how.steps": [
      { t: "Reenvía al cliente", d: "Pásale el número del cliente al chat." },
      { t: "Aprueba el borrador", d: "Bossie redacta — tú lo envías." },
      { t: "Cobra",               d: "Sale la factura y Bossie persigue el pago." },
    ],
    "demo.eyebrow": "Conversación real",
    "demo.title": "Se siente como mensajear con tu mejor capataz",
    "pricing.eyebrow": "Precios",
    "pricing.title": "Paga por lo que funciona",
    "pricing.without": "Sin Bossie",
    "pricing.with": "Con Bossie",
    "pricing.withoutPrice": "$0/mes",
    "pricing.withPrice": "$49/mes",
    "pricing.withoutNotes": ["Horas en papeleo", "Facturas tarde", "Clientes perdidos"],
    "pricing.withNotes": ["Cotizaciones rápidas", "Cobros automáticos", "Respuestas bilingües"],
    "contact.eyebrow": "Empezar",
    "contact.title": "Déjanos tu número — Bossie te escribe en 60 segundos",
    "contact.lede": "Te enviamos un código de 6 dígitos para entrar. Sin app.",
    "contact.phone": "Número celular",
    "contact.cta": "Enviarme el código",
    "contact.placeholder": "(512) 555-1234",
    "footer.tagline": "Paperwork Monster — para los contratistas que prefieren estar en obra.",
    "verify.h1": "Revisa tu celular",
    "verify.lede": "Te enviamos un código de 6 dígitos a",
    "verify.cta": "Verificar",
    "verify.editPhone": "¿Número incorrecto? Editar",
    "verify.resend": "Reenviar código",
    "verify.resendIn": "Reenviar en {n}s",
    "verify.errInvalid": "Ese código no coincide. Intenta de nuevo.",
    "verify.errExpired": "El código expiró. Pide uno nuevo.",
    "verify.errRate": "Demasiados intentos. Espera un minuto.",
    "welcome.back": "Bienvenido de nuevo, {firstName}.",
    "cta.steps.phone": "Teléfono",
    "cta.steps.code": "Código",
    "cta.steps.in": "Listo",
  },
};

export type StringKey = keyof Strings;

export function pickLangFromAcceptLanguage(header: string | null): Lang {
  if (!header) return "en";
  return /\bes\b|^es-/i.test(header) ? "es" : "en";
}
