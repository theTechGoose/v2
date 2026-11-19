/**
 * REQ-887 — /hr/departments: the table (name, documents, systems), Add, and the
 * department's page (`?dept=<id>`): the signing packet (documents, checked and ordered) and the
 * accounts to create (connected systems). The department is the configuration unit: a new hire
 * in it gets exactly this. Data: /hr/departments, /hr/documents, /hr/systems. Strings: hr.depts.*.
 */
import { useEffect, useState } from "preact/hooks";
import {
  type Department,
  hrClient,
  type HrDocument,
  type HrSystem,
} from "../clients/hr.ts";
import Backdrop from "../components/Backdrop.tsx";
import FieldHead from "../components/FieldHead.tsx";
import { friendlyHr, Toast, useToast } from "../components/hr/bits.tsx";
import { I, ICN } from "../lib/dash-icons.tsx";
import { t } from "../lib/i18n.ts";

export default function HrDepartmentsPage(
  { initialDeptId }: { initialDeptId?: string },
) {
  const [depts, setDepts] = useState<Department[] | null>(null);
  const [docs, setDocs] = useState<HrDocument[]>([]);
  const [systems, setSystems] = useState<HrSystem[]>([]);
  const [open, setOpen] = useState<Department | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, say] = useToast();

  async function load() {
    const [d, ds, s] = await Promise.all([
      hrClient.departments(),
      hrClient.documents(),
      hrClient.systems(),
    ]);
    setDepts(d);
    setDocs(ds.filter((x) => !x.discardedAt));
    setSystems(s.systems);
    return d;
  }
  useEffect(() => {
    load().then((d) => {
      if (initialDeptId) {
        const x = d.find((o) => o.id === initialDeptId);
        if (x) setOpen(x);
      }
    }).catch(() => setErr(t("hr.common.error")));
  }, []);

  function go(d: Department | null) {
    setOpen(d);
    history.replaceState(
      null,
      "",
      d
        ? `/hr/departments?dept=${encodeURIComponent(d.id)}`
        : "/hr/departments",
    );
  }

  if (open) {
    return (
      <>
        <DeptConfig
          key={open.id}
          dept={open}
          docs={docs}
          systems={systems}
          onBack={() => go(null)}
          onSaved={(d) => {
            setOpen(d);
            say(t("hr.depts.saved"));
            load().catch(() => {});
          }}
        />
        <Toast msg={toast} />
      </>
    );
  }

  return (
    <>
      <FieldHead
        eyebrow={t("hr.depts.eyebrow")}
        title={t("hr.depts.title")}
        sub={t("hr.depts.sub")}
      >
        <button
          type="button"
          class="btn btn--pink"
          data-cy="hr-dept-add"
          onClick={() => setAdding(true)}
        >
          <I d={ICN.plus} size={14} /> {t("hr.depts.add")}
        </button>
      </FieldHead>
      {err && <p class="alert">{err}</p>}
      <section class="panel">
        {depts && depts.length === 0 && (
          <p class="hr-empty" data-cy="hr-depts-empty">{t("hr.depts.empty")}</p>
        )}
        {depts && depts.length > 0 && (
          <table class="table" data-cy="hr-depts">
            <thead>
              <tr>
                <th>{t("hr.depts.col.name")}</th>
                <th>{t("hr.depts.col.docs")}</th>
                <th>{t("hr.depts.col.systems")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {depts.map((d) => (
                <tr
                  key={d.id}
                  class="hr-row"
                  data-cy="hr-dept-row"
                  onClick={() => go(d)}
                >
                  <td>
                    <span class="hr-who__name" data-cy="hr-dept-name">
                      {d.name}
                    </span>
                  </td>
                  <td>
                    {t(
                      `hr.depts.nDocs.${
                        d.docIds.length === 1 ? "one" : "other"
                      }`,
                      { n: d.docIds.length },
                    )}
                  </td>
                  <td>
                    {t(
                      `hr.depts.nSystems.${
                        d.systemIds.length === 1 ? "one" : "other"
                      }`,
                      { n: d.systemIds.length },
                    )}
                  </td>
                  <td style="text-align:right">
                    <span class="btn btn--ghost btn--sm">
                      {t("hr.depts.config")} <I d={ICN.arrow} size={14} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {adding && (
        <AddDept
          onClose={() => setAdding(false)}
          onAdded={async (d) => {
            setAdding(false);
            await load().catch(() => {});
            go(d);
          }}
        />
      )}
      <Toast msg={toast} />
    </>
  );
}

function AddDept(
  { onClose, onAdded }: {
    onClose: () => void;
    onAdded: (d: Department) => void;
  },
) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: Event) {
    e.preventDefault();
    if (!name.trim()) return setErr(t("hr.depts.err.name_required"));
    setBusy(true);
    try {
      onAdded(await hrClient.createDepartment({ name: name.trim() }));
    } catch (e2) {
      setErr(friendlyHr(e2, "hr.depts"));
      setBusy(false);
    }
  }
  return (
    <Backdrop class="modal-bg" onClose={() => !busy && onClose()}>
      <form class="modal" onSubmit={submit} data-cy="hr-dept-modal">
        <h2>{t("hr.depts.add")}</h2>
        <label class="field">
          <span>{t("hr.depts.name")}</span>
          <input
            value={name}
            data-cy="hr-dept-new-name"
            autoFocus
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
        {err && <p class="alert" data-cy="hr-dept-err">{err}</p>}
        <div class="modal__foot">
          <button type="button" class="btn btn--ghost" onClick={onClose}>
            {t("hr.common.cancel")}
          </button>
          <button
            type="submit"
            class="btn btn--pink"
            disabled={busy}
            data-cy="hr-dept-create"
          >
            {t("hr.depts.add")}
          </button>
        </div>
      </form>
    </Backdrop>
  );
}

function DeptConfig({ dept, docs, systems, onBack, onSaved }: {
  dept: Department;
  docs: HrDocument[];
  systems: HrSystem[];
  onBack: () => void;
  onSaved: (d: Department) => void;
}) {
  const [name, setName] = useState(dept.name);
  const [docIds, setDocIds] = useState<string[]>(dept.docIds);
  const [systemIds, setSystemIds] = useState<string[]>(dept.systemIds);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  // checked ones first, in packet order; the rest in library order
  const orderedDocs = [
    ...docIds.map((id) => docs.find((d) => d.id === id)).filter((
      d,
    ): d is HrDocument => !!d),
    ...docs.filter((d) => !docIds.includes(d.id)),
  ];
  const connected = systems.filter((s) =>
    s.status === "connected" || systemIds.includes(s.id)
  );

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      onSaved(
        await hrClient.saveDepartment(dept.id, {
          name: name.trim(),
          docIds,
          systemIds,
        }),
      );
    } catch (e) {
      setErr(friendlyHr(e, "hr.depts"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <FieldHead eyebrow={t("hr.depts.eyebrow")} title={name || dept.name}>
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          data-cy="hr-dept-back"
          onClick={onBack}
        >
          <I d={ICN.back} size={14} /> {t("hr.depts.back")}
        </button>
        <button
          type="button"
          class="btn btn--green"
          data-cy="hr-dept-save"
          disabled={busy}
          onClick={save}
        >
          <I d={ICN.check} size={14} /> {t("hr.depts.save")}
        </button>
      </FieldHead>
      {err && <p class="alert" data-cy="hr-dept-err">{err}</p>}
      <section class="panel">
        <div class="row">
          <label class="field">
            <span>{t("hr.depts.name")}</span>
            <input
              value={name}
              data-cy="hr-dept-cfg-name"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>
        </div>
      </section>
      <div class="hr-two">
        <section class="panel">
          <h2 class="panel__title">{t("hr.depts.docs")}</h2>
          <p class="hint" style="margin:0 0 10px">{t("hr.depts.docsHint")}</p>
          {docs.length === 0 && (
            <p class="hint">
              {t("hr.depts.noDocs")}{" "}
              <a href="/hr/documents">{t("nav.hrDocuments")}</a>
            </p>
          )}
          <ul class="hr-check-list" data-cy="hr-dept-docs">
            {orderedDocs.map((d) => (
              <li key={d.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={docIds.includes(d.id)}
                    data-cy="hr-dept-doc"
                    data-doc={d.id}
                    onChange={() => setDocIds(toggle(docIds, d.id))}
                  />
                  {docIds.includes(d.id) && (
                    <span class="hr-packet__n">{docIds.indexOf(d.id) + 1}</span>
                  )}
                  {d.name || t("hr.docs.untitled")}
                  <span class="hr-check-list__sub">
                    {t(`hr.docs.card.${d.kind}`)} · v{d.version}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section class="panel">
          <h2 class="panel__title">{t("hr.depts.systems")}</h2>
          <p class="hint" style="margin:0 0 10px">
            {t("hr.depts.systemsHint")}
          </p>
          {connected.length === 0 && (
            <p class="hint">
              {t("hr.depts.noSystems")}{" "}
              <a href="/hr/systems">{t("nav.hrSystems")}</a>
            </p>
          )}
          <ul class="hr-check-list" data-cy="hr-dept-systems">
            {connected.map((s) => (
              <li key={s.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={systemIds.includes(s.id)}
                    data-cy="hr-dept-system"
                    data-system={s.id}
                    onChange={() => setSystemIds(toggle(systemIds, s.id))}
                  />
                  {s.name}
                  <span class="hr-check-list__sub">
                    {s.webhookUrl
                      ? t("hr.systems.auto")
                      : t("hr.systems.manual")}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
