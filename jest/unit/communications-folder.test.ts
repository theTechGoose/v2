/**
 * REQ-914 — the Communications folder on the sidebar root: the Outbox (REQ-784) moved inside it
 * as the first entry, the Phone (REQ-915/916) as the second; the folder sits where the Outbox row
 * was; both dictionaries carry the two nav strings.
 */
import * as fs from "fs";
import * as path from "path";
import { folderPathTo, isFolder, viewAt } from "../../front-end/lib/nav-folders";
import { NAV } from "../../front-end/lib/nav-tree";

const ROOT = path.resolve(__dirname, "../..");
const dict = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")) as Record<string, string>;

describe("REQ-914 the Communications folder", () => {
  test("REQ-914 the folder takes the Outbox row's place on the root, between Quotes and Billing", () => {
    const root = viewAt(NAV, []).items.map((n) => n.id);
    expect(root).not.toContain("outbox");
    expect(root.indexOf("communications")).toBe(root.indexOf("quotes") + 1);
    expect(root.indexOf("billing")).toBe(root.indexOf("communications") + 1);
    const folder = viewAt(NAV, []).items.find((n) => n.id === "communications")!;
    expect(isFolder(folder)).toBe(true);
    expect((folder as { icon: string }).icon).toBe("send");
  });

  test("REQ-914 it holds Outbox (/messages, URL unchanged) then Phone (/communications)", () => {
    const items = viewAt(NAV, ["communications"]).items;
    expect(items.map((n) => n.id)).toEqual(["outbox", "phone"]);
    expect(items.map((n) => (n as { href?: string }).href)).toEqual(["/messages", "/communications"]);
    expect(folderPathTo(NAV, "outbox")).toEqual(["communications"]);
    expect(folderPathTo(NAV, "phone")).toEqual(["communications"]);
  });

  test("REQ-914 both dictionaries name the folder and the Phone", () => {
    const en = dict("lang/en.json"), es = dict("lang/es.json");
    expect(en["nav.communications"]).toBe("Communications");
    expect(es["nav.communications"]).toBe("Comunicaciones");
    expect(en["nav.phone"]).toBe("Phone");
    expect(es["nav.phone"]).toBe("Teléfono");
    expect(en["nav.outbox"]).toBe("Outbox"); // unchanged
  });
});
