/**
 * REQ-920d — the Systems tab's Phone & text card for a house line (REQ-920b): a number moved to
 * the main account texts through the platform's VERIFIED campaign, so the card says
 * "Registered (house)" — never blank, never "Not registered". The Phone page hides the ISV
 * registration panel for it (there is no subaccount left to register).
 */
import * as fs from "fs";
import * as path from "path";
import { systemsA2p } from "../../front-end/lib/a2p";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (rel: string) => JSON.parse(read(rel)) as Record<string, string>;

describe("REQ-920d the Systems card for the house line", () => {
  test("REQ-920d a main-kind line reads as registered (house); a customer line keeps its own word", () => {
    expect(
      systemsA2p({
        status: "active",
        number: "+1",
        kind: "main",
        a2p: "house",
      }),
    ).toBe("house");
    expect(
      systemsA2p({
        status: "active",
        number: "+1",
        kind: "subaccount",
        a2p: "pending",
      }),
    ).toBe("pending");
    expect(systemsA2p({ status: "active", number: "+1", kind: "env" }))
      .toBeUndefined();
    expect(systemsA2p({ status: "released", number: "+1", kind: "subaccount" }))
      .toBeUndefined();
    expect(systemsA2p({ status: "none" })).toBeUndefined();
    expect(systemsA2p(undefined)).toBeUndefined();
  });

  test("REQ-920d both dictionaries name the house registration; the card reads it through systemsA2p", () => {
    expect(dict("lang/en.json")["comms.a2p.sys.house"]).toBe(
      "Registered (house)",
    );
    expect(dict("lang/es.json")["comms.a2p.sys.house"]).toBeTruthy();
    const tab = read("front-end/components/SystemsTab.tsx");
    expect(tab).toContain("systemsA2p(line)");
  });

  test("REQ-920d the Phone page mounts the ISV registration panel only for a subaccount line", () => {
    const page = read("front-end/islands/PhonePage.tsx");
    expect(page).toMatch(/line\.kind !== "main" && <A2pPanel/);
  });
});
