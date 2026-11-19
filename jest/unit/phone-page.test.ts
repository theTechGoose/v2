/**
 * REQ-915 — the Phone page (/communications): the route mounts the PhonePage island in the
 * dashboard shell behind the owner's session, the client wraps every call of the REQ-899..905
 * API under its real paths, the pure helpers in lib/communications.ts (thread sort, timeline
 * merge, status chips, E.164 display, the shop's query), and both dictionaries carry comms.*.
 */
import * as fs from "fs";
import * as path from "path";
import {
  callChip,
  formatDuration,
  formatPhone,
  isNoLine,
  shopQuery,
  sortThreads,
  textChip,
  timeline,
  toE164,
} from "../../front-end/lib/communications";
import { commsClient } from "../../front-end/clients/communications";
import { ApiError } from "../../front-end/lib/api";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (rel: string) => JSON.parse(read(rel)) as Record<string, string>;
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

type Captured = { method: string; url: string; body: unknown };

function captureFetch(answer: unknown = {}): Captured[] {
  const seen: Captured[] = [];
  (globalThis as { fetch: unknown }).fetch = (
    url: string,
    init: { method: string; body?: string },
  ) => {
    seen.push({
      method: init.method,
      url: String(url),
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(answer)),
    } as unknown as Response);
  };
  return seen;
}

describe("REQ-915 the Phone page", () => {
  test("REQ-915a the route mounts PhonePage in the dashboard shell, behind the session gate, sidebar on phone", () => {
    const src = read("front-end/routes/communications/index.tsx");
    expect(src).toContain('from "../../islands/PhonePage.tsx"');
    // REQ-944: it carries the business's zone for the list clocks
    expect(src).toMatch(/<PhonePage(?:\s+timeZone=\{[^}]+\})?\s*\/>/);
    expect(src).toContain('<DashSidebar active="phone" />');
    expect(src).toContain('pageTitleKey="nav.phone"');
    expect(src).toContain('asset("/dashboard.css")');
    expect(src).toContain('asset("/phone.css")');
    expect(exists("front-end/static/phone.css")).toBe(true);
    expect(exists("front-end/islands/PhonePage.tsx")).toBe(true);
    const gate = read("front-end/routes/communications/_middleware.ts");
    expect(gate).toContain("loadUser(ctx.req)");
    expect(gate).toContain('Location: "/"');
  });

  test("REQ-915d the client hits every endpoint under its real path and method", async () => {
    const base = "http://localhost:3000";
    const seen = captureFetch({ numbers: [] });
    await commsClient.availableNumbers({ areaCode: "843" });
    await commsClient.availableNumbers({ contains: "CLEAN" });
    await commsClient.buyNumber("+18435550177", "Shop");
    await commsClient.line();
    await commsClient.release();
    await commsClient.threads();
    await commsClient.thread("+15125559876");
    await commsClient.sendText("+15125559876", "Hello");
    await commsClient.calls();
    await commsClient.call("call/1");
    await commsClient.voiceToken();
    expect(seen.map((s) => `${s.method} ${s.url.replace(base, "")}`)).toEqual([
      "GET /communications/numbers/available?areaCode=843",
      "GET /communications/numbers/available?contains=CLEAN",
      "POST /communications/numbers",
      "GET /communications/line",
      "POST /communications/line/release",
      "GET /communications/threads",
      "GET /communications/threads/%2B15125559876",
      "POST /communications/texts",
      "GET /communications/calls",
      "GET /communications/calls/call%2F1",
      "POST /communications/voice/token",
    ]);
    expect(seen[2].body).toEqual({
      phoneNumber: "+18435550177",
      friendlyName: "Shop",
    });
    expect(seen[7].body).toEqual({ to: "+15125559876", body: "Hello" });
  });

  test("REQ-915b threads sort newest first; the timeline merges texts and calls by time, oldest first", () => {
    const th = (peer: string, at: string) =>
      ({ peer, lastMessageAt: at }) as Parameters<typeof sortThreads>[0][0];
    const sorted = sortThreads([
      th("+1", "2026-11-17T10:00:00Z"),
      th("+2", "2026-11-17T12:00:00Z"),
      th("+3", "2026-11-16T23:00:00Z"),
    ]);
    expect(sorted.map((t) => t.peer)).toEqual(["+2", "+1", "+3"]);
    const text = (id: string, at: string) =>
      ({ id, createdAt: at }) as Parameters<typeof timeline>[0][0];
    const call = (id: string, at: string | undefined, created: string) =>
      ({ id, startedAt: at, createdAt: created }) as Parameters<
        typeof timeline
      >[1][0];
    const items = timeline(
      [text("t2", "2026-11-17T10:05:00Z"), text("t1", "2026-11-17T10:00:00Z")],
      [
        call("c1", "2026-11-17T10:02:00Z", "2026-11-17T09:00:00Z"),
        call("c2", undefined, "2026-11-17T10:09:00Z"),
      ],
    );
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      "text:t1",
      "call:c1",
      "text:t2",
      "call:c2",
    ]);
  });

  test("REQ-915b every text and call status maps to a chip class and a comms.status.* key", () => {
    expect(textChip("queued")).toEqual({
      cls: "chip--muted",
      key: "comms.status.queued",
    });
    expect(textChip("sending").cls).toBe("chip--muted");
    expect(textChip("sent").cls).toBe("chip--teal");
    expect(textChip("delivered").cls).toBe("chip--green");
    expect(textChip("failed").cls).toBe("chip--pink");
    expect(textChip("undelivered").cls).toBe("chip--pink");
    expect(textChip("received").cls).toBe("chip--teal");
    expect(textChip("dev").cls).toBe("chip--amber");
    expect(callChip("completed").cls).toBe("chip--green");
    expect(callChip("ringing").cls).toBe("chip--teal");
    expect(callChip("no-answer").cls).toBe("chip--pink");
    expect(callChip("in-progress").key).toBe("comms.callStatus.in-progress");
  });

  test("REQ-915a/b E.164 shows as (843) 555-0100; input normalizes to E.164; the shop's query is an area code or a word", () => {
    expect(formatPhone("+18435550100")).toBe("(843) 555-0100");
    expect(formatPhone("+447700900123")).toBe("+447700900123");
    expect(formatPhone("")).toBe("");
    expect(toE164("843-555-0100")).toBe("+18435550100");
    expect(toE164("1 (843) 555 0100")).toBe("+18435550100");
    expect(toE164("+44 7700 900123")).toBe("+447700900123");
    expect(toE164("12")).toBe(null);
    expect(shopQuery("843")).toEqual({ areaCode: "843" });
    expect(shopQuery(" clean ")).toEqual({ contains: "CLEAN" });
    expect(shopQuery("(843)")).toEqual({ areaCode: "843" });
    expect(shopQuery("084")).toBe(null);
    expect(shopQuery("")).toBe(null);
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(undefined)).toBe("—");
  });

  test("REQ-915a a 409 no_line (and only that) sends the page to the number shop", () => {
    expect(isNoLine(new ApiError(409, { code: "no_line" }))).toBe(true);
    expect(isNoLine(new ApiError(409, { message: "no line" }))).toBe(true);
    expect(isNoLine(new ApiError(409, { code: "line_exists" }))).toBe(false);
    expect(isNoLine(new ApiError(500, {}))).toBe(false);
    expect(isNoLine(new Error("x"))).toBe(false);
  });

  test("REQ-915e both dictionaries carry the same comms.* keys, every one the island uses", () => {
    const en = dict("lang/en.json"), es = dict("lang/es.json");
    const enK = Object.keys(en).filter((k) => k.startsWith("comms."));
    const esK = Object.keys(es).filter((k) => k.startsWith("comms."));
    expect(enK.length).toBeGreaterThan(40);
    expect(esK.sort()).toEqual(enK.sort());
    const used = new Set<string>();
    for (
      const f of [
        "front-end/islands/PhonePage.tsx",
        "front-end/lib/communications.ts",
        "front-end/lib/softphone.ts",
        "front-end/routes/communications/index.tsx",
      ]
    ) {
      for (const m of read(f).matchAll(/"(comms\.[A-Za-z0-9_.-]+)"/g)) {
        used.add(m[1]);
      }
    }
    expect(used.size).toBeGreaterThan(20);
    for (const k of used) {
      expect([k, typeof en[k]]).toEqual([k, "string"]);
      expect([k, typeof es[k]]).toEqual([k, "string"]);
    }
    for (
      const s of [
        "queued",
        "sending",
        "sent",
        "delivered",
        "undelivered",
        "failed",
        "received",
        "dev",
      ]
    ) expect(typeof en[`comms.status.${s}`]).toBe("string");
  });

  test("REQ-915b/916 the island talks to the API only through the client, has every data-cy, and no mock data", () => {
    const src = read("front-end/islands/PhonePage.tsx");
    expect(src).toContain('from "../clients/communications.ts"');
    expect(src).not.toMatch(/fetch\(/);
    expect(src).not.toMatch(/mock|fixture|sample/i);
    for (
      const cy of [
        "comms-search",
        "comms-buy",
        "comms-thread",
        "comms-compose",
        "comms-send",
        "comms-new-text",
        "comms-tab-inbox",
        "comms-tab-calls",
        "comms-dial",
        "comms-call",
        "comms-hangup",
        "comms-release",
        "comms-call-row",
      ]
    ) expect(src).toContain(`data-cy="${cy}"`);
    expect(src).toContain("15_000");
  });

  test("REQ-917 a provisioning failure whose reason is not_configured tells the truth: the line is not connected to Twilio", () => {
    const src = read("front-end/islands/PhonePage.tsx");
    expect(src).toContain('reason === "not_configured"');
    expect(src).toContain('t("comms.err.not_configured")');
    expect(src).toContain('t("comms.err.provisioning")');
    for (const lang of ["en", "es"]) {
      const d = JSON.parse(read(`lang/${lang}.json`));
      expect(d["comms.err.not_configured"]).toMatch(/Twilio/);
    }
  });
});
