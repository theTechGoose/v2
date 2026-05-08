import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import PublicSignContract from "../../islands/PublicSignContract.tsx";
import { ssrBackendGet } from "../../lib/backend-fetch.ts";
import { fmtMoneyExact, fmtPhone, telHref } from "../../lib/format.ts";

interface Contractor {
  name?: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  addressLine?: string;
  state?: string;
}

/** Two-letter US state abbreviations → full names. Used to expand the
 *  "Use my business state" / "Yes" wizard answers into customer-readable
 *  sentences on the contract page. */
const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

function expandStateName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const upper = code.trim().toUpperCase();
  return US_STATES[upper] ?? code;
}

interface LineItem {
  description: string;
  price?: number;
  quantity?: number;
  unit?: string;
}

interface Term {
  stepId: string;
  label: string;
  value: string;
}

interface ContractPublic {
  id: string;
  quoteId?: string;
  customerId?: string;
  status?: string;
  totalAmount?: number;
  effectiveDate?: string;
  startDate?: string;
  estimatedCompletionDate?: string;
  signedAt?: string;
  customerSignedName?: string;
  contractor?: Contractor;
  customer?: { name?: string };
  jobDetails?: { summary?: string; lineItems?: LineItem[] };
  terms?: Term[];
  createdAt?: string;
}

const PINK = "#FF6B6B";
const PINK_DARK = "#d94e4e";
const TEAL = "#144852";
const GREEN = "#519843";
const INK = "#1c2c30";
const MUTED = "#6b7a7e";
const LINE = "#e3e8e6";
const CREAM = "#fffdf7";
const BG = "#f7f6f1";

export default define.page(async function PublicContract(ctx) {
  const id = ctx.params.id;
  let contract: ContractPublic | undefined;
  let err: string | undefined;
  const r = await ssrBackendGet<ContractPublic>(`/contracts/${id}/public`);
  if (r.ok) contract = r.data;
  else err = "This contract link expired or was revoked.";

  return (
    <>
      <Head>
        <title>Contract · Paperwork Monsters</title>
        <link rel="stylesheet" href="/landing.css" />
        <style>{`
          @media (max-width: 720px) {
            .ctr__inner { padding: 28px 22px !important; }
            .ctr__title { font-size: 30px !important; }
            .ctr__total-amt { font-size: 34px !important; }
            .ctr__terms-grid { grid-template-columns: 1fr !important; }
            .ctr__milestones { grid-template-columns: 1fr 1fr !important; }
          }
          @media print {
            body { background: #ffffff !important; }
            .ctr__no-print { display: none !important; }
            .ctr { box-shadow: none !important; border: 1px solid ${LINE}; }
          }
        `}</style>
      </Head>
      <div style={`min-height:100vh;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};padding:32px 16px 64px`}>
        <div style="max-width:760px;margin:0 auto">
          {err || !contract
            ? <ErrorCard message={err ?? "Contract not available."} />
            : <ContractDoc contract={contract} />}
        </div>
      </div>
    </>
  );
});

function ErrorCard({ message }: { message: string }) {
  return (
    <>
      <div style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN};text-align:center;margin-bottom:18px`}>Paperwork Monsters</div>
      <div style="background:#fff;border-radius:18px;padding:32px;box-shadow:0 8px 32px rgba(20,72,82,0.08);text-align:center">
        <div style={`font-weight:800;color:${TEAL};font-size:18px`}>Hmm, can't open this</div>
        <p style={`margin:8px 0 0;color:${MUTED};font-size:14px`}>{message}</p>
      </div>
    </>
  );
}

function ContractDoc({ contract }: { contract: ContractPublic }) {
  const signed = contract.status === "signed";
  const declined = contract.status === "declined";
  const total = contract.totalAmount ?? sumLineTotals(contract.jobDetails?.lineItems);
  const customerName = contract.customer?.name?.trim();
  const customerFirst = customerName?.split(/\s+/)[0];
  const contractor = contract.contractor;
  const businessLabel = contractor?.businessName?.trim() || contractor?.name?.trim() || "Paperwork Monsters";
  const contractorName = contractor?.name?.trim();
  const contractorFirst = contractorName?.split(/\s+/)[0];
  const senderInitials = initialsFromName(contractorName ?? businessLabel);

  const items = contract.jobDetails?.lineItems ?? [];
  const showQty = items.some((li) => (li.quantity ?? 1) > 1);
  const summary = (contract.jobDetails?.summary ?? "Service Agreement").replace(/^\s*quote\s*:\s*/i, "").trim();
  const heroTitle = summary.replace(/\b\w/g, (c) => c.toUpperCase());

  const effective = contract.effectiveDate ?? contract.createdAt;
  const milestones = computeMilestones(total, contract.terms);

  return (
    <>
      {/* Sticky brand strip */}
      <div class="ctr__no-print" style={`text-align:center;margin-bottom:18px`}>
        <div style={`font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:${PINK_DARK}`}>{businessLabel}</div>
        {contractor?.addressLine ? <div style={`margin-top:4px;font-size:12px;color:${MUTED}`}>{contractor.addressLine}</div> : null}
      </div>

      <article class="ctr" style={`background:${CREAM};border-radius:24px;box-shadow:0 14px 50px rgba(20,72,82,0.10);overflow:hidden;border:1px solid rgba(255,107,107,0.10)`}>
        {/* Pink ribbon header */}
        <div style={`height:8px;background:linear-gradient(90deg,${PINK} 0%,${PINK_DARK} 100%)`} />

        <div class="ctr__inner" style="padding:36px 44px 40px">
          {/* Top row: doc tag + status pill */}
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
            <div>
              <span style={`display:inline-block;background:rgba(255,107,107,0.10);color:${PINK_DARK};font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;padding:6px 12px;border-radius:999px`}>
                Contract · #{contract.id.slice(0, 8).toUpperCase()}
              </span>
            </div>
            {signed
              ? <Pill bg="rgba(81,152,67,0.15)" color={GREEN} label={`Signed ${contract.signedAt ? fmtDate(contract.signedAt) : ""}`} />
              : declined
              ? <Pill bg="rgba(168,59,59,0.10)" color="#a83b3b" label="Declined" />
              : <Pill bg="rgba(255,107,107,0.10)" color={PINK_DARK} label="Awaiting your signature" />}
          </div>

          {/* Hero title */}
          <h1 class="ctr__title" style={`margin:18px 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:42px;letter-spacing:-0.025em;color:${TEAL};line-height:1.02`}>
            {heroTitle}
          </h1>
          {customerName && (
            <div style={`margin-top:10px;color:${MUTED};font-size:14px`}>
              Between <strong style={`color:${INK}`}>{businessLabel}</strong> ("Contractor") and <strong style={`color:${INK}`}>{customerName}</strong> ("Client")
              {effective ? <> · effective <strong style={`color:${INK}`}>{fmtDate(effective)}</strong></> : null}
            </div>
          )}

          {/* Recital */}
          <section style={`margin-top:22px;padding:18px 22px;background:rgba(255,107,107,0.04);border:1px solid rgba(255,107,107,0.18);border-radius:14px`}>
            <div style={`font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${PINK_DARK};margin-bottom:8px`}>The deal in plain English</div>
            <p style={`margin:0;color:${INK};font-size:15px;line-height:1.55`}>
              {customerFirst ? `Hi ${customerFirst} —` : "Hi there —"} this is the contract for <strong>{summary.toLowerCase()}</strong>. The job details, money, schedule, and the legal-but-honest stuff are below. Read it through, and when it looks right, type your name at the bottom and tap sign. We'll countersign and you'll have a PDF in your inbox.
            </p>
          </section>

          {/* Job details */}
          {items.length > 0 && (
            <section style="margin-top:30px">
              <SectionLabel n="01" title="Job details" hint="What we're actually doing" />
              <table style="width:100%;border-collapse:collapse;margin-top:14px">
                <thead>
                  <tr>
                    <th style={`padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};text-align:left`}>Description</th>
                    {showQty && (
                      <th style={`padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};text-align:right`}>Qty</th>
                    )}
                    <th style={`padding:8px 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};border-bottom:1px solid ${LINE};text-align:right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((li, i) => {
                    const lineTotal = (li.price ?? 0) * (li.quantity ?? 1);
                    return (
                      <tr key={i}>
                        <td style={`padding:14px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:15px;font-weight:600`}>{li.description}</td>
                        {showQty && (
                          <td style={`padding:14px 0;border-bottom:1px solid ${LINE};color:${MUTED};font-size:13px;text-align:right`}>{li.quantity ?? 1} {li.unit ?? "ea"}</td>
                        )}
                        <td style={`padding:14px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:15px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums`}>{fmtMoneyExact(lineTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* Total card */}
              <div style={`margin-top:18px;background:linear-gradient(135deg,#e8f3e2 0%,#dceadb 100%);border:1px solid rgba(81,152,67,0.25);border-radius:18px;padding:22px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px`}>
                <div>
                  <div style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${GREEN}`}>Contract value</div>
                  <div style={`margin-top:4px;color:${MUTED};font-size:12px`}>all in, no surprises</div>
                </div>
                <div class="ctr__total-amt" style={`font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:42px;letter-spacing:-0.03em;color:${TEAL};line-height:1;font-variant-numeric:tabular-nums`}>{fmtMoneyExact(total)}</div>
              </div>
            </section>
          )}

          {/* Payment milestones */}
          {milestones.length > 0 && (
            <section style="margin-top:30px">
              <SectionLabel n="02" title="Payment schedule" hint="When the money moves" />
              <div class="ctr__milestones" style="margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
                {milestones.map((m, i) => (
                  <div key={i} style={`background:#fff;border:1px solid ${LINE};border-radius:14px;padding:14px 16px`}>
                    <div style={`font-size:11px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:${PINK_DARK}`}>{m.label}</div>
                    <div style={`margin-top:6px;color:${TEAL};font-weight:900;font-size:20px;font-variant-numeric:tabular-nums`}>{fmtMoneyExact(m.amount)}</div>
                    <div style={`margin-top:2px;color:${MUTED};font-size:12px`}>{m.when}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Schedule */}
          {(contract.startDate || contract.estimatedCompletionDate) && (
            <section style="margin-top:30px">
              <SectionLabel n="03" title="Schedule" hint="When work happens" />
              <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
                {contract.startDate && (
                  <KV k="Start" v={fmtDate(contract.startDate)} />
                )}
                {contract.estimatedCompletionDate && (
                  <KV k="Estimated completion" v={fmtDate(contract.estimatedCompletionDate)} />
                )}
              </div>
            </section>
          )}

          {/* Wizard-captured terms grid. Some wizard answers are
              shorthand ("Use my business state", "Yes") that don't mean
              anything to the customer — expand them into full sentences
              using the contractor's state. */}
          {contract.terms && contract.terms.length > 0 && (
            <section style="margin-top:30px">
              <SectionLabel n="04" title="Terms" hint="What you agreed to in the chat" />
              <div class="ctr__terms-grid" style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
                {contract.terms.filter((t) => t.stepId !== "customer").map((t) => (
                  <KV key={t.stepId} k={t.label} v={expandTermValue(t, contractor?.state)} />
                ))}
              </div>
            </section>
          )}

          {/* Boilerplate clauses (always present, plain English) */}
          <section style="margin-top:30px">
            <SectionLabel n="05" title="Fine print, in plain English" hint="The legal-but-honest stuff" />
            <ol style={`margin:14px 0 0;padding-left:20px;color:${INK};font-size:14px;line-height:1.65`}>
              <li><strong>Governing Law.</strong> This agreement is governed by the laws of the state where the work is performed.</li>
              <li><strong>Job Details.</strong> Contractor will perform only the work described in this agreement. Any additional work must be approved by both parties and may result in additional charges.</li>
              <li><strong>Payment Terms.</strong> Payment is due as outlined in this agreement. Late payments may be subject to additional fees as allowed by law.</li>
              <li><strong>Change Orders.</strong> Any changes to the work must be agreed to in writing and may affect the total price and project timeline.</li>
              <li><strong>Customer Responsibilities.</strong> Customer agrees to provide access to the job site and ensure the work area is ready for the Contractor to perform the agreed services.</li>
              <li><strong>Delays and Unforeseen Conditions.</strong> Contractor is not responsible for delays caused by weather, material availability, site conditions, or other circumstances outside of their control.</li>
              <li><strong>Warranty.</strong> Contractor warrants their workmanship for the period stated in this agreement. This warranty applies to labor only and does not cover materials, normal wear and tear, misuse, or damage caused by others.</li>
              <li><strong>Limitation of Liability.</strong> Contractor's liability under this agreement is limited to the total amount paid by the Customer for the work performed.</li>
              <li><strong>Right to Stop Work.</strong> Contractor reserves the right to stop work if payments are not made as agreed.</li>
              <li><strong>Termination.</strong> Either party may cancel this agreement by providing 7 days' written notice.</li>
              <li><strong>Dispute Resolution.</strong> The parties agree to attempt to resolve any disputes in good faith. Any legal action will take place in small claims or local court in the state where the work is performed.</li>
              <li><strong>Permits and Compliance.</strong> Contractor is not responsible for obtaining permits unless specifically stated. Customer is responsible for ensuring all necessary approvals are in place unless otherwise agreed.</li>
              <li><strong>Indemnification.</strong> Customer agrees to hold Contractor harmless for damages or issues arising from conditions beyond the Contractor's control.</li>
              <li><strong>Entire Agreement.</strong> This agreement represents the full understanding between both parties and replaces any prior discussions or agreements.</li>
            </ol>
          </section>

          {/* Signature block — both cards render in both states; the
              right card swaps from "type your name below" placeholder to
              the customer's filled cursive name + date after signing. */}
          {!declined && (
            <section style={`margin-top:36px;padding-top:28px;border-top:2px dashed rgba(255,107,107,0.30)`}>
              <SectionLabel n="06" title="Sign here" hint={signed ? "Both signatures captured" : `By signing, ${customerFirst ?? "you"} agree to everything above`} />
              <div style="margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:stretch">
                {/* Contractor card */}
                <div style={`padding:14px 16px;background:#fff;border:1px solid ${LINE};border-radius:12px;min-height:96px;display:flex;flex-direction:column;justify-content:flex-end`}>
                  <div style={`font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}>Contractor signed</div>
                  <div style={`margin-top:6px;font-family:'Snell Roundhand','Brush Script MT',cursive;font-size:26px;color:${TEAL};line-height:1.1`}>{contractorName ?? businessLabel}</div>
                  <div style={`margin-top:4px;font-size:11px;color:${MUTED}`}>{effective ? fmtDate(effective) : "today"}</div>
                </div>
                {/* Customer card — placeholder OR filled */}
                {signed
                  ? (
                    <div style={`padding:14px 16px;background:#fff;border:1px solid ${LINE};border-radius:12px;min-height:96px;display:flex;flex-direction:column;justify-content:flex-end`}>
                      <div style={`font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}>{customerFirst ? `${customerName ?? customerFirst} signed` : "Client signed"}</div>
                      <div style={`margin-top:6px;font-family:'Snell Roundhand','Brush Script MT',cursive;font-size:26px;color:${TEAL};line-height:1.1`}>{contract.customerSignedName ?? customerName ?? "—"}</div>
                      <div style={`margin-top:4px;font-size:11px;color:${MUTED}`}>{contract.signedAt ? fmtDate(contract.signedAt) : "today"}</div>
                    </div>
                  )
                  : (
                    <div style={`padding:14px 16px;background:rgba(255,107,107,0.06);border:1px dashed rgba(255,107,107,0.45);border-radius:12px;min-height:96px;display:flex;flex-direction:column;justify-content:flex-end`}>
                      <div style={`font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${PINK_DARK}`}>Your signature</div>
                      <div style={`margin-top:6px;font-size:13px;color:${MUTED}`}>type your name below ↓</div>
                    </div>
                  )}
              </div>
              {!signed && <PublicSignContract contractId={contract.id} />}
              {signed && (
                <div style={`margin-top:22px;padding:18px 22px;background:linear-gradient(135deg,rgba(81,152,67,0.12) 0%,rgba(81,152,67,0.04) 100%);border:1px solid rgba(72,158,95,0.35);border-radius:16px;display:flex;align-items:center;gap:14px`}>
                  <div style={`width:40px;height:40px;border-radius:50%;background:${GREEN};color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  </div>
                  <div>
                    <div style={`font-weight:800;color:${GREEN};font-size:16px`}>Signed and binding</div>
                    <div style={`margin-top:2px;color:${MUTED};font-size:13px`}>Please allow up to 2 minutes before checking your email inbox. Don't forget to check spam.</div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Contact card */}
          {(contractor?.phoneNumber || contractor?.email) && (
            <footer style={`margin-top:36px;padding-top:22px;border-top:1px solid ${LINE};display:flex;align-items:center;gap:14px;flex-wrap:wrap`}>
              <div style={`width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,${GREEN} 0%,#71a85f 100%);color:#fff;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center;letter-spacing:.04em;flex-shrink:0`}>{senderInitials}</div>
              <div style="min-width:0;flex:1">
                <div style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}>Questions before signing? Reach {contractorFirst ?? "your contractor"}</div>
                <div style={`margin-top:3px;display:flex;gap:14px;flex-wrap:wrap;font-size:13.5px`}>
                  {contractor?.phoneNumber && <a href={telHref(contractor.phoneNumber)} style={`color:${TEAL};text-decoration:none;font-weight:700`}>{fmtPhone(contractor.phoneNumber)}</a>}
                  {contractor?.email && <a href={`mailto:${contractor.email}`} style={`color:${TEAL};text-decoration:none;font-weight:700`}>{contractor.email}</a>}
                </div>
              </div>
            </footer>
          )}
        </div>
      </article>
      <div style={`text-align:center;margin-top:18px;font-size:11px;color:#a8b2b3;letter-spacing:.04em`}>
        Powered by Paperwork Monsters · Contract #{contract.id.slice(0, 8).toUpperCase()}
      </div>
    </>
  );
}

function Pill({ bg, color, label }: { bg: string; color: string; label: string }) {
  return (
    <span style={`background:${bg};color:${color};font-weight:800;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:7px 14px;border-radius:999px;flex-shrink:0`}>{label}</span>
  );
}

function SectionLabel({ n, title, hint }: { n: string; title: string; hint?: string }) {
  return (
    <div style="display:flex;align-items:center;gap:12px">
      <span style={`display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${PINK};color:#fff;font-weight:800;font-size:12px;letter-spacing:.04em;flex-shrink:0`}>{n}</span>
      <div>
        <div style={`font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;color:${TEAL};font-size:18px;line-height:1.1`}>{title}</div>
        {hint && <div style={`font-size:12px;color:${MUTED};margin-top:2px`}>{hint}</div>}
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={`background:#fff;border:1px solid ${LINE};border-radius:12px;padding:12px 14px`}>
      <div style={`font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}>{k}</div>
      <div style={`margin-top:5px;color:${INK};font-weight:700;font-size:14px;line-height:1.35`}>{v}</div>
    </div>
  );
}

function sumLineTotals(items: LineItem[] | undefined): number {
  if (!items) return 0;
  return items.reduce((s, li) => s + (li.price ?? 0) * (li.quantity ?? 1), 0);
}

function initialsFromName(name?: string): string {
  if (!name) return "PM";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] ?? "PM").slice(0, 2).toUpperCase();
}

function fmtDate(iso: string): string {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(isDateOnly ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function termValue(terms: Term[] | undefined, stepId: string): string | undefined {
  return terms?.find((t) => t.stepId === stepId)?.value;
}

/** Expand wizard-shorthand answers into customer-readable sentences.
 *  E.g. "Use my business state" → "California". "Yes" / "No" for state
 *  notices → a sentence the customer can actually act on. */
function expandTermValue(term: Term, contractorState: string | undefined): string {
  const stateName = expandStateName(contractorState);
  if (term.stepId === "governing_state") {
    if (/use my business|business state/i.test(term.value)) {
      return stateName ? `${stateName} law` : term.value;
    }
    if (/job\s*site|use the job/i.test(term.value)) {
      return "Whatever state the work is performed in";
    }
    // User picked a specific state ("Pick a different state — TX")
    return expandStateName(term.value) ?? term.value;
  }
  if (term.stepId === "state_notices") {
    const v = term.value.trim().toLowerCase();
    if (v === "yes") {
      return stateName
        ? `Standard ${stateName} construction-contract notices included`
        : "Standard state construction-contract notices included";
    }
    if (v === "no") return "No state-specific notices included";
    if (v.startsWith("review")) return "Notices to be reviewed before signing";
    return term.value;
  }
  return term.value;
}

function computeMilestones(total: number, terms: Term[] | undefined): { label: string; amount: number; when: string }[] {
  if (!total || total <= 0) return [];
  const v = termValue(terms, "payment_terms")?.toLowerCase() ?? "";
  if (v.includes("50") && v.includes("/")) {
    return [
      { label: "Deposit", amount: Math.round(total / 2), when: "Before work starts" },
      { label: "Balance", amount: total - Math.round(total / 2), when: "On completion" },
    ];
  }
  if (v.includes("30") && v.includes("40")) {
    const a = Math.round(total * 0.30);
    const b = Math.round(total * 0.30);
    return [
      { label: "Deposit", amount: a, when: "Before work starts" },
      { label: "Midpoint", amount: b, when: "At rough-in / midpoint" },
      { label: "Final", amount: total - a - b, when: "On completion" },
    ];
  }
  if (v.includes("completion") || v.includes("net 15")) {
    return [{ label: "Final", amount: total, when: "On completion" }];
  }
  if (v.includes("deposit") && v.includes("balance")) {
    const dep = Math.round(total * 0.20);
    return [
      { label: "Deposit", amount: dep, when: "Before work starts" },
      { label: "Balance", amount: total - dep, when: "On completion" },
    ];
  }
  // Default: deposit/progress/final at 30/30/40
  if (terms && terms.length === 0) return [];
  return [];
}
