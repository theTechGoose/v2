/**
 * REQ-884c — /hr/hires: the roster, unfinished first; sortable by name, department, start,
 * packet progress and status; a search box across name/email/phone/department; a row opens the
 * hire. Data: GET /hr/hires?sort&dir. Strings: hr.hires.*.
 */
import { useEffect, useState } from "preact/hooks";
import { type Hire, hrClient } from "../clients/hr.ts";
import FieldHead from "../components/FieldHead.tsx";
import { Progress, StatusChip } from "../components/hr/bits.tsx";
import { I, ICN } from "../lib/dash-icons.tsx";
import {
  fmtDate,
  initialsOf,
  matchesHire,
  SORT_KEYS,
  type SortDir,
  sortHires,
  type SortKey,
} from "../lib/hr.ts";
import { langSignal, t } from "../lib/i18n.ts";

export default function HrHiresPage() {
  const lang = langSignal.value;
  const [hires, setHires] = useState<Hire[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("status");
  const [dir, setDir] = useState<SortDir>("asc");

  useEffect(() => {
    hrClient.hires().then(setHires).catch(() => setErr(t("hr.common.error")));
  }, []);

  function clickSort(k: SortKey) {
    if (k === sort) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(k);
      setDir("asc");
    }
  }

  const rows = hires
    ? sortHires(hires.filter((h) => matchesHire(h, q)), sort, dir)
    : [];

  return (
    <>
      <FieldHead
        eyebrow={t("hr.hires.eyebrow")}
        title={t("hr.hires.title")}
        sub={t("hr.hires.sub")}
      >
        <a class="btn btn--pink" href="/hr/hires/new" data-cy="hr-add">
          <I d={ICN.plus} size={14} /> {t("hr.hires.add")}
        </a>
      </FieldHead>
      {err && <p class="alert">{err}</p>}
      <section class="panel">
        <div class="hr-toolbar">
          <input
            type="search"
            placeholder={t("hr.hires.search")}
            value={q}
            data-cy="hr-search"
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          />
        </div>
        {hires && hires.length === 0 && (
          <p class="hr-empty" data-cy="hr-empty">{t("hr.hires.empty")}</p>
        )}
        {hires && hires.length > 0 && rows.length === 0 && (
          <p class="hr-empty">{t("hr.hires.noMatch")}</p>
        )}
        {rows.length > 0 && (
          <table class="table" data-cy="hr-roster">
            <thead>
              <tr>
                {SORT_KEYS.map((k) => (
                  <th key={k}>
                    <button
                      type="button"
                      class={`hr-sort ${sort === k ? "hr-sort--on" : ""}`}
                      data-cy={`hr-sort-${k}`}
                      onClick={() => clickSort(k)}
                    >
                      {t(`hr.hires.col.${k}`)}
                      {sort === k ? (dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr
                  key={h.id}
                  class="hr-row"
                  data-cy="hr-hire-row"
                  onClick={() => location.assign(`/hr/hires/${h.id}`)}
                >
                  <td>
                    <span class="hr-who">
                      <span class="hr-avatar">{initialsOf(h.name)}</span>
                      <span>
                        <div class="hr-who__name" data-cy="hr-hire-name">
                          {h.name}
                        </div>
                        <div class="hr-who__sub">{h.email || h.phone}</div>
                      </span>
                    </span>
                  </td>
                  <td>{h.departmentName}</td>
                  <td>{fmtDate(h.startDate, lang)}</td>
                  <td>
                    <Progress {...h.progress} />
                  </td>
                  <td>
                    <StatusChip status={h.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
