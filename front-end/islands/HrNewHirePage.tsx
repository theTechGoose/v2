/**
 * REQ-884a — /hr/hires/new: the intake form. Pick the department and the packet preview (the
 * department's documents, in order) and the accounts to create show up; Create mints the hire,
 * freezes the packet, and — with autoSend on — the link goes out by text and email.
 * Data: /hr/departments, /hr/documents, /hr/systems, POST /hr/hires. Strings: hr.new.*.
 */
import { useEffect, useState } from "preact/hooks";
import {
  type Department,
  hrClient,
  type HrDocument,
  type HrSettings,
  type HrSystem,
} from "../clients/hr.ts";
import FieldHead from "../components/FieldHead.tsx";
import { friendlyHr } from "../components/hr/bits.tsx";
import { I, ICN } from "../lib/dash-icons.tsx";
import { PHONE_PLACEHOLDER } from "../lib/field.ts";
import { t } from "../lib/i18n.ts";

const todayPlusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function HrNewHirePage() {
  const [depts, setDepts] = useState<Department[] | null>(null);
  const [docs, setDocs] = useState<HrDocument[]>([]);
  const [systems, setSystems] = useState<HrSystem[]>([]);
  const [settings, setSettings] = useState<HrSettings | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [deptId, setDeptId] = useState("");
  const [start, setStart] = useState(todayPlusDays(7));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      hrClient.departments(),
      hrClient.documents(),
      hrClient.systems(),
      hrClient.settings(),
    ]).then(([d, docs, s, st]) => {
      setDepts(d);
      setDocs(docs);
      setSystems(s.systems);
      setSettings(st);
      if (d.length === 1) setDeptId(d[0].id);
    }).catch(() => setErr(t("hr.common.error")));
  }, []);

  const dept = depts?.find((d) => d.id === deptId) ?? null;
  const packet = dept
    ? dept.docIds.map((id) => docs.find((x) => x.id === id)).filter(
      (x): x is HrDocument => !!x && !x.discardedAt,
    )
    : [];
  const accounts = dept
    ? dept.systemIds.map((id) => systems.find((x) => x.id === id)).filter(
      (x): x is HrSystem => !!x,
    )
    : [];

  async function submit(e: Event) {
    e.preventDefault();
    setErr(null);
    if (!first.trim()) return setErr(t("hr.new.err.name_required"));
    if (!deptId) return setErr(t("hr.new.err.department_required"));
    if (!phone.trim() && !email.trim()) {
      return setErr(t("hr.new.err.contact_required"));
    }
    setBusy(true);
    try {
      const h = await hrClient.createHire({
        firstName: first.trim(),
        lastName: last.trim(),
        email: email.trim(),
        phone: phone.trim(),
        departmentId: deptId,
        startDate: start,
      });
      location.assign(`/hr/hires/${h.id}`);
    } catch (e2) {
      setErr(friendlyHr(e2, "hr.new"));
      setBusy(false);
    }
  }

  return (
    <>
      <FieldHead
        eyebrow={t("hr.new.eyebrow")}
        title={t("hr.new.title")}
        sub={t("hr.new.sub")}
      >
        <a class="btn btn--ghost btn--sm" href="/hr/hires">
          <I d={ICN.back} size={14} /> {t("hr.common.back")}
        </a>
      </FieldHead>
      {depts && depts.length === 0 && (
        <p class="alert" data-cy="hr-new-nodepts">
          {t("hr.new.noDepts")}{" "}
          <a href="/hr/departments">{t("hr.new.noDeptsLink")}</a>
        </p>
      )}
      <form class="hr-two" onSubmit={submit} data-cy="hr-new-form">
        <section class="panel">
          <div class="row">
            <label class="field">
              <span>{t("hr.new.first")}</span>
              <input
                value={first}
                data-cy="hr-first"
                required
                onInput={(e) => setFirst((e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="field">
              <span>{t("hr.new.last")}</span>
              <input
                value={last}
                data-cy="hr-last"
                onInput={(e) => setLast((e.target as HTMLInputElement).value)}
              />
            </label>
          </div>
          <div class="row">
            <label class="field">
              <span>{t("hr.new.phone")}</span>
              <input
                type="tel"
                value={phone}
                placeholder={PHONE_PLACEHOLDER}
                data-cy="hr-phone"
                onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="field">
              <span>{t("hr.new.email")}</span>
              <input
                type="email"
                value={email}
                data-cy="hr-email"
                onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              />
            </label>
          </div>
          <div class="row">
            <label class="field">
              <span>{t("hr.new.dept")}</span>
              <select
                value={deptId}
                data-cy="hr-dept"
                onChange={(e) =>
                  setDeptId((e.target as HTMLSelectElement).value)}
              >
                <option value="">{t("hr.new.deptPick")}</option>
                {(depts ?? []).map((d) => (
                  <option value={d.id} key={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>{t("hr.new.start")}</span>
              <input
                type="date"
                value={start}
                data-cy="hr-start"
                onInput={(e) => setStart((e.target as HTMLInputElement).value)}
              />
            </label>
          </div>
          {err && <p class="alert" data-cy="hr-new-err">{err}</p>}
          <div class="field-actions" style="margin-top:14px">
            <button
              type="submit"
              class="btn btn--pink"
              disabled={busy || !depts?.length}
              data-cy="hr-create"
            >
              <I d={ICN.send} size={14} /> {settings?.autoSend === false
                ? t("hr.new.createOnly")
                : t("hr.new.create")}
            </button>
          </div>
        </section>
        <section class="panel">
          <h2 class="panel__title">{t("hr.new.packet")}</h2>
          <p class="hint" style="margin:0 0 10px">{t("hr.new.packetHint")}</p>
          {dept && packet.length === 0 && (
            <p class="hint" data-cy="hr-packet-empty">
              {t("hr.new.packetEmpty")}
            </p>
          )}
          <ol class="hr-packet" data-cy="hr-packet">
            {packet.map((d, i) => (
              <li key={d.id} data-cy="hr-packet-doc">
                <span class="hr-packet__n">{i + 1}</span>
                {d.name}
                <span class="chip chip--muted">
                  {t(`hr.detail.kind.${d.kind}`)}
                </span>
              </li>
            ))}
          </ol>
          <h2 class="panel__title" style="margin-top:16px">
            {t("hr.new.systems")}
          </h2>
          {dept && accounts.length === 0 && (
            <p class="hint">{t("hr.new.systemsEmpty")}</p>
          )}
          <ul class="hr-packet" data-cy="hr-accounts">
            {accounts.map((s) => (
              <li key={s.id}>
                <I d={ICN.plug} size={14} /> {s.name}
                <span
                  class={`chip ${s.webhookUrl ? "chip--green" : "chip--amber"}`}
                >
                  {s.webhookUrl ? t("hr.systems.auto") : t("hr.systems.manual")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </form>
    </>
  );
}
