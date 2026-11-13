/**
 * REQ-699 (demo-loop cycle 5, M20) — signing a recurring quote starts its
 * billing in Field. Pair 2 signed "$180 al mes" and Campo → Suscripciones
 * still read "0 ACTIVAS": nothing outside the Field module used the
 * SubscriptionStore. This registers on paperwork's QuoteSubscriptionPort at
 * boot; SendSignedConfirmation asks it when the signed quote's payment term
 * is recurring.
 *
 * One subscription per quote (`quoteId`) — a replayed accept finds it and
 * makes nothing new. The job's address is geocoded once; a quote with no
 * address at all, or one the geocoder cannot place, still bills — it sits on
 * the business's map centre until the office fills the address in. It is
 * grouped into a zone like any subscription, so the day's round can staff it
 * and the batch bills each period.
 */
import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteSubscriptionPort } from "@paperwork/domain/coordinators/quote-subscription-port/mod.ts";
import {
  SubscriptionStore,
  TaskTypeStore,
} from "@field/domain/data/field-stores/mod.ts";
import { FieldGeocoder } from "@field/domain/data/geocoder/mod.ts";
import {
  FieldZones,
  newId,
} from "@field/domain/coordinators/field-zones/mod.ts";
import { FieldMapCenter } from "@field/domain/coordinators/field-map-center/mod.ts";
import { findOrCreateTaskType } from "@field/domain/business/tasks/mod.ts";
import { subscriptionPlan } from "@field/domain/business/quote-subscription/mod.ts";
import { fieldToday } from "@field/domain/business/schedule/mod.ts";
import { CAP, type Subscription } from "@field/dto/field.ts";

@Injectable()
export class FieldQuoteSubscriptions {
  constructor(
    private subs: SubscriptionStore,
    private types: TaskTypeStore,
    private quotes: QuoteStore,
    private customers: CustomerStore,
    private geocoder: FieldGeocoder,
    private zones: FieldZones,
    private mapCenter: FieldMapCenter,
    // optional so a hand-built coordinator (its own tests) runs without it
    port?: QuoteSubscriptionPort,
  ) {
    port?.register((e) => this.fromQuote(e));
  }

  /** The subscription that bills this signed quote — made the first time. */
  async fromQuote(
    e: { userId: string; quoteId: string },
  ): Promise<{ subscriptionId: string } | null> {
    const quote = await this.quotes.getOwned(e.quoteId, e.userId);
    const existing = (await this.subs.listByUser(e.userId)).find((s) =>
      s.quoteId === quote.id
    );
    if (existing) return { subscriptionId: existing.id };
    const customer = quote.customerId
      ? await this.customers.getOwned(quote.customerId, e.userId)
        .catch(() => null)
      : null;
    const plan = subscriptionPlan(quote, {
      today: fieldToday(),
      customerAddress: customer?.address,
    });
    if (!plan || !customer) return null;

    const known = await this.types.listByUser(e.userId);
    const { type, created } = findOrCreateTaskType(
      known,
      plan.taskTypeName,
      e.userId,
      newId,
    );
    if (created) await this.types.put(type);
    const address = plan.address.slice(0, CAP.text);
    const { lat, lng } = await this.place(e.userId, address);
    const now = new Date().toISOString();
    const s: Subscription = {
      id: newId(),
      userId: e.userId,
      customerId: plan.customerId,
      address,
      lat,
      lng,
      items: [{ taskTypeId: type.id, priceCents: plan.priceCents }],
      cadence: plan.cadence,
      ...(plan.intervalWeeks ? { intervalWeeks: plan.intervalWeeks } : {}),
      startDate: plan.startDate,
      ...(plan.endDate ? { endDate: plan.endDate } : {}),
      quoteId: plan.quoteId,
      ...(plan.quoteNumber ? { quoteNumber: plan.quoteNumber } : {}),
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await this.subs.put(s);
    try {
      await this.zones.regroup(e.userId);
    } catch (err) {
      // the subscription stands; the next change regroups the zones
      console.error(`[field] quote ${quote.id}: zone regroup failed:`, err);
    }
    return { subscriptionId: s.id };
  }

  /** the address on the map, once — else the business's own spot */
  private async place(
    userId: string,
    address: string,
  ): Promise<{ lat: number; lng: number }> {
    if (address) {
      try {
        return await this.geocoder.geocode(address);
      } catch (err) {
        console.error(
          `[field] cannot geocode "${address}" — placed on the business's map:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    const { lat, lng } = await this.mapCenter.center(userId);
    return { lat, lng };
  }
}
