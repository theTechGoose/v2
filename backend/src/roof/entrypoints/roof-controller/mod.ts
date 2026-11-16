/**
 * REQ-856 — the roof tool's API, behind the owner's session:
 *   GET  /roof/locate?q=            an address → its point (Mapbox, else the Census geocoder)
 *   GET  /roof/site?lat&lng&m       the window around a point: its Web Mercator box, the
 *                                   imagery's provider/date/resolution, nearby building outlines
 *   GET  /roof/image?lat&lng&m&px   that window as a PNG (the USGS NAIP export, proxied)
 *   GET/POST /roof/measurements, GET/PUT/DELETE /roof/measurements/:id — the account's
 *   measurements, each answered with its summary (shared/roof-geometry).
 */
import {
  Body,
  Context,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { bboxAround, summarize } from "#roof-geometry/mod.ts";
import {
  parseLat,
  parseLng,
  parseMeasurementInput,
  parsePx,
  parseWindowM,
  RoofError,
  type RoofMeasurement,
  type RoofMeasurementView,
} from "@roof/dto/roof.ts";
import { RoofMeasurementStore } from "@roof/domain/data/roof-store/mod.ts";
import { RoofSources } from "@roof/domain/data/roof-sources/mod.ts";

const newId = () => crypto.randomUUID();

export function view(m: RoofMeasurement): RoofMeasurementView {
  const { userId: _owner, ...rest } = m;
  return { ...rest, summary: summarize(m.facets, m.wastePct) };
}

@Controller("roof")
export class RoofController {
  constructor(
    private store: RoofMeasurementStore,
    private sources: RoofSources,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get("locate")
  async locate(@Context() ctx: ExecutionContext, @Query("q") q?: string) {
    await requireUser(ctx, this.sessions, this.users);
    const query = (q ?? "").trim();
    if (query.length < 3) {
      throw new RoofError(
        "q must be at least 3 characters",
        400,
        "query_too_short",
      );
    }
    const p = await this.sources.locator.locate(query);
    if (!p) throw new RoofError("address not found", 404, "address_not_found");
    return p;
  }

  @Get("site")
  async site(
    @Context() ctx: ExecutionContext,
    @Query("lat") lat?: string,
    @Query("lng") lng?: string,
    @Query("m") m?: string,
  ) {
    await requireUser(ctx, this.sessions, this.users);
    const center = { lat: parseLat(lat), lng: parseLng(lng) };
    const meters = parseWindowM(m);
    // best effort, never a 5xx: the window is usable without its vintage or outlines
    const [source, footprints] = await Promise.all([
      this.sources.imagery.sourceAt(center).catch((e) => {
        console.warn(
          `[roof] imagery source lookup failed: ${(e as Error).message}`,
        );
        return { provider: "unknown" };
      }),
      this.sources.footprints.near(center, meters).catch((e) => {
        console.warn(`[roof] outline lookup failed: ${(e as Error).message}`);
        return [];
      }),
    ]);
    return {
      center,
      meters,
      bbox: bboxAround(center, meters),
      source,
      footprints,
    };
  }

  @Get("image")
  async image(
    @Context() ctx: ExecutionContext,
    @Query("lat") lat?: string,
    @Query("lng") lng?: string,
    @Query("m") m?: string,
    @Query("px") px?: string,
  ) {
    await requireUser(ctx, this.sessions, this.users);
    const center = { lat: parseLat(lat), lng: parseLng(lng) };
    const bytes = await this.sources.imagery.image(
      bboxAround(center, parseWindowM(m)),
      parsePx(px),
    );
    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, max-age=3600",
      },
    });
  }

  @Get("measurements")
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const all = await this.store.listByUser(user.id);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(view);
  }

  @Post("measurements")
  async create(@Context() ctx: ExecutionContext, @Body() raw: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const input = parseMeasurementInput(raw);
    const now = new Date().toISOString();
    const m: RoofMeasurement = {
      id: newId(),
      userId: user.id,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.put(m);
    return ctx.json(view(m), 201);
  }

  @Get("measurements/:id")
  async one(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return view(await this.store.getOwned(id, user.id));
  }

  @Put("measurements/:id")
  async update(
    @Context() ctx: ExecutionContext,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const cur = await this.store.getOwned(id, user.id);
    const input = parseMeasurementInput(raw);
    const m: RoofMeasurement = {
      ...cur,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    await this.store.put(m);
    return view(m);
  }

  @Delete("measurements/:id")
  async remove(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const cur = await this.store.getOwned(id, user.id);
    await this.store.delete(cur);
    return { ok: true, id };
  }
}
