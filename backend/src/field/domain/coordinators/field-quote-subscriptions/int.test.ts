/**
 * REQ-699 (demo-loop cycle 5, M20) — signing a recurring quote starts its
 * billing in Field. Pair 2 signed "$180 al mes" and Campo → Suscripciones
 * still said "0 ACTIVAS" (fleet-1 stdout:433): nothing outside
 * backend/src/field used SubscriptionStore.
 *
 * The real stores on an in-memory KV, the coordinator registered on
 * paperwork's QuoteSubscriptionPort the way the app boots it.
 */
import { assert, assertEquals } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { FieldQuoteSubscriptions } from "./mod.ts";
import { QuoteSubscriptionPort } from "@paperwork/domain/coordinators/quote-subscription-port/mod.ts";
import {
  RegionStore,
  SubscriptionStore,
  TaskTypeStore,
} from "@field/domain/data/field-stores/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { FieldGeocoder } from "@field/domain/data/geocoder/mod.ts";
import { FieldZones } from "@field/domain/coordinators/field-zones/mod.ts";
import { FieldMapCenter } from "@field/domain/coordinators/field-map-center/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { fieldToday, shiftDate } from "@field/domain/business/schedule/mod.ts";
import { US_VIEW } from "@field/domain/business/map-center/mod.ts";

const U = "u-699";

function rig() {
  const subs = new SubscriptionStore();
  const regions = new RegionStore();
  const types = new TaskTypeStore();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const geocoder = new FieldGeocoder();
  const port = new QuoteSubscriptionPort();
  const coordinator = new FieldQuoteSubscriptions(
    subs,
    types,
    quotes,
    customers,
    geocoder,
    new FieldZones(subs, regions),
    new FieldMapCenter(new BusinessAddressStore(), geocoder),
    port,
  );
  return {
    subs,
    regions,
    types,
    quotes,
    customers,
    geocoder,
    port,
    coordinator,
  };
}

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  return rig();
}

const term = (stepId: string, value: string) => ({
  stepId,
  label: stepId,
  value,
});

/** pair 2's agreement, signed */
async function signedQuote(
  r: ReturnType<typeof rig>,
  o: { payment?: string; address?: string; customerAddress?: string } = {},
) {
  const maria = await r.customers.create(U, {
    name: "María López",
    phoneNumber: "3055550144",
    ...(o.customerAddress ? { address: o.customerAddress } : {}),
  });
  const quote = await r.quotes.create(U, {
    summary: "Corte de césped y poda de setos",
    jobName: "Corte de césped",
    customerId: maria.id,
    ...(o.address !== undefined ? { serviceAddress: o.address } : {
      serviceAddress: "845 Palm Ave, Orlando, FL 32803",
    }),
    lineItems: [{
      description: "Mantenimiento mensual de jardín (4 visitas al mes)",
      quantity: 1,
      unit: "month",
      price: 18_000,
    }],
    estimatedTotal: 18_000,
    terms: [
      term("start_date", "Next week"),
      term("wraps", "2 hours"),
      term("payment_terms", o.payment ?? "Monthly · $180/mo"),
    ],
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
  return { maria, quote };
}

Deno.test("REQ-699 M20 the port: pair 2's signed monthly quote becomes ONE linked, zoned Field subscription", async () => {
  const r = await fresh();
  const { maria, quote } = await signedQuote(r);

  const made = await r.port.run({ userId: U, quoteId: quote.id });

  assert(made?.subscriptionId, "the port answers the subscription it made");
  const all = await r.subs.listByUser(U);
  assertEquals(all.length, 1);
  const s = all[0];
  assertEquals(
    [
      s.id,
      s.quoteId,
      s.quoteNumber,
      s.customerId,
      s.address,
      s.cadence,
      s.startDate,
      s.active,
    ],
    [
      made.subscriptionId,
      quote.id,
      quote.number,
      maria.id,
      "845 Palm Ave, Orlando, FL 32803",
      "monthly",
      shiftDate(fieldToday(), 7),
      true,
    ],
  );
  const types = await r.types.listByUser(U);
  assertEquals(types.map((t) => t.name), ["Corte de césped"]);
  assertEquals(s.items, [{ taskTypeId: types[0].id, priceCents: 18_000 }]);
  assert(s.regionId, "grouped into a zone, so the day's round can staff it");
  assertEquals((await r.regions.listByUser(U)).length, 1);
  assertEquals(r.geocoder.fake?.calls, 1, "the address is geocoded once");
});

Deno.test("REQ-699 the port is idempotent: a second run (a replayed accept) makes nothing new", async () => {
  const r = await fresh();
  const { quote } = await signedQuote(r);
  const first = await r.port.run({ userId: U, quoteId: quote.id });
  const again = await r.coordinator.fromQuote({ userId: U, quoteId: quote.id });
  assertEquals(again?.subscriptionId, first?.subscriptionId);
  assertEquals((await r.subs.listByUser(U)).length, 1);
  assertEquals((await r.types.listByUser(U)).length, 1);
});

Deno.test("REQ-699 the job's task type is reused when the account already has it (any case)", async () => {
  const r = await fresh();
  await r.types.put({
    id: "t-0",
    userId: U,
    name: "corte de CÉSPED",
    createdAt: new Date().toISOString(),
  });
  const { quote } = await signedQuote(r, {
    payment: "Every 2 weeks · $90/2 wks · until 2027-06-30",
  });
  await r.port.run({ userId: U, quoteId: quote.id });
  const [s] = await r.subs.listByUser(U);
  assertEquals(
    [
      s.items[0].taskTypeId,
      s.items[0].priceCents,
      s.cadence,
      s.intervalWeeks,
      s.endDate,
    ],
    ["t-0", 9_000, "biweekly", 2, "2027-06-30"],
  );
  assertEquals((await r.types.listByUser(U)).length, 1);
});

Deno.test("REQ-699 a one-off payment term makes no subscription", async () => {
  const r = await fresh();
  const { quote } = await signedQuote(r, { payment: "50/50" });
  assertEquals(await r.port.run({ userId: U, quoteId: quote.id }), null);
  assertEquals((await r.subs.listByUser(U)).length, 0);
});

Deno.test("REQ-699 no job address: the customer's, else none — still made, placed on the business's map", async () => {
  const r = await fresh();
  const { quote } = await signedQuote(r, {
    address: "",
    customerAddress: "12 Oak St, Orlando, FL 32801",
  });
  await r.port.run({ userId: U, quoteId: quote.id });
  assertEquals(
    (await r.subs.listByUser(U))[0].address,
    "12 Oak St, Orlando, FL 32801",
  );

  const r2 = await fresh();
  const bare = await signedQuote(r2, { address: "" });
  const made = await r2.port.run({ userId: U, quoteId: bare.quote.id });
  assert(made?.subscriptionId);
  const [s] = await r2.subs.listByUser(U);
  assertEquals([s.address, s.lat, s.lng], ["", US_VIEW.lat, US_VIEW.lng]);
});
