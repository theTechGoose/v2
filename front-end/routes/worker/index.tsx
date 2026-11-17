/**
 * REQ-143 — /worker: the worker's own screen. PUBLIC route (no owner session):
 * the WorkerScreen island logs the worker in by cell + PIN against
 * /api/field/worker/login, which sets its own pm_worker cookie. Phone-first,
 * no dashboard chrome.
 * REQ-282 — an owner who opens it from the office sidebar is still signed in:
 * the route reads that session (no cookie → no backend call) and the island
 * shows a "Back to office" link. A worker's phone never sees it.
 * REQ-417 (demo m44) — that link goes back to the office page the owner came
 * from: `?from=` or a same-origin Referer, allow-listed (workerOfficeHref);
 * /field/tasks when neither says.
 * REQ-494 (demo M43) — an EN/ES pick made on the switch is remembered in its
 * own pm_worker_lang cookie; re-opening /worker without ?lang= keeps it.
 * REQ-714 (demo cycle 5, m58) — a signed-in worker (pm_worker cookie) is read
 * on the server (GET /field/worker/me, as the island does) and the page
 * renders in the worker's language unless ?lang= or the pick chose one, so it
 * no longer paints English and flips to Spanish. `pageLang` (the browser's
 * own) is what Salir returns to (REQ-416).
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import { tFor } from "../../lib/i18n.ts";
import { langFromCookie } from "../../lib/lang.ts";
import { loadUser } from "../../lib/auth.ts";
import {
  fieldTodayIso,
  workerLangPickFromCookie,
  workerOfficeHref,
  workerRouteLang,
} from "../../lib/field.ts";
import { loadWorkerLang } from "../../lib/worker-ssr.ts";
import WorkerScreen, { type WorkerSsr } from "../../islands/WorkerScreen.tsx";
import { workerClient } from "../../clients/field.ts";

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
  const cookies = ctx.req.headers.get("cookie");
  const workerLang = await loadWorkerLang(ctx.req);
  const { lang, pageLang, chosen, picked } = workerRouteLang({
    query: url.searchParams.get("lang"),
    picked: workerLangPickFromCookie(cookies),
    stored: langFromCookie(cookies),
    worker: workerLang,
  });
  ctx.state.lang = lang;
  const date = url.searchParams.get("date") ?? undefined;
  const office = !!(await loadUser(ctx.req));
  const officeHref = office
    ? workerOfficeHref(
      url.searchParams.get("from"),
      ctx.req.headers.get("referer"),
      url.origin,
    )
    : undefined;
  const ssr = await loadSsr(ctx.req.headers.get("cookie"), date);
  return (
    <>
      <Head>
        <DocTitle lang={lang} title={(l) => tFor(l, "worker.docTitle")} />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link key="css-field" rel="stylesheet" href={asset("/field.css")} />
      </Head>
      <WorkerScreen
        initialLang={lang}
        pageLang={pageLang}
        langChosen={chosen}
        langPicked={picked}
        initialDate={date}
        office={office}
        officeHref={officeHref}
        ssr={ssr}
      />
    </>
  );
});
