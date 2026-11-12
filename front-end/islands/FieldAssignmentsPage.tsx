/**
 * REQ-143 — /field/assignments. Subscriptions grouped into zones, one worker per zone.
 *
 * Left: a Leaflet map (OSM tiles, loaded from the CDN at runtime — the page works
 * without it) with one circle marker per active subscription, coloured by zone.
 * Right: the zones — each with a staffing <select>, its subscriptions as rows that
 * drag to another zone (or move via the per-row "Move to…" select for touch), a pin
 * on hand-moved rows that un-pins on click — plus a workload strip, a worker filter
 * and "Re-group". Every write reloads the regions from the server.
 *
 * Ported from a2z/web/asignaciones.html (demo driver dropped).
 */
import { useEffect, useRef, useState } from "preact/hooks";
import {
  fieldClient,
  type FieldWorker,
  type MapCenter,
  type RegionView,
  type SubscriptionView,
} from "../clients/field.ts";
import FieldHead from "../components/FieldHead.tsx";
import { assignmentsMapView, US_MAP_VIEW } from "../lib/field.ts";
import { ApiError } from "../lib/api.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { langSignal, t } from "../lib/i18n.ts";
import {
  isReplicaFrame,
  onReplicaView,
  onViewRequest,
  reportView,
} from "../lib/demo-mode/replica.ts";

// ---- Leaflet, typed just as far as this page uses it ----
type LatLng = [number, number];
interface LLayer {
  addTo(target: LMap | LLayerGroup): LLayer;
  remove(): void;
  bindPopup(content: HTMLElement | string): LLayer;
}
interface LLayerGroup extends LLayer {
  clearLayers(): void;
}
interface LMap {
  setView(center: LatLng, zoom: number, opts?: { animate?: boolean }): LMap;
  getCenter(): { lat: number; lng: number };
  getZoom(): number;
  on(event: string, fn: () => void): LMap;
  fitBounds(bounds: LatLng[], opts?: { padding?: [number, number] }): LMap;
  remove(): void;
  invalidateSize(): void;
  containerPointToLatLng(p: [number, number]): { lat: number; lng: number };
  latLngToContainerPoint(ll: LatLng): { x: number; y: number };
}
interface Leaflet {
  map(el: HTMLElement, opts?: { scrollWheelZoom?: boolean }): LMap;
  tileLayer(
    url: string,
    opts: { attribution: string; maxZoom?: number },
  ): LLayer;
  layerGroup(): LLayerGroup;
  circleMarker(
    at: LatLng,
    opts: {
      radius: number;
      color: string;
      weight: number;
      fillColor: string;
      fillOpacity: number;
    },
  ): LLayer;
  circle(
    at: LatLng,
    opts: {
      radius: number;
      color: string;
      weight: number;
      dashArray?: string;
      fillColor: string;
      fillOpacity: number;
    },
  ): LLayer;
  marker(at: LatLng, opts: { icon: unknown; interactive?: boolean }): LLayer;
  divIcon(opts: { className: string; html: HTMLElement | string }): unknown;
}

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

let leafletPromise: Promise<Leaflet | null> | null = null;

/** Inject Leaflet's css + js once; resolves to the global `L` or null when the CDN fails. */
function ensureLeaflet(): Promise<Leaflet | null> {
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const g = globalThis as { L?: Leaflet };
    if (g.L) return resolve(g.L);
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve(g.L ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return leafletPromise;
}

function el(tag: string, text: string, style?: string): HTMLElement {
  const n = document.createElement(tag);
  n.textContent = text;
  if (style) n.setAttribute("style", style);
  return n;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError && e.body && typeof e.body === "object") {
    const b = e.body as { error?: unknown; message?: unknown };
    if (typeof b.error === "string") return b.error;
    if (typeof b.message === "string") return b.message;
  }
  return t("field.common.error");
}

interface Drag {
  sub: string;
  from: string;
}

export default function FieldAssignmentsPage() {
  const _lang = langSignal.value;
  const [regions, setRegions] = useState<RegionView[]>([]);
  const [workers, setWorkers] = useState<FieldWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  /** REQ-288 — the business's own place, for a map with no subscriptions on it */
  const [center, setCenter] = useState<MapCenter | null>(null);

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LLayerGroup | null>(null);
  const leafletRef = useRef<Leaflet | null>(null);
  /** REQ-187 — demo mode: the customer's map reports its centre/zoom; the replica frame's map takes
   *  them (and keeps them over its own fit). `mirrorRef` is the subscription, disposed with the map. */
  const mirrorRef = useRef<(() => void) | null>(null);
  const lastMapRef = useRef<{ c: [number, number]; z: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);

  async function load() {
    try {
      const [r, w] = await Promise.all([
        fieldClient.regions(),
        fieldClient.workers(),
      ]);
      setRegions(r);
      setWorkers(w);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    fieldClient.mapCenter().then(setCenter).catch(
      () => {/* the US view stands */},
    );
  }, []);

  // Leaflet: create the map once the CDN script is in; the zone list never waits for it.
  useEffect(() => {
    let cancelled = false;
    ensureLeaflet().then((L) => {
      if (cancelled) return;
      if (!L || !mapEl.current) {
        setMapFailed(true);
        return;
      }
      leafletRef.current = L;
      // REQ-288 — the whole US until the subscriptions or the business's place are known
      const map = L.map(mapEl.current, { scrollWheelZoom: false }).setView(
        [US_MAP_VIEW.lat, US_MAP_VIEW.lng],
        US_MAP_VIEW.zoom,
      );
      L.tileLayer(OSM_TILES, { attribution: OSM_ATTR, maxZoom: 18 }).addTo(map);
      mapRef.current = map;
      if (isReplicaFrame()) {
        mirrorRef.current = onReplicaView((v) => {
          if (!v.map) return;
          lastMapRef.current = v.map;
          map.setView(v.map.c, v.map.z, { animate: false });
        });
      } else {
        const report = () => {
          const c = map.getCenter();
          reportView({ map: { c: [c.lat, c.lng], z: map.getZoom() } });
        };
        map.on("moveend", report);
        mirrorRef.current = onViewRequest(report);
      }
      setMapReady(true);
    });
    return () => {
      cancelled = true;
      mirrorRef.current?.();
      mirrorRef.current = null;
      layerRef.current?.remove();
      layerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Redraw the markers whenever the regions change.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady) return;
    layerRef.current?.remove();
    const layer = L.layerGroup();
    layer.addTo(map);
    layerRef.current = layer;
    const pts: LatLng[] = [];
    for (const r of regions) {
      for (const s of r.subscriptions) {
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
        pts.push([s.lat, s.lng]);
        const popup = document.createElement("div");
        popup.appendChild(el("b", s.customerName));
        popup.appendChild(document.createElement("br"));
        popup.appendChild(document.createTextNode(s.address));
        popup.appendChild(document.createElement("br"));
        popup.appendChild(
          el("span", r.name, `color:${r.color};font-weight:700`),
        );
        popup.appendChild(
          document.createTextNode(
            ` · ${r.worker ? r.worker.name : t("field.asg.noWorker")}`,
          ),
        );
        L.circleMarker([s.lat, s.lng], {
          radius: 9,
          color: "#fff",
          weight: 2,
          fillColor: r.color,
          fillOpacity: 0.95,
        })
          .bindPopup(popup).addTo(layer);
      }
      if (
        r.subscriptions.length && Number.isFinite(r.lat) &&
        Number.isFinite(r.lng)
      ) {
        L.circle([r.lat, r.lng], {
          radius: 3000,
          color: r.color,
          weight: 1.5,
          dashArray: "6 6",
          fillColor: r.color,
          fillOpacity: 0.06,
        }).addTo(layer);
        const label = el(
          "div",
          `${r.name}${r.worker ? ` · ${r.worker.name}` : ""}`,
          `transform:translate(-50%,-140%);white-space:nowrap;background:${r.color};color:#fff;font:800 11px var(--font-heading,Nunito,sans-serif);padding:3px 8px;border-radius:999px;box-shadow:0 2px 6px rgba(0,0,0,.2)`,
        );
        L.marker([r.lat, r.lng], {
          icon: L.divIcon({ className: "", html: label }),
          interactive: false,
        }).addTo(layer);
      }
    }
    map.invalidateSize();
    const view = assignmentsMapView(pts, center);
    if ("fit" in view) map.fitBounds(view.fit, { padding: [30, 30] });
    else map.setView(view.center, view.zoom, { animate: false });
    // REQ-187 — in the replica frame the customer's view rules over this fit
    const mirrored = lastMapRef.current;
    if (mirrored) map.setView(mirrored.c, mirrored.z, { animate: false });
  }, [regions, mapReady, center]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const wname = (w: { name: string; role?: string }) =>
    `${w.name}${w.role === "foreman" ? ` (${t("field.asg.foremanTag")})` : ""}`;

  const move = (subId: string, regionId: string) =>
    run(() => fieldClient.moveSubscription(subId, regionId));
  const staff = (regionId: string, workerId: string) =>
    run(() => fieldClient.staffRegion(regionId, workerId || null));
  const unpin = (subId: string) =>
    run(() => fieldClient.unpinSubscription(subId));
  const regroup = () =>
    run(async () => {
      const r = await fieldClient.regroup();
      setFlash(t("field.asg.regrouped", { n: r.regions }));
    });

  const unstaffed =
    regions.filter((r) => !r.workerId && r.subscriptions.length).length;
  const visible = regions.filter((r) => !filter || r.workerId === filter);

  function onDrop(e: DragEvent, region: RegionView) {
    e.preventDefault();
    setOver(null);
    const sub = e.dataTransfer?.getData("text/plain") || dragging?.sub;
    const from = dragging?.from;
    setDragging(null);
    if (!sub || from === region.id) return;
    move(sub, region.id);
  }

  function rowOf(s: SubscriptionView, r: RegionView) {
    return (
      <div
        key={s.id}
        class={`rsub${dragging?.sub === s.id ? " rsub--drag" : ""}`}
        draggable
        data-cy="asg-sub"
        data-sub={s.id}
        onDragStart={(e) => {
          setDragging({ sub: s.id, from: r.id });
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", s.id);
          }
        }}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
        }}
      >
        <span class="rsub__name" title={s.customerName}>{s.customerName}</span>
        <span class="rsub__addr" title={s.address}>
          {s.address.split(",")[0]}
        </span>
        {s.pinned && (
          <button
            type="button"
            class="rsub__pin"
            data-cy="asg-unpin"
            title={t("field.asg.unpin")}
            aria-label={t("field.asg.unpin")}
            disabled={busy}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              unpin(s.id);
            }}
          >
            📌
          </button>
        )}
        <select
          class="rsub__move"
          data-cy="asg-move"
          title={t("field.asg.moveTo")}
          aria-label={t("field.asg.moveTo")}
          disabled={busy}
          value=""
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            if (v) move(s.id, v);
          }}
        >
          <option value="">{t("field.asg.moveTo")}</option>
          {regions.filter((x) => x.id !== r.id).map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <>
      <FieldHead
        eyebrow={t("field.asg.eyebrow", { n: regions.length })}
        title={t("field.asg.title")}
        sub={t("field.asg.sub")}
      >
        <select
          class="btn btn--ghost field-filter"
          data-cy="asg-filter"
          aria-label={t("field.asg.filter")}
          value={filter}
          onChange={(e) =>
            setFilter((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">{t("field.asg.filter")}</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>{wname(w)}</option>
          ))}
        </select>
        <button
          type="button"
          class="btn btn--ghost"
          data-cy="asg-regroup"
          disabled={busy}
          onClick={regroup}
        >
          <I d={ICN.repeat} size={14} /> {t("field.asg.regroup")}
        </button>
      </FieldHead>

      {flash && (
        <div class="chip chip--green" style="margin-bottom:10px">{flash}</div>
      )}
      {error && (
        <div class="alert" style="margin:0 0 10px" role="alert">{error}</div>
      )}
      {loading && (
        <div class="hint" style="margin-bottom:10px">
          {t("field.common.loading")}
        </div>
      )}
      {unstaffed > 0 && (
        <div class="alert" style="margin:0 0 10px">
          {t("field.asg.unstaffedCount", { n: unstaffed })}
        </div>
      )}

      {workers.length > 0 && (
        <div class="workload">
          {workers.map((w) => {
            const z = regions.filter((r) => r.workerId === w.id);
            return (
              <span class="chip" key={w.id} title={wname(w)}>
                <b>{w.name}</b> {t("field.asg.load", {
                  zones: z.length,
                  subs: z.reduce((n, r) => n + r.subscriptions.length, 0),
                })}
              </span>
            );
          })}
        </div>
      )}

      <div class="alay">
        <div class="alay__map">
          <div class="field-map" ref={mapEl} />
          {mapFailed && (
            <div class="hint" style="margin-top:8px">
              {t("field.asg.mapFailed")}
            </div>
          )}
        </div>
        <div>
          {visible.map((r) => (
            <div
              key={r.id}
              class={`region${over === r.id ? " region--over" : ""}`}
              data-cy="asg-region"
              data-region={r.id}
              style={`--rc:${r.color}`}
              onDragOver={(e) => {
                if (dragging && dragging.from !== r.id) {
                  e.preventDefault();
                  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                  if (over !== r.id) setOver(r.id);
                }
              }}
              onDragLeave={() => {
                if (over === r.id) setOver(null);
              }}
              onDrop={(e) => onDrop(e, r)}
            >
              <div class="region__head">
                <span class="dot" style={`background:${r.color}`} />
                <span class="region__name">{r.name}</span>
                <select
                  data-cy="asg-region-worker"
                  aria-label={r.name}
                  disabled={busy}
                  value={r.workerId ?? ""}
                  onChange={(e) =>
                    staff(r.id, (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">{t("field.asg.noWorker")}</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>{wname(w)}</option>
                  ))}
                </select>
              </div>
              {!r.workerId && (
                <div
                  class="hint"
                  style="margin:-4px 0 8px;color:var(--pink-700)"
                >
                  {t("field.asg.unstaffed")}
                </div>
              )}
              <div class="region__list">
                {r.subscriptions.map((s) => rowOf(s, r))}
                {r.subscriptions.length === 0 && (
                  <div class="region__empty">{t("field.asg.empty")}</div>
                )}
              </div>
            </div>
          ))}
          {!loading && visible.length === 0 && (
            <div class="panel hint">{t("field.asg.noRegions")}</div>
          )}
        </div>
      </div>
    </>
  );
}
