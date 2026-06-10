/**
 * Top-level data island for /settings. Fetches the composite profile from
 * the backend (user + business identity + address + insurance + tax +
 * contract defaults) and lets the contractor edit it in place.
 *
 * Roadmap p.2/p.3: the mailing address, insurance (incl. file upload),
 * W-9 upload, and accepted payment methods are all editable here. Each
 * card owns its own save state and bubbles the saved value up via onSaved
 * so neighbouring cards stay in sync without a full refetch.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { profileClient, type ProfileSnapshot } from "../clients/profile.ts";
import { filesClient } from "../clients/files.ts";
import { fmtPhone } from "../lib/format.ts";
import { type Lang, langSignal, setLang, tFor } from "../lib/i18n.ts";
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

const inputStyle =
  "width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border, #d8dcd5);border-radius:8px;font:inherit;font-size:13.5px;background:#fff;color:var(--fg)";
const labelStyle =
  "display:block;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-muted, #6b7560);margin-bottom:4px";
const btnSecondary =
  "padding:8px 14px;border-radius:8px;border:1px solid var(--border, #d8dcd5);background:#fff;color:var(--fg);cursor:pointer;font:inherit;font-weight:600";
const btnPrimary =
  "padding:9px 16px;border-radius:8px;border:0;background:var(--brand-green,#519843);color:#fff;cursor:pointer;font:inherit;font-weight:700";

/** Roadmap p.13: neutral Latin-American Spanish for the Settings UI, keyed
 *  off the contractor's `user.language`. One dictionary so the whole screen
 *  flips together (no mixed-language state). */
function tr(es: boolean) {
  const lang: Lang = es ? "es" : "en";
  return {
    heroSub: tFor(lang, "settings.heroSub"),
    saving: tFor(lang, "settings.saving"),
    saved: tFor(lang, "settings.saved"),
    saveFailed: tFor(lang, "settings.saveFailed"),
    logoUploadFailed: tFor(lang, "settings.logoUploadFailed"),
    uploadFailed: tFor(lang, "settings.uploadFailed"),
    nothingSet: tFor(lang, "settings.nothingSet"),
    // Card titles
    account: tFor(lang, "common.account"),
    businessIdentity: tFor(lang, "settings.businessIdentity"),
    mailingAddress: tFor(lang, "settings.mailingAddress"),
    insurance: tFor(lang, "settings.insurance"),
    tax: tFor(lang, "settings.tax"),
    contractDefaults: tFor(lang, "settings.contractDefaults"),
    payments: tFor(lang, "settings.payments"),
    editDetails: tFor(lang, "settings.editDetails"),
    // Account / identity rows + fields
    name: tFor(lang, "settings.name"),
    phone: tFor(lang, "settings.phone"),
    email: tFor(lang, "settings.email"),
    language: tFor(lang, "settings.language"),
    spanish: tFor(lang, "settings.spanish"),
    english: tFor(lang, "settings.english"),
    legalName: tFor(lang, "settings.legalName"),
    license: tFor(lang, "settings.license"),
    businessName: tFor(lang, "settings.businessName"),
    // Address
    street: tFor(lang, "settings.street"),
    city: tFor(lang, "settings.city"),
    state: tFor(lang, "settings.state"),
    zip: tFor(lang, "settings.zip"),
    country: tFor(lang, "settings.country"),
    // Logo
    uploadLogo: tFor(lang, "settings.uploadLogo"),
    replaceLogo: tFor(lang, "settings.replaceLogo"),
    uploading: tFor(lang, "settings.uploading"),
    logoSet: tFor(lang, "settings.logoSet"),
    logoHint: tFor(lang, "settings.logoHint"),
    // Contractor's own UI language (the app + assistant they see).
    appLang: tFor(lang, "settings.appLang"),
    appLangHint: tFor(lang, "settings.appLangHint"),
    // Outgoing-comms languages (what the contractor can SEND quotes in).
    commsLang: tFor(lang, "settings.commsLang"),
    commsLangHint: tFor(lang, "settings.commsLangHint"),
    // Insurance
    provider: tFor(lang, "settings.provider"),
    policyNumber: tFor(lang, "settings.policyNumber"),
    coverage: tFor(lang, "settings.coverage"),
    expires: tFor(lang, "settings.expires"),
    uploadCert: tFor(lang, "settings.uploadCert"),
    replaceCert: tFor(lang, "settings.replaceCert"),
    certOnFile: tFor(lang, "settings.certOnFile"),
    certHint: tFor(lang, "settings.certHint"),
    // Tax
    tinLabel: tFor(lang, "settings.tinLabel"),
    onFile: tFor(lang, "settings.onFile"),
    enterToReplace: tFor(lang, "settings.enterToReplace"),
    uploadW9: tFor(lang, "settings.uploadW9"),
    replaceW9: tFor(lang, "settings.replaceW9"),
    uploaded: tFor(lang, "settings.uploaded"),
    w9Hint: tFor(lang, "settings.w9Hint"),
    // Contract defaults
    paymentTerms: tFor(lang, "settings.paymentTerms"),
    deposit: tFor(lang, "settings.deposit"),
    warranty: tFor(lang, "settings.warranty"),
    days: tFor(lang, "settings.days"),
    // Payments
    paymentsIntro: tFor(lang, "settings.paymentsIntro"),
    yourHandle: tFor(lang, "settings.yourHandle"),
    mailingOptional: tFor(lang, "settings.mailingOptional"),
    instructionsOptional: tFor(lang, "settings.instructionsOptional"),
    retypeConfirm: tFor(lang, "settings.retypeConfirm"),
    noMatch: tFor(lang, "settings.noMatch"),
    savePayments: tFor(lang, "settings.savePayments"),
    enterHandle: (m: string) =>
      tFor(lang, "settings.payments.enterHandle", { m }),
    handleMismatch: (m: string) =>
      tFor(lang, "settings.payments.handleMismatch", { m }),
    // Danger zone
    dangerZone: tFor(lang, "settings.dangerZone"),
    wipeIntro: tFor(lang, "settings.wipeIntro"),
    wipeConfirmLabel: tFor(lang, "settings.wipeConfirmLabel"),
    wipeButton: tFor(lang, "settings.wipeButton"),
    wiping: tFor(lang, "settings.wiping"),
    wipeFailed: tFor(lang, "settings.wipeFailed"),
    // Aria labels
    ariaEditName: tFor(lang, "settings.aria.editName"),
    ariaEditEmail: tFor(lang, "settings.aria.editEmail"),
    ariaEditBusinessName: tFor(lang, "settings.aria.editBusinessName"),
    ariaUploadLogo: tFor(lang, "settings.aria.uploadLogo"),
    ariaLogoFile: tFor(lang, "settings.aria.logoFile"),
    ariaInsuranceCertFile: tFor(lang, "settings.aria.insuranceCertFile"),
    ariaW9File: tFor(lang, "settings.aria.w9File"),
    ariaWipeConfirm: tFor(lang, "settings.aria.wipeConfirm"),
    // Placeholders
    phStreet: tFor(lang, "settings.ph.street"),
    phState: tFor(lang, "settings.ph.state"),
    phCoverage: tFor(lang, "settings.ph.coverage"),
    phTin: tFor(lang, "settings.ph.tin"),
  };
}

function Card(
  { title, rows, empty = tFor("en", "settings.nothingSet") }: {
    title: string;
    rows: Array<[string, string | undefined | null]>;
    empty?: string;
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
            {empty}
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

/** Small shell for an editable card: title, optional status line, error. */
function EditPanel(
  {
    title,
    children,
    busy,
    err,
    saved,
    saving = tFor("en", "settings.saving"),
    savedLabel = tFor("en", "settings.saved"),
  }: {
    title: string;
    children: ComponentChildren;
    busy?: boolean;
    err?: string | null;
    saved?: boolean;
    saving?: string;
    savedLabel?: string;
  },
) {
  return (
    <div class="panel" style="padding:18px 20px">
      <div
        class="panel__head"
        style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px"
      >
        <h3 class="panel__title">{title}</h3>
        {busy
          ? <span style="font-size:11.5px;color:var(--fg-muted)">{saving}</span>
          : saved
          ? (
            <span style="font-size:11.5px;color:var(--brand-green,#519843)">
              {savedLabel}
            </span>
          )
          : null}
      </div>
      {children}
      {err
        ? (
          <div style="margin-top:10px;color:#a83b3b;font-size:12.5px">
            {err}
          </div>
        )
        : null}
    </div>
  );
}

/** EditCard — name, email, business name, and logo. Saves on blur. */
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
  const t = tr(langSignal.value === "es");

  async function saveUser(patch: Record<string, unknown>) {
    setBusy("user");
    setErr(null);
    try {
      const u = await profileClient.updateUser(patch);
      onSaved({ user: { ...snapshot.user, ...u } as typeof snapshot.user });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.saveFailed);
    } finally {
      setBusy(null);
    }
  }
  async function saveIdentity(patch: Record<string, unknown>) {
    setBusy("identity");
    setErr(null);
    try {
      const id = await profileClient.updateIdentity(patch);
      onSaved({
        identity: {
          ...(snapshot.identity ?? {} as never),
          ...id,
        } as typeof snapshot.identity,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.saveFailed);
    } finally {
      setBusy(null);
    }
  }
  async function onLogoPick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setBusy("logo");
    setErr(null);
    try {
      const rec = await filesClient.uploadBlob(file, file.name);
      await saveIdentity({ logoFileId: rec.id });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : t.logoUploadFailed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <EditPanel
      title={t.editDetails}
      busy={!!busy}
      err={err}
      saving={t.saving}
      savedLabel={t.saved}
    >
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
        <label style="display:block">
          <span style={labelStyle}>{t.name}</span>
          <input
            type="text"
            class="settings-edit__input"
            style={inputStyle}
            value={name}
            disabled={busy === "user"}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            onBlur={() =>
              name.trim() !== (snapshot.user.name ?? "") &&
              saveUser({ name: name.trim() })}
            aria-label={t.ariaEditName}
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>{t.email}</span>
          <input
            type="email"
            class="settings-edit__input"
            style={inputStyle}
            value={email}
            disabled={busy === "user"}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            onBlur={() =>
              email.trim() !== (snapshot.user.email ?? "") &&
              saveUser({ email: email.trim() })}
            aria-label={t.ariaEditEmail}
          />
        </label>
        <label style="display:block;grid-column:1 / -1">
          <span style={labelStyle}>{t.businessName}</span>
          <input
            type="text"
            class="settings-edit__input"
            style={inputStyle}
            value={biz}
            disabled={busy === "identity"}
            onInput={(e) => setBiz((e.target as HTMLInputElement).value)}
            onBlur={() =>
              biz.trim() !== (snapshot.identity?.businessName ?? "") &&
              saveIdentity({ businessName: biz.trim() })}
            aria-label={t.ariaEditBusinessName}
          />
        </label>
        <div style="grid-column:1 / -1;display:flex;align-items:center;gap:12px">
          <button
            type="button"
            class="btn btn-secondary"
            aria-label={t.ariaUploadLogo}
            disabled={busy === "logo"}
            onClick={() => logoInputRef.current?.click()}
            style={btnSecondary}
          >
            {busy === "logo"
              ? t.uploading
              : (snapshot.identity?.logoFileId ? t.replaceLogo : t.uploadLogo)}
          </button>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            aria-label={t.ariaLogoFile}
            style="display:none"
            onChange={onLogoPick}
          />
          {snapshot.identity?.logoFileId
            ? (
              <span style="font-size:12px;color:var(--fg-muted)">
                {t.logoSet} · {snapshot.identity.logoFileId.slice(0, 8)}…
              </span>
            )
            : (
              <span style="font-size:12px;color:var(--fg-muted)">
                {t.logoHint}
              </span>
            )}
        </div>
        <label style="display:block;grid-column:1 / -1">
          <span style={labelStyle}>{t.appLang}</span>
          <select
            style={inputStyle}
            disabled={busy === "user"}
            value={langSignal.value === "es" ? "es" : "en"}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value as Lang;
              setLang(v); // flip the whole app instantly
              saveUser({ language: v }); // …and persist
            }}
          >
            <option value="en">{t.english}</option>
            <option value="es">{t.spanish}</option>
          </select>
          <span style="display:block;margin-top:4px;font-size:12px;color:var(--fg-muted)">
            {t.appLangHint}
          </span>
        </label>
        <div style="display:block;grid-column:1 / -1">
          <span style={labelStyle}>{t.commsLang}</span>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:2px">
            {[{ code: "en", label: t.english }, {
              code: "es",
              label: t.spanish,
            }]
              .map((lng) => {
                // Selected set: the explicit list, else fall back to the legacy
                // single commsLanguage (so existing accounts show their language
                // pre-checked), else English.
                const selected = snapshot.identity?.commsLanguages?.length
                  ? snapshot.identity.commsLanguages
                  : [snapshot.identity?.commsLanguage ?? "en"];
                const on = selected.includes(lng.code);
                return (
                  <label
                    key={lng.code}
                    style={`display:flex;align-items:center;gap:8px;cursor:pointer;border:1px solid ${
                      on
                        ? "var(--brand-green,#519843)"
                        : "var(--border,#d8dcd5)"
                    };border-radius:8px;padding:8px 12px;background:#fff`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy === "identity"}
                      onChange={(e) => {
                        const want = (e.target as HTMLInputElement).checked;
                        const set = new Set(selected);
                        if (want) set.add(lng.code);
                        else set.delete(lng.code);
                        // Always keep at least one language enabled.
                        if (set.size === 0) return;
                        const list = ["en", "es"].filter((c) => set.has(c));
                        saveIdentity({
                          commsLanguages: list,
                          commsLanguage: list[0],
                        });
                      }}
                    />
                    <span style="font-weight:700;font-size:13.5px;color:var(--fg)">
                      {lng.label}
                    </span>
                  </label>
                );
              })}
          </div>
          <span style="display:block;margin-top:4px;font-size:12px;color:var(--fg-muted)">
            {t.commsLangHint}
          </span>
        </div>
      </div>
    </EditPanel>
  );
}

/** AddressEditCard — editable mailing address (roadmap p.2). Saves on blur. */
function AddressEditCard(
  { snapshot, onSaved }: {
    snapshot: ProfileSnapshot;
    onSaved: (partial: Partial<ProfileSnapshot>) => void;
  },
) {
  const a = snapshot.address;
  const [street, setStreet] = useState(a?.street ?? "");
  const [city, setCity] = useState(a?.city ?? "");
  const [stateV, setStateV] = useState(a?.state ?? "");
  const [postal, setPostal] = useState(a?.postal ?? "");
  const [country, setCountry] = useState(a?.country ?? "US");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const t = tr(langSignal.value === "es");

  async function save(patch: Record<string, string>) {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const next = await profileClient.updateAddress(patch);
      onSaved({ address: next });
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.saveFailed);
    } finally {
      setBusy(false);
    }
  }
  const blur = (field: string, val: string, was: string) => {
    if (val.trim() !== (was ?? "")) save({ [field]: val.trim() });
  };

  return (
    <EditPanel
      title={t.mailingAddress}
      busy={busy}
      err={err}
      saved={saved}
      saving={t.saving}
      savedLabel={t.saved}
    >
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        <label style="display:block;grid-column:1 / -1">
          <span style={labelStyle}>{t.street}</span>
          <input
            type="text"
            style={inputStyle}
            value={street}
            disabled={busy}
            placeholder={t.phStreet}
            onInput={(e) => setStreet((e.target as HTMLInputElement).value)}
            onBlur={() => blur("street", street, a?.street ?? "")}
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>{t.city}</span>
          <input
            type="text"
            style={inputStyle}
            value={city}
            disabled={busy}
            onInput={(e) => setCity((e.target as HTMLInputElement).value)}
            onBlur={() => blur("city", city, a?.city ?? "")}
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>{t.state}</span>
          <input
            type="text"
            style={inputStyle}
            value={stateV}
            disabled={busy}
            maxLength={2}
            placeholder={t.phState}
            onInput={(e) =>
              setStateV((e.target as HTMLInputElement).value.toUpperCase())}
            onBlur={() => blur("state", stateV, a?.state ?? "")}
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>{t.zip}</span>
          <input
            type="text"
            style={inputStyle}
            value={postal}
            disabled={busy}
            onInput={(e) => setPostal((e.target as HTMLInputElement).value)}
            onBlur={() => blur("postal", postal, a?.postal ?? "")}
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>{t.country}</span>
          <input
            type="text"
            style={inputStyle}
            value={country}
            disabled={busy}
            onInput={(e) => setCountry((e.target as HTMLInputElement).value)}
            onBlur={() => blur("country", country, a?.country ?? "")}
          />
        </label>
      </div>
    </EditPanel>
  );
}

/** InsuranceEditCard — provider/policy/coverage/expiry + file upload (roadmap p.2). */
function InsuranceEditCard(
  { snapshot, onSaved }: {
    snapshot: ProfileSnapshot;
    onSaved: (partial: Partial<ProfileSnapshot>) => void;
  },
) {
  const ins = snapshot.insurance;
  const [provider, setProvider] = useState(ins?.provider ?? "");
  const [policy, setPolicy] = useState(ins?.policyNumber ?? "");
  const [coverage, setCoverage] = useState(
    ins?.coverageCents != null ? String(ins.coverageCents / 100) : "",
  );
  const [expires, setExpires] = useState(ins?.expiresAt ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const t = tr(langSignal.value === "es");

  async function save(patch: Record<string, unknown>) {
    setBusy("fields");
    setErr(null);
    setSaved(false);
    try {
      const next = await profileClient.updateInsurance(patch);
      onSaved({ insurance: next });
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.saveFailed);
    } finally {
      setBusy(null);
    }
  }
  async function onFilePick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setBusy("file");
    setErr(null);
    try {
      const rec = await filesClient.uploadBlob(file, file.name);
      await save({ insuranceFileId: rec.id });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : t.uploadFailed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <EditPanel
      title={t.insurance}
      busy={!!busy}
      err={err}
      saved={saved}
      saving={t.saving}
      savedLabel={t.saved}
    >
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        <label style="display:block">
          <span style={labelStyle}>{t.provider}</span>
          <input
            type="text"
            style={inputStyle}
            value={provider}
            disabled={!!busy}
            onInput={(e) => setProvider((e.target as HTMLInputElement).value)}
            onBlur={() =>
              provider.trim() !== (ins?.provider ?? "") &&
              save({ provider: provider.trim() })}
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>{t.policyNumber}</span>
          <input
            type="text"
            style={inputStyle}
            value={policy}
            disabled={!!busy}
            onInput={(e) => setPolicy((e.target as HTMLInputElement).value)}
            onBlur={() =>
              policy.trim() !== (ins?.policyNumber ?? "") &&
              save({ policyNumber: policy.trim() })}
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>{t.coverage}</span>
          <input
            type="number"
            min="0"
            step="1000"
            style={inputStyle}
            value={coverage}
            disabled={!!busy}
            placeholder={t.phCoverage}
            onInput={(e) => setCoverage((e.target as HTMLInputElement).value)}
            onBlur={() => {
              const cents = coverage.trim() === ""
                ? undefined
                : Math.round(Number(coverage) * 100);
              if (cents !== ins?.coverageCents && !Number.isNaN(cents)) {
                save({
                  coverageCents: cents,
                });
              }
            }}
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>{t.expires}</span>
          <input
            type="date"
            style={inputStyle}
            value={expires ? expires.slice(0, 10) : ""}
            disabled={!!busy}
            onInput={(e) => setExpires((e.target as HTMLInputElement).value)}
            onBlur={() =>
              expires.slice(0, 10) !== (ins?.expiresAt ?? "").slice(0, 10) &&
              save({ expiresAt: expires })}
          />
        </label>
      </div>
      <div style="margin-top:14px;display:flex;align-items:center;gap:12px">
        <button
          type="button"
          disabled={busy === "file"}
          onClick={() => fileRef.current?.click()}
          style={btnSecondary}
        >
          {busy === "file"
            ? t.uploading
            : ins?.insuranceFileId
            ? t.replaceCert
            : t.uploadCert}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          aria-label={t.ariaInsuranceCertFile}
          style="display:none"
          onChange={onFilePick}
        />
        <span style="font-size:12px;color:var(--fg-muted)">
          {ins?.insuranceFileId
            ? `${t.certOnFile}${
              ins.insuranceUploadedAt
                ? ` · ${ins.insuranceUploadedAt.slice(0, 10)}`
                : ""
            }`
            : t.certHint}
        </span>
      </div>
    </EditPanel>
  );
}

/** TaxEditCard — TIN entry + W-9 upload (roadmap p.2). The raw TIN never
 *  comes back from the server; we show the masked value it returns. */
function TaxEditCard(
  { snapshot, onSaved }: {
    snapshot: ProfileSnapshot;
    onSaved: (partial: Partial<ProfileSnapshot>) => void;
  },
) {
  const tax = snapshot.tax;
  const [tin, setTin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const t = tr(langSignal.value === "es");

  async function save(patch: Record<string, unknown>) {
    setBusy("save");
    setErr(null);
    setSaved(false);
    try {
      const next = await profileClient.updateTax(patch);
      onSaved({ tax: next });
      setSaved(true);
      setTin("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.saveFailed);
    } finally {
      setBusy(null);
    }
  }
  async function onFilePick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setBusy("file");
    setErr(null);
    try {
      const rec = await filesClient.uploadBlob(file, file.name);
      await save({ w9FileId: rec.id });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : t.uploadFailed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <EditPanel
      title={t.tax}
      busy={!!busy}
      err={err}
      saved={saved}
      saving={t.saving}
      savedLabel={t.saved}
    >
      <div style="display:grid;grid-template-columns:1fr;gap:12px">
        <label style="display:block">
          <span style={labelStyle}>
            {t.tinLabel}{" "}
            {tax?.tinMasked ? `(${t.onFile}: ${tax.tinMasked})` : ""}
          </span>
          <input
            type="text"
            style={inputStyle}
            value={tin}
            disabled={!!busy}
            placeholder={tax?.tinMasked ? t.enterToReplace : t.phTin}
            onInput={(e) => setTin((e.target as HTMLInputElement).value)}
            onBlur={() => tin.trim() && save({ tin: tin.trim() })}
          />
        </label>
      </div>
      <div style="margin-top:14px;display:flex;align-items:center;gap:12px">
        <button
          type="button"
          disabled={busy === "file"}
          onClick={() => fileRef.current?.click()}
          style={btnSecondary}
        >
          {busy === "file"
            ? t.uploading
            : tax?.w9FileId
            ? t.replaceW9
            : t.uploadW9}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          aria-label={t.ariaW9File}
          style="display:none"
          onChange={onFilePick}
        />
        <span style="font-size:12px;color:var(--fg-muted)">
          {tax?.w9UploadedAt
            ? `${t.uploaded} ${tax.w9UploadedAt.slice(0, 10)}`
            : t.w9Hint}
        </span>
      </div>
    </EditPanel>
  );
}

interface PayRow {
  key:
    | "venmo"
    | "cashapp"
    | "zelle"
    | "paypal"
    | "check"
    | "cash"
    | "ach"
    | "card";
  label: string;
  /** Backend field that stores the handle. null → no handle (cash). */
  field: "handle" | "cashtag" | "mailTo" | "instructions" | null;
  placeholder: string;
  /** Money-routing handles (Venmo/Zelle/etc.) are required when the method is
   *  enabled and get a retype-to-confirm guard — a typo sends funds to the
   *  wrong place. A check's mailing address is optional (the contractor's
   *  address already prints on the invoice) and needs no confirm field. */
  optional?: boolean;
}

// `label` and `placeholder` hold i18n KEYS (resolved per-language at render).
const PAY_ROWS: PayRow[] = [
  {
    key: "venmo",
    label: "paymentMethod.venmo",
    field: "handle",
    placeholder: "settings.pay.venmoPh",
  },
  {
    key: "cashapp",
    label: "paymentMethod.cashApp",
    field: "cashtag",
    placeholder: "settings.pay.cashappPh",
  },
  {
    key: "zelle",
    label: "paymentMethod.zelle",
    field: "handle",
    placeholder: "settings.pay.zellePh",
  },
  {
    key: "paypal",
    label: "paymentMethod.paypal",
    field: "handle",
    placeholder: "settings.pay.paypalPh",
  },
  {
    key: "check",
    label: "paymentMethod.check",
    field: "mailTo",
    placeholder: "settings.pay.checkPh",
    optional: true,
  },
  {
    key: "ach",
    label: "paymentMethod.ach",
    field: "instructions",
    placeholder: "settings.pay.achPh",
    optional: true,
  },
  {
    key: "card",
    label: "paymentMethod.card",
    field: "instructions",
    placeholder: "settings.pay.cardPh",
    optional: true,
  },
  { key: "cash", label: "paymentMethod.cash", field: null, placeholder: "" },
];

interface PayState {
  enabled: boolean;
  value: string;
  confirm: string;
}

/** PaymentsEditCard — enable/disable each method + enter the handle with a
 *  retype-to-confirm guard (roadmap p.3). Saves the whole acceptedPaymentMethods
 *  object so the shallow-merge backend keeps untouched methods intact. */
function PaymentsEditCard(
  { snapshot, onSaved }: {
    snapshot: ProfileSnapshot;
    onSaved: (partial: Partial<ProfileSnapshot>) => void;
  },
) {
  const apm = snapshot.identity?.acceptedPaymentMethods ?? {};
  const init: Record<string, PayState> = {};
  for (const r of PAY_ROWS) {
    const cur = (apm as Record<
      string,
      {
        enabled?: boolean;
        handle?: string;
        cashtag?: string;
        mailTo?: string;
        instructions?: string;
      }
    >)[r.key];
    const val = r.field ? (cur?.[r.field] ?? "") : "";
    init[r.key] = { enabled: !!cur?.enabled, value: val, confirm: val };
  }
  const [rows, setRows] = useState<Record<string, PayState>>(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const lang: Lang = langSignal.value === "es" ? "es" : "en";
  const t = tr(langSignal.value === "es");

  function patchRow(key: string, next: Partial<PayState>) {
    setSaved(false);
    setRows((cur) => ({ ...cur, [key]: { ...cur[key], ...next } }));
  }

  const mismatch = (r: PayRow) => {
    const st = rows[r.key];
    return st.enabled && r.field !== null && st.value.trim() !== "" &&
      st.confirm.trim() !== "" && st.value.trim() !== st.confirm.trim();
  };

  async function save() {
    // Validate every enabled handle-bearing method has a matching confirm.
    for (const r of PAY_ROWS) {
      const st = rows[r.key];
      if (!st.enabled || r.field === null) continue;
      // Optional fields (check's mailing address) may be left blank.
      if (r.optional) continue;
      const label = tFor(lang, r.label);
      if (st.value.trim() === "") {
        setErr(t.enterHandle(label));
        return;
      }
      if (st.value.trim() !== st.confirm.trim()) {
        setErr(t.handleMismatch(label));
        return;
      }
    }
    setBusy(true);
    setErr(null);
    setSaved(false);
    // Preserve any methods we don't render here (e.g. `other`) via shallow spread.
    const apmPatch: Record<string, Record<string, unknown>> = {
      ...(apm as Record<string, Record<string, unknown>>),
    };
    for (const r of PAY_ROWS) {
      const st = rows[r.key];
      const entry: Record<string, unknown> = { enabled: st.enabled };
      if (r.field) entry[r.field] = st.value.trim();
      apmPatch[r.key] = entry;
    }
    try {
      const id = await profileClient.updateIdentity({
        acceptedPaymentMethods: apmPatch,
      });
      onSaved({
        identity: {
          ...(snapshot.identity ?? {} as never),
          ...id,
        } as typeof snapshot.identity,
      });
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditPanel
      title={t.payments}
      busy={busy}
      err={err}
      saved={saved}
      saving={t.saving}
      savedLabel={t.saved}
    >
      <p style="margin:0 0 14px;font-size:13px;color:var(--fg-muted, #6b7560)">
        {t.paymentsIntro}
      </p>
      <div style="display:flex;flex-direction:column;gap:12px">
        {PAY_ROWS.map((r) => {
          const st = rows[r.key];
          const bad = mismatch(r);
          const label = tFor(lang, r.label);
          const placeholder = r.placeholder ? tFor(lang, r.placeholder) : "";
          return (
            <div
              key={r.key}
              style={`border:1px solid ${
                st.enabled
                  ? "var(--brand-green,#519843)"
                  : "var(--border,#d8dcd5)"
              };border-radius:10px;padding:12px 14px;background:#fff`}
            >
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
                <input
                  type="checkbox"
                  checked={st.enabled}
                  disabled={busy}
                  onChange={(e) =>
                    patchRow(r.key, {
                      enabled: (e.target as HTMLInputElement).checked,
                    })}
                />
                <span style="font-weight:700;font-size:14px;color:var(--fg)">
                  {label}
                </span>
              </label>
              {st.enabled && r.field !== null && (
                <div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
                  <label style="display:block">
                    <span style={labelStyle}>
                      {r.field === "instructions"
                        ? t.instructionsOptional
                        : r.optional
                        ? t.mailingOptional
                        : t.yourHandle}
                    </span>
                    <input
                      type="text"
                      style={inputStyle}
                      value={st.value}
                      disabled={busy}
                      placeholder={placeholder}
                      onInput={(e) =>
                        patchRow(r.key, {
                          value: (e.target as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  {!r.optional && (
                    <label style="display:block">
                      <span style={labelStyle}>{t.retypeConfirm}</span>
                      <input
                        type="text"
                        style={`${inputStyle}${
                          bad ? ";border-color:#a83b3b" : ""
                        }`}
                        value={st.confirm}
                        disabled={busy}
                        placeholder={placeholder}
                        onInput={(e) =>
                          patchRow(r.key, {
                            confirm: (e.target as HTMLInputElement).value,
                          })}
                      />
                    </label>
                  )}
                  {bad && (
                    <div style="grid-column:1 / -1;color:#a83b3b;font-size:12px">
                      {t.noMatch}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style="margin-top:16px">
        <button type="button" style={btnPrimary} disabled={busy} onClick={save}>
          {busy ? t.saving : t.savePayments}
        </button>
      </div>
    </EditPanel>
  );
}

/** DangerZoneCard — irreversible account wipe. Type-to-confirm gate, then a
 *  single destructive button hits GET /me/wipe and bounces to the login page
 *  (the wipe drops every session, so the app is logged out anyway). */
function DangerZoneCard(_props: { snapshot: ProfileSnapshot }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = tr(langSignal.value === "es");
  const armed = confirm.trim().toUpperCase() === "DELETE";

  async function wipe() {
    if (!armed) return;
    setBusy(true);
    setErr(null);
    try {
      await profileClient.wipeAccount();
      // Account + all sessions are gone — hard-redirect out of the app.
      globalThis.location.href = "/login";
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.wipeFailed);
      setBusy(false);
    }
  }

  return (
    <div
      class="panel"
      style="padding:18px 20px;border:1px solid #e3b4b4;background:#fdf6f6"
    >
      <div class="panel__head" style="margin-bottom:12px">
        <h3 class="panel__title" style="color:#a83b3b">{t.dangerZone}</h3>
      </div>
      <p style="margin:0 0 14px;font-size:13px;color:var(--fg-muted,#6b7560)">
        {t.wipeIntro}
      </p>
      <label style="display:block;max-width:320px">
        <span style={labelStyle}>{t.wipeConfirmLabel}</span>
        <input
          type="text"
          style={inputStyle}
          value={confirm}
          disabled={busy}
          placeholder="DELETE"
          aria-label={t.ariaWipeConfirm}
          onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
        />
      </label>
      <div style="margin-top:16px">
        <button
          type="button"
          disabled={!armed || busy}
          onClick={wipe}
          style={`padding:9px 16px;border-radius:8px;border:0;background:${
            armed ? "#a83b3b" : "#d8b4b4"
          };color:#fff;cursor:${
            armed && !busy ? "pointer" : "not-allowed"
          };font:inherit;font-weight:700`}
        >
          {busy ? t.wiping : t.wipeButton}
        </button>
      </div>
      {err
        ? (
          <div style="margin-top:10px;color:#a83b3b;font-size:12.5px">
            {err}
          </div>
        )
        : null}
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
        {tFor("en", "settings.loadError", {
          error: s.error ?? tFor("en", "settings.unknownError"),
        })}
      </div>
    );
  }

  const p = s.profile;
  const lang: Lang = p.user.language === "es" ? "es" : "en";
  const t = tr(p.user.language === "es");
  const onSaved = (next: Partial<ProfileSnapshot>) =>
    setS((cur) =>
      cur.profile ? { ...cur, profile: { ...cur.profile, ...next } } : cur
    );

  return (
    <>
      <section class="hero" style="grid-template-columns:1fr">
        <div class="hero__copy">
          <h1 class="hero__title">
            {p.identity?.businessName ?? p.identity?.displayName ??
              p.user.name ?? tFor(lang, "settings.yourBusiness")}
          </h1>
          <p class="hero__sub">{t.heroSub}</p>
        </div>
      </section>

      <div class="grid">
        <Card
          title={t.account}
          empty={t.nothingSet}
          rows={[
            [t.name, p.user.name],
            [
              t.phone,
              p.user.phoneNumber ? fmtPhone(p.user.phoneNumber) : undefined,
            ],
            [t.email, p.user.email],
            [t.language, p.user.language === "es" ? t.spanish : t.english],
          ]}
        />
        <Card
          title={t.businessIdentity}
          empty={t.nothingSet}
          rows={[
            [
              t.businessName,
              p.identity?.businessName ?? p.identity?.displayName,
            ],
            [t.legalName, p.identity?.legalName],
            [t.license, p.identity?.businessLicense],
          ]}
        />
      </div>

      <EditCard snapshot={p} onSaved={onSaved} />

      <div class="grid">
        <AddressEditCard snapshot={p} onSaved={onSaved} />
        <InsuranceEditCard snapshot={p} onSaved={onSaved} />
      </div>

      <div class="grid">
        <TaxEditCard snapshot={p} onSaved={onSaved} />
        <Card
          title={t.contractDefaults}
          empty={t.nothingSet}
          rows={[
            [
              t.paymentTerms,
              p.contractDefaults?.paymentTermsDays != null
                ? tFor(lang, "settings.contractDefaults.net", {
                  n: p.contractDefaults.paymentTermsDays,
                })
                : null,
            ],
            [
              t.deposit,
              p.contractDefaults?.depositPct != null
                ? `${p.contractDefaults.depositPct}%`
                : null,
            ],
            [
              t.warranty,
              p.contractDefaults?.warrantyDays != null
                ? `${p.contractDefaults.warrantyDays} ${t.days}`
                : null,
            ],
          ]}
        />
      </div>

      <PaymentsEditCard snapshot={p} onSaved={onSaved} />

      <DangerZoneCard snapshot={p} />
    </>
  );
}
