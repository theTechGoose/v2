/**
 * REQ-806 — `deno task ops`: the asker's side of the approve-link door. The session never leaves
 * the tool (it is saved 0600, never printed) and its browser sends no write to the app.
 */
import {
  blocksRequest,
  outName,
  parseOpsArgs,
  viewCookie,
} from "../../shared/ops/tool";

describe("REQ-806 ops tool", () => {
  test("parses ask / view / end", () => {
    expect(
      parseOpsArgs(["ask", "A2Z Landscape", "--reason", "check Xpress Pay"]),
    ).toEqual({
      cmd: "ask",
      account: "A2Z Landscape",
      reason: "check Xpress Pay",
      base: "https://documonster.com",
    });
    expect(
      parseOpsArgs([
        "view",
        "/invoices",
        "/i/abc",
        "--out",
        "/tmp/x",
        "--base",
        "http://localhost:5280",
      ]),
    ).toEqual({
      cmd: "view",
      paths: ["/invoices", "/i/abc"],
      out: "/tmp/x",
      base: "http://localhost:5280",
    });
    expect(parseOpsArgs(["end"])).toEqual({ cmd: "end" });
    expect(() => parseOpsArgs(["ask"])).toThrow("account");
    expect(() => parseOpsArgs(["view"])).toThrow("path");
    expect(() => parseOpsArgs(["nope"])).toThrow("usage");
  });
  test("the view browser aborts every write to the app, lets reads and other origins through", () => {
    const base = "https://documonster.com";
    expect(blocksRequest(base, "GET", "https://documonster.com/invoices")).toBe(
      false,
    );
    expect(
      blocksRequest(
        base,
        "POST",
        "https://documonster.com/api/invoices/1/claim-payment",
      ),
    ).toBe(true);
    expect(blocksRequest(base, "PUT", "https://documonster.com/api/me")).toBe(
      true,
    );
    expect(blocksRequest(base, "POST", "https://connect.facebook.net/tr")).toBe(
      true,
    );
    expect(blocksRequest(base, "GET", "https://fonts.googleapis.com/css")).toBe(
      false,
    );
  });
  test("files are named by order and path; the cookie is the app's own session cookie on its host", () => {
    expect(outName(0, "/i/1b2c?x=1")).toBe("01-i-1b2c-x-1");
    expect(outName(11, "/")).toBe("12-home");
    expect(viewCookie("https://documonster.com", "sid")).toEqual({
      name: "pm_session",
      value: "sid",
      domain: "documonster.com",
      path: "/",
      secure: true,
      httpOnly: true,
    });
    expect(viewCookie("http://localhost:5280", "sid").secure).toBe(false);
  });
});
