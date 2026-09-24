import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import { langFromCookie, pickLangFromAcceptLanguage } from "../lib/lang.ts";
import SiteFooter from "../components/SiteFooter.tsx";
import { LEGAL_DOCS, type LegalBlock } from "../../shared/legal/terms.ts";

/**
 * /terms — the Terms of Service, Refund & Cancellation Policy and Privacy
 * Policy (REQ-043), rendered verbatim from shared/legal/terms.ts. Every
 * page's footer links here. The documents are the client's English legal
 * text and are not machine-translated; only the chrome (page title, footer
 * label) follows the visitor's language.
 */
export default define.page(function Terms(ctx) {
  const lang: Lang = langFromCookie(ctx.req.headers.get("cookie")) ??
    pickLangFromAcceptLanguage(ctx.req.headers.get("accept-language"));
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
            <nav class="legal__nav" aria-label="Legal documents">
              {LEGAL_DOCS.map((d) => (
                <a key={d.id} href={`#${d.id}`}>{d.title}</a>
              ))}
            </nav>
          </header>

          {LEGAL_DOCS.map((doc) => (
            <article key={doc.id} id={doc.id} class="legal__doc">
              <h1>{doc.title}</h1>
              <p class="legal__effective">
                {`Effective Date: ${doc.effectiveDate}`}
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
