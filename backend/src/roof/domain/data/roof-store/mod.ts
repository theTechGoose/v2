/**
 * REQ-856 — the account's roof measurements, one owned record each:
 *   [roof_measurement, id]                 → the record (carries userId)
 *   [roof_measurement_by_user, userId, id] → id
 */
import { Injectable } from "#danet/core";
import { OwnedStore } from "@field/domain/data/field-stores/mod.ts";
import type { RoofMeasurement } from "@roof/dto/roof.ts";

@Injectable()
export class RoofMeasurementStore extends OwnedStore<RoofMeasurement> {
  constructor() {
    super("roof_measurement");
  }
}
