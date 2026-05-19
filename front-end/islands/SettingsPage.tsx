/**
 * Top-level data island for /settings. Fetches the composite profile from
 * the backend (user + business identity + address + insurance + tax + contract
 * defaults) and renders a read-only summary. Edit flows live in the assistant.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { profileClient, type ProfileSnapshot } from "../clients/profile.ts";
import { filesClient } from "../clients/files.ts";
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

/** EditCard — inline edit affordances for the bits a user is most likely
 *  to want to fix themselves: name, email, business name, and logo.
 *  Saves on blur (or on file pick) and pushes the new values back up via
 *  the onSaved callback so neighbouring read-only cards reflect the edit
 *  without a full refetch. */
function EditCard(
  { snapshot, onSaved }: {
    snapshot: ProfileSnapshot;
    onSaved: (partial: Partial<ProfileSnapshot>) => void;
  },
) {
  const [name, setName] = useState(snapshot.user.name ?? "");
  const [email, setEmail] = useState(snapshot.user.email ?? "");
  const [biz, setBiz] = useState(snapshot.identity?.businessName ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  async function saveUser(patch: Record<string, unknown>) {
    setBusy("user"); setErr(null);
    try {
      const u = await profileClient.updateUser(patch);
      onSaved({ user: { ...snapshot.user, ...u } as typeof snapshot.user });
    } catch (e) { setErr(e instanceof Error ? e.message : "save failed"); }
    finally { setBusy(null); }
  }
  async function saveIdentity(patch: Record<string, unknown>) {
    setBusy("identity"); setErr(null);
    try {
      const id = await profileClient.updateIdentity(patch);
      onSaved({ identity: { ...(snapshot.identity ?? {} as never), ...id } as typeof snapshot.identity });
    } catch (e) { setErr(e instanceof Error ? e.message : "save failed"); }
    finally { setBusy(null); }
  }
  async function onLogoPick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setBusy("logo"); setErr(null);
    try {
      const rec = await filesClient.uploadBlob(file, file.name);
      await saveIdentity({ logoFileId: rec.id });
    } catch (ex) { setErr(ex instanceof Error ? ex.message : "logo upload failed"); }
    finally { setBusy(null); }
  }

  const inputStyle =
    "width:100%;padding:8px 10px;border:1px solid var(--border, #d8dcd5);border-radius:8px;font:inherit;font-size:13.5px;background:#fff;color:var(--fg)";
  const labelStyle =
    "display:block;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-muted, #6b7560);margin-bottom:4px";

  return (
    <div class="panel" style="padding:18px 20px;margin-top:16px">
      <div class="panel__head" style="margin-bottom:12px">
        <h3 class="panel__title">Edit your details</h3>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <label style="display:block">
          <span style={labelStyle}>Name</span>
          <input
            type="text"
            class="settings-edit__input"
            style={inputStyle}
            value={name}
            disabled={busy === "user"}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            onBlur={() => name.trim() !== (snapshot.user.name ?? "") && saveUser({ name: name.trim() })}
            aria-label="Edit name"
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>Email</span>
          <input
            type="email"
            class="settings-edit__input"
            style={inputStyle}
            value={email}
            disabled={busy === "user"}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            onBlur={() => email.trim() !== (snapshot.user.email ?? "") && saveUser({ email: email.trim() })}
            aria-label="Edit email"
          />
        </label>
        <label style="display:block;grid-column:1 / -1">
          <span style={labelStyle}>Business name</span>
          <input
            type="text"
            class="settings-edit__input"
            style={inputStyle}
            value={biz}
            disabled={busy === "identity"}
            onInput={(e) => setBiz((e.target as HTMLInputElement).value)}
            onBlur={() => biz.trim() !== (snapshot.identity?.businessName ?? "") && saveIdentity({ businessName: biz.trim() })}
            aria-label="Edit business name"
          />
        </label>
        <div style="grid-column:1 / -1;display:flex;align-items:center;gap:12px">
          <button
            type="button"
            class="btn btn-secondary"
            aria-label="Upload logo"
            disabled={busy === "logo"}
            onClick={() => logoInputRef.current?.click()}
            style="padding:8px 14px;border-radius:8px;border:1px solid var(--border, #d8dcd5);background:#fff;color:var(--fg);cursor:pointer;font:inherit;font-weight:600"
          >
            {busy === "logo" ? "Uploading…" : (snapshot.identity?.logoFileId ? "Replace logo" : "Upload logo")}
          </button>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            aria-label="Logo file"
            style="display:none"
            onChange={onLogoPick}
          />
          {snapshot.identity?.logoFileId
            ? <span style="font-size:12px;color:var(--fg-muted)">Logo set · file {snapshot.identity.logoFileId.slice(0, 8)}…</span>
            : <span style="font-size:12px;color:var(--fg-muted)">PNG or JPG · shows on quotes &amp; invoices</span>}
        </div>
      </div>
      {err ? <div style="margin-top:10px;color:#a83b3b;font-size:12.5px">{err}</div> : null}
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
  if (p.address?.street) addressLines.push(p.address.street);
  if (p.address?.unit) addressLines.push(p.address.unit);
  const cityLine = [p.address?.city, p.address?.state, p.address?.postal]
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

      <EditCard
        snapshot={p}
        onSaved={(next) => setS((cur) => cur.profile ? { ...cur, profile: { ...cur.profile, ...next } } : cur)}
      />

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
