import { page } from "fresh";
import { define } from "../utils.ts";
import { resolvePageLang } from "./page-lang.ts";

/**
 * REQ-066/122 — the one GET handler the public pages share: the four legal
 * pages (/terms, /refund-policy, /privacy, /sms-terms) and /contact.
 *
 * The language is resolvePageLang's: an explicit ?lang= wins and is persisted
 * to pm_lang like every other language pick in the app, then the visitor's
 * saved choice, then the same Spanish-first default the other public pages
 * use (REQ-043 amendment). It is recorded on ctx.state.lang so the app shell
 * labels <html> with the language the page actually paints (REQ-122), and
 * handed to the page as { lang }.
 */
export const publicPageHandler = define.handlers({
  GET(ctx) {
    const { lang, picked } = resolvePageLang(ctx.req);
    ctx.state.lang = lang;
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
