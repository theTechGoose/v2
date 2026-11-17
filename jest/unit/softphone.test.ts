/**
 * REQ-916 — the softphone's pure state machine (front-end/lib/softphone.ts): idle → registering
 * → ready → dialing / ringing → in-call → back to ready (the device stays registered) and idle
 * when it is torn down; the error states and the one-line reason; the token refresh timing as a
 * function of expiresAt and now; the in-call timer; the Calls view's row formatting.
 */
import {
  formatTimer,
  initialPhone,
  type PhoneEvent,
  phoneReducer,
  type PhoneState,
  reasonDetail,
  reasonKey,
  refreshDelayMs,
  VOICE_SDK_URL,
} from "../../front-end/lib/softphone";
import { callRow } from "../../front-end/lib/communications";
import * as fs from "fs";
import * as path from "path";

const run = (events: PhoneEvent[], from: PhoneState = initialPhone()) =>
  events.reduce(phoneReducer, from);

describe("REQ-916 the softphone state machine", () => {
  test("REQ-916a idle → registering → ready → dialing → in-call → ready, and teardown → idle", () => {
    const s0 = initialPhone();
    expect(s0.phase).toBe("idle");
    const s1 = phoneReducer(s0, { type: "register" });
    expect(s1.phase).toBe("registering");
    const s2 = phoneReducer(s1, { type: "registered" });
    expect(s2.phase).toBe("ready");
    const s3 = phoneReducer(s2, { type: "dial", to: "+15125559876" });
    expect(s3).toMatchObject({
      phase: "dialing",
      peer: "+15125559876",
      direction: "outbound",
    });
    const s4 = phoneReducer(s3, { type: "accepted", at: 1000 });
    expect(s4).toMatchObject({ phase: "in-call", startedAt: 1000 });
    const s5 = phoneReducer(s4, { type: "ended" });
    expect(s5.phase).toBe("ready");
    expect(s5.peer).toBeUndefined();
    expect(s5.startedAt).toBeUndefined();
    expect(phoneReducer(s5, { type: "unregistered" }).phase).toBe("idle");
  });

  test("REQ-916a an incoming call rings with the caller; Answer → in-call, Decline → ready; a second call while busy is ignored", () => {
    const ready = run([{ type: "register" }, { type: "registered" }]);
    const ring = phoneReducer(ready, {
      type: "incoming",
      from: "+15125550001",
    });
    expect(ring).toMatchObject({
      phase: "ringing",
      peer: "+15125550001",
      direction: "inbound",
    });
    expect(phoneReducer(ring, { type: "accepted", at: 5 }).phase).toBe(
      "in-call",
    );
    expect(phoneReducer(ring, { type: "declined" }).phase).toBe("ready");
    expect(phoneReducer(ring, { type: "ended" }).phase).toBe("ready"); // the caller hung up first
    const busy = phoneReducer(ring, { type: "accepted", at: 5 });
    expect(phoneReducer(busy, { type: "incoming", from: "+1999" })).toBe(busy);
    // dialing is only from ready
    expect(phoneReducer(initialPhone(), { type: "dial", to: "+1" }).phase)
      .toBe("idle");
  });

  test("REQ-916a mute toggles only in a call and resets when the call ends", () => {
    const inCall = run([
      { type: "register" },
      { type: "registered" },
      { type: "dial", to: "+1512" },
      { type: "accepted", at: 0 },
    ]);
    const muted = phoneReducer(inCall, { type: "mute", muted: true });
    expect(muted.muted).toBe(true);
    expect(phoneReducer(muted, { type: "ended" }).muted).toBe(false);
    const ready = run([{ type: "register" }, { type: "registered" }]);
    expect(phoneReducer(ready, { type: "mute", muted: true }).muted).toBe(
      false,
    );
  });

  test("REQ-916c a failure from any phase is the error state with its reason; register again retries", () => {
    const err = run([
      { type: "register" },
      { type: "failed", reason: "sdk" },
    ]);
    expect(err).toMatchObject({ phase: "error", reason: "sdk" });
    expect(phoneReducer(err, { type: "register" }).phase).toBe("registering");
    expect(phoneReducer(err, { type: "register" }).reason).toBeUndefined();
    // a call's own failure drops the call, the device stays ready
    const dialing = run([
      { type: "register" },
      { type: "registered" },
      { type: "dial", to: "+1" },
    ]);
    expect(phoneReducer(dialing, { type: "callFailed" }).phase).toBe("ready");
  });

  test("REQ-916c the one-line reason: no API key (503), the SDK cannot load, mic denied, anything else", () => {
    expect(reasonKey({ status: 503 })).toBe("comms.phone.reason.noKey");
    expect(reasonKey({ status: 409 })).toBe("comms.phone.reason.noLine");
    expect(
      reasonKey(
        new TypeError("Failed to fetch dynamically imported module"),
        "sdk",
      ),
    )
      .toBe("comms.phone.reason.sdk");
    expect(reasonKey({ name: "NotAllowedError" })).toBe(
      "comms.phone.reason.mic",
    );
    expect(reasonKey({ code: 31402 })).toBe("comms.phone.reason.mic");
    expect(reasonKey({ code: 31208 })).toBe("comms.phone.reason.mic");
    expect(reasonKey(new Error("boom"))).toBe("comms.phone.reason.twilio");
  });

  test("REQ-916a the token is re-minted 60 s before it expires (half the remaining life when under a minute), never in the past", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    expect(refreshDelayMs("2026-11-17T13:00:00Z", now)).toBe(3_540_000);
    expect(refreshDelayMs("2026-11-17T12:01:30Z", now)).toBe(30_000);
    expect(refreshDelayMs("2026-11-17T12:01:00Z", now)).toBe(30_000);
    expect(refreshDelayMs("2026-11-17T12:00:40Z", now)).toBe(20_000);
    expect(refreshDelayMs("2026-11-17T11:59:00Z", now)).toBe(0);
    expect(refreshDelayMs("not a date", now)).toBe(0);
  });

  test("REQ-916a the call timer reads m:ss, then h:mm:ss", () => {
    expect(formatTimer(0)).toBe("0:00");
    expect(formatTimer(65_400)).toBe("1:05");
    expect(formatTimer(3_725_000)).toBe("1:02:05");
    expect(formatTimer(-5)).toBe("0:00");
  });

  test("REQ-916b the Calls view: direction, peer, status chip, handledBy, duration", () => {
    const row = callRow(
      {
        id: "c1",
        peer: "+15125559876",
        direction: "inbound",
        status: "completed",
        handledBy: "agent",
        durationSec: 125,
        startedAt: "2026-11-17T10:00:00Z",
        createdAt: "2026-11-17T10:00:00Z",
      } as Parameters<typeof callRow>[0],
    );
    expect(row).toEqual({
      id: "c1",
      dirKey: "comms.calls.dir.inbound",
      peer: "(512) 555-9876",
      status: { cls: "chip--green", key: "comms.callStatus.completed" },
      handledKey: "comms.handledBy.agent",
      duration: "2:05",
      at: "2026-11-17T10:00:00Z",
    });
    for (const h of ["none", "client", "agent", "voicemail", "forward"]) {
      expect(
        callRow(
          {
            id: "x",
            peer: "",
            direction: "outbound",
            status: "busy",
            handledBy: h,
            createdAt: "2026-11-17T10:00:00Z",
          } as Parameters<typeof callRow>[0],
        ).handledKey,
      ).toBe(`comms.handledBy.${h}`);
    }
  });

  test("REQ-916a the Voice SDK comes from an https CDN at runtime and is in no deno.json", () => {
    expect(VOICE_SDK_URL).toMatch(
      /^https:\/\/.+@twilio\/voice-sdk@\d+\.\d+\.\d+/,
    );
    const ROOT = path.resolve(__dirname, "../..");
    for (const f of ["deno.json", "front-end/deno.json", "backend/deno.json"]) {
      const p = path.join(ROOT, f);
      if (fs.existsSync(p)) {
        expect(fs.readFileSync(p, "utf8")).not.toContain("voice-sdk");
      }
    }
    const island = fs.readFileSync(
      path.join(ROOT, "front-end/islands/PhonePage.tsx"),
      "utf8",
    );
    expect(island).toMatch(
      /import\(\s*\/\* @vite-ignore \*\/\s*VOICE_SDK_URL\s*\)/,
    );
  });

  test("REQ-919 the SDK is esm.sh's bundled build (the plain one breaks on loglevel), and an unknown error keeps Twilio's code and message", () => {
    expect(VOICE_SDK_URL).toBe(
      "https://esm.sh/@twilio/voice-sdk@2.19.0?bundle",
    );
    expect(reasonDetail({ code: 31204, message: "Unable to validate token" }))
      .toBe("31204: Unable to validate token");
    expect(
      reasonDetail(
        new TypeError("Cannot read properties of undefined (reading 'ERROR')"),
      ),
    ).toBe("TypeError: Cannot read properties of undefined (reading 'ERROR')");
    expect(reasonDetail({ status: 503 })).toBe(""); // a known reason needs no detail
    expect(reasonDetail({ code: 31402 })).toBe("");
    expect(reasonDetail(undefined)).toBe("");
    const s = phoneReducer(initialPhone(), {
      type: "failed",
      reason: "comms.phone.reason.twilio",
      detail: "31204: Unable to validate token",
    });
    expect(s).toMatchObject({
      phase: "error",
      reason: "comms.phone.reason.twilio",
      detail: "31204: Unable to validate token",
    });
    const island = fs.readFileSync(
      path.resolve(__dirname, "../../front-end/islands/PhonePage.tsx"),
      "utf8",
    );
    expect(island).toContain("reasonDetail(e");
    expect(island).toContain("s.detail");
  });
});
