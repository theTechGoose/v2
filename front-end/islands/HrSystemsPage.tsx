/**
 * REQ-888 — /hr/systems: the connected systems (each with its webhook URL — set, it is called
 * on provisioning and offboarding; blank, the account is a manual step on the hire), Connect /
 * Disconnect / Remove, the catalog to attach from, and a custom system. Data: /hr/systems.
 * Strings: hr.systems.*.
 */
import { useEffect, useState } from "preact/hooks";
import {
  type CatalogEntry,
  hrClient,
  type HrSystem,
  type SystemKind,
} from "../clients/hr.ts";
import FieldHead from "../components/FieldHead.tsx";
import { friendlyHr, Toast, useToast } from "../components/hr/bits.tsx";
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

export default function HrSystemsPage() {
  const [systems, setSystems] = useState<HrSystem[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState({
    name: "",
    kind: "other" as SystemKind,
    desc: "",
  });
  const [toast, say] = useToast();

  async function load() {
    const r = await hrClient.systems();
    setSystems(r.systems);
    setCatalog(r.catalog);
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

  const attachedKeys = new Set((systems ?? []).map((s) => s.key));
  const available = catalog.filter((c) => !attachedKeys.has(c.key));

  return (
    <>
      <FieldHead
        eyebrow={t("hr.systems.eyebrow")}
        title={t("hr.systems.title")}
        sub={t("hr.systems.sub")}
      />
      {err && <p class="alert" data-cy="hr-sys-err">{err}</p>}
      <section class="panel">
        <h2 class="panel__title">{t("hr.systems.connected")}</h2>
        {systems && systems.length === 0 && (
          <p class="hr-empty" data-cy="hr-sys-empty">{t("hr.systems.empty")}</p>
        )}
        <div class="hr-sys-grid" data-cy="hr-sys-grid">
          {(systems ?? []).map((s) => (
            <SystemCard key={s.id} s={s} busy={busy} run={run} />
          ))}
        </div>
      </section>
      <section class="panel">
        <h2 class="panel__title">{t("hr.systems.catalog")}</h2>
        <div class="hr-sys-grid" data-cy="hr-catalog">
          {available.map((c) => (
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

function SystemCard(
  { s, busy, run }: {
    s: HrSystem;
    busy: boolean;
    run: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
  },
) {
  const [url, setUrl] = useState(s.webhookUrl ?? "");
  const connected = s.status === "connected";
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
      <label class="hint">{t("hr.systems.webhook")}</label>
      <input
        placeholder="https://…"
        value={url}
        data-cy="hr-sys-webhook"
        onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
        onBlur={() => {
          if ((s.webhookUrl ?? "") !== url.trim()) {
            run(
              () =>
                hrClient.saveSystem(s.id, { webhookUrl: url.trim() || null }),
              t("hr.common.saved"),
            );
          }
        }}
      />
      <span class="hint">{t("hr.systems.webhookHint")}</span>
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
