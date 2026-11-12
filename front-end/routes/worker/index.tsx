/**
 * REQ-143 — /worker: the worker's own screen. PUBLIC route (no owner session):
 * the WorkerScreen island logs the worker in by cell + PIN against
 * /api/field/worker/login, which sets its own pm_worker cookie. Phone-first,
 * no dashboard chrome.
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { type Lang, tFor } from "../../lib/i18n.ts";
import { langFromCookie } from "../../lib/lang.ts";
import WorkerScreen, { type WorkerSsr } from "../../islands/WorkerScreen.tsx";
import { workerClient } from "../../clients/field.ts";
import { fieldTodayIso } from "../../lib/field.ts";

/** REQ-197 — the first paint is the final screen: with a pm_worker cookie the server asks the
 *  backend who the worker is and loads the day; without one it renders the login form. A backend
 *  failure hands back `undefined` and the island loads on its own as before. */
async function loadSsr(
  cookie: string | null,
  date: string | undefined,
): Promise<WorkerSsr | undefined> {
  const day = date ?? fieldTodayIso();
  const none: WorkerSsr = { me: null, tasks: [], types: [], date: day };
  if (!cookie || !/(?:^|[;,]\s*)pm_worker=/.test(cookie)) return none;
  try {
    const raw = await workerClient.me({ cookie });
    const me = raw && typeof raw === "object" ? raw : null;
    if (!me) return none;
    const [tasks, types] = await Promise.all([
      workerClient.tasks(day, me.role === "foreman", { cookie }),
      workerClient.taskTypes({ cookie }),
    ]);
    return { me, tasks, types, date: day };
  } catch {
    return undefined;
  }
}

export default define.page(async function WorkerRoute(ctx) {
  const url = new URL(ctx.req.url);
  const qLang = url.searchParams.get("lang");
  const lang: Lang = qLang === "en" || qLang === "es"
    ? qLang
    : langFromCookie(ctx.req.headers.get("cookie")) ?? "es";
  ctx.state.lang = lang;
  const date = url.searchParams.get("date") ?? undefined;
  const ssr = await loadSsr(ctx.req.headers.get("cookie"), date);
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
      <WorkerScreen initialLang={lang} initialDate={date} ssr={ssr} />
    </>
  );
});
