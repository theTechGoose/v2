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
import Backdrop from "../components/Backdrop.tsx";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { adminsClient, isActing } from "../clients/admins.ts";
import {
  type NumberingView,
  profileClient,
  type ProfileSnapshot,
} from "../clients/profile.ts";
import { announceProfile } from "../lib/profile-events.ts";
import { DOC_KINDS, type DocKind } from "../../shared/documents/numbering.ts";
import {
  formOf,
  invalidStartKinds,
  lockedKindsMessage,
  lockNote,
  nextLabel,
  type NumberingForm,
  numberingPatch,
} from "../../shared/documents/numbering-settings.ts";
import {
  PRICING_PLANS,
  type PricingPlan,
  UPGRADE_PLANS,
} from "../../shared/quote-flow/pricing-plans.ts";
import { switchQuote } from "../../shared/quote-flow/plan-switch.ts";
import { accountNetDays } from "../../shared/quote-flow/completion-schedule.ts"; // REQ-411
import {
  insurerError,
  policyNumberError,
} from "../../shared/quote-flow/business-fields.ts"; // REQ-503
import { dollars, PlanCards } from "../components/PlanCards.tsx";
import {
  handoffOf,
  handoffPage,
  pickErrorOf,
  planViewOf,
  type SettingsTab,
  settingsTabOf,
} from "../lib/plan-return.ts";
import { filesClient } from "../clients/files.ts";
import {
  isLogoImageType,
  LOGO_IMAGE_ACCEPT,
} from "../../shared/quote-flow/logo-image.ts"; // REQ-252
import { ApiError } from "../lib/api.ts";
import { fmtPhone } from "../lib/format.ts";
import { TransferAccount } from "../components/TransferAccount.tsx"; // REQ-220
import { type Lang, langSignal, setLang, tFor } from "../lib/i18n.ts";
import { normalizeWebsiteUrl } from "../../shared/quote-flow/format-helpers.ts";
import {
  accountEmailError,
  businessNameError,
} from "../../shared/quote-flow/settings-fields.ts"; // REQ-501
import {
  businessTimezone,
  PICKER_TIMEZONES,
  timezoneLabelKey,
} from "../../shared/quote-flow/business-timezone.ts";
import { sendLanguagesOf } from "../../shared/quote-flow/comms-language.ts";
import { Icon } from "../components/ui/Icon.tsx";
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

/**
 * Map a file-upload failure to a friendly, localized message. The raw error
 * is always logged for debugging, so users never see "POST /files failed:
 * 500". A structured "file_too_large" signal from the backend (413) surfaces
 * the specific too-large copy; everything else falls back to the generic
 * per-card message.
 */
/**
 * PUT JSON with `keepalive` so the instant-save model survives navigation:
 * the /settings header promises "changes save as you go", and a blur/change
 * save fired right before a page switch must still reach the backend.
 */
function putKeepalive(path: string, body: unknown): Promise<Response> {
  return fetch(`/api${path}`, {
    method: "PUT",
    credentials: "include",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function uploadErrorMessage(
  ex: unknown,
  tooLarge: string,
  fallback: string,
): string {
  console.error("file upload failed", ex);
  if (ex instanceof ApiError) {
    const body = ex.body as { code?: unknown } | null;
    if (body && typeof body === "object" && body.code === "file_too_large") {
      return tooLarge;
    }
  }
  return fallback;
}

/** Roadmap p.13: neutral Latin-American Spanish for the Settings UI, keyed
 *  off `langSignal` (REQ-254 — never the fetched `user.language`). One
 *  dictionary so the whole screen flips together (no mixed-language state). */
function tr(es: boolean) {
  const lang: Lang = es ? "es" : "en";
  return {
    heroSub: tFor(lang, "settings.heroSub"),
    saving: tFor(lang, "settings.saving"),
    saved: tFor(lang, "settings.saved"),
    saveFailed: tFor(lang, "settings.saveFailed"),
    logoUploadFailed: tFor(lang, "settings.logoUploadFailed"),
    logoNotImage: tFor(lang, "settings.logoNotImage"),
    uploadFailed: tFor(lang, "settings.uploadFailed"),
    uploadTooLarge: tFor(lang, "settings.uploadTooLarge"),
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
    website: tFor(lang, "settings.website"),
    netDays: tFor(lang, "settings.netDays"),
    netDaysHint: tFor(lang, "settings.netDaysHint"),
    // Address
    saveAddress: tFor(lang, "settings.saveAddress"),
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
    timezone: tFor(lang, "field.settings.timezone"),
    timezoneHint: tFor(lang, "field.settings.timezoneHint"),
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
    // REQ-198/199 — document numbering (the "{number}" / "{kinds}" templates
    // are left raw here and filled by the shared pure helpers)
    numberingTitle: tFor(lang, "settings.numbering.title"),
    numberingIntro: tFor(lang, "settings.numbering.intro"),
    numberingAccount: tFor(lang, "settings.numbering.accountNumber"),
    numberingAccountHint: tFor(lang, "settings.numbering.accountNumberHint"),
    numberingStart: tFor(lang, "settings.numbering.start"),
    numberingSave: tFor(lang, "settings.numbering.save"),
    numberingNext: tFor(lang, "settings.numbering.next"),
    numberingLockNote: tFor(lang, "settings.numbering.lockNote"),
    numberingLocked: tFor(lang, "settings.numbering.locked"),
    numberingStartInvalid: tFor(lang, "settings.numbering.startInvalid"),
    numberingLoadFailed: tFor(lang, "settings.numbering.loadFailed"),
    numberingKind: Object.fromEntries(
      DOC_KINDS.map((k) => [k, tFor(lang, `settings.numbering.kind.${k}`)]),
    ) as Record<DocKind, string>,
    // REQ-199 — reset test data
    resetButton: tFor(lang, "settings.reset.button"),
    resetTitle: tFor(lang, "settings.reset.title"),
    resetIntro: tFor(lang, "settings.reset.intro"),
    resetModalBody: tFor(lang, "settings.reset.modalBody"),
    resetConfirmLabel: tFor(lang, "settings.reset.confirmLabel"),
    resetConfirm: tFor(lang, "settings.reset.confirm"),
    resetCancel: tFor(lang, "settings.reset.cancel"),
    resetWorking: tFor(lang, "settings.reset.working"),
    resetDone: tFor(lang, "settings.reset.done"),
    resetFailed: tFor(lang, "settings.reset.failed"),
    // Aria labels
    ariaEditName: tFor(lang, "settings.aria.editName"),
    ariaEditEmail: tFor(lang, "settings.aria.editEmail"),
    ariaEditBusinessName: tFor(lang, "settings.aria.editBusinessName"),
    ariaEditWebsite: tFor(lang, "settings.aria.editWebsite"),
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
    // REQ-220: a value may be a node (the phone and its "Transfer account" button)
    rows: Array<[string, ComponentChildren | undefined | null]>;
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

/** Small shell for an editable card: title, optional status line, error.
 *  `dataCy` stamps the Cypress contract selector on the card root. */
function EditPanel(
  {
    title,
    children,
    busy,
    err,
    saved,
    saving = tFor("en", "settings.saving"),
    savedLabel = tFor("en", "settings.saved"),
    dataCy,
  }: {
    title: string;
    children: ComponentChildren;
    busy?: boolean;
    err?: string | null;
    saved?: boolean;
    saving?: string;
    savedLabel?: string;
    dataCy?: string;
  },
) {
  return (
    <div class="panel" style="padding:18px 20px" data-cy={dataCy}>
      <div
        class="panel__head"
        style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px"
      >
        <h3 class="panel__title">{title}</h3>
        {busy
          ? <span style="font-size:11.5px;color:var(--fg-muted)">{saving}</span>
          : saved
          ? (
            <span style="font-size:11.5px;color:var(--brand-green,#519843);display:inline-flex;align-items:center;gap:4px">
              {savedLabel}
              <Icon name="check" size={12} stroke-width={3} />
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
  // REQ-038 (NW-06b): the business website — surfaces on every From block.
  const [site, setSite] = useState(snapshot.identity?.websiteUrl ?? "");
  // REQ-174: the default days a customer has to pay an invoice
  const [netDays, setNetDays] = useState(
    String(accountNetDays(snapshot.identity?.invoiceNetDays)),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // REQ-501 (demo M35): a bad email / an emptied business name is shown under its field and NOT
  // saved — the stored value stays (the keys come from shared/quote-flow/settings-fields.ts)
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [bizErr, setBizErr] = useState<string | null>(null);
  // REQ-511 (demo m41): the logo's own error, drawn in the logo row — not at
  // the bottom of the card, under the languages and off-screen
  const [logoErr, setLogoErr] = useState<string | null>(null);
  // REQ-511 (demo p8-pair6-d): "Saved ✓" after a save, cleared on the next edit
  const [saved, setSaved] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const t = tr(langSignal.value === "es");
  const fieldLang: Lang = langSignal.value === "es" ? "es" : "en";
  /** REQ-172/255 — the zone picked, else the address's state's, else New York */
  const zone = businessTimezone({
    timezone: snapshot.identity?.timezone,
    state: snapshot.address?.state,
  });

  async function saveUser(patch: Record<string, unknown>) {
    setBusy("user");
    setErr(null);
    setSaved(false);
    try {
      const u = await profileClient.updateUser(patch);
      onSaved({ user: { ...snapshot.user, ...u } as typeof snapshot.user });
      setSaved(true);
      // REQ-355 — the topbar greets the new name at once, not after a reload
      if ("name" in patch) {
        announceProfile({ name: u?.name ?? String(patch.name ?? "") });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.saveFailed);
    } finally {
      setBusy(null);
    }
  }
  async function saveIdentity(patch: Record<string, unknown>) {
    setBusy("identity");
    setErr(null);
    setSaved(false);
    try {
      const id = await profileClient.updateIdentity(patch);
      onSaved({
        identity: {
          ...(snapshot.identity ?? {} as never),
          ...id,
        } as typeof snapshot.identity,
      });
      setSaved(true);
    } catch (e) {
      // REQ-252: the server refuses a logo that is not an image (422 logo_not_image)
      if (e instanceof ApiError && e.status === 422 && "logoFileId" in patch) {
        setLogoErr(t.logoNotImage);
      } else setErr(e instanceof Error ? e.message : t.saveFailed);
    } finally {
      setBusy(null);
    }
  }
  async function onLogoPick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setSaved(false);
    // REQ-252 (M30): only an image is a logo — refused here, before any upload
    if (!isLogoImageType(file.type)) {
      (e.target as HTMLInputElement).value = "";
      setLogoErr(t.logoNotImage);
      return;
    }
    setBusy("logo");
    setLogoErr(null);
    try {
      const rec = await filesClient.uploadBlob(file, file.name);
      await saveIdentity({ logoFileId: rec.id });
    } catch (ex) {
      setLogoErr(
        uploadErrorMessage(ex, t.uploadTooLarge, t.logoUploadFailed),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <EditPanel
      title={t.editDetails}
      busy={!!busy}
      err={err}
      saved={saved}
      saving={t.saving}
      savedLabel={t.saved}
      dataCy="settings-edit-details"
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
            onInput={(e) => {
              setSaved(false);
              setName((e.target as HTMLInputElement).value);
            }}
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
            data-cy="settings-email"
            value={email}
            disabled={busy === "user"}
            aria-invalid={emailErr ? "true" : undefined}
            onInput={(e) => {
              setSaved(false);
              setEmail((e.target as HTMLInputElement).value);
              setEmailErr(null);
            }}
            onBlur={() => {
              const key = accountEmailError(email);
              setEmailErr(key);
              if (key) return;
              if (email.trim() !== (snapshot.user.email ?? "")) {
                saveUser({ email: email.trim() });
              }
            }}
            aria-label={t.ariaEditEmail}
          />
          {emailErr
            ? (
              <span
                role="alert"
                data-cy="settings-email-error"
                style="display:block;margin-top:4px;font-size:12px;color:#a83b3b"
              >
                {tFor(fieldLang, emailErr)}
              </span>
            )
            : null}
        </label>
        <label style="display:block;grid-column:1 / -1">
          <span style={labelStyle}>{t.businessName}</span>
          <input
            type="text"
            class="settings-edit__input"
            style={inputStyle}
            data-cy="settings-biz"
            value={biz}
            disabled={busy === "identity"}
            aria-invalid={bizErr ? "true" : undefined}
            onInput={(e) => {
              setSaved(false);
              setBiz((e.target as HTMLInputElement).value);
              setBizErr(null);
            }}
            onBlur={() => {
              const key = businessNameError(
                biz,
                snapshot.identity?.businessName,
              );
              setBizErr(key);
              if (key) return;
              if (biz.trim() !== (snapshot.identity?.businessName ?? "")) {
                saveIdentity({ businessName: biz.trim() });
              }
            }}
            aria-label={t.ariaEditBusinessName}
          />
          {bizErr
            ? (
              <span
                role="alert"
                data-cy="settings-biz-error"
                style="display:block;margin-top:4px;font-size:12px;color:#a83b3b"
              >
                {tFor(fieldLang, bizErr)}
              </span>
            )
            : null}
        </label>
        <label style="display:block;grid-column:1 / -1">
          <span style={labelStyle}>{t.website}</span>
          <input
            type="url"
            class="settings-edit__input"
            style={inputStyle}
            data-cy="settings-website"
            value={site}
            placeholder="https://"
            disabled={busy === "identity"}
            onInput={(e) => {
              setSaved(false);
              setSite((e.target as HTMLInputElement).value);
            }}
            onBlur={() => {
              const next = normalizeWebsiteUrl(site);
              if (next !== site) setSite(next);
              if (next !== (snapshot.identity?.websiteUrl ?? "")) {
                saveIdentity({ websiteUrl: next });
              }
            }}
            aria-label={t.ariaEditWebsite}
          />
        </label>
        <label style="display:block;grid-column:1 / -1">
          <span style={labelStyle}>{t.netDays}</span>
          <input
            type="number"
            min="0"
            max="365"
            step="1"
            class="settings-edit__input"
            style={inputStyle}
            data-cy="settings-net-days"
            value={netDays}
            disabled={busy === "identity"}
            onInput={(e) => {
              setSaved(false);
              setNetDays((e.target as HTMLInputElement).value);
            }}
            onBlur={() => {
              const n = Number(netDays);
              if (!Number.isInteger(n) || n < 0 || n > 365) {
                setNetDays(
                  String(accountNetDays(snapshot.identity?.invoiceNetDays)),
                );
                return;
              }
              if (n !== accountNetDays(snapshot.identity?.invoiceNetDays)) {
                saveIdentity({ invoiceNetDays: n });
              }
            }}
            aria-label={t.netDays}
          />
          <span style="display:block;margin-top:4px;font-size:12px;color:var(--fg-muted,#6b7560)">
            {t.netDaysHint}
          </span>
        </label>
        <div style="grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:center;gap:12px">
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
            accept={LOGO_IMAGE_ACCEPT}
            data-cy="settings-logo-file"
            aria-label={t.ariaLogoFile}
            style="display:none"
            onChange={onLogoPick}
          />
          {snapshot.identity?.logoFileId
            ? (
              <span style="display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--fg-muted)">
                {/* REQ-252: the logo itself, so a broken one is seen here first */}
                <img
                  data-cy="settings-logo-preview"
                  src={`/api/files/${snapshot.identity.logoFileId}`}
                  alt={t.logoSet}
                  style="max-height:32px;max-width:96px;object-fit:contain;border-radius:4px"
                />
                {t.logoSet}
              </span>
            )
            : null}
          {/* REQ-511 (demo m41): the types + size limit, on Upload and on Replace */}
          <span
            data-cy="settings-logo-hint"
            style="font-size:12px;color:var(--fg-muted)"
          >
            {t.logoHint}
          </span>
        </div>
        {logoErr
          ? (
            <div
              data-cy="settings-logo-error"
              role="alert"
              style="grid-column:1 / -1;margin-top:-6px;color:#a83b3b;font-size:12.5px"
            >
              {logoErr}
            </div>
          )
          : null}
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
                // REQ-348: the one rule — the explicit list, else the legacy
                // single commsLanguage, else the default from the account's
                // own language (a Spanish signup sends in English and Spanish).
                const selected: string[] = sendLanguagesOf(
                  snapshot.identity,
                  snapshot.user.language,
                );
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
        {/* REQ-172/255 — the business's time zone (picked, else the address's state's): the 9 am schedule texts follow it */}
        <label style="display:block;grid-column:1 / -1">
          <span style={labelStyle}>{t.timezone}</span>
          <select
            data-cy="settings-timezone"
            style={inputStyle}
            value={zone}
            disabled={busy === "identity"}
            onChange={(e) => saveIdentity({
              timezone: (e.target as HTMLSelectElement).value,
            })}
          >
            {(PICKER_TIMEZONES.includes(zone)
              ? PICKER_TIMEZONES
              : [zone, ...PICKER_TIMEZONES]).map((z) => (
                <option key={z} value={z}>
                  {timezoneLabel(langSignal.value === "es" ? "es" : "en", z)}
                </option>
              ))}
          </select>
          <span style="display:block;margin-top:4px;font-size:12px;color:var(--fg-muted)">
            {t.timezoneHint}
          </span>
        </label>
      </div>
    </EditPanel>
  );
}

/** REQ-346 — a zone's label in the UI language ("Eastern (New York)"); a
 *  zone with no label (one kept from an older pick) shows its IANA id */
function timezoneLabel(lang: Lang, id: string): string {
  const key = timezoneLabelKey(id);
  const label = tFor(lang, key);
  return label === key ? id : label;
}

/** AddressEditCard — editable mailing address (roadmap p.8). P-42: honors
 *  the page's "changes save as you go" promise — every edit autosaves
 *  (debounced on input, flushed on blur and on page-hide via keepalive), so
 *  persistence never depends on the explicit Save button (kept as a
 *  reassurance affordance). Contract: [data-cy=settings-mailing-address];
 *  input order is part of it: street first, city second, then
 *  state/zip/country. */
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

  // Latest field values + dirty flag, readable from timers/unload handlers.
  const pendingRef = useRef<Record<string, string> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function payload(patch: Partial<Record<string, string>> = {}) {
    return {
      street: (patch.street ?? street).trim(),
      city: (patch.city ?? city).trim(),
      state: (patch.state ?? stateV).trim(),
      postal: (patch.postal ?? postal).trim(),
      country: (patch.country ?? country).trim(),
    };
  }

  /** Debounced instant-save: keepalive PUT so a save racing a navigation
   *  still lands. Inputs are never disabled by it — typing wins. */
  function queueAutosave(next: Record<string, string>) {
    pendingRef.current = next;
    setSaved(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushAutosave(), 350);
  }
  function flushAutosave() {
    const body = pendingRef.current;
    if (!body) return;
    pendingRef.current = null;
    clearTimeout(timerRef.current);
    setBusy(true);
    setErr(null);
    putKeepalive("/profile/address", body)
      .then(async (r) => {
        if (!r.ok) throw new Error(t.saveFailed);
        const next = await r.json().catch(() => null);
        if (next) onSaved({ address: next });
        setSaved(true);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : t.saveFailed))
      .finally(() => setBusy(false));
  }
  useEffect(() => {
    // Page unloading (navigation away) — fire any pending save NOW; the
    // keepalive fetch outlives the document.
    const onHide = () => {
      const body = pendingRef.current;
      if (!body) return;
      pendingRef.current = null;
      putKeepalive("/profile/address", body).catch(() => {/* best-effort */});
    };
    addEventListener("pagehide", onHide);
    return () => {
      removeEventListener("pagehide", onHide);
      onHide();
    };
  }, []);

  async function save() {
    pendingRef.current = null;
    clearTimeout(timerRef.current);
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const next = await profileClient.updateAddress(payload());
      onSaved({ address: next });
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditPanel
      title={t.mailingAddress}
      busy={busy}
      err={err}
      saved={saved}
      saving={t.saving}
      savedLabel={t.saved}
      dataCy="settings-mailing-address"
    >
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        <label style="display:block;grid-column:1 / -1">
          <span style={labelStyle}>{t.street}</span>
          <input
            type="text"
            style={inputStyle}
            value={street}
            placeholder={t.phStreet}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              setStreet(v);
              queueAutosave(payload({ street: v }));
            }}
            onBlur={flushAutosave}
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>{t.city}</span>
          <input
            type="text"
            style={inputStyle}
            value={city}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              setCity(v);
              queueAutosave(payload({ city: v }));
            }}
            onBlur={flushAutosave}
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>{t.state}</span>
          <input
            type="text"
            style={inputStyle}
            value={stateV}
            maxLength={2}
            placeholder={t.phState}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value.toUpperCase();
              setStateV(v);
              queueAutosave(payload({ state: v }));
            }}
            onBlur={flushAutosave}
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>{t.zip}</span>
          <input
            type="text"
            style={inputStyle}
            value={postal}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              setPostal(v);
              queueAutosave(payload({ postal: v }));
            }}
            onBlur={flushAutosave}
          />
        </label>
        <label style="display:block">
          <span style={labelStyle}>{t.country}</span>
          <input
            type="text"
            style={inputStyle}
            value={country}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              setCountry(v);
              queueAutosave(payload({ country: v }));
            }}
            onBlur={flushAutosave}
          />
        </label>
      </div>
      <div style="margin-top:16px">
        <button
          type="button"
          style={btnPrimary}
          disabled={busy}
          onClick={save}
        >
          {busy ? t.saving : t.saveAddress}
        </button>
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
  /** Original name of the certificate uploaded THIS session — the backend
   *  insurance record only stores insuranceFileId, so the human-readable
   *  name lives in island state (from the POST /files FileRecord). */
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const t = tr(langSignal.value === "es");

  async function save(patch: Record<string, unknown>): Promise<boolean> {
    setBusy("fields");
    setErr(null);
    setSaved(false);
    try {
      const next = await profileClient.updateInsurance(patch);
      onSaved({ insurance: next });
      setSaved(true);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.saveFailed);
      return false;
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
      if (await save({ insuranceFileId: rec.id })) setFileName(rec.filename);
    } catch (ex) {
      setErr(uploadErrorMessage(ex, t.uploadTooLarge, t.uploadFailed));
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
            onBlur={() => {
              if (provider.trim() === (ins?.provider ?? "")) return;
              // REQ-503 (demo m62): "!!!" is not an insurer
              const bad = insurerError(provider);
              if (bad) return setErr(tFor(langSignal.value, bad));
              save({ provider: provider.trim() });
            }}
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
            onBlur={() => {
              if (policy.trim() === (ins?.policyNumber ?? "")) return;
              // REQ-503 (demo m62): letters, digits and dashes, up to 40
              const bad = policyNumberError(policy);
              if (bad) return setErr(tFor(langSignal.value, bad));
              save({ policyNumber: policy.trim() });
            }}
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
      <div
        data-cy="settings-insurance-upload"
        style="margin-top:14px;display:flex;align-items:center;gap:12px"
      >
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
          {fileName
            ? `${t.certOnFile} · ${fileName}`
            : ins?.insuranceFileId
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
  /** Original name of the W-9 uploaded THIS session — the tax record only
   *  stores w9FileId, so the readable name lives in island state. */
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const t = tr(langSignal.value === "es");

  async function save(patch: Record<string, unknown>): Promise<boolean> {
    setBusy("save");
    setErr(null);
    setSaved(false);
    try {
      const next = await profileClient.updateTax(patch);
      onSaved({ tax: next });
      setSaved(true);
      setTin("");
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.saveFailed);
      return false;
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
      if (await save({ w9FileId: rec.id })) setFileName(rec.filename);
    } catch (ex) {
      setErr(uploadErrorMessage(ex, t.uploadTooLarge, t.uploadFailed));
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
      <div
        data-cy="settings-w9-upload"
        style="margin-top:14px;display:flex;align-items:center;gap:12px"
      >
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
          {fileName
            ? `${t.uploaded} · ${fileName}`
            : tax?.w9UploadedAt
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
  // Latest rows, readable synchronously from blur handlers (P-42 autosave).
  const rowsRef = useRef<Record<string, PayState>>(rows);
  rowsRef.current = rows;

  /** Patch one row; `saveNow` persists the merged state immediately (the
   *  instant-save path for checkbox toggles). */
  function patchRow(key: string, next: Partial<PayState>, saveNow = false) {
    const merged = {
      ...rowsRef.current,
      [key]: { ...rowsRef.current[key], ...next },
    };
    rowsRef.current = merged;
    setSaved(false);
    setRows(merged);
    if (saveNow) autosave(merged);
  }

  const mismatch = (r: PayRow) => {
    const st = rows[r.key];
    return st.enabled && r.field !== null && st.value.trim() !== "" &&
      st.confirm.trim() !== "" && st.value.trim() !== st.confirm.trim();
  };

  /** Build the full acceptedPaymentMethods patch from a rows snapshot,
   *  preserving methods this card doesn't render (e.g. `other`). */
  function buildPatch(
    cur: Record<string, PayState>,
  ): Record<string, Record<string, unknown>> {
    const apmPatch: Record<string, Record<string, unknown>> = {
      ...(apm as Record<string, Record<string, unknown>>),
    };
    for (const r of PAY_ROWS) {
      const st = cur[r.key];
      const entry: Record<string, unknown> = { enabled: st.enabled };
      if (r.field) entry[r.field] = st.value.trim();
      apmPatch[r.key] = entry;
    }
    return apmPatch;
  }

  /** Every enabled required-handle method is complete + confirmed — the gate
   *  for a SILENT instant-save (incomplete rows wait for the explicit Save,
   *  which surfaces the validation copy). */
  function autosaveReady(cur: Record<string, PayState>): boolean {
    return PAY_ROWS.every((r) => {
      const st = cur[r.key];
      if (!st.enabled || r.field === null || r.optional) return true;
      return st.value.trim() !== "" && st.value.trim() === st.confirm.trim();
    });
  }

  /** P-42 instant-save: persist the toggles/handles the moment they change
   *  (keepalive so a save racing a navigation still lands). */
  function autosave(cur: Record<string, PayState>) {
    if (!autosaveReady(cur)) return;
    setErr(null);
    setBusy(true);
    putKeepalive("/profile/identity", {
      acceptedPaymentMethods: buildPatch(cur),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(t.saveFailed);
        const id = await r.json().catch(() => null);
        if (id) {
          onSaved({
            identity: {
              ...(snapshot.identity ?? {} as never),
              ...id,
            } as typeof snapshot.identity,
          });
        }
        setSaved(true);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : t.saveFailed))
      .finally(() => setBusy(false));
  }

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
    try {
      const id = await profileClient.updateIdentity({
        acceptedPaymentMethods: buildPatch(rows),
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
                  onChange={(e) =>
                    // P-42: a toggle IS the edit — persist it instantly.
                    patchRow(r.key, {
                      enabled: (e.target as HTMLInputElement).checked,
                    }, true)}
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
                      placeholder={placeholder}
                      onInput={(e) =>
                        patchRow(r.key, {
                          value: (e.target as HTMLInputElement).value,
                        })}
                      onBlur={() => autosave(rowsRef.current)}
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
                        placeholder={placeholder}
                        onInput={(e) =>
                          patchRow(r.key, {
                            confirm: (e.target as HTMLInputElement).value,
                          })}
                        onBlur={() => autosave(rowsRef.current)}
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

/** ContractDefaultsEditCard — the "Valores del contrato" card, made live
 *  (P-42): three editable fields wired to GET/PUT /profile/contract-defaults
 *  ({ paymentTermsDays, depositPct, warrantyDays }), instant-saved on
 *  change/blur like everything else on this page. */
function ContractDefaultsEditCard(
  { snapshot, onSaved }: {
    snapshot: ProfileSnapshot;
    onSaved: (partial: Partial<ProfileSnapshot>) => void;
  },
) {
  const cd = snapshot.contractDefaults;
  const [terms, setTerms] = useState(
    cd?.paymentTermsDays != null ? String(cd.paymentTermsDays) : "",
  );
  const [deposit, setDeposit] = useState(
    cd?.depositPct != null ? String(cd.depositPct) : "",
  );
  const [warranty, setWarranty] = useState(
    cd?.warrantyDays != null ? String(cd.warrantyDays) : "",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const t = tr(langSignal.value === "es");

  function autosave(
    patch: Partial<Record<"terms" | "deposit" | "warranty", string>> = {},
  ) {
    const num = (raw: string) => {
      const n = Math.round(Number(raw));
      return raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const body = {
      ...(num(patch.terms ?? terms) != null
        ? { paymentTermsDays: num(patch.terms ?? terms) }
        : {}),
      ...(num(patch.deposit ?? deposit) != null
        ? { depositPct: num(patch.deposit ?? deposit) }
        : {}),
      ...(num(patch.warranty ?? warranty) != null
        ? { warrantyDays: num(patch.warranty ?? warranty) }
        : {}),
    };
    if (Object.keys(body).length === 0) return;
    setBusy(true);
    setErr(null);
    putKeepalive("/profile/contract-defaults", body)
      .then(async (r) => {
        if (!r.ok) throw new Error(t.saveFailed);
        const next = await r.json().catch(() => null);
        if (next) onSaved({ contractDefaults: next });
        setSaved(true);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : t.saveFailed))
      .finally(() => setBusy(false));
  }

  const fields: Array<{
    key: "terms" | "deposit" | "warranty";
    label: string;
    suffix: string;
    value: string;
    set: (v: string) => void;
  }> = [
    {
      key: "terms",
      label: t.paymentTerms,
      suffix: t.days,
      value: terms,
      set: setTerms,
    },
    {
      key: "deposit",
      label: t.deposit,
      suffix: "%",
      value: deposit,
      set: setDeposit,
    },
    {
      key: "warranty",
      label: t.warranty,
      suffix: t.days,
      value: warranty,
      set: setWarranty,
    },
  ];

  return (
    <EditPanel
      title={t.contractDefaults}
      busy={busy}
      err={err}
      saved={saved}
      saving={t.saving}
      savedLabel={t.saved}
      dataCy="settings-contract-defaults"
    >
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
        {fields.map((f) => (
          <label key={f.key} style="display:block">
            <span style={labelStyle}>{f.label} ({f.suffix})</span>
            <input
              type="number"
              min="0"
              step="1"
              style={inputStyle}
              value={f.value}
              onInput={(e) => f.set((e.target as HTMLInputElement).value)}
              onBlur={(e) =>
                autosave({ [f.key]: (e.target as HTMLInputElement).value })}
            />
          </label>
        ))}
      </div>
    </EditPanel>
  );
}

/** NumberingCard — REQ-198/199: the account number and, per document kind,
 *  the next number and an editable starting number. Saves only the changed
 *  kinds (PUT /profile/numbering); a kind that already issued a number is
 *  locked (input disabled, lock note) and a 409 `numbering_locked` names the
 *  kinds inline. `refreshKey` bumps after the setup reset so the card refetches. */
function NumberingCard({ refreshKey }: { refreshKey: number }) {
  const [view, setView] = useState<NumberingView | null>(null);
  const [form, setForm] = useState<NumberingForm | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const t = tr(langSignal.value === "es");

  useEffect(() => {
    let alive = true;
    setLoadErr(null);
    setSaved(false);
    profileClient.numbering()
      .then((v) => {
        if (!alive) return;
        setView(v);
        setForm(formOf(v));
      })
      .catch(() => {
        if (alive) setLoadErr(t.numberingLoadFailed);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  async function save() {
    if (!view || !form) return;
    const bad = invalidStartKinds(form);
    if (bad.length) {
      setErr(lockedKindsMessage(bad, t.numberingKind, t.numberingStartInvalid));
      return;
    }
    const patch = numberingPatch(view, form);
    setErr(null);
    if (Object.keys(patch).length === 0) {
      setSaved(true);
      return;
    }
    setBusy(true);
    setSaved(false);
    try {
      const next = await profileClient.updateNumbering(patch);
      setView(next);
      setForm(formOf(next));
      setSaved(true);
    } catch (e) {
      const body = e instanceof ApiError
        ? e.body as { reason?: string; kinds?: string[] } | null
        : null;
      if (
        e instanceof ApiError && e.status === 409 &&
        body?.reason === "numbering_locked"
      ) {
        setErr(
          lockedKindsMessage(
            body.kinds ?? [],
            t.numberingKind,
            t.numberingLocked,
          ),
        );
        // show the locks the server knows about; keep what was typed for the open kinds
        profileClient.numbering().then((v) => {
          setView(v);
          setForm((f) => {
            const fresh = formOf(v);
            if (!f) return fresh;
            for (const kind of DOC_KINDS) {
              if (!v.issued[kind]) fresh[kind] = f[kind];
            }
            return fresh;
          });
        }).catch(() => {/* the inline error already says what happened */});
      } else {
        setErr(e instanceof Error ? e.message : t.saveFailed);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditPanel
      title={t.numberingTitle}
      busy={busy}
      saved={saved}
      saving={t.saving}
      savedLabel={t.saved}
      dataCy="settings-numbering"
    >
      <p style="margin:0 0 14px;font-size:13px;color:var(--fg-muted,#6b7560)">
        {t.numberingIntro}
      </p>
      {loadErr
        ? (
          <div
            style="color:#a83b3b;font-size:12.5px"
            data-cy="settings-numbering-load-error"
          >
            {loadErr}
          </div>
        )
        : null}
      {view && form
        ? (
          <>
            <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px">
              <span style={labelStyle + ";margin:0"}>{t.numberingAccount}</span>
              <strong
                data-cy="settings-numbering-account"
                style="font-size:16px;letter-spacing:.04em;color:var(--fg)"
              >
                {view.accountNumber}
              </strong>
              <span style="font-size:12px;color:var(--fg-muted,#6b7560)">
                {t.numberingAccountHint}
              </span>
            </div>
            <div style="display:grid;gap:10px">
              {DOC_KINDS.map((kind) => {
                const locked = view.issued[kind];
                const note = locked
                  ? lockNote(view, kind, t.numberingLockNote)
                  : "";
                return (
                  <div
                    key={kind}
                    data-cy={`settings-numbering-row-${kind}`}
                    style="display:grid;grid-template-columns:minmax(0,1fr) 160px;gap:6px 16px;align-items:center;padding:10px 12px;border:1px solid var(--border,#d8dcd5);border-radius:10px;background:#fff"
                  >
                    <div style="min-width:0">
                      <div style="font-weight:700;font-size:13.5px;color:var(--fg)">
                        {t.numberingKind[kind]}
                      </div>
                      <div
                        data-cy={`settings-numbering-next-${kind}`}
                        style="font-size:12.5px;color:var(--fg-muted,#6b7560)"
                      >
                        {nextLabel(view, kind, t.numberingNext)}
                      </div>
                      {note
                        ? (
                          <div
                            data-cy={`settings-numbering-lock-${kind}`}
                            style="font-size:12px;color:#8a6d1f;margin-top:2px"
                          >
                            {note}
                          </div>
                        )
                        : null}
                    </div>
                    <label style="display:block">
                      <span style={labelStyle}>{t.numberingStart}</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        data-cy={`settings-numbering-start-${kind}`}
                        aria-label={`${
                          t.numberingKind[kind]
                        } — ${t.numberingStart}`}
                        style={inputStyle +
                          (locked
                            ? ";background:#f3f4f1;color:var(--fg-muted,#6b7560)"
                            : "")}
                        value={form[kind]}
                        disabled={locked || busy}
                        onInput={(e) => {
                          const v = (e.target as HTMLInputElement).value;
                          setForm((f) => f ? { ...f, [kind]: v } : f);
                          setSaved(false);
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
            <div style="margin-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <button
                type="button"
                data-cy="settings-numbering-save"
                disabled={busy}
                onClick={save}
                style={btnPrimary}
              >
                {t.numberingSave}
              </button>
            </div>
          </>
        )
        : null}
      {err
        ? (
          <div
            data-cy="settings-numbering-error"
            style="margin-top:10px;color:#a83b3b;font-size:12.5px"
          >
            {err}
          </div>
        )
        : null}
    </EditPanel>
  );
}

/** DangerZoneCard — irreversible account wipe. Type-to-confirm gate, then a
 *  single destructive button hits GET /me/wipe and bounces to the login page
 *  (the wipe drops every session, so the app is logged out anyway).
 *  REQ-199: also the "Reset test data" action — clears the account's records
 *  and restarts numbering through a confirm modal, keeps the account. */

// REQ-127 — Raphael, 2026-11-02: "rework the pan ui so that its SUPER clean what plan the user is
// on. right now its pretty confusing. how about just a billing tab rather than a slot on the page."
// The plan in one look: its name and price large, ONE status pill, the facts (next bill, card,
// since), the action a pending or past-due plan needs, then the other plans as cards each saying —
// from the one switch rule (shared/quote-flow/plan-switch.ts) — exactly what picking it does.
// REQ-054/055/056/059/061/064/106/119 all live here now: a card is the pick and opens the pay page
// itself; Monster Assist+ is a card here and nowhere else; a pending one offers its page.
const PILL_KEY = {
  free: "billing.pill.free",
  active: "billing.pill.active",
  pending: "billing.pill.pending",
  past_due: "billing.pill.pastDue",
  preparing: "billing.pill.preparing",
  paidOnce: "billing.pill.paidOnce",
} as const;

function BillingTab({ snapshot }: { snapshot: ProfileSnapshot }) {
  const lang: Lang = langSignal.value === "es" ? "es" : "en"; // REQ-254
  const plan = snapshot.plan ?? null;
  // REQ-064 — the hidden test tier has a name and a price too, though it is never a card
  const planById = (id: string) => PRICING_PLANS.find((p) => p.id === id);
  const nameOf = (id: string) => planById(id)?.name ?? id;
  const oneTime = (id: string) => planById(id)?.period === "one-time";
  // REQ-056 — every selectable plan but the current one is a card: Monster Free among them on a
  // paid plan, so going back to free is the same one click as going up. REQ-119 — the upgrade
  // list: onboarding's cards and Monster Assist+, the hidden tier this panel alone offers
  const selectable = UPGRADE_PLANS;
  // REQ-106 — a pick the CRM refused by name is not the plan: the cards offer it again
  const currentId =
    plan && plan.status !== "free" && handoffOf(plan) !== "merchant-unknown"
      ? plan.planId
      : "free";
  const hasEmail = Boolean(snapshot.user.email?.trim());
  // REQ-059 — a pick the backend refused came back here saying why (/plan/pick)
  const [err, setErr] = useState("");
  useEffect(() => {
    const why = pickErrorOf(location.search);
    if (why) {
      setErr(tFor(
        lang,
        why === "email-required"
          ? "plan.emailFirstSettings"
          : why === "merchant-unknown"
          ? "plan.merchantUnknown"
          : "plan.error",
      ));
    }
  }, []);

  const currentName = nameOf(currentId);
  const priceCents = planById(currentId)?.priceCents ?? 0;
  const fmtDate = (iso: string | undefined) =>
    iso
      ? new Date(iso).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
      : "";
  // ONE pill
  const pill: keyof typeof PILL_KEY = !plan || currentId === "free"
    ? "free"
    : plan.status === "active"
    ? (oneTime(plan.planId) ? "paidOnce" : "active") // REQ-064 — no monthly billing behind a one-time charge
    : plan.status === "past_due"
    ? "past_due"
    : handoffOf(plan) === "ready"
    ? "pending"
    : "preparing";
  // REQ-061 — the sentence under it: since when, the next bill; a month the CRM could not collect
  // says so, with the way to pay it (the line the stories read)
  const since = (plan?.activatedAt ?? plan?.updatedAt ?? "").slice(0, 10);
  const status = !plan || plan.status === "free"
    ? tFor(lang, "plan.statusFree")
    : plan.status === "active" && oneTime(plan.planId)
    ? tFor(lang, "plan.paidOnce", { name: currentName, date: since })
    : plan.status === "active"
    ? (plan.nextBillAt
      ? tFor(lang, "plan.activeNext", {
        name: currentName,
        date: since,
        next: plan.nextBillAt.slice(0, 10),
      })
      : tFor(lang, "plan.activeSince", { name: currentName, date: since }))
    : plan.status === "past_due"
    ? tFor(lang, "plan.pastDue", { name: currentName })
    // REQ-106 — a pending pick: refused by name, being prepared, or waiting on its page
    : handoffOf(plan) === "merchant-unknown"
    ? tFor(lang, "plan.merchantUnknown")
    : handoffOf(plan) !== "ready"
    ? tFor(lang, "plan.preparing")
    : tFor(lang, "plan.pending");
  const paidPlan = Boolean(plan) && currentId !== "free";

  // REQ-127 — what picking a card does, from the one rule the backend charges by
  const note = (p: PricingPlan): string | null => {
    const q = switchQuote(
      plan
        ? {
          planId: plan.planId,
          status: plan.status,
          nextBillAt: plan.nextBillAt,
        }
        : null,
      p.id,
      new Date().toISOString(),
    );
    const monthly = dollars(q.monthlyCents);
    if (q.kind === "upgrade") {
      return tFor(lang, "billing.note.upgrade", {
        due: dollars(q.dueCents),
        monthly,
      });
    }
    if (q.kind === "downgrade") {
      return tFor(lang, "billing.note.downgrade", {
        monthly,
        date: fmtDate(q.firstBillAt ?? undefined),
      });
    }
    if (q.kind === "first") {
      return tFor(lang, "billing.note.first", { monthly });
    }
    if (q.kind === "free") {
      if (currentId === "free") return null;
      return plan?.status === "active" || plan?.status === "past_due"
        ? tFor(lang, "billing.note.free")
        : tFor(lang, "billing.note.freeUnpaid");
    }
    return null;
  };

  return (
    <div class="panel billing" style="padding:18px 20px" data-cy="billing">
      <div class="billing__head">
        <div>
          <div class="billing__eyebrow">{tFor(lang, "billing.yourPlan")}</div>
          <div class="billing__name" data-cy="plan-current">{currentName}</div>
          <div class="billing__price" data-cy="plan-price">
            {priceCents > 0
              ? tFor(
                lang,
                oneTime(currentId)
                  ? "billing.oneTimePrice"
                  : "billing.perMonth",
                { price: dollars(priceCents) },
              )
              : tFor(lang, "billing.freePrice")}
          </div>
        </div>
        <span
          class={`billing__pill billing__pill--${pill}`}
          data-cy="plan-pill"
        >
          {tFor(lang, PILL_KEY[pill])}
        </span>
      </div>
      <p class="billing__status" data-cy="plan-status">{status}</p>
      {paidPlan && plan && (plan.nextBillAt || plan.cardLast4 || since)
        ? (
          <dl class="billing__facts">
            {plan.nextBillAt && plan.status === "active"
              ? (
                <div>
                  <dt>{tFor(lang, "billing.nextBill")}</dt>
                  <dd data-cy="plan-next-bill">
                    {fmtDate(plan.nextBillAt)}
                    {/* REQ-129 — what that bill is for: the prorated days to the month's end, or the full month */}
                    {plan.nextBillCents !== undefined
                      ? ` · ${dollars(plan.nextBillCents)}${
                        plan.nextBillCents < priceCents
                          ? ` ${tFor(lang, "billing.prorated")}`
                          : ""
                      }`
                      : ""}
                  </dd>
                </div>
              )
              : null}
            {plan.cardLast4
              ? (
                <div>
                  <dt>{tFor(lang, "billing.cardOnFile")}</dt>
                  <dd data-cy="plan-card-on-file">
                    {plan.cardBrand || "card"} •••• {plan.cardLast4}
                  </dd>
                </div>
              )
              : null}
            {since
              ? (
                <div>
                  <dt>{tFor(lang, "billing.since")}</dt>
                  <dd data-cy="plan-since">
                    {fmtDate(plan.activatedAt ?? plan.updatedAt)}
                  </dd>
                </div>
              )
              : null}
          </dl>
        )
        : null}
      {plan && (plan.status === "past_due" || planViewOf(plan) === "pay")
        ? (
          // REQ-059 — the pay page again, in this tab; the receipt brings the person back here.
          // REQ-061 — the past-due month's page, the same way
          <div class="billing__actions">
            <a
              class="btn btn--accent"
              data-cy="plan-pay-link"
              href={plan.payUrl}
            >
              {tFor(
                lang,
                plan.status === "past_due" ? "plan.payNow" : "plan.resume",
              )} →
            </a>
          </div>
        )
        : planViewOf(plan) === "preparing"
        ? (
          // REQ-106 — the page is being prepared: the hand-off page waits for it
          <div class="billing__actions">
            <a
              class="btn btn--accent"
              data-cy="plan-handoff-link"
              href={handoffPage("/settings")}
            >
              {tFor(lang, "plan.preparingOpen")} →
            </a>
          </div>
        )
        : null}
      {
        /* the other plans are cards — while one is pending too, a change of mind goes to ITS pay page (or stores free).
          REQ-055/059: a card is a form; the pick is a redirect to the pay page, in this tab */
      }
      <h4 class="billing__change">{tFor(lang, "billing.changePlan")}</h4>
      <div style="display:grid;gap:10px">
        <PlanCards
          plans={selectable.filter((p) => p.id !== currentId)}
          lang={lang}
          featuredId="monster"
          disabled={(p) => p.priceCents > 0 && !hasEmail}
          back="/settings"
          note={note}
        />
        {!hasEmail
          ? (
            <span style="color:var(--fg-muted, #6b7560)">
              {tFor(lang, "plan.emailFirstSettings")}
            </span>
          )
          : null}
      </div>
      {err
        ? (
          <div
            role="alert"
            style="color:var(--danger, #b42318); margin-top:10px"
          >
            {err}
          </div>
        )
        : null}
    </div>
  );
}

function DangerZoneCard(
  { onReset }: { snapshot: ProfileSnapshot; onReset: () => void },
) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // REQ-199 — the reset-test-data modal and its outcome
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);
  const t = tr(langSignal.value === "es");
  // P-65: the confirm keyword is the quoted word inside the localized label
  // ('Type "DELETE" to confirm' / 'Escribe "ELIMINAR" para confirmar') — the
  // ES page must never demand the English "DELETE".
  const keyword = (t.wipeConfirmLabel.match(/"([^"]+)"/)?.[1] ?? "DELETE")
    .toUpperCase();
  const armed = confirm.trim().toUpperCase() === keyword;
  const resetKeyword = (t.resetConfirmLabel.match(/"([^"]+)"/)?.[1] ?? "RESET")
    .toUpperCase();
  const resetArmed = resetConfirm.trim().toUpperCase() === resetKeyword;

  function openReset() {
    setResetConfirm("");
    setResetErr(null);
    setResetDone(false);
    setResetOpen(true);
  }

  async function reset() {
    if (!resetArmed || resetBusy) return;
    setResetBusy(true);
    setResetErr(null);
    try {
      await profileClient.setupReset();
      setResetOpen(false);
      setResetDone(true);
      onReset();
    } catch (e) {
      console.error("setup reset failed", e);
      setResetErr(t.resetFailed);
    } finally {
      setResetBusy(false);
    }
  }

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
      {/* REQ-199 — reset test data: records go, the account stays */}
      <div
        data-cy="settings-reset"
        style="margin:0 0 18px;padding:0 0 18px;border-bottom:1px solid #e3b4b4"
      >
        <div style="font-weight:700;font-size:13.5px;color:var(--fg);margin-bottom:4px">
          {t.resetTitle}
        </div>
        <p style="margin:0 0 12px;font-size:13px;color:var(--fg-muted,#6b7560)">
          {t.resetIntro}
        </p>
        <button
          type="button"
          data-cy="settings-reset-open"
          disabled={busy || resetBusy}
          onClick={openReset}
          style="padding:8px 14px;border-radius:8px;border:1px solid #a83b3b;background:#fff;color:#a83b3b;cursor:pointer;font:inherit;font-weight:700"
        >
          {t.resetButton}
        </button>
        {resetDone
          ? (
            <div
              data-cy="settings-reset-done"
              style="margin-top:10px;color:var(--brand-green,#519843);font-size:12.5px;font-weight:600"
            >
              {t.resetDone}
            </div>
          )
          : null}
      </div>
      {resetOpen
        ? (
          <Backdrop
            data-cy="settings-reset-modal"
            style="position:fixed;inset:0;z-index:60;background:rgba(20,72,82,0.35);display:flex;align-items:center;justify-content:center;padding:20px"
            onClose={() => !resetBusy && setResetOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-reset-title"
              style="background:#fff;border-radius:16px;padding:20px 22px;width:min(480px,100%);box-shadow:0 20px 60px rgba(20,72,82,0.25);display:flex;flex-direction:column;gap:12px;text-align:left"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                id="settings-reset-title"
                style="font-size:18px;font-weight:800;color:#a83b3b"
              >
                {t.resetTitle}
              </div>
              <p style="margin:0;font-size:13.5px;color:var(--fg,#144852)">
                {t.resetModalBody}
              </p>
              <label style="display:block">
                <span style={labelStyle}>{t.resetConfirmLabel}</span>
                <input
                  type="text"
                  data-cy="settings-reset-confirm-input"
                  style={inputStyle}
                  value={resetConfirm}
                  disabled={resetBusy}
                  placeholder={resetKeyword}
                  autoComplete="off"
                  onInput={(e) =>
                    setResetConfirm((e.target as HTMLInputElement).value)}
                />
              </label>
              {resetErr
                ? (
                  <div
                    data-cy="settings-reset-error"
                    style="color:#a83b3b;font-size:12.5px"
                  >
                    {resetErr}
                  </div>
                )
                : null}
              <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
                <button
                  type="button"
                  data-cy="settings-reset-cancel"
                  disabled={resetBusy}
                  onClick={() => setResetOpen(false)}
                  style="padding:9px 14px;border-radius:8px;border:0;background:transparent;color:var(--fg-muted,#6b7560);cursor:pointer;font:inherit;font-weight:600"
                >
                  {t.resetCancel}
                </button>
                <button
                  type="button"
                  data-cy="settings-reset-confirm"
                  disabled={!resetArmed || resetBusy}
                  onClick={reset}
                  style={`padding:9px 16px;border-radius:8px;border:0;background:${
                    resetArmed ? "#a83b3b" : "#d8b4b4"
                  };color:#fff;cursor:${
                    resetArmed && !resetBusy ? "pointer" : "not-allowed"
                  };font:inherit;font-weight:700`}
                >
                  {resetBusy ? t.resetWorking : t.resetConfirm}
                </button>
              </div>
            </div>
          </Backdrop>
        )
        : null}
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
          placeholder={keyword}
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
  // REQ-146: an admin acting for the account never sees the danger zone (the
  // server refuses the wipe to them anyway)
  const [acting, setActing] = useState(false);
  // REQ-199: bumped by the setup reset so the numbering card refetches
  const [numberingKey, setNumberingKey] = useState(0);
  useEffect(() => {
    let alive = true;
    adminsClient.accounts().then((v) => {
      if (alive) setActing(isActing(v));
    }).catch(() => {/* unknown → shown; the server still refuses */});
    return () => {
      alive = false;
    };
  }, []);
  // REQ-127 — two tabs: Account (everything below) and Billing (the plan). The address opens the
  // one asked for (?tab=billing; a pick's reason or a receipt's marker open Billing too)
  const [tab, setTab] = useState<SettingsTab>(() =>
    typeof location === "undefined" ? "account" : settingsTabOf(location.search)
  );
  const pickTab = (next: SettingsTab) => {
    setTab(next);
    const u = new URL(location.href);
    if (next === "billing") u.searchParams.set("tab", "billing");
    else u.searchParams.delete("tab");
    u.searchParams.delete("plan");
    history.replaceState(null, "", u.pathname + u.search);
  };

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
        {tFor(langSignal.value, "settings.loadError", {
          error: s.error ?? tFor(langSignal.value, "settings.unknownError"),
        })}
      </div>
    );
  }

  const p = s.profile;
  // REQ-254: the UI language is langSignal — the one switch the topbar EN/ES toggle and the
  // app-language select both flip — never this island's fetched copy of the profile, which a
  // toggle does not update (the top of the page stayed in the old language until a reload)
  const lang: Lang = langSignal.value === "es" ? "es" : "en";
  const t = tr(lang === "es");
  const onSaved = (next: Partial<ProfileSnapshot>) =>
    setS((cur) =>
      cur.profile ? { ...cur, profile: { ...cur.profile, ...next } } : cur
    );

  return (
    <>
      <section class="hero" style="grid-template-columns:1fr">
        <div class="hero__copy">
          <h1 class="hero__title">
            {/* REQ-501 (demo M35): `||` — an empty business name falls through to the next */}
            {p.identity?.businessName || p.identity?.displayName ||
              p.user.name || tFor(lang, "settings.yourBusiness")}
          </h1>
          <p class="hero__sub">{t.heroSub}</p>
        </div>
      </section>

      <nav class="settings-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "account"}
          class={`settings-tab${tab === "account" ? " settings-tab--on" : ""}`}
          data-cy="settings-tab-account"
          onClick={() => pickTab("account")}
        >
          {tFor(lang, "settings.tabAccount")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "billing"}
          class={`settings-tab${tab === "billing" ? " settings-tab--on" : ""}`}
          data-cy="settings-tab-billing"
          onClick={() => pickTab("billing")}
        >
          {tFor(lang, "settings.tabBilling")}
        </button>
      </nav>

      {tab === "billing" ? <BillingTab snapshot={p} /> : (
        <>
          <div class="grid">
            <Card
              title={t.account}
              empty={t.nothingSet}
              rows={[
                [t.name, p.user.name],
                [
                  t.phone,
                  // REQ-220: the phone is the sign-in, so it is not a field — it moves by
                  // "Transfer account" (owner only; an admin acting never sees the button)
                  p.user.phoneNumber
                    ? (
                      <span style="display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap">
                        <span data-cy="settings-phone">
                          {fmtPhone(p.user.phoneNumber)}
                        </span>
                        {!acting && <TransferAccount lang={lang} />}
                      </span>
                    )
                    : undefined,
                ],
                // UX-35: the email lives on ONE surface — the editable form
                // below. Repeating it read-only here competed with the form and
                // clipped long addresses at the card edge.
                [t.language, lang === "es" ? t.spanish : t.english],
              ]}
            />
            <Card
              title={t.businessIdentity}
              empty={t.nothingSet}
              rows={[
                [
                  t.businessName,
                  p.identity?.businessName || p.identity?.displayName,
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
            {
              /* P-42: live editor wired to GET/PUT /profile/contract-defaults —
            the card is no longer a dead read-only panel. */
            }
            <ContractDefaultsEditCard snapshot={p} onSaved={onSaved} />
          </div>

          {/* REQ-198/199: the account number and the starting numbers */}
          <NumberingCard refreshKey={numberingKey} />

          <PaymentsEditCard snapshot={p} onSaved={onSaved} />

          {!acting && (
            <DangerZoneCard
              snapshot={p}
              onReset={() => setNumberingKey((k) => k + 1)}
            />
          )}
        </>
      )}
    </>
  );
}
