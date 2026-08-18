import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import PublicContractView from "../../islands/PublicContractView.tsx";
import { BG, INK, LINE } from "../../components/contract-doc.tsx";
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
        <title>Quote & Agreement · Paperwork Monster</title>
        <link rel="stylesheet" href="/landing.css" />
        <style>
          {`
          @media (max-width: 720px) {
            .ctr__inner { padding: 28px 22px !important; }
            .ctr__title { font-size: 30px !important; }
            .ctr__total-amt { font-size: 34px !important; }
            .ctr__terms-grid { grid-template-columns: 1fr !important; }
            .ctr__milestones { grid-template-columns: 1fr 1fr !important; }
          }
          @media print {
            body { background: #ffffff !important; }
            .ctr__no-print { display: none !important; }
            .ctr { box-shadow: none !important; border: 1px solid ${LINE}; }
          }
        `}
        </style>
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
