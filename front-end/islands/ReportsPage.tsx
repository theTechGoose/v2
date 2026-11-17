/**
 * /reports island — REQ-795 (hotfix). Raphael: "make a data export section at
 * the top level ... make it so we can select what slice of data we want and
 * for what dates" (then: "call it reports").
 *
 * Pick ONE slice (all / unpaid / paid invoices, payments, quotes, customers),
 * a date preset or a custom From/To, and download the CSV. The island only
 * builds the link (`lib/reports-export.ts`); the backend filters.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import {
  type DateRange,
  isValidRange,
  presetRange,
  REPORT_PRESETS,
  REPORT_SLICES,
  reportExportHref,
  type ReportPreset,
  type ReportSliceId,
} from "../lib/reports-export.ts";

interface Props {
  initialLang?: Lang;
}

export default function ReportsPage({ initialLang }: Props) {
  const [, force] = useState(0);
  useEffect(() => {
    // SSR-resolved language wins over the defaulted localStorage seed
    // (project_langsignal); then follow the live signal.
    const stored = globalThis.localStorage?.getItem("pm:lang") as Lang | null;
    langSignal.value = initialLang ?? stored ?? "es";
    const unsub = langSignal.subscribe(() => force((n) => n + 1));
    return () => unsub();
  }, []);
  const lang = initialLang && typeof document === "undefined"
    ? initialLang
    : langSignal.value;

  const [slice, setSlice] = useState<ReportSliceId>("invoices");
  const [preset, setPreset] = useState<ReportPreset>("all");
  const [custom, setCustom] = useState<DateRange>({});

  const range: DateRange = preset === "custom"
    ? custom
    : presetRange(preset, new Date());
  const valid = isValidRange(range);
  const href = useMemo(
    () => reportExportHref(slice, valid ? range : {}),
    [slice, range.from, range.to, valid],
  );

  const rangeText = !range.from && !range.to
    ? tFor(lang, "reportsPage.rangeAll")
    : range.from && range.to
    ? tFor(lang, "reportsPage.rangeFromTo", { from: range.from, to: range.to })
    : range.from
    ? tFor(lang, "reportsPage.rangeFrom", { from: range.from })
    : tFor(lang, "reportsPage.rangeTo", { to: range.to ?? "" });

  return (
    <section data-cy="reports-page" class="rp">
      <header class="qph">
        <div class="qph__copy">
          <div class="qph__eyebrow">
            <span class="qph__eyebrow-dot" />{" "}
            {tFor(lang, "reportsPage.eyebrow")}
          </div>
          <h1 class="qph__title">
            {tFor(lang, "reportsPage.titlePre")}{" "}
            <em>{tFor(lang, "reportsPage.titleEm")}</em>.
          </h1>
          <p class="qph__sub">{tFor(lang, "reportsPage.intro")}</p>
        </div>
      </header>

      <section class="rp__step">
        <div class="rp__head">
          <span class="rp__num">01</span>
          <h2 class="rp__title">{tFor(lang, "reportsPage.sliceLabel")}</h2>
        </div>
        <div role="radiogroup" class="rp__tiles">
          {REPORT_SLICES.map((s) => (
            <label
              key={s.id}
              data-cy={`report-slice-${s.id}`}
              class={"rp__tile" + (slice === s.id ? " rp__tile--on" : "")}
            >
              <input
                type="radio"
                name="slice"
                value={s.id}
                checked={slice === s.id}
                onChange={() => setSlice(s.id)}
              />
              <span class="rp__tile-name">
                {tFor(lang, `reportsPage.slice.${s.id}`)}
              </span>
              <span class="rp__tile-hint">
                {tFor(lang, `reportsPage.sliceHint.${s.id}`)}
              </span>
              <span class="rp__tick" aria-hidden="true">
                <I d={ICN.check} size={13} sw={3} />
              </span>
            </label>
          ))}
        </div>
      </section>

      <section class="rp__step">
        <div class="rp__head">
          <span class="rp__num">02</span>
          <h2 class="rp__title">{tFor(lang, "reportsPage.datesLabel")}</h2>
        </div>
        <div class="rp__chips">
          {REPORT_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              data-cy={`report-preset-${p}`}
              aria-pressed={preset === p}
              onClick={() => setPreset(p)}
              class={"rp__chip" + (preset === p ? " rp__chip--on" : "")}
            >
              {tFor(lang, `reportsPage.preset.${p}`)}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div class="rp__custom">
            <label class="rp__field">
              {tFor(lang, "reportsPage.from")}
              <input
                type="date"
                data-cy="report-from"
                value={custom.from ?? ""}
                onInput={(e) =>
                  setCustom((c) => ({
                    ...c,
                    from: (e.currentTarget as HTMLInputElement).value ||
                      undefined,
                  }))}
              />
            </label>
            <label class="rp__field">
              {tFor(lang, "reportsPage.to")}
              <input
                type="date"
                data-cy="report-to"
                value={custom.to ?? ""}
                onInput={(e) =>
                  setCustom((c) => ({
                    ...c,
                    to: (e.currentTarget as HTMLInputElement).value ||
                      undefined,
                  }))}
              />
            </label>
          </div>
        )}
        {valid
          ? <p class="rp__range" data-cy="report-range-text">{rangeText}</p>
          : (
            <p role="alert" class="rp__err" data-cy="report-range-error">
              <I d={ICN.alert} size={14} sw={2.5} />{" "}
              {tFor(lang, "reportsPage.errRange")}
            </p>
          )}
      </section>

      <div class="rp__go">
        <div class="rp__go-copy">
          <div class="rp__go-lbl">{tFor(lang, "reportsPage.readyLbl")}</div>
          <div class="rp__go-what">
            {tFor(lang, `reportsPage.slice.${slice}`)}
          </div>
          <div class="rp__go-when">
            {valid ? rangeText : tFor(lang, "reportsPage.errRange")}
          </div>
        </div>
        {valid
          ? (
            <a class="qph__cta" data-cy="report-download" href={href} download>
              <I d={ICN.doc} size={14} sw={2.5} />{" "}
              {tFor(lang, "reportsPage.download")}
            </a>
          )
          : (
            <span
              class="qph__cta rp__cta--off"
              data-cy="report-download"
              aria-disabled="true"
            >
              <I d={ICN.doc} size={14} sw={2.5} />{" "}
              {tFor(lang, "reportsPage.download")}
            </span>
          )}
      </div>
    </section>
  );
}
