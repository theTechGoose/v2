/**
 * REQ-927 — "in services we need a way to migrate services to another and segment it out so we
 * can undo redo or move that segment to another spot". The /field/services page: Move to… on
 * every live card, the Moves list with Undo / Redo / Move to…, the words in both languages
 * without developer jargon, and the client calls the endpoints.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const page = read("front-end/islands/FieldServicesPage.tsx");
const client = read("front-end/clients/field.ts");

const KEYS = [
  "move", "moveTitle", "moveSub", "moveTo", "movePick", "moveDelete", "moveSubmit", "moveSegTitle", "moveSegSub",
  "moves", "movesSub",
  ...["subs", "ckls", "tasks", "crews"].flatMap((k) => [`mc.${k}.one`, `mc.${k}.other`]), "moveDeleted", "moveUndone", "undo", "redo",
  "err.same", "err.nothing", "err.archived", "err.crewConflict", "err.superseded", "err.undoNameTaken", "err.notApplied", "err.notUndone",
].map((k) => `field.svc.${k}`);
const JARGON = /server|servidor|backend|\bAPI\b|endpoint|\bid\b|null|undefined|taskType|segment/i;

describe("REQ-927 service migration on /field/services", () => {
  for (const [lang, d] of [["en", en], ["es", es]] as const) {
    test(`${lang}: every key exists, is non-empty and has no developer jargon`, () => {
      expect(KEYS.filter((k) => typeof d[k] !== "string" || !d[k].trim())).toEqual([]);
      expect(KEYS.filter((k) => JARGON.test(d[k] ?? ""))).toEqual([]);
    });
    test(`${lang}: the in-use refusal points at Move to…`, () => {
      expect(d["field.svc.inUse"]).toContain(d["field.svc.move"]);
    });
  }
  test("a move's counts read in the singular for one", () => {
    expect([en["field.svc.mc.crews.one"], es["field.svc.mc.crews.one"]]).toEqual(["{n} crew", "{n} cuadrilla"]);
    expect(page).toMatch(/tn\(`field\.svc\.mc\.\$\{k\}`/);
  });
  test("the languages differ", () => {
    expect(KEYS.filter((k) => en[k] === es[k])).toEqual([]);
  });
  test("the client calls migrate, the list, undo, redo and move", () => {
    expect(client).toMatch(/migrateTaskType:[\s\S]*?`\/field\/task-types\/\$\{id\}\/migrate`/);
    expect(client).toMatch(/serviceMigrations:[\s\S]*?"\/field\/service-migrations"/);
    for (const verb of ["undo", "redo", "move"]) {
      expect(client).toMatch(new RegExp("`/field/service-migrations/\\$\\{id\\}/" + verb + "`"));
    }
  });
  test("the page: Move to… on live cards, a move form with the target and delete-after, the Moves list with Undo / Redo / Move to…", () => {
    for (const cy of ["svc-migrate", "svc-move-form", "svc-move-target", "svc-move-delete", "svc-move-submit", "svc-moves", "svc-move-row", "svc-move-undo", "svc-move-redo", "svc-move-again", "svc-move-error"]) {
      expect(page).toContain(`data-cy="${cy}"`);
    }
    for (const code of ["same_service", "nothing_to_migrate", "target_archived", "migration_crew_conflict", "segment_superseded", "undo_name_taken", "segment_not_applied", "segment_not_undone"]) {
      expect(page).toMatch(new RegExp(`\\b${code}\\b`));
    }
  });
});
