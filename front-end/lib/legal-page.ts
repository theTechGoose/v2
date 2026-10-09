import { page } from "fresh";
import { define } from "../utils.ts";
import type { Lang } from "./i18n.ts";
import { langFromCookie, pickLangFromAcceptLanguage } from "./lang.ts";

/**
 * REQ-066 — the one GET handler the four legal pages share (/terms,
 * /refund-policy, /privacy, /sms-terms). Language: an explicit ?lang= wins
 * and is persisted to pm_lang like every other language pick in the app,
 * then the visitor's saved choice, then the same Spanish-first default the
 * other public pages use (REQ-043 amendment).
 */
export const legalHandler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const q = url.searchParams.get("lang");
    const picked: Lang | null = q === "en" || q === "es" ? q : null;
    const lang: Lang = picked ??
      langFromCookie(ctx.req.headers.get("cookie")) ??
      pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language"));
    return page({ lang }, {
      headers: picked
        ? {
          "set-cookie":
            `pm_lang=${picked};path=/;max-age=31536000;samesite=lax`,
        }
        : {},
    });
  },
});
