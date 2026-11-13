/**
 * REQ-715 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5, issue m31 "No per-client language" (with c2-M29,
 * c3-m43, c4-M34): "use it for reminder, receipt and SMS sends". The field
 * module's texts to a customer — a canceled service, a service moved to
 * another day (REQ-171) — were written in the ACCOUNT's commsLanguage, so a
 * customer who reads Spanish got them in English.
 *
 * Integration: the real FieldNotices over the real stores on an in-memory
 * KV; only the SMS provider is captured.
 */
import { assertEquals, assertStringIncludes } from "#std/assert";
import { FieldNotices } from "./mod.ts";
import { FieldDay } from "@field/domain/coordinators/field-day/mod.ts";
import {
  FieldTaskStore,
  FieldWorkerStore,
  RegionStore,
  SubscriptionStore,
  TaskTypeStore,
} from "@field/domain/data/field-stores/mod.ts";
import type { FieldTask } from "@field/dto/field.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { CreateCustomerDto } from "@crm/dto/customer.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

const USER = "u-req715-field";

async function rig() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const texts: SendSmsInput[] = [];
  const sms = new SmsService();
  sms.send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve({ ok: true, sid: "SM-715" });
  };
  const customers = new CustomerStore();
  const identity = new BusinessIdentityStore();
  const notices = new FieldNotices(
    new UserStore(),
    identity,
    customers,
    new FieldWorkerStore(),
    new TaskTypeStore(),
    new SubscriptionStore(),
    new FieldDay(
      new SubscriptionStore(),
      new RegionStore(),
      new FieldTaskStore(),
    ),
    sms,
  );
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", USER], {
    id: USER,
    phoneNumber: "+15125557400",
    name: "Luis Ortega",
    language: "en",
    features: { fieldTexts: true },
    createdAt: now,
    updatedAt: now,
  });
  // the account's own send default is English
  await identity.upsert(USER, {
    businessName: "Ortega Lawn Care",
    commsLanguage: "en",
  });
  const carmen = await customers.create(USER, {
    name: "Carmen Ruiz",
    phoneNumber: "+15125557401",
    language: "es",
  } as CreateCustomerDto);
  const bob = await customers.create(USER, {
    name: "Bob Smith",
    phoneNumber: "+15125557402",
  });
  return { notices, texts, carmen, bob };
}

function task(id: string, customerId: string): FieldTask {
  return {
    id,
    userId: USER,
    subscriptionId: "sub-1",
    taskTypeId: "type-1",
    customerId,
    regionId: "region-1",
    workerId: "worker-1",
    date: "2099-03-10",
    priceCents: 40_00,
    status: "assigned",
  } as FieldTask;
}

Deno.test("REQ-715 m31 field texts: a canceled or moved service is texted in the customer's own language; a customer with none gets the account's", async () => {
  const r = await rig();
  try {
    await r.notices.customerCanceled(USER, task("t-1", r.carmen.id));
    await r.notices.customerDeferred(
      USER,
      task("t-2", r.carmen.id),
      "2099-03-11",
    );
    await r.notices.customerCanceled(USER, task("t-3", r.bob.id));

    const toCarmen = r.texts.filter((x) => x.to === "+15125557401");
    assertEquals(toCarmen.length, 2);
    assertStringIncludes(
      toCarmen[0].body,
      "tu servicio de",
      "canceled: Spanish",
    );
    assertStringIncludes(toCarmen[1].body, "tu servicio de", "moved: Spanish");
    const toBob = r.texts.filter((x) => x.to === "+15125557402");
    assertEquals(toBob.length, 1);
    assertStringIncludes(
      toBob[0].body,
      "your ",
      "no language: the account's English",
    );
  } finally {
    await resetKv();
  }
});
