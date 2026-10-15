/**
 * REQ-077 — a server started for the gate or a pin runs on its own KV.
 *
 * `deno task serve` on a bare PORT is what the merge gate (wt-gate, REQ-278)
 * and `pin-link --serve` (REQ-287) start. Without a KV_PATH every one of
 * those servers — and the dev server on the default ports — opens Deno's ONE
 * default KV file for this checkout, so state crosses runs: the 30 s
 * per-address OTP cooldown (P-03) set by the previous gate's login story, or
 * by the pinned server, answers 429 to the next run's fixed address, the
 * login island shows the cooldown and never navigates, and the story waits
 * out its 90 s (2026-10-15: the judge's e2e lane red on login-internal twice
 * on an untouched page; reproduced back-to-back on the pin, 4/4 then 3/4).
 *
 * So `kvPathFor` decides the backend child's KV_PATH: an explicit KV_PATH
 * always wins; a bare PORT with none gets a fresh file in a temp dir of its
 * own; no PORT (a developer's own `deno task serve`) keeps the platform
 * default and its persistent dev data.
 */
import { kvPathFor } from "../../scripts/serve-kv";

describe("REQ-077 a server started for the gate or a pin runs on its own KV", () => {
  const tmp = () => "/tmp/v2-kv-abc123";

  it("REQ-077 a bare PORT with no KV_PATH gets a fresh KV file in its own temp dir", () => {
    expect(kvPathFor({ PORT: "26615" }, tmp)).toBe(
      "/tmp/v2-kv-abc123/kv.sqlite3",
    );
  });

  it("REQ-077 an explicit KV_PATH always wins, PORT or not", () => {
    expect(kvPathFor({ PORT: "26615", KV_PATH: "/data/dev.sqlite3" }, tmp))
      .toBe("/data/dev.sqlite3");
    expect(kvPathFor({ KV_PATH: "/data/dev.sqlite3" }, tmp)).toBe(
      "/data/dev.sqlite3",
    );
  });

  it("REQ-077 no PORT keeps the platform default — a developer's own serve keeps its data", () => {
    let made = 0;
    expect(kvPathFor({}, () => {
      made++;
      return "/tmp/never";
    })).toBeUndefined();
    expect(kvPathFor({ PORT: "" }, () => {
      made++;
      return "/tmp/never";
    })).toBeUndefined();
    expect(made).toBe(0);
  });

  it("REQ-077 two servers started one after the other never share a file", () => {
    let n = 0;
    const fresh = () => `/tmp/v2-kv-${++n}`;
    expect(kvPathFor({ PORT: "26615" }, fresh)).not.toBe(
      kvPathFor({ PORT: "26617" }, fresh),
    );
  });
});
