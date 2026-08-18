import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import PublicContractView from "../../islands/PublicContractView.tsx";
import { BG, INK } from "../../components/contract-doc.tsx";
import { langFromCookie } from "../../lib/lang.ts";

/**
 * Public agreement page. The contract is fetched client-side by the
 * PublicContractView island (which paints a skeleton first) rather than in
 * an SSR `await` — that previously blocked the first byte and showed a blank
 * white screen on slow networks (problems.md #25).
 */
export default define.page(function PublicContract(ctx) {
  const id = ctx.params.id;
  // The customer's own language choice (pm_lang cookie) wins; when absent the
  // document falls back to the contractor's outgoing-comms language.
  const lang = langFromCookie(ctx.req.headers.get("cookie")) ?? undefined;

  return (
    <>
      <Head>
        <title>Quote + Agreement · Paperwork Monster</title>
        <link rel="stylesheet" href="/landing.css" />
        {/* P-62: the phone-layout + @media print rules live in a LINKED
            stylesheet, not an inline <style> — Fresh emits a Head <style>
            inside the island's SSR boundary and Preact deletes it on
            hydration, so print styles silently never applied in a real
            browser (see front-end/static/public-contract.css). */}
        <link rel="stylesheet" href="/public-contract.css" />
      </Head>
      <div
        style={`min-height:100dvh;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};padding:32px 16px calc(64px + var(--kb-inset, 0px));scroll-padding-bottom:var(--kb-inset, 0px)`}
      >
        <div style="max-width:760px;margin:0 auto">
          <PublicContractView id={id} lang={lang} />
        </div>
      </div>
    </>
  );
});
