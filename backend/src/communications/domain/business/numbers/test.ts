/** REQ-903 — searching Twilio's inventory and what a line looks like to the app. */
import { assertEquals, assertThrows } from "#std/assert";
import { availableNumbersQuery, mapAvailable, parseAreaCode } from "./mod.ts";
import {
  type Line,
  parseBuyNumber,
  redactLine,
} from "@communications/dto/mod.ts";

Deno.test("REQ-903 availableNumbersQuery: voice + sms only, area code or contains, bounded page", () => {
  assertEquals(
    availableNumbersQuery({ areaCode: "843" }).toString(),
    "VoiceEnabled=true&SmsEnabled=true&PageSize=20&AreaCode=843",
  );
  assertEquals(
    availableNumbersQuery({ contains: "CLEAN", limit: 5 }).toString(),
    "VoiceEnabled=true&SmsEnabled=true&PageSize=5&Contains=CLEAN",
  );
  assertEquals(availableNumbersQuery({ limit: 999 }).get("PageSize"), "50");
});

Deno.test("REQ-903 parseAreaCode: three digits or nothing", () => {
  assertEquals(parseAreaCode("843"), "843");
  assertEquals(parseAreaCode(" (512) "), "512");
  assertEquals(parseAreaCode("12"), undefined);
  assertEquals(parseAreaCode(undefined), undefined);
});

Deno.test("REQ-903 mapAvailable: Twilio's rows become our shape, capabilities normalised", () => {
  const rows = [{
    phone_number: "+18435550100",
    friendly_name: "(843) 555-0100",
    locality: "Myrtle Beach",
    region: "SC",
    iso_country: "US",
    capabilities: { voice: true, SMS: true, MMS: false },
  }];
  assertEquals(mapAvailable(rows), [{
    phoneNumber: "+18435550100",
    friendlyName: "(843) 555-0100",
    locality: "Myrtle Beach",
    region: "SC",
    capabilities: { voice: true, sms: true, mms: false },
  }]);
});

Deno.test("REQ-903 parseBuyNumber: E.164 required; friendly name optional and trimmed", () => {
  assertEquals(
    parseBuyNumber({
      phoneNumber: "+18435550100",
      friendlyName: "  Shop line ",
    }),
    { phoneNumber: "+18435550100", friendlyName: "Shop line" },
  );
  assertEquals(parseBuyNumber({ phoneNumber: "843-555-0100" }), {
    phoneNumber: "+18435550100",
  });
  assertThrows(
    () => parseBuyNumber({ phoneNumber: "nope" }),
    Error,
    "phoneNumber",
  );
  assertThrows(() => parseBuyNumber({}), Error, "phoneNumber");
});

Deno.test("REQ-903 redactLine: the sealed secrets never leave the server", () => {
  const line: Line = {
    id: "l1",
    userId: "u1",
    kind: "subaccount",
    subaccountSid: "ACsub",
    number: "+18435550100",
    numberSid: "PN1",
    apiKeySid: "SK1",
    twimlAppSid: "AP1",
    friendlyName: "Shop",
    status: "active",
    authTokenSealed: "v1.x.y",
    apiKeySecretSealed: "v1.a.b",
    createdAt: "t",
    updatedAt: "t",
  };
  const pub = redactLine(line) as Record<string, unknown>;
  assertEquals("authTokenSealed" in pub, false);
  assertEquals("apiKeySecretSealed" in pub, false);
  assertEquals(pub.number, "+18435550100");
  assertEquals(pub.subaccountSid, "ACsub");
});
