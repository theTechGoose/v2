/**
 * Top-level data island for /settings. Fetches the composite profile from
 * the backend (user + business identity + address + insurance + tax + contract
 * defaults) and renders a read-only summary. Edit flows live in the assistant.
 */
import { useEffect, useState } from "preact/hooks";
import { profileClient, type ProfileSnapshot } from "../clients/profile.ts";
import { fmtPhone } from "../lib/format.ts";
import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  ShimmerStyle,
} from "../components/Skeletons.tsx";

interface State {
  loading: boolean;
  error: string | null;
  profile: ProfileSnapshot | null;
}

const INITIAL: State = { loading: true, error: null, profile: null };

function Card(
  { title, rows }: {
    title: string;
    rows: Array<[string, string | undefined | null]>;
  },
) {
  const filled = rows.filter(([, v]) =>
    v !== undefined && v !== null && v !== ""
  );
  return (
    <div class="panel" style="padding:18px 20px">
      <div class="panel__head" style="margin-bottom:12px">
        <h3 class="panel__title">{title}</h3>
      </div>
      {filled.length === 0
        ? (
          <div style="color:var(--fg-muted, #6b7560);font-size:13px">
            Nothing set yet.
          </div>
        )
        : (
          <div style="display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;font-size:13.5px">
            {filled.map(([k, v]) => (
              <>
                <div key={`k-${k}`} style="color:var(--fg-muted, #6b7560)">
                  {k}
                </div>
                <div key={`v-${k}`} style="color:var(--fg)">{v}</div>
              </>
            ))}
          </div>
        )}
    </div>
  );
}

export default function SettingsPage() {
  const [s, setS] = useState<State>(INITIAL);

  useEffect(() => {
    let alive = true;
    profileClient.get()
      .then((profile) => {
        if (alive) setS({ loading: false, error: null, profile });
      })
      .catch((err: Error) => {
        if (alive) setS({ ...INITIAL, loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (s.loading) {
    return (
      <>
        <ShimmerStyle />
        <PageHeaderSkeleton />
        <CardGridSkeleton rows={2} />
      </>
    );
  }
  if (s.error || !s.profile) {
    return (
      <div class="dashpage-error">
        Couldn't load profile: {s.error ?? "unknown error"}
      </div>
    );
  }

  const p = s.profile;

  const addressLines: string[] = [];
  if (p.address?.line1) addressLines.push(p.address.line1);
  if (p.address?.line2) addressLines.push(p.address.line2);
  const cityLine = [p.address?.city, p.address?.state, p.address?.postalCode]
    .filter(Boolean).join(", ");
  if (cityLine) addressLines.push(cityLine);
  if (p.address?.country) addressLines.push(p.address.country);

  return (
    <>
      <section class="hero" style="grid-template-columns:1fr">
        <div class="hero__copy">
          <h1 class="hero__title">
            {p.identity?.businessName ?? p.identity?.displayName ?? p.user.name ?? "Your business"}
          </h1>
          <p class="hero__sub">
            Edits live in the assistant — anything saved there shows up here. To
            change something below, ask the monsters.
          </p>
        </div>
      </section>

      <div class="grid">
        <Card
          title="Account"
          rows={[
            ["Name", p.user.name],
            ["Phone", p.user.phoneNumber ? fmtPhone(p.user.phoneNumber) : undefined],
            ["Email", p.user.email],
            ["Language", p.user.language === "es" ? "Spanish" : "English"],
          ]}
        />
        <Card
          title="Business identity"
          rows={[
            ["Business name", p.identity?.businessName ?? p.identity?.displayName],
            ["Legal name", p.identity?.legalName],
            ["License", p.identity?.businessLicense],
            ["Tagline", p.identity?.tagline],
            ["Website", p.identity?.websiteUrl],
          ]}
        />
      </div>

      <div class="grid">
        <Card
          title="Mailing address"
          rows={[
            [
              "Address",
              addressLines.length > 0 ? addressLines.join(" · ") : null,
            ],
          ]}
        />
        <Card
          title="Insurance"
          rows={[
            ["Provider", p.insurance?.provider],
            [
              "Coverage",
              p.insurance?.coverageCents != null
                ? `$${(p.insurance.coverageCents / 100).toLocaleString()}`
                : null,
            ],
            ["Expires", p.insurance?.expiresAt],
          ]}
        />
      </div>

      <div class="grid">
        <Card
          title="Tax"
          rows={[
            ["TIN", p.tax?.tinMasked],
            [
              "W-9",
              p.tax?.w9UploadedAt
                ? `Uploaded ${p.tax.w9UploadedAt}`
                : "Not uploaded",
            ],
          ]}
        />
        <Card
          title="Contract defaults"
          rows={[
            [
              "Payment terms",
              p.contractDefaults?.paymentTermsDays != null
                ? `Net ${p.contractDefaults.paymentTermsDays}`
                : null,
            ],
            [
              "Deposit",
              p.contractDefaults?.depositPct != null
                ? `${p.contractDefaults.depositPct}%`
                : null,
            ],
            [
              "Warranty",
              p.contractDefaults?.warrantyDays != null
                ? `${p.contractDefaults.warrantyDays} days`
                : null,
            ],
          ]}
        />
      </div>
    </>
  );
}
