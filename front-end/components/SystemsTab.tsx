/**
 * REQ-912 — Settings → Systems: the one place that lists what DocuMonster runs on for this
 * account — email (Postmark), the phone line (REQ-903/904), card payments (Stripe / Square, as
 * Billing has them), e-signature (DocuMonster's own, always on) — and the HR provisioning
 * registry (REQ-888, REQ-913) that used to be /hr/systems: Connect / Disconnect / webhook /
 * Remove, the catalog, a custom system. Data: GET /me/systems; writes go through hrClient.
 * Strings: settings.systems.* and the hr.systems.* it inherited.
 */
import { useEffect, useState } from "preact/hooks";
import {
  type CatalogEntry,
  hrClient,
  type HrSystem,
  type SystemKind,
} from "../clients/hr.ts";
import {
  isBuiltin,
  systemsClient,
  type SystemsSummary,
} from "../clients/systems.ts";
import { friendlyHr, Toast, useToast } from "./hr/bits.tsx";
import { I, ICN } from "../lib/dash-icons.tsx";
import { t } from "../lib/i18n.ts";

const KINDS: SystemKind[] = [
  "crm",
  "dialer",
  "email",
  "payroll",
  "esign",
  "comms",
  "sso",
  "other",
];

export default function SystemsTab() {
  const [sum, setSum] = useState<SystemsSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState({
    name: "",
    kind: "other" as SystemKind,
    desc: "",
  });
  const [toast, say] = useToast();

  async function load() {
    setSum(await systemsClient.summary());
  }
  useEffect(() => {
    load().catch(() => setErr(t("hr.common.error")));
  }, []);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
      if (done) say(done);
    } catch (e) {
      setErr(friendlyHr(e, "hr.systems"));
    } finally {
      setBusy(false);
    }
  }

  const systems: HrSystem[] = sum?.hr.systems ?? [];
  const catalog: CatalogEntry[] = sum?.hr.catalog ?? [];
  const line = sum?.line;

  return (
    <>
      {err && <p class="alert" data-cy="hr-sys-err">{err}</p>}
      <section class="panel" data-cy="sys-summary">
        <h2 class="panel__title">{t("settings.systems.title")}</h2>
        <p class="hint">{t("settings.systems.sub")}</p>
        <div class="hr-sys-grid">
          <SummaryCard
            cy="sys-email"
            name={t("settings.systems.email")}
            kind={t("hr.systems.kind.email")}
            desc={sum ? sum.email.from : ""}
            on={Boolean(sum?.email.configured)}
            onLabel={sum?.email.configured
              ? t("settings.systems.connected")
              : t("settings.systems.emailDev")}
          />
          <SummaryCard
            cy="sys-line"
            name={t("settings.systems.line")}
            kind={t("hr.systems.kind.comms")}
            desc={line && line.status !== "none"
              ? line.number
              : t("settings.systems.lineNone")}
            on={line?.status === "active"}
            onLabel={line?.status === "active"
              ? t("settings.systems.connected")
              : line?.status === "released"
              ? t("settings.systems.lineReleased")
              : t("settings.systems.notConnected")}
            action={{
              href: "/communications",
              label: line?.status === "active"
                ? t("settings.systems.lineOpen")
                : t("settings.systems.lineGet"),
            }}
          />
          <SummaryCard
            cy="sys-payments"
            name={t("settings.systems.payments")}
            kind={t("settings.systems.paymentsKind")}
            desc={sum?.payments.stripe.connected
              ? "Stripe"
              : sum?.payments.square.connected
              ? "Square"
              : t("settings.systems.paymentsNone")}
            on={Boolean(
              sum?.payments.stripe.connected || sum?.payments.square.connected,
            )}
            onLabel={sum?.payments.stripe.connected ||
                sum?.payments.square.connected
              ? t("settings.systems.connected")
              : t("settings.systems.notConnected")}
            action={{
              href: "/settings?tab=billing#payments",
              label: t("settings.systems.manage"),
            }}
          />
          <SummaryCard
            cy="sys-esign"
            name={t("settings.systems.esign")}
            kind={t("hr.systems.kind.esign")}
            desc={t("settings.systems.esignDesc")}
            on
            onLabel={t("settings.systems.esignOn")}
          />
        </div>
      </section>

      <section class="panel" data-cy="sys-hr">
        <h2 class="panel__title">{t("settings.systems.hr")}</h2>
        <p class="hint">{t("settings.systems.hrSub")}</p>
        {sum && systems.length === 0 && (
          <p class="hr-empty" data-cy="hr-sys-empty">{t("hr.systems.empty")}</p>
        )}
        <div class="hr-sys-grid" data-cy="hr-sys-grid">
          {systems.map((s) => (
            <SystemCard key={s.id} s={s} busy={busy} run={run} />
          ))}
        </div>
        <h3 class="panel__title" style="margin-top:18px">
          {t("hr.systems.catalog")}
        </h3>
        <div class="hr-sys-grid" data-cy="hr-catalog">
          {catalog.map((c) => (
            <div
              class="hr-sys"
              key={c.key}
              data-cy="hr-catalog-card"
              data-key={c.key}
            >
              <div class="hr-sys__head">
                <span class="hr-sys__icon">
                  <I d={ICN.plug} size={14} />
                </span>
                <div>
                  <div class="hr-sys__name">{c.name}</div>
                  <div class="hr-sys__kind">
                    {t(`hr.systems.kind.${c.kind}`)}
                  </div>
                </div>
              </div>
              <div class="hr-sys__desc">{c.desc}</div>
              <div class="hr-sys__foot">
                <span class="chip chip--muted">
                  {t("settings.systems.builtin")}
                </span>
                <button
                  type="button"
                  class="btn btn--teal btn--sm"
                  data-cy="hr-attach"
                  disabled={busy}
                  onClick={() =>
                    run(() => hrClient.attachSystem({ key: c.key }))}
                >
                  <I d={ICN.plus} size={14} /> {t("hr.systems.attach")}
                </button>
              </div>
            </div>
          ))}
          <form
            class="hr-sys"
            data-cy="hr-custom"
            onSubmit={(e) => {
              e.preventDefault();
              if (!custom.name.trim()) return;
              run(() =>
                hrClient.attachSystem({
                  name: custom.name.trim(),
                  kind: custom.kind,
                  desc: custom.desc.trim(),
                })
              )
                .then(() => setCustom({ name: "", kind: "other", desc: "" }));
            }}
          >
            <div class="hr-sys__name">{t("hr.systems.custom")}</div>
            <div class="hr-sys__desc">{t("settings.systems.customHint")}</div>
            <input
              placeholder={t("hr.systems.custom.name")}
              value={custom.name}
              data-cy="hr-custom-name"
              onInput={(e) =>
                setCustom({
                  ...custom,
                  name: (e.target as HTMLInputElement).value,
                })}
            />
            <select
              value={custom.kind}
              onChange={(e) =>
                setCustom({
                  ...custom,
                  kind: (e.target as HTMLSelectElement).value as SystemKind,
                })}
              style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font:inherit;font-size:12.5px"
            >
              {KINDS.map((k) => (
                <option value={k} key={k}>{t(`hr.systems.kind.${k}`)}</option>
              ))}
            </select>
            <input
              placeholder={t("hr.systems.custom.desc")}
              value={custom.desc}
              onInput={(e) =>
                setCustom({
                  ...custom,
                  desc: (e.target as HTMLInputElement).value,
                })}
            />
            <div class="hr-sys__foot">
              <button
                type="submit"
                class="btn btn--ghost btn--sm"
                disabled={busy || !custom.name.trim()}
                data-cy="hr-custom-add"
              >
                <I d={ICN.plus} size={14} /> {t("hr.systems.attach")}
              </button>
            </div>
          </form>
        </div>
      </section>
      <Toast msg={toast} />
    </>
  );
}

function SummaryCard({ cy, name, kind, desc, on, onLabel, action }: {
  cy: string;
  name: string;
  kind: string;
  desc: string;
  on: boolean;
  onLabel: string;
  action?: { href: string; label: string };
}) {
  return (
    <div class="hr-sys" data-cy={cy} data-on={on ? "1" : "0"}>
      <div class="hr-sys__head">
        <span class="hr-sys__icon">
          <I d={ICN.plug} size={14} />
        </span>
        <div>
          <div class="hr-sys__name">{name}</div>
          <div class="hr-sys__kind">{kind}</div>
        </div>
      </div>
      <div class="hr-sys__desc">{desc}</div>
      <div class="hr-sys__foot">
        <span class={`chip ${on ? "chip--green" : "chip--muted"}`}>
          {onLabel}
        </span>
        {action && (
          <a class="btn btn--ghost btn--sm" href={action.href}>
            {action.label}
          </a>
        )}
      </div>
    </div>
  );
}

function SystemCard(
  { s, busy, run }: {
    s: HrSystem;
    busy: boolean;
    run: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
  },
) {
  const [url, setUrl] = useState(s.webhookUrl ?? "");
  const connected = s.status === "connected";
  const builtin = isBuiltin(s.key);
  return (
    <div
      class="hr-sys"
      data-cy="hr-sys-card"
      data-key={s.key}
      data-status={s.status}
    >
      <div class="hr-sys__head">
        <span class="hr-sys__icon">
          <I d={ICN.plug} size={14} />
        </span>
        <div>
          <div class="hr-sys__name" data-cy="hr-sys-name">{s.name}</div>
          <div class="hr-sys__kind">{t(`hr.systems.kind.${s.kind}`)}</div>
        </div>
      </div>
      {s.desc && <div class="hr-sys__desc">{s.desc}</div>}
      {builtin
        ? (
          <span class="hint" data-cy="hr-sys-builtin">
            {t("settings.systems.builtinHint")}
          </span>
        )
        : (
          <>
            <label class="hint">{t("hr.systems.webhook")}</label>
            <input
              placeholder="https://…"
              value={url}
              data-cy="hr-sys-webhook"
              onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
              onBlur={() => {
                if ((s.webhookUrl ?? "") !== url.trim()) {
                  run(() =>
                    hrClient.saveSystem(s.id, {
                      webhookUrl: url.trim() || null,
                    }), t("hr.common.saved"));
                }
              }}
            />
            <span class="hint">{t("hr.systems.webhookHint")}</span>
          </>
        )}
      <div class="hr-sys__foot">
        <span
          class={`chip ${connected ? "chip--green" : "chip--muted"}`}
          data-cy="hr-sys-status"
        >
          {t(`hr.systems.status.${s.status}`)}
        </span>
        <button
          type="button"
          class={`btn btn--sm ${connected ? "btn--ghost" : "btn--green"}`}
          data-cy="hr-sys-toggle"
          disabled={busy}
          onClick={() =>
            run(() =>
              hrClient.saveSystem(s.id, {
                status: connected ? "available" : "connected",
              })
            )}
        >
          {connected ? t("hr.systems.disconnect") : t("hr.systems.connect")}
        </button>
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          data-cy="hr-sys-detach"
          disabled={busy}
          onClick={() => run(() => hrClient.removeSystem(s.id))}
        >
          <I d={ICN.trash} size={14} /> {t("hr.systems.detach")}
        </button>
      </div>
    </div>
  );
}
