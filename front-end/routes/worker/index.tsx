/**
 * REQ-143 — /worker: the worker's own screen. PUBLIC route (no owner session):
 * the WorkerScreen island logs the worker in by cell + PIN against
 * /api/field/worker/login, which sets its own pm_worker cookie. Phone-first,
 * no dashboard chrome.
 */
import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { type Lang, tFor } from "../../lib/i18n.ts";
import { langFromCookie } from "../../lib/lang.ts";
import WorkerScreen from "../../islands/WorkerScreen.tsx";

export default define.page(function WorkerRoute(ctx) {
  const url = new URL(ctx.req.url);
  const qLang = url.searchParams.get("lang");
  const lang: Lang = qLang === "en" || qLang === "es"
    ? qLang
    : langFromCookie(ctx.req.headers.get("cookie")) ?? "es";
  ctx.state.lang = lang;
  const date = url.searchParams.get("date") ?? undefined;
  return (
    <>
      <Head>
        <title>{tFor(lang, "worker.docTitle")}</title>
        <link key="css-dashboard" rel="stylesheet" href="/dashboard.css" />
        <link key="css-field" rel="stylesheet" href="/field.css" />
      </Head>
      <WorkerScreen initialLang={lang} initialDate={date} />
    </>
  );
});
