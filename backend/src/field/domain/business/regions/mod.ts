/**
 * REQ-140 — group subscriptions into geographic zones.
 *
 * Pure: takes stored coordinates, never calls a geocoder. Straight-line
 * (haversine) distance; the owner's drag is honoured by `pinned` — a pinned
 * subscription keeps its zone through every re-run and never pulls the centre.
 */
import type { Region, Subscription } from "@field/dto/field.ts";

export const REGION_RADIUS_KM = 3;

const PALETTE = ["#519843", "#ff6b6b", "#2d737c", "#e8a33d", "#8b7dbf", "#644536", "#56969e", "#c92a2a"];

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function regionName(index: number): string {
  return `Zona ${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ""}`;
}

export interface GroupResult {
  regions: Region[];
  /** subscriptionId → regionId for every active subscription */
  assignments: Map<string, string>;
}

/**
 * Existing zones keep their id, name, colour and worker; a pinned subscription
 * stays where the owner put it; every other active subscription joins the
 * nearest zone within REGION_RADIUS_KM or starts a new one. Zones left with no
 * members and no worker are dropped.
 */
export function groupRegions(
  subs: Subscription[],
  existing: Region[],
  opts: { radiusKm?: number; newId: () => string; userId: string },
): GroupResult {
  const radius = opts.radiusKm ?? REGION_RADIUS_KM;
  const regions: Region[] = existing.map((r) => ({ ...r }));
  const members = new Map<string, Subscription[]>(regions.map((r) => [r.id, []]));
  const assignments = new Map<string, string>();
  const active = subs.filter((s) => s.active);

  // 1. pinned subscriptions anchor their zone
  for (const s of active) {
    if (s.pinned && s.regionId && members.has(s.regionId)) {
      members.get(s.regionId)!.push(s);
      assignments.set(s.id, s.regionId);
    }
  }
  // centre = the un-pinned members' centroid; else the stored centre
  const centroid = (r: Region) => {
    const m = members.get(r.id)!.filter((s) => !s.pinned);
    if (!m.length) return { lat: r.lat, lng: r.lng };
    return { lat: m.reduce((a, s) => a + s.lat, 0) / m.length, lng: m.reduce((a, s) => a + s.lng, 0) / m.length };
  };

  // 2. everyone else: nearest zone within the radius, else a new one
  for (const s of active) {
    if (assignments.has(s.id)) continue;
    let best: Region | undefined, bestD = Infinity;
    for (const r of regions) {
      const d = distanceKm(s, centroid(r));
      if (d < bestD) { bestD = d; best = r; }
    }
    if (best && bestD <= radius) {
      members.get(best.id)!.push(s);
      assignments.set(s.id, best.id);
    } else {
      const names = new Set(regions.map((r) => r.name)), colors = new Set(regions.map((r) => r.color));
      let i = 0;
      while (names.has(regionName(i))) i++;
      const r: Region = {
        id: opts.newId(), userId: opts.userId, name: regionName(i),
        color: PALETTE.find((c) => !colors.has(c)) ?? PALETTE[i % PALETTE.length], lat: s.lat, lng: s.lng,
      };
      regions.push(r);
      members.set(r.id, [s]);
      assignments.set(s.id, r.id);
    }
  }

  // 3. settle centroids; drop empty, unstaffed zones
  const kept = regions.filter((r) => members.get(r.id)!.length > 0 || r.workerId);
  for (const r of kept) Object.assign(r, centroid(r));
  return { regions: kept, assignments };
}
