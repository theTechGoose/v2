/**
 * REQ-1156 (LOOP-007 q3-88) — a hire in a department with no systems is never promised accounts:
 * the done screen's copy and the owner's Accounts-panel action follow whether there is anything
 * to provision.
 */
import { accountsAction, signDoneKey } from "../../front-end/lib/hr";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const dict = (rel: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")) as Record<
    string,
    string
  >;

describe("REQ-1156 no accounts promised without systems", () => {
  test("REQ-1156 signDoneKey: 0 or unknown accounts → the no-accounts copy; 1+ → the accounts promise", () => {
    expect(signDoneKey(0)).toBe("hr.sign.done.bodyNoAccounts");
    expect(signDoneKey(undefined)).toBe("hr.sign.done.bodyNoAccounts");
    expect(signDoneKey(1)).toBe("hr.sign.done.body");
    expect(signDoneKey(3)).toBe("hr.sign.done.body");
  });

  test("REQ-1156 the no-accounts copy exists in both languages and never mentions accounts", () => {
    const en = dict("lang/en.json")["hr.sign.done.bodyNoAccounts"];
    const es = dict("lang/es.json")["hr.sign.done.bodyNoAccounts"];
    expect(en).toContain("{company}");
    expect(es).toContain("{company}");
    expect(en).not.toMatch(/account/i);
    expect(es).not.toMatch(/cuenta/i);
    expect(dict("lang/en.json")["hr.detail.markReady"]).toBeTruthy();
    expect(dict("lang/es.json")["hr.detail.markReady"]).toBeTruthy();
  });

  test("REQ-1156 accountsAction: Create accounts only with systems; a signed no-systems hire gets Mark ready", () => {
    expect(accountsAction({ status: "signed", systemIds: [] })).toBe("finish");
    expect(accountsAction({ status: "active", systemIds: [] })).toBeNull();
    expect(accountsAction({ status: "provisioning", systemIds: [] }))
      .toBeNull();
    expect(accountsAction({ status: "signed", systemIds: ["s1"] })).toBe(
      "provision",
    );
    expect(accountsAction({ status: "active", systemIds: ["s1"] })).toBe(
      "provision",
    );
    expect(accountsAction({ status: "signing", systemIds: ["s1"] })).toBeNull();
    expect(accountsAction({ status: "invited", systemIds: [] })).toBeNull();
  });
});
