import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import PublicQuoteView from "../../islands/PublicQuoteView.tsx";
import { BG, INK } from "../../components/quote-doc.tsx";
import { resolveContractLang } from "../../../shared/quote-flow/public-lang.ts";
import { tFor } from "../../lib/i18n.ts";

/**
 * Public Quote + Agreement page — the ONE customer-facing document (the
 * quote IS the agreement; accepting it is the signature ceremony). The
 * quote is fetched client-side by the PublicQuoteView island (which paints
 * a skeleton first) rather than in an SSR `await` — that previously blocked
 * the first byte and showed a blank white screen on slow networks
 * (problems.md #25).
 */
export default define.page(function PublicQuote(ctx) {
  const id = ctx.params.id;
  // REQ-048: English first. Only the visitor's own pick — ?lang= on the
  // link, then their pm_lang cookie — opens the contract in Spanish; the
  // island's EN | ES toggle flips it in place from there.
  const lang = resolveContractLang({
    query: new URL(ctx.req.url).searchParams.get("lang"),
    cookie: ctx.req.headers.get("cookie"),
  });

  return (
    <>
      <Head>
        {/* UX-40: localized like /i and /co (tFor docTitle). */}
        <title>{tFor(lang, "quoteDoc.docTitle")}</title>
        <link key="css-landing" rel="stylesheet" href="/landing.css" />
        {
          /* P-62: the phone-layout + @media print rules live in a LINKED
            stylesheet, not an inline <style> — Fresh emits a Head <style>
            inside the island's SSR boundary and Preact deletes it on
            hydration, so print styles silently never applied in a real
            browser (see front-end/static/public-contract.css). */
        }
        <link key="css-public-contract" rel="stylesheet" href="/public-contract.css" />
      </Head>
      <div
        style={`min-height:100dvh;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};display:flex;flex-direction:column;scroll-padding-bottom:var(--kb-inset, 0px)`}
      >
        <div style="flex:1;width:100%;max-width:792px;margin:0 auto;padding:32px 16px calc(64px + var(--kb-inset, 0px))">
          <PublicQuoteView id={id} lang={lang} />
        </div>
        <SiteFooter lang={lang} />
      </div>
    </>
  );
});
