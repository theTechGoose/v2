/**
 * REQ-889a — /hr/settings: company name, HR email, link expiry, the signing domain (fixed
 * infrastructure, shown not edited), the four automation toggles (auto-send, 24 h reminder,
 * notify HR on complete, auto-provision), the default credentials shown in documents that ask
 * for them. Data: GET/PUT /hr/settings. Strings: hr.settings.*.
 */
import { useEffect, useState } from "preact/hooks";
import { hrClient, type HrSettings } from "../clients/hr.ts";
import FieldHead from "../components/FieldHead.tsx";
import { friendlyHr, Toast, useToast } from "../components/hr/bits.tsx";
import { I, ICN } from "../lib/dash-icons.tsx";
import { t } from "../lib/i18n.ts";

const TOGGLES: (keyof HrSettings)[] = [
  "autoSend",
  "remind24h",
  "notifyOnComplete",
  "autoProvision",
];

export default function HrSettingsPage() {
  const [s, setS] = useState<HrSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, say] = useToast();

  useEffect(() => {
    hrClient.settings().then(setS).catch(() => setErr(t("hr.common.error")));
  }, []);

  if (!s) return <p class="hint">{err ?? t("hr.common.loading")}</p>;
  const set = (patch: Partial<HrSettings>) => setS({ ...s, ...patch });

  async function save(e: Event) {
    e.preventDefault();
    if (!s) return;
    setBusy(true);
    setErr(null);
    try {
      setS(
        await hrClient.saveSettings({
          companyName: s.companyName,
          hrEmail: s.hrEmail,
          linkExpiryDays: s.linkExpiryDays,
          autoSend: s.autoSend,
          autoProvision: s.autoProvision,
          remind24h: s.remind24h,
          notifyOnComplete: s.notifyOnComplete,
          credsUsername: s.credsUsername,
          credsPassword: s.credsPassword,
        }),
      );
      say(t("hr.settings.saved"));
    } catch (e2) {
      setErr(friendlyHr(e2, "hr.settings"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} data-cy="hr-settings">
      <FieldHead
        eyebrow={t("hr.settings.eyebrow")}
        title={t("hr.settings.title")}
        sub={t("hr.settings.sub")}
      >
        <button
          type="submit"
          class="btn btn--green"
          disabled={busy}
          data-cy="hr-settings-save"
        >
          <I d={ICN.check} size={14} /> {t("hr.settings.save")}
        </button>
      </FieldHead>
      {err && <p class="alert" data-cy="hr-settings-err">{err}</p>}
      <section class="panel">
        <div class="row">
          <label class="field">
            <span>{t("hr.settings.company")}</span>
            <input
              value={s.companyName}
              data-cy="hr-set-company"
              onInput={(e) =>
                set({ companyName: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span>{t("hr.settings.hrEmail")}</span>
            <input
              type="email"
              value={s.hrEmail}
              data-cy="hr-set-email"
              onInput={(e) =>
                set({ hrEmail: (e.target as HTMLInputElement).value })}
            />
          </label>
        </div>
        <div class="row">
          <label class="field">
            <span>{t("hr.settings.expiry")}</span>
            <select
              value={String(s.linkExpiryDays)}
              data-cy="hr-set-expiry"
              onChange={(e) =>
                set({
                  linkExpiryDays: Number((e.target as HTMLSelectElement).value),
                })}
            >
              {[3, 7, 14, 30].map((n) => (
                <option value={String(n)} key={n}>
                  {t("hr.settings.days", { n })}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>{t("hr.settings.signingDomain")}</span>
            <input value={s.signingDomain} readOnly data-cy="hr-set-domain" />
            <span class="hint">
              {t("hr.settings.signingDomainHint", { domain: s.signingDomain })}
            </span>
          </label>
        </div>
      </section>
      <section class="panel">
        <h2 class="panel__title">{t("hr.settings.automation")}</h2>
        <div class="hr-toggles">
          {TOGGLES.map((k) => (
            <label class="hr-toggle" key={k}>
              <input
                type="checkbox"
                checked={!!s[k]}
                data-cy={`hr-set-${k}`}
                onChange={(e) =>
                  set(
                    { [k]: (e.target as HTMLInputElement).checked } as Partial<
                      HrSettings
                    >,
                  )}
              />
              <span class="hr-toggle__text">
                <span class="hr-toggle__label">{t(`hr.settings.${k}`)}</span>
                <span class="hr-toggle__hint">
                  {t(`hr.settings.${k}.hint`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>
      <section class="panel">
        <h2 class="panel__title">{t("hr.settings.creds")}</h2>
        <p class="hint" style="margin:0 0 10px">{t("hr.settings.credsHint")}</p>
        <div class="row">
          <label class="field">
            <span>{t("hr.settings.credsUsername")}</span>
            <input
              value={s.credsUsername}
              data-cy="hr-set-user"
              onInput={(e) =>
                set({ credsUsername: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span>{t("hr.settings.credsPassword")}</span>
            <input
              value={s.credsPassword}
              data-cy="hr-set-pass"
              onInput={(e) =>
                set({ credsPassword: (e.target as HTMLInputElement).value })}
            />
          </label>
        </div>
      </section>
      <Toast msg={toast} />
    </form>
  );
}
