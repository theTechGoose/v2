import { Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import PublicSignContract from "../../islands/PublicSignContract.tsx";
import { ssrBackendGet } from "../../lib/backend-fetch.ts";

interface ContractPublic {
  id: string;
  quoteId?: string;
  customerId?: string;
  status?: string;
  totalAmount?: number;
  startDate?: string;
  estimatedCompletionDate?: string;
}

export default define.page(async function PublicContract(ctx) {
  const id = ctx.params.id;
  let contract: ContractPublic | undefined;
  let err: string | undefined;
  const r = await ssrBackendGet<ContractPublic>(`/contracts/${id}/public`);
  if (r.ok) contract = r.data;
  else err = r.status === 404 ? "Contract not found" : `Contract unavailable (${r.status})`;

  return (
    <>
      <Head>
        <title>Contract · Paperwork Monsters</title>
        <link rel="stylesheet" href="/landing.css" />
      </Head>
      <div style="min-height:100vh;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30;padding:32px 16px">
        <div style="max-width:640px;margin:0 auto">
          <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#519843;text-align:center;margin-bottom:18px">Paperwork Monsters</div>
          {err || !contract
            ? (
              <div style="background:#fff;border-radius:18px;padding:32px;box-shadow:0 8px 32px rgba(20,72,82,0.08);text-align:center">
                <div style="font-weight:800;color:#144852;font-size:18px">Hmm, can't open this</div>
                <p style="margin:8px 0 0;color:#6b7a7e;font-size:14px">{err ?? "Contract not available."}</p>
              </div>
            )
            : <ContractCard contract={contract} />}
        </div>
      </div>
    </>
  );
});

function ContractCard({ contract }: { contract: ContractPublic }) {
  const signed = contract.status === "accepted" || contract.status === "signed";
  return (
    <article style="background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
      <header style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#519843">Contract</div>
          <h1 style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852;margin:6px 0 0">#{contract.id.slice(0, 8)}</h1>
        </div>
        {signed
          ? <span style="background:rgba(81,152,67,0.12);color:#519843;font-weight:800;font-size:11px;letter-spacing:.10em;text-transform:uppercase;padding:6px 12px;border-radius:999px">{contract.status}</span>
          : null}
      </header>
      <div style="height:1px;background:#e3e8e6;margin:20px 0"></div>
      <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#6b7a7e">Project</div>
      <table style="width:100%;border-collapse:collapse;margin-top:8px">
        {contract.startDate
          ? <tr><td style="padding:6px 0;color:#6b7a7e;font-size:13px">Start</td><td style="padding:6px 0;text-align:right;color:#1c2c30;font-weight:700;font-size:14px">{contract.startDate}</td></tr>
          : null}
        {contract.estimatedCompletionDate
          ? <tr><td style="padding:6px 0;color:#6b7a7e;font-size:13px">Est. completion</td><td style="padding:6px 0;text-align:right;color:#1c2c30;font-weight:700;font-size:14px">{contract.estimatedCompletionDate}</td></tr>
          : null}
        <tr><td style="padding:6px 0;color:#6b7a7e;font-size:13px">Status</td><td style="padding:6px 0;text-align:right;color:#1c2c30;font-weight:700;font-size:14px;text-transform:capitalize">{contract.status ?? "draft"}</td></tr>
      </table>
      <div style="margin-top:18px;background:linear-gradient(135deg,rgba(81,152,67,0.10),rgba(72,158,95,0.04));border:1px solid rgba(72,158,95,0.20);border-radius:14px;padding:18px 20px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:11px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:#519843">Contract value</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:#144852">{fmtUSD(contract.totalAmount)}</div>
      </div>
      {signed ? null : <PublicSignContract contractId={contract.id} />}
    </article>
  );
}

function fmtUSD(amount: number | undefined): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
