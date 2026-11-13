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

const CARD =
  "background:#fff;border:1px solid var(--border,#d8dcd5);border-radius:20px;padding:18px 20px;margin-bottom:16px";
const LEGEND =
  "display:block;font-family:var(--font-heading);font-weight:800;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--brand-teal,#144852);margin:0 0 12px";
const OPTION =
  "display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:12px;border:1px solid transparent;cursor:pointer";
const OPTION_ON =
  "background:var(--brand-green-soft,#e8f3e4);border-color:var(--brand-green,#519843)";
const INPUT =
  "font:inherit;padding:9px 12px;border:1px solid var(--border,#d8dcd5);border-radius:10px;background:#fff;color:inherit";

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
    <section data-cy="reports-page" style="max-width:760px">
      <header class="qph" style="display:block">
        <h1 class="qph__title" style="margin:0 0 6px">
          {tFor(lang, "reportsPage.title")}
        </h1>
        <p class="qph__sub" style="margin:0">
          {tFor(lang, "reportsPage.intro")}
        </p>
      </header>

      <section style={CARD}>
        <h2 style={LEGEND}>{tFor(lang, "reportsPage.sliceLabel")}</h2>
        <div
          role="radiogroup"
          style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px"
        >
          {REPORT_SLICES.map((s) => (
            <label
              key={s.id}
              data-cy={`report-slice-${s.id}`}
              style={OPTION + (slice === s.id ? ";" + OPTION_ON : "")}
            >
              <input
                type="radio"
                name="slice"
                value={s.id}
                checked={slice === s.id}
                onChange={() => setSlice(s.id)}
                style="margin-top:4px"
              />
              <span>
                <strong style="display:block;font-size:14px">
                  {tFor(lang, `reportsPage.slice.${s.id}`)}
                </strong>
                <span style="font-size:12.5px;color:var(--fg-muted,#6b7560)">
                  {tFor(lang, `reportsPage.sliceHint.${s.id}`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section style={CARD}>
        <h2 style={LEGEND}>{tFor(lang, "reportsPage.datesLabel")}</h2>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          {REPORT_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              data-cy={`report-preset-${p}`}
              aria-pressed={preset === p}
              onClick={() => setPreset(p)}
              style={"font:inherit;font-weight:700;font-size:13px;padding:8px 14px;border-radius:999px;cursor:pointer;" +
                (preset === p
                  ? "background:var(--brand-teal,#144852);color:#fff;border:1px solid var(--brand-teal,#144852)"
                  : "background:#fff;color:var(--brand-teal,#144852);border:1px solid var(--border,#d8dcd5)")}
            >
              {tFor(lang, `reportsPage.preset.${p}`)}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end">
            <label style="display:grid;gap:4px;font-size:13px;font-weight:700">
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
                style={INPUT}
              />
            </label>
            <label style="display:grid;gap:4px;font-size:13px;font-weight:700">
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
                style={INPUT}
              />
            </label>
          </div>
        )}
        <p
          data-cy="report-range-text"
          style="margin:12px 0 0;font-size:13px;color:var(--fg-muted,#6b7560)"
        >
          {valid ? rangeText : ""}
        </p>
        {!valid && (
          <p
            role="alert"
            data-cy="report-range-error"
            style="margin:8px 0 0;font-size:13px;font-weight:700;color:var(--brand-pink,#ff6b6b)"
          >
            {tFor(lang, "reportsPage.errRange")}
          </p>
        )}
      </section>

      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        {valid
          ? (
            <a
              class="qph__cta"
              data-cy="report-download"
              href={href}
              download
            >
              ⬇ {tFor(lang, "reportsPage.download")}
            </a>
          )
          : (
            <span
              class="qph__cta"
              data-cy="report-download"
              aria-disabled="true"
              style="opacity:.45;cursor:not-allowed;box-shadow:none"
            >
              ⬇ {tFor(lang, "reportsPage.download")}
            </span>
          )}
      </div>
    </section>
  );
}
