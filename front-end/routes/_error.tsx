import { HttpError } from "fresh";
import { define } from "../utils.ts";
import { tFor } from "../lib/i18n.ts";
import { resolvePublicLang } from "../../shared/quote-flow/public-lang.ts";

/**
 * Unified error page (Fresh 2 replaces _404.tsx + _500.tsx). A mistyped ad URL
 * — the P-56 defect — used to dump a paid visitor on the framework's bare
 * "Not Found" plaintext. This renders a branded page with the logo, the app
 * name, and a way back home, at the correct HTTP status (404 for a missing
 * route, 500 otherwise). It renders inside routes/_app.tsx, so it inherits the
 * shared <head> (theme-color + manifest, P-57).
 */
export default define.page((ctx) => {
  const status = ctx.error instanceof HttpError ? ctx.error.status : 500;
  const isNotFound = status === 404;
  // A mistyped ad URL is PUBLIC traffic — an English-speaking visitor used to
  // land on a Spanish 404 because this hardcoded "es" with no Accept-Language
  // fallback. Same ONE helper the public documents use: the visitor's own
  // pm_lang choice first, then the browser's language, then English.
  const lang = resolvePublicLang({
    cookie: ctx.req?.headers?.get("cookie"),
    header: ctx.req?.headers?.get("accept-language"),
  });
  const brand = tFor(lang, "brand.name");
  const heading = isNotFound
    ? tFor(lang, "errorPage.notFound.heading")
    : tFor(lang, "errorPage.server.heading");
  const body = isNotFound
    ? tFor(lang, "errorPage.notFound.body")
    : tFor(lang, "errorPage.server.body");
  const homeCta = tFor(lang, "errorPage.home");

  return (
    <div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30;padding:32px 16px">
      <div style="max-width:440px;width:100%;text-align:center">
        <a
          href="/"
          style="display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:#144852;font-weight:800;font-size:18px;letter-spacing:-0.01em"
        >
          <img
            src="/logo-monster.png"
            alt={brand}
            style="height:40px;width:auto;display:block"
          />
          <span>
            Paperwork <em style="font-style:normal;color:#519843">Monster</em>
          </span>
        </a>
        <div style="margin:28px auto 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:64px;letter-spacing:-0.04em;color:#519843;line-height:1">
          {status}
        </div>
        <h1 style="margin:10px 0 0;font-size:22px;font-weight:900;letter-spacing:-0.02em;color:#144852">
          {heading}
        </h1>
        <p style="margin:10px 0 0;color:#6b7a7e;font-size:15px;line-height:1.55">
          {body}
        </p>
        <a
          href="/"
          style="display:inline-block;margin-top:24px;background:#519843;color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:14px 26px;border-radius:12px;box-shadow:0 10px 22px -8px rgba(81,152,67,0.55)"
        >
          {homeCta}
        </a>
      </div>
    </div>
  );
});
