/**
 * REQ-415 — demo-loop cycle 2, demo issue p11: "Examples that don't fit the trade (lawn placeholder
 * for fence builder, … 'Click' on phone)". The one-off task's Service box on /field/tasks showed the
 * fixed lawn-care example `field.tk.typePh` "Lawn, Mulch, Pool cleaning…" (and the missing-service
 * error `field.tk.needType` "Type the service (Lawn, Mulch…).") to every business — a fence builder
 * included. The assistant's empty state said "Click on a box…" on a phone.
 *
 * Fix: the examples come from the account's OWN task types (`serviceExamples` in
 * front-end/lib/field.ts → `field.tk.typePhFrom` / `field.tk.needTypeFrom`), and fall back to a
 * neutral "e.g. Weekly service, Repair visit…" when it has none. The empty-state title and the
 * send-button source strings carry no mouse-only "Click".
 */
import * as fs from "fs";
import * as path from "path";
import { serviceExamples, serviceHint } from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const island = read("front-end/islands/FieldTasksPage.tsx");

const ty = (...names: string[]) => names.map((name) => ({ name }));

describe("REQ-415 serviceExamples — the Service examples are the account's own task types", () => {
  test("a fence builder's types are the examples, up to three, in order", () => {
    expect(serviceExamples(ty("Fence install", "Gate repair", "Stain", "Post set"))).toBe(
      "Fence install, Gate repair, Stain",
    );
  });

  test("blank and repeated names (any case) are skipped", () => {
    expect(serviceExamples(ty("  ", "Deep clean", "deep clean ", "Move-out clean"))).toBe(
      "Deep clean, Move-out clean",
    );
  });

  test("no task types → empty (the neutral fallback is used)", () => {
    expect(serviceExamples([])).toBe("");
    expect(serviceExamples(ty(" "))).toBe("");
  });
});

describe("REQ-415 serviceHint — placeholder and missing-service error keys", () => {
  test("with types: the *From keys with the examples", () => {
    expect(serviceHint(ty("Fence install"), "ph")).toEqual({
      key: "field.tk.typePhFrom",
      vars: { examples: "Fence install" },
    });
    expect(serviceHint(ty("Fence install"), "need")).toEqual({
      key: "field.tk.needTypeFrom",
      vars: { examples: "Fence install" },
    });
  });

  test("without types: the neutral keys", () => {
    expect(serviceHint([], "ph")).toEqual({ key: "field.tk.typePh" });
    expect(serviceHint([], "need")).toEqual({ key: "field.tk.needType" });
  });
});

describe("REQ-415 the dictionaries carry no lawn-care example and no mouse-only 'Click'", () => {
  const LAWN = /lawn|mulch|pool|c[eé]sped|mantillo|piscina/i;
  test.each(["field.tk.typePh", "field.tk.needType"])("%s is neutral in en and es", (k) => {
    expect(en[k]).toBeTruthy();
    expect(es[k]).toBeTruthy();
    expect(en[k]).not.toMatch(LAWN);
    expect(es[k]).not.toMatch(LAWN);
    expect(en[k]).toMatch(/Weekly service/);
    expect(es[k]).toMatch(/Servicio semanal/);
  });

  test.each(["field.tk.typePhFrom", "field.tk.needTypeFrom"])("%s interpolates {examples} in en and es", (k) => {
    expect(en[k]).toContain("{examples}");
    expect(es[k]).toContain("{examples}");
  });

  test("the assistant's empty state has no 'Click' (en) and keeps 'Toca' (es)", () => {
    expect(en["asstChat.empty.title"]).not.toMatch(/\bclick\b/i);
    expect(es["asstChat.empty.title"]).toMatch(/\btoca\b/i);
  });

  test.each(["asstChat.preview.sendEmail", "asstChat.preview.sendSms"])("%s has no 'Click here'", (k) => {
    expect(en[k]).not.toMatch(/click here/i);
    expect(es[k]).not.toMatch(/haz clic/i);
  });
});

describe("REQ-415 FieldTasksPage binds the derived hint, not the fixed key", () => {
  test("no raw t(\"field.tk.typePh\") left; serviceHint drives both Service boxes and the error", () => {
    expect(island).not.toMatch(/t\("field\.tk\.typePh"\)/);
    expect(island).toMatch(/serviceHint\(types, "ph"\)/);
    expect(island).toMatch(/serviceHint\(types, "need"\)/);
  });
});
