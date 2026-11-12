import { Head } from "fresh/runtime";
import { personLanguage } from "../../../shared/person-name/mod.ts"; // REQ-631
import { define } from "../../utils.ts";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DemoStage from "../../islands/DemoStage.tsx";

/** REQ-187 — the staff's demo page: a dark stage with the customer's screen in a frame. */
export default define.page(function DemoStageRoute(ctx) {
  const lang: Lang = personLanguage(ctx.state.user) === "es" ? "es" : "en";
  return (
    <>
      <Head>
        <title>
          {tFor(lang, "demoMode.title")} · {tFor(lang, "brand.name")}
        </title>
        <meta name="robots" content="noindex" />
      </Head>
      <DemoStage />
    </>
  );
});
