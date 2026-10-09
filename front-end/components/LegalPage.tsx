import { Head } from "fresh/runtime";
import { type Lang, tFor } from "../lib/i18n.ts";
import { LANDING_DICT } from "../lib/landing-dict.ts";
import SiteFooter from "./SiteFooter.tsx";
import {
  LEGAL_LINKS,
  type LegalBlock,
  legalDocFor,
  type LegalDocId,
  legalPathFor,
} from "../../shared/legal/terms.ts";

/**
 * REQ-066 — one legal document on its own page, under the SAME header the
 * website ("/", routes/index.tsx) has: the brand, the Yo hablo Español /
 * I speak English toggle, the What We Do / How It Works / Pricing links and
 * the Log in button, in the website's stylesheet (landing.css). Hans:
 * "Make the page that houses this information make the header look the
 * same as the rest of the website please." Then the four documents as TABS
 * (Raphael: "one link with a page that has multiple tabs" — each tab is a
 * page of its own, so a policy keeps a URL the consent text can link), the
 * document (REQ-065: the October 6, 2026 text, in the visitor's language),
 * and the site footer with its one policies link (REQ-067).
 *
 * The toggle here is two links (?lang=) — the website's is scripted
 * (landing-scripts.js) because that page swaps copy in place; this page is
 * rendered whole, so a request with the language is the whole toggle.
 */
export default function LegalPage(
  { id, lang }: { id: LegalDocId; lang: Lang },
) {
  const doc = legalDocFor(lang, id);
  const site = LANDING_DICT[lang];
  const path = legalPathFor(id);
  return (
    <>
      <Head>
        <title>
          {doc.title} · {tFor(lang, "brand.name")}
        </title>
        <link rel="stylesheet" href="/landing.css" key="css-landing" />
        <link rel="stylesheet" href="/legal.css" key="css-legal" />
      </Head>

      {/* the website's header, as on "/" */}
      <div class="nav-wrap">
        <div class="container nav">
          <a href="/" class="brand">
            <img src="/logo-monster.png" alt="Paperwork Monster" />
            <span>{site.brand1}</span>
            <em style="font-style:normal;color:var(--brand-green)">
              {site.brand2}
            </em>
          </a>
          <div class="lang-toggle" role="group" aria-label="Language">
            <a
              href={`${path}?lang=es`}
              data-legal-lang="es"
              class={lang === "es" ? "on" : ""}
              aria-current={lang === "es" ? "true" : undefined}
              aria-label="Yo hablo Español"
            >
              <span class="lang-toggle__full">Yo hablo Español</span>
              <span class="lang-toggle__abbr" aria-hidden="true">ES</span>
            </a>
            <a
              href={`${path}?lang=en`}
              data-legal-lang="en"
              class={lang === "en" ? "on" : ""}
              aria-current={lang === "en" ? "true" : undefined}
              aria-label="I speak English"
            >
              <span class="lang-toggle__full">I speak English</span>
              <span class="lang-toggle__abbr" aria-hidden="true">EN</span>
            </a>
          </div>
          <nav class="nav-links">
            <a href="/#features">{site["nav.features"]}</a>
            <a href="/#how-it-works">{site["nav.how"]}</a>
            <a href="/#pricing">{site["nav.pricing"]}</a>
          </nav>
          <a href="/login" class="btn btn-outline">{site["nav.login"]}</a>
        </div>
      </div>

      <div class="legal">
        <div class="legal__wrap">
          <nav
            class="legal__tabs"
            data-legal-nav
            aria-label={tFor(lang, "legal.docsAria")}
          >
            {LEGAL_LINKS.map((l) => (
              <a
                key={l.id}
                href={l.path}
                data-legal-link={l.id}
                class={l.id === id ? "on" : ""}
                aria-current={l.id === id ? "page" : undefined}
              >
                {tFor(lang, l.labelKey)}
              </a>
            ))}
          </nav>

          <article
            id={doc.id}
            class="legal__doc"
            lang={lang}
            data-legal-doc={lang}
          >
            <h1>{doc.title}</h1>
            <p class="legal__effective">
              {`${tFor(lang, "legal.lastUpdated")}: ${doc.lastUpdated}`}
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

          <SiteFooter lang={lang} style="margin-top:24px" />
        </div>
      </div>
    </>
  );
}

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
