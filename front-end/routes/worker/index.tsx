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
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import { tFor } from "../../lib/i18n.ts";
import { langFromCookie } from "../../lib/lang.ts";
import { loadUser } from "../../lib/auth.ts";
import {
  workerLangPickFromCookie,
  workerOfficeHref,
  workerRouteLang,
} from "../../lib/field.ts";
import WorkerScreen from "../../islands/WorkerScreen.tsx";

export default define.page(async function WorkerRoute(ctx) {
  const url = new URL(ctx.req.url);
  const cookies = ctx.req.headers.get("cookie");
  const { lang, chosen, picked } = workerRouteLang({
    query: url.searchParams.get("lang"),
    picked: workerLangPickFromCookie(cookies),
    stored: langFromCookie(cookies),
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
        langChosen={chosen}
        langPicked={picked}
        initialDate={date}
        office={office}
        officeHref={officeHref}
      />
    </>
  );
});
