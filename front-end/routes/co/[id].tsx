import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import { ssrBackendGet } from "../../lib/backend-fetch.ts";
import PublicChangeOrderActions from "../../islands/PublicChangeOrderActions.tsx";

interface ChangeOrderPublic {
  id: string;
  description: string;
  deltaAmountCents: number;
  status: "pending" | "approved" | "declined";
  currentAmount?: number;
  newAmount?: number;
  businessName?: string;
  decidedAt?: string;
}

const TEAL = "#144852";
const GREEN = "#519843";
const INK = "#1c2c30";
const MUTED = "#6b7a7e";
const LINE = "#e3e8e6";
const CREAM = "#fffdf7";
const BG = "#f7f6f1";
const PINK = "#FF6B6B";
const PINK_DARK = "#d94e4e";

function money(cents: number): string {
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

export default define.page(async function PublicChangeOrder(ctx) {
  const id = ctx.params.id;
  const r = await ssrBackendGet<ChangeOrderPublic>(
    `/change-orders/${id}/public`,
  );
  const co = r.ok ? r.data : undefined;

  return (
    <>
      <Head>
        <title>Change order · Paperwork Monster</title>
        <link rel="stylesheet" href="/landing.css" />
      </Head>
      <div
        style={`min-height:100vh;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};padding:32px 16px 64px`}
      >
        <div style="max-width:560px;margin:0 auto">
          {!co
            ? (
              <div style="background:#fff;border-radius:18px;padding:32px;box-shadow:0 8px 32px rgba(20,72,82,0.08);text-align:center">
                <div style={`font-weight:800;color:${TEAL};font-size:18px`}>
                  Hmm, can't open this
                </div>
                <p style={`margin:8px 0 0;color:${MUTED};font-size:14px`}>
                  This change-order link expired or was revoked.
                </p>
              </div>
            )
            : (
              <article
                style={`background:${CREAM};border-radius:24px;box-shadow:0 14px 50px rgba(20,72,82,0.10);overflow:hidden;border:1px solid rgba(255,107,107,0.10)`}
              >
                <div
                  style={`height:8px;background:linear-gradient(90deg,${PINK} 0%,${PINK_DARK} 100%)`}
                />
                <div style="padding:32px 32px 36px">
                  <div
                    style={`font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:${PINK_DARK}`}
                  >
                    {co.businessName ?? "Your contractor"}
                  </div>
                  <h1
                    style={`margin:12px 0 0;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:${TEAL};line-height:1.1`}
                  >
                    Change order
                  </h1>
                  <p style={`margin:10px 0 0;color:${MUTED};font-size:14px`}>
                    Your contractor proposed an adjustment to your invoice.
                    Review it below and approve to update your total.
                  </p>

                  <section
                    style={`margin-top:22px;background:#fff;border:1px solid ${LINE};border-radius:14px;padding:18px 20px`}
                  >
                    <div
                      style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
                    >
                      What's changing
                    </div>
                    <p
                      style={`margin:8px 0 0;color:${INK};font-size:15px;line-height:1.55`}
                    >
                      {co.description}
                    </p>
                    <div
                      style={`margin-top:16px;padding-top:14px;border-top:1px solid ${LINE};display:flex;flex-direction:column;gap:6px;font-size:14px`}
                    >
                      {co.currentAmount != null
                        ? (
                          <div style="display:flex;justify-content:space-between">
                            <span style={`color:${MUTED}`}>Current total</span>
                            <span>{money(co.currentAmount)}</span>
                          </div>
                        )
                        : null}
                      <div style="display:flex;justify-content:space-between">
                        <span style={`color:${MUTED}`}>
                          {co.deltaAmountCents >= 0 ? "Added" : "Credit"}
                        </span>
                        <span
                          style={`color:${
                            co.deltaAmountCents >= 0 ? INK : GREEN
                          }`}
                        >
                          {co.deltaAmountCents >= 0 ? "+" : "−"}
                          {money(Math.abs(co.deltaAmountCents))}
                        </span>
                      </div>
                      {co.newAmount != null
                        ? (
                          <div style="display:flex;justify-content:space-between;font-weight:800;color:#1c2c30;font-size:16px;margin-top:4px">
                            <span>New total</span>
                            <span style={`color:${GREEN}`}>
                              {money(co.newAmount)}
                            </span>
                          </div>
                        )
                        : null}
                    </div>
                  </section>

                  <PublicChangeOrderActions
                    changeOrderId={co.id}
                    initialStatus={co.status}
                  />
                </div>
              </article>
            )}
        </div>
      </div>
    </>
  );
});
