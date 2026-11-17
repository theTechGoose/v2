import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DemoStage from "../../islands/DemoStage.tsx";

/** REQ-187 — the staff's demo page: a dark stage with the customer's screen in a frame. */
export default define.page(function DemoStageRoute(ctx) {
  // REQ-341: ctx.state.user is the impersonated CUSTOMER here — the stage speaks the PRESENTER's
  // language (whoami's impersonator), so the customer picking ES never flips the staff's controls.
  // REQ-812: the /demo middleware resolved it onto ctx.state.lang, which the app shell uses too.
  const lang: Lang = ctx.state.lang ?? "en";
  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) =>
            `${tFor(l, "demoMode.title")} · ${tFor(l, "brand.name")}`}
        />
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
