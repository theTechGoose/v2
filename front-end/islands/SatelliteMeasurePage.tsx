/**
 * REQ-856 — the Satellite measure island (/tools/satellite; REQ-891: in the
 * Tools folder, renamed from Roof measure, and a section can be a flat
 * surface — a driveway, a patio — with no pitch). Raphael: "get satellite images of an address for
 * free and do the measurement myself … just in the United States".
 *
 * An address → /api/roof/locate (Mapbox when there is a token, else the free
 * Census geocoder) → a square aerial window from the free USGS NAIP imagery
 * (/api/roof/image) drawn on a canvas. The owner clicks the corners of each
 * roof section; a closed ring is a facet with a pitch (rise per 12). The
 * numbers come from shared/roof-geometry — the same code the API uses for the
 * saved summary — so the page and the record never disagree. Building
 * outlines OpenStreetMap knows near the point can seed a facet.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";
import { ApiError } from "../lib/api.ts";
import AddressAutocomplete from "../components/AddressAutocomplete.tsx";
import FieldHead from "../components/FieldHead.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import {
  type LatLng,
  type Located,
  roofClient,
  type RoofFacet,
  type RoofMeasurementView,
  type SiteInfo,
} from "../clients/roof.ts";
import {
  bboxAround,
  centroid,
  distanceM,
  type FacetKind,
  latLngToPixel,
  pixelToLatLng,
  summarize,
} from "../../shared/roof-geometry/mod.ts";

interface Props {
  initialLang?: Lang;
}

/** the canvas's own pixel grid (the image is requested at this size) */
const SIZE = 1000;
const WINDOWS = [30, 45, 60, 90, 140] as const;
const PITCHES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18] as const;
const DEFAULT_WASTE = 10;
const DEFAULT_PITCH = 4;
/** clicking this close (canvas px) to the first corner closes the ring */
const CLOSE_PX = 18;
const IMG_RETRIES = 2; // silent retries of the aerial photo before 'didn't load'
const IMG_RETRY_MS = 1500;
const COLORS = [
  "#e6397a",
  "#1f8a70",
  "#f28c28",
  "#3b6fd6",
  "#8e44ad",
  "#c0392b",
];

type ImgState = "idle" | "loading" | "ready" | "error";

function errMsg(lang: Lang, err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as { code?: unknown; message?: unknown } | null;
    if (b && typeof b === "object") {
      if (b.code === "address_not_found") return tFor(lang, "roof.notFound");
      if (b.code === "imagery_unavailable") {
        return tFor(lang, "roof.imageFailed");
      }
      if (b.code === "no_facets") return tFor(lang, "roof.noFacets");
      if (typeof b.message === "string" && b.message) return b.message;
    }
    if (err.status === 404) return tFor(lang, "roof.notFound");
  }
  return tFor(lang, "roof.error");
}

export default function SatelliteMeasurePage({ initialLang }: Props) {
  const [, force] = useState(0);
  useEffect(() => {
    const stored = globalThis.localStorage?.getItem("pm:lang") as Lang | null;
    langSignal.value = initialLang ?? stored ?? "es";
    const unsub = langSignal.subscribe(() => force((n) => n + 1));
    return () => unsub();
  }, []);
  const lang: Lang = initialLang && typeof document === "undefined"
    ? initialLang
    : langSignal.value;
  const t = (k: string, vars?: Record<string, string | number>) =>
    tFor(lang, k, vars);
  const fmtInt = (n: number) =>
    Math.round(n).toLocaleString(lang === "es" ? "es-US" : "en-US");

  const [address, setAddress] = useState("");
  const [located, setLocated] = useState<Located | null>(null);
  const [locating, setLocating] = useState(false);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [windowM, setWindowM] = useState<number>(60);
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [imgState, setImgState] = useState<ImgState>("idle");
  const [imgTry, setImgTry] = useState(0); // bumped by "Try again"
  const [facets, setFacets] = useState<RoofFacet[]>([]);
  const [draft, setDraft] = useState<LatLng[]>([]);
  const [wastePct, setWastePct] = useState<number>(DEFAULT_WASTE);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saved, setSaved] = useState<RoofMeasurementView[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const bbox = center ? bboxAround(center, windowM) : null;

  // ---- the saved list ----
  async function loadSaved() {
    try {
      setSaved(await roofClient.measurements());
    } catch {
      setSaved([]);
    }
  }
  useEffect(() => {
    void loadSaved();
  }, []);

  // ---- the window: site info + the image, whenever the centre or width changes ----
  useEffect(() => {
    if (!center) return;
    let gone = false;
    setImgState("loading");
    setSite(null);
    roofClient.site(center, windowM).then((s) => {
      if (!gone) setSite(s);
    }).catch(() => {
      if (!gone) setSite(null);
    });
    // the photo: a cold aerial export can be slow, so a failed load is retried
    // on its own (REQ-856 AMENDMENT) before the page says it didn't load
    const url = roofClient.imageUrl(center, windowM, SIZE);
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const img = new Image();
    img.onload = () => {
      if (gone) return;
      imgRef.current = img;
      setImgState("ready");
    };
    img.onerror = () => {
      if (gone) return;
      imgRef.current = null;
      if (attempt < IMG_RETRIES) {
        attempt++;
        timer = setTimeout(() => {
          if (!gone) img.src = `${url}&try=${attempt}`;
        }, IMG_RETRY_MS);
        return;
      }
      setImgState("error");
    };
    img.src = url;
    return () => {
      gone = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [center?.lat, center?.lng, windowM, imgTry]);

  // ---- drawing ----
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (imgRef.current && imgState === "ready") {
      ctx.drawImage(imgRef.current, 0, 0, SIZE, SIZE);
    } else {
      ctx.fillStyle = "#e7ebe4";
      ctx.fillRect(0, 0, SIZE, SIZE);
    }
    if (!bbox) return;
    const px = (p: LatLng) => latLngToPixel(p, bbox, SIZE);
    // known outlines, faint and dashed
    if (site && facets.length === 0) {
      ctx.save();
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      for (const ring of site.footprints) {
        ctx.beginPath();
        ring.forEach((p, i) => {
          const q = px(p);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }
    // the facets
    facets.forEach((f, i) => {
      const c = COLORS[i % COLORS.length];
      ctx.beginPath();
      f.points.forEach((p, j) => {
        const q = px(p);
        if (j === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fillStyle = c + "55";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = c;
      ctx.stroke();
      const m = px(centroid(f.points));
      ctx.font = "bold 34px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(0,0,0,.55)";
      ctx.strokeText(String(i + 1), m.x, m.y);
      ctx.fillStyle = "#fff";
      ctx.fillText(String(i + 1), m.x, m.y);
    });
    // the draft ring
    if (draft.length) {
      ctx.beginPath();
      draft.forEach((p, j) => {
        const q = px(p);
        if (j === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#fff";
      ctx.setLineDash([]);
      ctx.stroke();
      draft.forEach((p, j) => {
        const q = px(p);
        ctx.beginPath();
        ctx.arc(q.x, q.y, j === 0 ? 11 : 7, 0, Math.PI * 2);
        ctx.fillStyle = j === 0 ? "#e6397a" : "#fff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#144852";
        ctx.stroke();
      });
    }
  }, [imgState, facets, draft, site, bbox?.west, bbox?.north, bbox?.east]);

  // ---- actions ----
  async function locate(e?: Event) {
    e?.preventDefault();
    const q = address.trim();
    if (q.length < 3 || locating) return;
    setErr(null);
    setLocating(true);
    try {
      const p = await roofClient.locate(q);
      setLocated(p);
      setCenter({ lat: p.lat, lng: p.lng });
      setFacets([]);
      setDraft([]);
      setEditingId(null);
      setSavedMsg(false);
    } catch (e) {
      setErr(errMsg(lang, e));
    } finally {
      setLocating(false);
    }
  }

  function canvasPoint(ev: MouseEvent): { x: number; y: number } | null {
    const cv = canvasRef.current;
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * SIZE,
      y: ((ev.clientY - r.top) / r.height) * SIZE,
    };
  }

  function closeDraft() {
    if (draft.length < 3) return;
    setFacets([...facets, {
      points: draft,
      pitch: DEFAULT_PITCH,
      kind: "roof",
    }]);
    setDraft([]);
    setSavedMsg(false);
  }

  function onCanvasClick(ev: MouseEvent) {
    if (!bbox || imgState !== "ready") return;
    const q = canvasPoint(ev);
    if (!q) return;
    if (draft.length >= 3) {
      const first = latLngToPixel(draft[0], bbox, SIZE);
      if (Math.hypot(first.x - q.x, first.y - q.y) <= CLOSE_PX) {
        closeDraft();
        return;
      }
    }
    setDraft([...draft, pixelToLatLng(q.x, q.y, bbox, SIZE)]);
  }

  function nudge(dLatM: number, dLngM: number) {
    if (!center) return;
    const step = windowM * 0.25;
    setCenter({
      lat: center.lat + (dLatM * step) / 111_320,
      lng: center.lng +
        (dLngM * step) / (111_320 * Math.cos((center.lat * Math.PI) / 180)),
    });
  }

  function useOutline() {
    if (!site || !center || !site.footprints.length) return;
    const ring =
      [...site.footprints].sort((a, b) =>
        distanceM(centroid(a), center) - distanceM(centroid(b), center)
      )[0];
    setFacets([...facets, {
      points: ring,
      pitch: DEFAULT_PITCH,
      kind: "roof",
    }]);
    setDraft([]);
    setSavedMsg(false);
  }

  function setPitch(i: number, pitch: number) {
    setFacets(facets.map((f, j) => (j === i ? { ...f, pitch } : f)));
    setSavedMsg(false);
  }

  // REQ-891 — a driveway or patio has no pitch; back to a roof it gets the default
  function setKind(i: number, kind: FacetKind) {
    setFacets(
      facets.map((f, j) =>
        j === i
          ? {
            ...f,
            kind,
            pitch: kind === "flat" ? 0 : (f.pitch || DEFAULT_PITCH),
          }
          : f
      ),
    );
    setSavedMsg(false);
  }
  const hasRoof = facets.some((f) => (f.kind ?? "roof") === "roof");

  async function save() {
    if (!center || saving) return;
    if (!facets.length) {
      setErr(t("roof.noFacets"));
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const body = {
        address: located?.label || address.trim(),
        lat: center.lat,
        lng: center.lng,
        facets,
        wastePct,
        note: note.trim() || undefined,
      };
      const m = editingId
        ? await roofClient.update(editingId, body)
        : await roofClient.create(body);
      setEditingId(m.id);
      setSavedMsg(true);
      await loadSaved();
    } catch (e) {
      setErr(errMsg(lang, e));
    } finally {
      setSaving(false);
    }
  }

  function open(m: RoofMeasurementView) {
    setAddress(m.address);
    setLocated({
      lat: m.lat,
      lng: m.lng,
      label: m.address,
      accuracy: "rooftop",
      source: "saved",
    });
    setCenter({ lat: m.lat, lng: m.lng });
    setFacets(m.facets);
    setDraft([]);
    setWastePct(m.wastePct);
    setNote(m.note ?? "");
    setEditingId(m.id);
    setSavedMsg(false);
    setErr(null);
    globalThis.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  async function remove(id: string) {
    try {
      await roofClient.remove(id);
      setConfirmId(null);
      if (editingId === id) setEditingId(null);
      await loadSaved();
    } catch (e) {
      setErr(errMsg(lang, e));
    }
  }

  const sum = summarize(facets, wastePct);
  const imagery = site?.source.date && site.source.gsdCm
    ? t("roof.imagery", {
      provider: site.source.provider,
      date: site.source.date,
      cm: site.source.gsdCm,
    })
    : site
    ? t("roof.imageryUnknown", { provider: site.source.provider })
    : null;

  return (
    <section class="roof-page" data-cy="roof-page">
      <FieldHead
        eyebrow={t("roof.eyebrow")}
        title={t("roof.title")}
        sub={t("roof.sub")}
      />

      <div class="roof">
        <div class="roof__card">
          <form class="roof__row" onSubmit={locate}>
            <div class="roof__addr">
              <AddressAutocomplete
                id="roof-address"
                data-cy="roof-address"
                value={address}
                onInput={setAddress}
                lang={lang}
                label={t("roof.address")}
                useTypedLabel={t("roof.useTyped")}
              />
            </div>
            <button
              type="submit"
              class="btn btn--accent"
              data-cy="roof-locate"
              disabled={locating || address.trim().length < 3}
            >
              {locating ? t("roof.locating") : t("roof.locate")}
            </button>
          </form>
          {located && (
            <p class="roof__hint" data-cy="roof-located">
              {located.accuracy === "street"
                ? t("roof.locatedStreet", { label: located.label })
                : t("roof.located", { label: located.label })}
            </p>
          )}
          {err && <p class="roof__err" data-cy="roof-error">{err}</p>}

          <div class="roof__stage">
            <canvas
              ref={canvasRef}
              class="roof__canvas"
              width={SIZE}
              height={SIZE}
              data-cy="roof-canvas"
              data-ready={imgState === "ready" ? "1" : "0"}
              onClick={onCanvasClick}
            />
            {imgState !== "ready" && (
              <div class="roof__stage-msg">
                {imgState === "loading"
                  ? t("roof.fetchingPhoto")
                  : imgState === "error"
                  ? (
                    <div>
                      <p>{t("roof.imageFailed")}</p>
                      <button
                        type="button"
                        class="roof__btn-sm"
                        data-cy="roof-retry"
                        onClick={() => {
                          setImgState("loading");
                          setImgTry((n) => n + 1);
                        }}
                      >
                        {t("roof.retry")}
                      </button>
                    </div>
                  )
                  : t("roof.howTo")}
              </div>
            )}
            {center && (
              <>
                <button
                  type="button"
                  class="roof__nudge roof__nudge--n"
                  title={t("roof.nudge")}
                  aria-label={t("roof.nudge")}
                  onClick={() => nudge(1, 0)}
                >
                  <Icon name="chevron-up" />
                </button>
                <button
                  type="button"
                  class="roof__nudge roof__nudge--s"
                  title={t("roof.nudge")}
                  aria-label={t("roof.nudge")}
                  onClick={() => nudge(-1, 0)}
                >
                  <Icon name="chevron-down" />
                </button>
                <button
                  type="button"
                  class="roof__nudge roof__nudge--w"
                  title={t("roof.nudge")}
                  aria-label={t("roof.nudge")}
                  onClick={() => nudge(0, -1)}
                >
                  <Icon name="chevron-left" />
                </button>
                <button
                  type="button"
                  class="roof__nudge roof__nudge--e"
                  title={t("roof.nudge")}
                  aria-label={t("roof.nudge")}
                  onClick={() => nudge(0, 1)}
                >
                  <Icon name="chevron-right" />
                </button>
              </>
            )}
          </div>
          {imagery && (
            <div class="roof__imagery" data-cy="roof-imagery">{imagery}</div>
          )}

          <div class="roof__tools">
            <label class="roof__label">
              {t("roof.window")}{" "}
              <select
                class="roof__select"
                data-cy="roof-window"
                value={String(windowM)}
                onChange={(e) =>
                  setWindowM(Number((e.target as HTMLSelectElement).value))}
                disabled={!center}
              >
                {WINDOWS.map((m) => (
                  <option value={String(m)}>{t("roof.windowM", { m })}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              class="btn btn--accent roof__btn-sm"
              data-cy="roof-close"
              disabled={draft.length < 3}
              onClick={closeDraft}
            >
              {t("roof.closeFacet")}
            </button>
            <button
              type="button"
              class="btn btn--ghost roof__btn-sm"
              data-cy="roof-undo"
              disabled={!draft.length}
              onClick={() => setDraft(draft.slice(0, -1))}
            >
              {t("roof.undo")}
            </button>
            <button
              type="button"
              class="btn btn--ghost roof__btn-sm"
              data-cy="roof-outline"
              disabled={!site || !site.footprints.length}
              title={site && !site.footprints.length
                ? t("roof.noOutline")
                : undefined}
              onClick={useOutline}
            >
              {t("roof.useOutline")}
            </button>
            <button
              type="button"
              class="btn btn--ghost roof__btn-sm"
              data-cy="roof-clear"
              disabled={!facets.length && !draft.length}
              onClick={() => {
                setFacets([]);
                setDraft([]);
                setSavedMsg(false);
              }}
            >
              {t("roof.clear")}
            </button>
          </div>
          <p class="roof__hint">
            {draft.length
              ? t("roof.drafting", { n: draft.length }) + " · "
              : ""}
            {t("roof.howTo")}
          </p>
        </div>

        <div class="roof__card">
          <table data-cy="roof-facets">
            <thead>
              <tr>
                <th>{t("roof.facet")}</th>
                <th>{t("roof.kind")}</th>
                <th>{t("roof.pitch")}</th>
                <th class="num">{t("roof.plan")}</th>
                <th class="num">{t("roof.surface")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {facets.map((f, i) => (
                <tr data-cy="roof-facet-row">
                  <td>
                    <span
                      class="roof__swatch"
                      style={`background:${COLORS[i % COLORS.length]}`}
                    />
                    {i + 1}
                  </td>
                  <td>
                    <select
                      class="roof__select"
                      data-cy="roof-kind"
                      value={f.kind ?? "roof"}
                      onChange={(e) =>
                        setKind(
                          i,
                          (e.target as HTMLSelectElement).value as FacetKind,
                        )}
                    >
                      <option value="roof">{t("roof.kindRoof")}</option>
                      <option value="flat">{t("roof.kindFlat")}</option>
                    </select>
                  </td>
                  <td>
                    {(f.kind ?? "roof") === "flat"
                      ? <span class="roof__hint">—</span>
                      : (
                        <select
                          class="roof__select"
                          data-cy="roof-pitch"
                          value={String(f.pitch)}
                          onChange={(e) =>
                            setPitch(
                              i,
                              Number((e.target as HTMLSelectElement).value),
                            )}
                        >
                          {PITCHES.map((p) => (
                            <option value={String(p)}>
                              {p === 0
                                ? t("roof.pitchFlat")
                                : t("roof.pitchN", { n: p })}
                            </option>
                          ))}
                        </select>
                      )}
                  </td>
                  <td class="num">
                    {t("roof.sqft", { n: fmtInt(sum.facets[i].planSqft) })}
                  </td>
                  <td class="num">
                    {t("roof.sqft", { n: fmtInt(sum.facets[i].surfaceSqft) })}
                  </td>
                  <td class="num">
                    <button
                      type="button"
                      class="btn btn--ghost roof__btn-sm"
                      data-cy="roof-facet-remove"
                      onClick={() => {
                        setFacets(facets.filter((_, j) => j !== i));
                        setSavedMsg(false);
                      }}
                    >
                      {t("roof.remove")}
                    </button>
                  </td>
                </tr>
              ))}
              {!facets.length && (
                <tr>
                  <td colSpan={5} class="roof__hint">{t("roof.noFacets")}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div class="roof__row" style="margin-top:12px">
            <label class="roof__label">
              {t("roof.waste")} %{" "}
              <input
                class="roof__input roof__input--sm"
                data-cy="roof-waste"
                type="number"
                min={0}
                max={100}
                step={1}
                value={String(wastePct)}
                onInput={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  setWastePct(
                    Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0,
                  );
                  setSavedMsg(false);
                }}
              />
            </label>
          </div>

          <div class="roof__totals">
            <div class="roof__kpi">
              <b data-cy="roof-total-plan">
                {t("roof.sqft", { n: fmtInt(sum.planSqft) })}
              </b>
              <span>{t("roof.totalPlan")}</span>
            </div>
            <div class="roof__kpi">
              <b data-cy="roof-total-surface">
                {t("roof.sqft", { n: fmtInt(sum.surfaceSqft) })}
              </b>
              <span>{t("roof.totalSurface")}</span>
            </div>
            <div class="roof__kpi">
              <b data-cy="roof-with-waste">
                {t("roof.sqft", { n: fmtInt(sum.withWasteSqft) })}
              </b>
              <span>{t("roof.withWaste")} ({sum.wastePct}%)</span>
            </div>
            {hasRoof && (
              <div class="roof__kpi roof__kpi--hero">
                <b data-cy="roof-squares">{sum.squares.toFixed(2)}</b>
                <span>{t("roof.squares")}</span>
              </div>
            )}
          </div>

          <div class="roof__row" style="margin-top:12px">
            <input
              class="roof__input"
              data-cy="roof-note"
              placeholder={t("roof.notePh")}
              aria-label={t("roof.note")}
              value={note}
              onInput={(e) => {
                setNote((e.target as HTMLInputElement).value);
                setSavedMsg(false);
              }}
            />
          </div>
          <div class="roof__row" style="margin-top:12px">
            <button
              type="button"
              class="btn btn--accent"
              data-cy="roof-save"
              disabled={saving || !center || !facets.length}
              onClick={save}
            >
              {saving
                ? t("roof.saving")
                : editingId
                ? t("roof.update")
                : t("roof.save")}
            </button>
            {savedMsg && (
              <span class="roof__hint" data-cy="roof-saved-msg">
                {t("roof.saved")}
              </span>
            )}
          </div>

          <div class="roof__saved">
            <h2>{t("roof.savedTitle")}</h2>
            {saved && !saved.length && (
              <p class="roof__hint">{t("roof.savedEmpty")}</p>
            )}
            {(saved ?? []).map((m) => (
              <div class="roof__scard" data-cy="roof-saved-card">
                <div>
                  <div class="roof__scard-addr">{m.address}</div>
                  <div class="roof__scard-meta">
                    {m.createdAt.slice(0, 10)} ·{" "}
                    {t("roof.sections", { n: m.facets.length })} ·{" "}
                    {t("roof.withWaste")}{" "}
                    {t("roof.sqft", { n: fmtInt(m.summary.withWasteSqft) })} ·
                    {" "}
                    {m.summary.squares.toFixed(2)}{" "}
                    {t("roof.squares").toLowerCase()}
                    {m.note ? ` · ${m.note}` : ""}
                  </div>
                </div>
                <div class="roof__row">
                  <button
                    type="button"
                    class="btn btn--ghost roof__btn-sm"
                    data-cy="roof-saved-open"
                    onClick={() =>
                      open(m)}
                  >
                    {t("roof.open")}
                  </button>
                  {confirmId === m.id
                    ? (
                      <>
                        <span class="roof__hint">
                          {t("roof.confirmDelete")}
                        </span>
                        <button
                          type="button"
                          class="btn btn--accent roof__btn-sm"
                          data-cy="roof-saved-delete-confirm"
                          onClick={() => remove(m.id)}
                        >
                          {t("roof.delete")}
                        </button>
                        <button
                          type="button"
                          class="btn btn--ghost roof__btn-sm"
                          onClick={() =>
                            setConfirmId(null)}
                        >
                          {t("roof.cancel")}
                        </button>
                      </>
                    )
                    : (
                      <button
                        type="button"
                        class="btn btn--ghost roof__btn-sm"
                        data-cy="roof-saved-delete"
                        onClick={() => setConfirmId(m.id)}
                      >
                        {t("roof.delete")}
                      </button>
                    )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
