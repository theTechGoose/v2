import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { type Lang, tFor } from "../../lib/i18n.ts";
import { presenterLangForRequest } from "../../lib/presenter-lang.ts";
import DemoStage from "../../islands/DemoStage.tsx";

/** REQ-187 — the staff's demo page: a dark stage with the customer's screen in a frame. */
export default define.page(async function DemoStageRoute(ctx) {
  // REQ-341: ctx.state.user is the impersonated CUSTOMER here — the stage speaks the PRESENTER's
  // language (whoami's impersonator), so the customer picking ES never flips the staff's controls
  const lang: Lang = await presenterLangForRequest(ctx.req, ctx.state.user);
  return (
    <>
      <Head>
        <title>
          {tFor(lang, "demoMode.title")} · {tFor(lang, "brand.name")}
        </title>
        <meta name="robots" content="noindex" />
        {/* REQ-270: the pill and banner use font:inherit — give the page a font */}
        <link
          key="css-demo-stage"
          rel="stylesheet"
          href={asset("/demo-stage.css")}
        />
      </Head>
      {/* REQ-270/341: the presenter's own language, not the replica frame's nor the customer's profile */}
      <DemoStage initialLang={lang} />
    </>
  );
});
