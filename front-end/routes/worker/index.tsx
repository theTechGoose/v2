/**
 * REQ-143 — /worker: the worker's own screen. PUBLIC route (no owner session):
 * the WorkerScreen island logs the worker in by cell + PIN against
 * /api/field/worker/login, which sets its own pm_worker cookie. Phone-first,
 * no dashboard chrome.
 * REQ-282 — an owner who opens it from the office sidebar is still signed in:
 * the route reads that session (no cookie → no backend call) and the island
 * shows a "Back to office" link to /field/tasks. A worker's phone never sees it.
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { type Lang, tFor } from "../../lib/i18n.ts";
import { langFromCookie } from "../../lib/lang.ts";
import { loadUser } from "../../lib/auth.ts";
import WorkerScreen from "../../islands/WorkerScreen.tsx";

export default define.page(async function WorkerRoute(ctx) {
  const url = new URL(ctx.req.url);
  const qLang = url.searchParams.get("lang");
  const lang: Lang = qLang === "en" || qLang === "es"
    ? qLang
    : langFromCookie(ctx.req.headers.get("cookie")) ?? "es";
  ctx.state.lang = lang;
  const date = url.searchParams.get("date") ?? undefined;
  const office = !!(await loadUser(ctx.req));
  return (
    <>
      <Head>
        <title>{tFor(lang, "worker.docTitle")}</title>
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
      </Head>
      <WorkerScreen
        initialLang={lang}
        langChosen={qLang === "en" || qLang === "es"}
        initialDate={date}
        office={office}
      />
    </>
  );
});
