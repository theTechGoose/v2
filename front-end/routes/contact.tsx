import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import {
  type Lang,
  langFromCookie,
  pickLangFromAcceptLanguage,
} from "../lib/lang.ts";
import { tFor } from "../lib/i18n.ts";
import ContactForm from "../islands/ContactForm.tsx";

// Toll-free support line (TWILIO_SUPPORT_NUMBER) — the same public number the
// dashboard's "Call support" CTA dials. Safe to ship.
const SUPPORT_PHONE = "+18667678399";
const SUPPORT_PHONE_DISPLAY = "(866) 767-8399";

/**
 * /contact — public inquiry page. Renders a name/email/subject/message form
 * that posts to the backend ContactPublicController (POST /contact). Reachable
 * from the landing footer's "Contact" link. Language is resolved server-side
 * (cookie → Accept-Language), mirroring the /login pattern.
 */
export default define.page(function Contact(ctx) {
  const lang: Lang = langFromCookie(ctx.req.headers.get("cookie")) ??
    pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language"));

  const labels = {
    name: tFor(lang, "contactPage.name"),
    namePh: tFor(lang, "contactPage.namePh"),
    email: tFor(lang, "contactPage.email"),
    emailPh: tFor(lang, "contactPage.emailPh"),
    subject: tFor(lang, "contactPage.subject"),
    subjectPh: tFor(lang, "contactPage.subjectPh"),
    message: tFor(lang, "contactPage.message"),
    messagePh: tFor(lang, "contactPage.messagePh"),
    submit: tFor(lang, "contactPage.submit"),
    sending: tFor(lang, "contactPage.sending"),
    success: tFor(lang, "contactPage.success"),
    errorRate: tFor(lang, "contactPage.errorRate"),
    errorGeneric: tFor(lang, "contactPage.errorGeneric"),
  };

  return (
    <>
      <Head>
        <title>
          {tFor(lang, "contactPage.title")} · {tFor(lang, "brand.name")}
        </title>
        <link rel="stylesheet" href="/verify.css" />
      </Head>
      <div class="verify-shell">
        <div class="verify-card" style="max-width:480px;text-align:left">
          <a
            href="/"
            class="brand"
            style="margin:0 auto 4px;justify-content:center"
          >
            <img
              src="/logo-monster.png"
              alt={tFor(lang, "brand.name")}
              style="width:38px;height:38px;flex-shrink:0"
            />
            <span>{tFor(lang, "brand.namePrefix")}</span>
            <em style="font-style:normal;color:var(--brand-green)">
              {tFor(lang, "brand.nameSuffix")}
            </em>
          </a>
          <h1 style="font-size:30px;margin:6px 0 0;text-align:center">
            {tFor(lang, "contactPage.heading")}
          </h1>
          <p
            style="color:var(--fg-muted);font-size:16px;margin:0 0 6px;text-align:center"
          >
            {tFor(lang, "contactPage.subtitle")}
          </p>

          <ContactForm labels={labels} />

          <p
            style="color:var(--fg-muted);font-size:14px;margin:2px 0 0;text-align:center"
          >
            {tFor(lang, "contactPage.callPrefix")}{" "}
            <a
              href={`tel:${SUPPORT_PHONE}`}
              style="color:var(--brand-green);font-weight:800;text-decoration:none"
            >
              {SUPPORT_PHONE_DISPLAY}
            </a>
          </p>
          <a
            href="/"
            style="color:var(--fg-muted);font-size:14px;text-align:center;text-decoration:none"
          >
            {tFor(lang, "contactPage.back")}
          </a>
        </div>
      </div>
    </>
  );
});
