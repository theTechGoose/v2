/** REQ-900/901 — the TwiML the line answers Twilio with. */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import {
  connectRelay,
  dialNumber,
  emptyResponse,
  escapeXml,
  forwardTo,
  hangup,
  record,
  ringClients,
} from "./mod.ts";

const XML = '<?xml version="1.0" encoding="UTF-8"?>';

Deno.test("REQ-900 twiml: emptyResponse and hangup are well-formed", () => {
  assertEquals(emptyResponse(), `${XML}<Response></Response>`);
  assertEquals(hangup(), `${XML}<Response><Hangup/></Response>`);
});

Deno.test("REQ-900 twiml: dialNumber dials the peer with the line as caller id and a status callback", () => {
  const xml = dialNumber({ callerId: "+18432588463", to: "+15125551234", statusCallback: "https://app.test/communications/twilio/voice/status" });
  assertStringIncludes(xml, '<Dial callerId="+18432588463"');
  assertStringIncludes(xml, '<Number statusCallback="https://app.test/communications/twilio/voice/status" statusCallbackEvent="initiated ringing answered completed">+15125551234</Number>');
});

Deno.test("REQ-900 twiml: ringClients rings every softphone identity for the timeout and reports to the action url", () => {
  const xml = ringClients({ identities: ["u_1", "u_2"], timeoutSec: 20, action: "https://app.test/communications/twilio/voice/unanswered", callerId: "+15125551234" });
  assertStringIncludes(xml, '<Dial timeout="20" action="https://app.test/communications/twilio/voice/unanswered" callerId="+15125551234">');
  assertStringIncludes(xml, "<Client>u_1</Client><Client>u_2</Client>");
});

Deno.test("REQ-900 twiml: record says the prompt, records up to the max, and names the recording callback", () => {
  const xml = record({ sayFirst: "Leave a message after the tone.", maxLengthSec: 120, recordingStatusCallback: "https://app.test/communications/twilio/voice/recording" });
  assertStringIncludes(xml, "<Say>Leave a message after the tone.</Say>");
  assertStringIncludes(xml, '<Record maxLength="120" playBeep="true" recordingStatusCallback="https://app.test/communications/twilio/voice/recording"/>');
});

Deno.test("REQ-901 twiml: connectRelay opens ConversationRelay on our wss url with the greeting, the action, and custom parameters", () => {
  const xml = connectRelay({
    url: "wss://app.test/communications/voice/relay",
    action: "https://app.test/communications/twilio/voice/relay-done",
    welcomeGreeting: "Thanks for calling. Who am I speaking with?",
    language: "en-US",
    parameters: { callId: "c_1" },
  });
  assertStringIncludes(xml, '<Connect action="https://app.test/communications/twilio/voice/relay-done">');
  assertStringIncludes(xml, '<ConversationRelay url="wss://app.test/communications/voice/relay" welcomeGreeting="Thanks for calling. Who am I speaking with?" language="en-US"');
  assertStringIncludes(xml, '<Parameter name="callId" value="c_1"/>');
  assert(xml.endsWith("</ConversationRelay></Connect></Response>"));
});

Deno.test("REQ-900 twiml: forwardTo dials the configured phone", () => {
  const xml = forwardTo({ number: "+15125550000", callerId: "+18432588463" });
  assertStringIncludes(xml, '<Dial callerId="+18432588463"><Number>+15125550000</Number></Dial>');
});

Deno.test("REQ-900 twiml: text and attributes are XML-escaped", () => {
  assertEquals(escapeXml(`Tom & Jerry <3 "quotes" 'apos'`), "Tom &amp; Jerry &lt;3 &quot;quotes&quot; &apos;apos&apos;");
  const xml = record({ sayFirst: "Hi & bye", maxLengthSec: 10, recordingStatusCallback: "https://app.test/r?a=1&b=2" });
  assertStringIncludes(xml, "<Say>Hi &amp; bye</Say>");
  assertStringIncludes(xml, 'recordingStatusCallback="https://app.test/r?a=1&amp;b=2"');
});
