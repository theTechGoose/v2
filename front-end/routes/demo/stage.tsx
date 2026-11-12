import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DemoStage from "../../islands/DemoStage.tsx";

/** REQ-187 — the staff's demo page: a dark stage with the customer's screen in a frame. */
export default define.page(function DemoStageRoute(ctx) {
  const lang: Lang = ctx.state.user?.language === "es" ? "es" : "en";
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
      {/* REQ-270: the staff's own language, not whatever the replica frame last stored */}
      <DemoStage initialLang={lang} />
    </>
  );
});
