/**
 * REQ-288 — the assignments map's starting point: the business's profile address,
 * geocoded once per address (cached under the user, re-geocoded only when the
 * address changes). No address, or one the geocoder cannot place → the whole US.
 */
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { FieldGeocoder } from "@field/domain/data/geocoder/mod.ts";
import {
  businessAddressLine,
  type MapView,
  mapZoomFor,
  US_VIEW,
} from "@field/domain/business/map-center/mod.ts";

const PREFIX = "field_map_center";

interface Cached {
  userId: string;
  line: string;
  lat: number;
  lng: number;
}

export type MapCenter = MapView & { source: "business" | "none" };

@Injectable()
export class FieldMapCenter {
  constructor(
    private address: BusinessAddressStore,
    private geocoder: FieldGeocoder,
  ) {}

  async center(userId: string): Promise<MapCenter> {
    const address = await this.address.get(userId);
    const line = businessAddressLine(address);
    if (!line) return { ...US_VIEW, source: "none" };
    // REQ-747 — a state alone is shown as the state, not at street zoom
    const zoom = mapZoomFor(address);
    const kv = await getKv();
    const hit = (await kv.get<Cached>([PREFIX, userId])).value;
    if (hit && hit.line === line) {
      return {
        lat: hit.lat,
        lng: hit.lng,
        zoom,
        source: "business",
      };
    }
    try {
      const { lat, lng } = await this.geocoder.geocode(line);
      await kv.set(
        [PREFIX, userId],
        { userId, line, lat, lng } satisfies Cached,
      );
      return { lat, lng, zoom, source: "business" };
    } catch (e) {
      // no geocoder (503) or no match: the map still opens, on the country
      console.error(
        `[field] map centre: cannot geocode the business address — ${
          e instanceof Error ? e.message : e
        }`,
      );
      return { ...US_VIEW, source: "none" };
    }
  }
}
