/**
 * REQ-296 — a demo that reaches its two hours ends for everyone, said on both pills (demo-loop
 * cycle 1, issue nc-3: the KV expiry was silent — no `ended`, both pills stayed "Connected").
 * The wire carries `reason: "expired"`; each side says it in its own words, naming nobody; a
 * stage carries it to /admin; both dictionaries have the line; the islands hand the reason on.
 */
import * as fs from "fs";
import * as path from "path";
import {
  endedHref,
  endedText,
  readEndedNotice,
  whoEnded,
} from "../../shared/demo-mode/ended.ts";
import { parseServerMessage } from "../../shared/demo-mode/protocol.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const hans = { userId: "u-hans", name: "Hans", color: "#2f6d29" };
const lia = { userId: "u-lia", name: "Lia", color: "#1f5fa8" };

describe("REQ-296 the expiry rides the wire", () => {
  test("`ended` keeps reason expired; any other reason is dropped", () => {
    expect(
      parseServerMessage('{"t":"ended","by":"presenter","reason":"expired"}'),
    ).toStrictEqual({ t: "ended", by: "presenter", reason: "expired" });
    expect(
      parseServerMessage('{"t":"ended","by":"viewer","reason":"expired"}'),
    ).toStrictEqual({ t: "ended", by: "viewer", reason: "expired" });
    expect(
      parseServerMessage('{"t":"ended","by":"viewer","reason":"bogus"}'),
    ).toStrictEqual({ t: "ended", by: "viewer" });
  });
});

describe("REQ-296 expiry names nobody, on either side", () => {
  const customer = {
    role: "viewer" as const,
    presenters: [hans],
    presenterName: "Hans",
  };
  const stage = {
    role: "presenter" as const,
    pid: "u-hans",
    presenters: [hans],
    targetName: "Ana Torres",
  };
  const expired = { by: "presenter" as const, reason: "expired" as const };

  test("the customer reads expired, not the one presenter's name", () => {
    expect(whoEnded(expired, customer)).toEqual({ by: "expired" });
    expect(whoEnded({ ...expired, pid: "u-hans" }, customer))
      .toEqual({ by: "expired" });
    expect(whoEnded(expired, { ...customer, presenters: [hans, lia] }))
      .toEqual({ by: "expired" });
  });

  test("a stage alone on the demo reads expired, not 'you'", () => {
    expect(whoEnded(expired, stage)).toEqual({ by: "expired" });
    expect(whoEnded({ ...expired, pid: "u-hans" }, stage))
      .toEqual({ by: "expired" });
  });

  test("the line is demoMode.expired, in both languages, and says two hours", () => {
    expect(endedText({ by: "expired" })).toEqual({ key: "demoMode.expired" });
    expect(en["demoMode.expired"]).toMatch(/two hours/i);
    expect(es["demoMode.expired"]).toMatch(/dos horas/i);
  });

  test("a stage's hop to /admin carries expired and reads it back", () => {
    const href = endedHref({ by: "expired" });
    const url = new URL(href, "https://documonster.test");
    expect(url.pathname).toBe("/admin");
    expect(url.searchParams.get("by")).toBe("expired");
    expect(readEndedNotice(url.search)).toEqual({
      notice: { by: "expired" },
      rest: "",
    });
  });
});

describe("REQ-296 the islands hand the reason on", () => {
  test("the transport's onEnded admits expired", () => {
    const tr = read("front-end/lib/demo-mode/transport.ts");
    expect(tr).toMatch(
      /onEnded\(by: Role, reason\?: "declined" \| "expired", pid\?: string\): void/,
    );
  });

  test("both pills pass the reason to whoEnded", () => {
    for (
      const island of [
        read("front-end/islands/DemoModeOverlay.tsx"),
        read("front-end/islands/DemoStage.tsx"),
      ]
    ) {
      expect(island).toMatch(/onEnded: \(by, reason, pid\)/);
      expect(island).toMatch(/whoEnded\(\{ by, reason, pid \}/);
    }
  });
});
