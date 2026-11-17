/**
 * REQ-889d — /hr: the onboarding desk's numbers (packets sent, completed, awaiting, accounts),
 * the last 7 days of sends, the status mix, by department, the three most recent hires.
 * Data: GET /hr/dashboard (clients/hr.ts). Strings: hr.home.*.
 */
import { useEffect, useState } from "preact/hooks";
import { type Dashboard, hrClient } from "../clients/hr.ts";
import FieldHead from "../components/FieldHead.tsx";
import { Progress, StatusChip } from "../components/hr/bits.tsx";
import { I, ICN } from "../lib/dash-icons.tsx";
import { donutSlices, fmtDate, initialsOf } from "../lib/hr.ts";
import { langSignal, t } from "../lib/i18n.ts";

const DONUT_COLORS = {
  signed: "#1a8e40",
  awaiting: "#f0b429",
  expired: "#d93c63",
};

export default function HrOverviewPage() {
  const lang = langSignal.value;
  const [d, setD] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    hrClient.dashboard().then(setD).catch(() => setErr(t("hr.common.error")));
  }, []);

  const slices = d ? donutSlices(d.statusMix) : [];
  let acc = 0;
  const gradient = slices.length && slices.some((s) => s.pct > 0)
    ? `conic-gradient(${
      slices.map((s) => {
        const from = acc * 100;
        acc += s.pct;
        return `${DONUT_COLORS[s.key]} ${from}% ${acc * 100}%`;
      }).join(", ")
    })`
    : "conic-gradient(#e6eeec 0 100%)";
  const maxDay = d ? Math.max(1, ...d.byDay.map((x) => x.sent)) : 1;

  return (
    <>
      <FieldHead
        eyebrow={t("hr.home.eyebrow")}
        title={t("hr.home.title")}
        sub={t("hr.home.sub")}
      >
        <a class="btn btn--pink" href="/hr/hires/new" data-cy="hr-home-add">
          <I d={ICN.plus} size={14} /> {t("hr.home.addHire")}
        </a>
      </FieldHead>
      {err && <p class="alert">{err}</p>}
      <div class="hr-stats" data-cy="hr-stats">
        <Stat k="sent" v={d?.sent} />
        <Stat k="completed" v={d?.completed} cls="hr-stat--green" />
        <Stat k="awaiting" v={d?.awaiting} cls="hr-stat--pink" />
        <Stat k="accounts" v={d?.accounts} />
      </div>
      <div class="hr-grid2">
        <section class="panel">
          <h2 class="panel__title">{t("hr.home.chart.sent")}</h2>
          <div class="hr-bars" data-cy="hr-bars">
            {(d?.byDay ?? []).map((x) => (
              <div class="hr-bar" key={x.day}>
                <span class="hr-bar__n">{x.sent}</span>
                <span
                  class="hr-bar__fill"
                  style={`height:${Math.round((x.sent / maxDay) * 100)}%`}
                />
                <span class="hr-bar__day">{fmtDate(x.day, lang)}</span>
              </div>
            ))}
          </div>
        </section>
        <section class="panel">
          <h2 class="panel__title">{t("hr.home.chart.mix")}</h2>
          <div class="hr-donut">
            <div class="hr-donut__ring" style={`background:${gradient}`} />
            <div class="hr-donut__legend">
              {slices.map((s) => (
                <span key={s.key}>
                  <span
                    class="dot"
                    style={`background:${DONUT_COLORS[s.key]}`}
                  />
                  {t(`hr.home.mix.${s.key}`)} · {s.value}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>
      <div class="hr-grid2">
        <section class="panel">
          <h2 class="panel__title">{t("hr.home.recent")}</h2>
          {d && d.recent.length === 0 && (
            <p class="hr-empty" data-cy="hr-home-empty">{t("hr.home.empty")}</p>
          )}
          {d && d.recent.length > 0 && (
            <table class="table">
              <tbody>
                {d.recent.map((h) => (
                  <tr
                    key={h.id}
                    class="hr-row"
                    data-cy="hr-recent-row"
                    onClick={() => location.assign(`/hr/hires/${h.id}`)}
                  >
                    <td>
                      <span class="hr-who">
                        <span class="hr-avatar">{initialsOf(h.name)}</span>
                        <span>
                          <div class="hr-who__name">{h.name}</div>
                          <div class="hr-who__sub">
                            {h.departmentName} · {fmtDate(h.startDate, lang)}
                          </div>
                        </span>
                      </span>
                    </td>
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
          <p style="margin:12px 0 0">
            <a class="btn btn--ghost btn--sm" href="/hr/hires">
              {t("hr.home.viewAll")} <I d={ICN.arrow} size={14} />
            </a>
          </p>
        </section>
        <section class="panel">
          <h2 class="panel__title">{t("hr.home.chart.byDept")}</h2>
          <div class="hr-depts">
            {(d?.byDepartment ?? []).map((x) => {
              const total = x.signed + x.awaiting || 1;
              return (
                <div class="hr-dept-bar" key={x.department}>
                  <span>{x.department}</span>
                  <span class="hr-dept-bar__track">
                    <span
                      class="hr-dept-bar__signed"
                      style={`width:${(x.signed / total) * 100}%`}
                    />
                    <span
                      class="hr-dept-bar__awaiting"
                      style={`width:${(x.awaiting / total) * 100}%`}
                    />
                  </span>
                  <span class="hr-dept-bar__n">
                    {x.signed}/{x.signed + x.awaiting}
                  </span>
                </div>
              );
            })}
            {d && d.byDepartment.length === 0 && (
              <span class="hint">{t("hr.common.none")}</span>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ k, v, cls }: { k: string; v?: number; cls?: string }) {
  return (
    <div class={`hr-stat ${cls ?? ""}`} data-cy={`hr-stat-${k}`}>
      <div class="hr-stat__label">{t(`hr.home.stat.${k}`)}</div>
      <div class="hr-stat__value">{v ?? "–"}</div>
    </div>
  );
}
