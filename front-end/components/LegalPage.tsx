import { asset, Head } from "fresh/runtime";
import { type Lang, tFor } from "../lib/i18n.ts";
import { LANDING_DICT } from "../lib/landing-dict.ts";
import SiteFooter from "./SiteFooter.tsx";
import DocTitle from "./DocTitle.tsx";
import {
  type LegalBlock,
  legalDocFor,
  type LegalDocId,
  legalPathFor,
} from "../../shared/legal/terms.ts";
import { absoluteUrl } from "../../shared/quote-flow/site-meta.ts";

/**
 * REQ-066 — one legal document on its own page, under the SAME header the
 * website ("/", routes/index.tsx) has: the brand, the Yo hablo Español /
 * I speak English toggle, the What We Do / How It Works / Pricing links and
 * the Log in button, in the website's stylesheet (landing.css). Hans:
 * "Make the page that houses this information make the header look the
 * same as the rest of the website please." Then the document itself —
 * nothing between the header and the title: no tabs, no row of the other
 * documents (REQ-076, Raphael, 2026-10-15, on RingCentral's reviewer not
 * seeing "an actual privacy policy": "cant have it tabbed") — REQ-065's
 * October 6, 2026 text in the visitor's language, and the site footer with
 * the four policy links (REQ-067), which is how the pages link each other.
 *
 * The toggle here is two links (?lang=) — the website's is scripted
 * (landing-scripts.js) because that page swaps copy in place; this page is
 * rendered whole, so a request with the language is the whole toggle.
 */
export default function LegalPage(
  { id, lang, signedIn = false }: {
    id: LegalDocId;
    lang: Lang;
    /** REQ-510: a signed-in visitor gets "Back to app" → /dashboard, not Log in */
    signedIn?: boolean;
  },
) {
  const doc = legalDocFor(lang, id);
  const site = LANDING_DICT[lang];
  const path = legalPathFor(id);
  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) =>
            `${legalDocFor(l, id).title} · ${tFor(l, "brand.name")}`}
        />
        {
          /* REQ-218: the document answers at three URLs (bare, ?lang=en,
            ?lang=es); this names the one that is the page, so a crawler does
            not have to pick among duplicates. */
        }
        <link rel="canonical" href={absoluteUrl(path)} />
        <link rel="stylesheet" href={asset("/landing.css")} key="css-landing" />
        <link rel="stylesheet" href={asset("/legal.css")} key="css-legal" />
      </Head>

      {/* the website's header, as on "/" */}
      <div class="nav-wrap">
        <div class="container nav">
          <a href="/" class="brand">
            <img src="/logo-monster.png" alt="DocuMonster" />
            <span>
              {site.brand1}
              <em style="font-style:normal;color:var(--brand-green)">
                {site.brand2}
              </em>
            </span>
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
          {signedIn
            ? (
              <a href="/dashboard" class="btn btn-outline">
                {site["nav.backToApp"]}
              </a>
            )
            : <a href="/login" class="btn btn-outline">{site["nav.login"]}</a>}
        </div>
      </div>

      <div class="legal">
        <div class="legal__wrap">
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
        </div>
      </div>
      <SiteFooter lang={lang} />
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
