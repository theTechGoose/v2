/**
 * REQ-885 / REQ-883c — /sign/:token: the hire's phone page. PUBLIC (no owner session, no
 * dashboard chrome): the token is the hire's identity; the HrSignPacket island opens the packet
 * at /api/hr/sign/:token. The language is the pm_lang cookie's, else ?lang=, else Spanish
 * (the app's default) — the page's EN/ES switch persists it.
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import { langFromCookie } from "../../lib/lang.ts";
import HrSignPacket from "../../islands/HrSignPacket.tsx";

export default define.page(function SignRoute(ctx) {
  const url = new URL(ctx.req.url);
  const q = url.searchParams.get("lang");
  const lang: Lang = q === "en" || q === "es"
    ? q
    : langFromCookie(ctx.req.headers.get("cookie")) ?? "es";
  ctx.state.lang = lang;
  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "hr.sign.docTitle")} />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
        <link key="css-hr" rel="stylesheet" href={asset("/hr.css")} />
      </Head>
      <HrSignPacket token={ctx.params.token} initialLang={lang} />
    </>
  );
});
