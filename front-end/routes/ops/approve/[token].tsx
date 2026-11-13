import { asset, Head } from "fresh/runtime";
import { define } from "../../../utils.ts";
import { ssrBackendGet, ssrBackendPost } from "../../../lib/backend-fetch.ts";
import { type Lang, langFromCookie } from "../../../lib/lang.ts";
import { tFor } from "../../../lib/i18n.ts";
import DocTitle from "../../../components/DocTitle.tsx";

/**
 * /ops/approve/:token (REQ-806) — the page the super-admin phone's text opens. It shows who
 * Claude asks to view and why; Approve (the one solid button) or Deny post back here. Reading the
 * page changes nothing — a link preview's GET never approves. Unlinked and noindex.
 */
interface Ask {
  account?: string;
  reason?: string;
  status: "pending" | "approved" | "denied" | "expired";
  minutes: number;
}

export const handler = define.handlers({
  async POST(ctx) {
    const token = ctx.params.token;
    const form = await ctx.req.formData();
    const verdict = form.get("verdict") === "approve" ? "approve" : "deny";
    await ssrBackendPost(
      `/ops/approvals/${encodeURIComponent(token)}/${verdict}`,
      {},
    ).catch(() => null);
    return new Response(null, {
      status: 303,
      headers: { Location: `/ops/approve/${token}` },
    });
  },
});

export default define.page(async function OpsApprove(ctx) {
  // the approver's page (the 7133 phone), not a contractor's: English unless a language was picked
  const lang: Lang = langFromCookie(ctx.req.headers.get("cookie")) ?? "en";
  const r = await ssrBackendGet<Ask>(
    `/ops/approvals/${encodeURIComponent(ctx.params.token)}`,
  ).catch(() => null);
  const ask = r?.ok ? r.data : undefined;
  const minutes = String(ask?.minutes ?? 30);
  const note = !ask
    ? tFor(lang, "ops.approve.notFound")
    : ask.status === "approved"
    ? tFor(lang, "ops.approve.approved", { minutes })
    : ask.status === "denied"
    ? tFor(lang, "ops.approve.denied")
    : ask.status === "expired"
    ? tFor(lang, "ops.approve.expired")
    : "";
  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) =>
            `${tFor(l, "ops.approve.title")} · ${tFor(l, "brand.name")}`}
        />
        <meta name="robots" content="noindex" />
        <link key="css-verify" rel="stylesheet" href={asset("/verify.css")} />
      </Head>
      <div class="verify-shell">
        <div class="verify-card" data-cy="ops-approve">
          <h1 style="margin:0 0 10px;font-size:22px">
            {tFor(lang, "ops.approve.title")}
          </h1>
          {ask?.account
            ? (
              <p
                data-cy="ops-approve-account"
                style="margin:0 0 8px;font-size:16px;line-height:1.45"
              >
                {tFor(lang, "ops.approve.ask", { account: ask.account })}
              </p>
            )
            : null}
          {ask
            ? (
              <p style="margin:0 0 8px;color:#5b6b70;font-size:14px">
                {tFor(lang, "ops.approve.readOnly", { minutes })}
              </p>
            )
            : null}
          {ask?.reason
            ? (
              <p
                data-cy="ops-approve-reason"
                style="margin:0 0 16px;font-size:14px"
              >
                {tFor(lang, "ops.approve.reason", { reason: ask.reason })}
              </p>
            )
            : null}
          {note
            ? (
              <p
                data-cy="ops-approve-status"
                role="status"
                style="margin:12px 0 0;font-weight:700;font-size:15px"
              >
                {note}
              </p>
            )
            : (
              <form method="post" style="display:flex;gap:10px;margin-top:8px">
                <button
                  type="submit"
                  name="verdict"
                  value="approve"
                  data-cy="ops-approve-yes"
                  style="flex:1;appearance:none;border:0;border-radius:999px;padding:12px 18px;background:#1f4e57;color:#fff;font-weight:800;font-size:15px;cursor:pointer"
                >
                  {tFor(lang, "ops.approve.approve")}
                </button>
                <button
                  type="submit"
                  name="verdict"
                  value="deny"
                  data-cy="ops-approve-no"
                  style="flex:1;appearance:none;border:1.5px solid #1f4e57;border-radius:999px;padding:12px 18px;background:#fff;color:#1f4e57;font-weight:800;font-size:15px;cursor:pointer"
                >
                  {tFor(lang, "ops.approve.deny")}
                </button>
              </form>
            )}
        </div>
      </div>
    </>
  );
});
