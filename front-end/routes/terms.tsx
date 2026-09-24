import { Head } from "fresh/runtime";
import { page } from "fresh";
import { define } from "../utils.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import { langFromCookie, pickLangFromAcceptLanguage } from "../lib/lang.ts";
import SiteFooter from "../components/SiteFooter.tsx";
import { type LegalBlock, legalDocsFor } from "../../shared/legal/terms.ts";

/**
 * /terms — the Terms of Service, Refund & Cancellation Policy and Privacy
 * Policy (REQ-043), rendered verbatim from shared/legal/terms.ts (English)
 * or shared/legal/terms.es.ts (Spanish — "it should be both"). Language:
 * an explicit ?lang= wins and is persisted to pm_lang like every other
 * language pick in the app, then the visitor's saved choice, then the same
 * Spanish-first default the other public pages use. An EN/ES toggle sits
 * at the top of the page.
 */
export const handler = define.handlers({
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

export default define.page<typeof handler>(function Terms(ctx) {
  const { lang } = ctx.data;
  const docs = legalDocsFor(lang);
  return (
    <>
      <Head>
        <title>
          {tFor(lang, "siteFooter.terms")} · {tFor(lang, "brand.name")}
        </title>
        <link rel="stylesheet" href="/legal.css" />
      </Head>
      <div class="legal">
        <div class="legal__wrap">
          <header class="legal__top">
            <a
              href="/"
              class="legal__brand"
              aria-label={tFor(lang, "brand.name")}
            >
              <img src="/logo-monster.png" alt="" />
              <span>
                Paperwork <em>Monster</em>
              </span>
            </a>
            <div class="legal__lang" role="group" aria-label="Language">
              <a
                href="/terms?lang=en"
                data-legal-lang="en"
                class={lang === "en" ? "on" : ""}
                aria-current={lang === "en" ? "true" : undefined}
              >
                EN
              </a>
              <a
                href="/terms?lang=es"
                data-legal-lang="es"
                class={lang === "es" ? "on" : ""}
                aria-current={lang === "es" ? "true" : undefined}
              >
                ES
              </a>
            </div>
            <nav class="legal__nav" aria-label={tFor(lang, "legal.navAria")}>
              {docs.map((d) => <a key={d.id} href={`#${d.id}`}>{d.title}</a>)}
            </nav>
          </header>

          {docs.map((doc) => (
            <article
              key={doc.id}
              id={doc.id}
              class="legal__doc"
              lang={lang}
              data-legal-doc={lang}
            >
              <h1>{doc.title}</h1>
              <p class="legal__effective">
                {`${tFor(lang, "legal.effectiveDate")}: ${doc.effectiveDate}`}
              </p>
              {doc.notice ? <p class="legal__notice">{doc.notice}</p> : null}
              {doc.intro.map((text, i) => <p key={i}>{text}</p>)}
              {doc.sections.map((s) => (
                <section key={s.n}>
                  <h2>{`${s.n}. ${s.heading}`}</h2>
                  {s.blocks.map((b, i) => <Block key={i} block={b} />)}
                </section>
              ))}
            </article>
          ))}

          <SiteFooter lang={lang} style="margin-top:24px" />
        </div>
      </div>
    </>
  );
});

function Block({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case "p":
      return <p>{block.text}</p>;
    case "list":
      return (
        <ul>
          {block.items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      );
    case "labeled":
      return (
        <>
          <strong class="legal__label">{block.label}</strong>
          <p>{block.text}</p>
        </>
      );
  }
}
