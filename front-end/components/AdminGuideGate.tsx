import { asset, Head } from "fresh/runtime";
import DocTitle from "./DocTitle.tsx";
import { tFor } from "../lib/i18n.ts";
import type { AdminGate } from "../lib/admin-gate.ts";
import { returnAskText } from "../../shared/demo-mode/restart.ts";
import { stageHref } from "../../shared/demo-mode/ended.ts";
import { langToggleHref } from "../../shared/quote-flow/public-lang.ts";
import AdminGateReturn from "../islands/AdminGateReturn.tsx";
import PublicLangToggle from "../islands/PublicLangToggle.tsx";

/**
 * REQ-376 (demo-loop cycle 2, m20 + nc-second-demo) — what /admin shows while this browser guides
 * a customer (routes/admin/_middleware.ts), instead of a bare redirect to the customer's dashboard:
 * whom the browser acts as, why the console is not here, how to start another demo, and the two
 * ways out — Back to the demo (the stage, when a demo is being presented) and Return to your
 * account. In the presenter's language.
 *
 * REQ-855 (demo-loop cycle dm3, m5 + rc-17) — and where the presenter changes THEIR language while
 * guiding: an EN | ES switch to this same page with ?lang= (`url`: the request's address), which
 * the gate's language ranks first (REQ-829) and Back to the demo / Return carry on. Demo 3 found no
 * such control here and fell back to a hand-set cookie, which ranks last by design.
 */
export default function AdminGuideGate(
  { gate, url }: { gate: AdminGate; url: string },
) {
  const { lang, customer, demoId } = gate;
  const ask = demoId ? returnAskText(gate.presenters, customer) : null;
  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) => `Admin · ${tFor(l, "brand.name")}`}
        />
        <meta name="robots" content="noindex" />
        {/* REQ-858 — each keyed: Fresh's <Head> keeps one unkeyed stylesheet link */}
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link
          key="css-public-lang"
          rel="stylesheet"
          href={asset("/public-lang.css")}
        />
      </Head>
      <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box">
        <section
          data-cy="admin-gate"
          role="alert"
          style="max-width:520px;width:100%;background:#fff;border:1px solid #e3e8e1;border-radius:16px;padding:28px;box-shadow:0 6px 24px rgba(0,0,0,.08);font:inherit"
        >
          <PublicLangToggle
            lang={lang}
            hrefs={{
              en: langToggleHref(url, "en"),
              es: langToggleHref(url, "es"),
            }}
          />
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">
            {tFor(lang, "adminGate.title", { name: customer })}
          </h1>
          <p style="margin:0 0 10px;line-height:1.5">
            {tFor(lang, "adminGate.body")}
          </p>
          <p style="margin:0 0 10px;line-height:1.5">
            {tFor(lang, "adminGate.secondDemo")}
          </p>
          {ask
            ? (
              <p
                data-cy="admin-gate-ask"
                style="margin:0 0 10px;line-height:1.5;color:#5b6358"
              >
                {tFor(lang, ask.key, ask.vars)}
              </p>
            )
            : null}
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">
            {demoId
              ? (
                <a
                  href={stageHref(lang)}
                  data-cy="admin-gate-back"
                  style="padding:10px 18px;border-radius:10px;background:#2f6d29;color:#fff;text-decoration:none;font-weight:700"
                >
                  {tFor(lang, "demoMode.rejoin")}
                </a>
              )
              : null}
            <AdminGateReturn lang={lang} demoId={demoId} primary={!demoId} />
          </div>
        </section>
      </main>
    </>
  );
}
