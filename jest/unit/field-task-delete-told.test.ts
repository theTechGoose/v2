/**
 * REQ-1006 — LOOP-007 cycle 1, QA issue q1-92: "Deleting a scheduled one-off doesn't text the
 * customer, and the owner isn't told". DELETE /field/tasks/:id already answers
 * `{ ok: true, texted }` (REQ-171, false while the account's fieldTexts flag is off — REQ-177),
 * but `fieldClient.deleteTask` was typed `{ ok: true }` and FieldTasksPage.remove() always
 * flashed a plain "Task deleted", so the contractor never learned the customer was NOT told.
 *
 * Fix contract: `deletedNotice(texted, taskDate, today, customer)` in front-end/lib/field.ts picks
 * the flash — texted → `field.tk.deletedTexted`; not texted and the visit is today or later →
 * `field.tk.deletedNotTexted` (let them know); a past visit → plain `field.tk.deleted`.
 * remove() reads `texted` from deleteTask and flashes through it.
 */
import * as fs from "fs";
import * as path from "path";
import * as field from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const island = read("front-end/islands/FieldTasksPage.tsx");
const client = read("front-end/clients/field.ts");

type Notice = { key: string; vars: Record<string, string> };
const deletedNotice = (field as unknown as {
  deletedNotice?: (
    texted: boolean | undefined,
    taskDate: string,
    today: string,
    customer: string,
  ) => Notice;
}).deletedNotice;

describe("REQ-1006 deleting a task tells the owner whether the customer was texted (LOOP-007 q1-92)", () => {
  test("REQ-1006 lib/field exports deletedNotice", () => {
    expect(typeof deletedNotice).toBe("function");
  });

  test("REQ-1006 texted:true → 'was texted' flash naming the customer", () => {
    expect(deletedNotice!(true, "2026-11-20", "2026-11-18", "Ana Torres"))
      .toEqual({
        key: "field.tk.deletedTexted",
        vars: { customer: "Ana Torres" },
      });
  });

  test("REQ-1006 texted:false on a future or today's visit → 'was not told' flash", () => {
    for (const day of ["2026-11-20", "2026-11-18"]) {
      expect(deletedNotice!(false, day, "2026-11-18", "Ana Torres")).toEqual({
        key: "field.tk.deletedNotTexted",
        vars: { customer: "Ana Torres" },
      });
    }
    // an older backend answer with no `texted` is read as not texted
    expect(deletedNotice!(undefined, "2026-11-20", "2026-11-18", "Ana Torres")
      .key).toBe("field.tk.deletedNotTexted");
  });

  test("REQ-1006 texted:false on a past visit → plain 'Task deleted'", () => {
    expect(deletedNotice!(false, "2026-11-10", "2026-11-18", "Ana Torres").key)
      .toBe("field.tk.deleted");
  });

  test("REQ-1006 en/es carry deletedTexted + deletedNotTexted with {customer}", () => {
    for (const d of [en, es]) {
      expect(d["field.tk.deletedTexted"]).toMatch(/\{customer\}/);
      expect(d["field.tk.deletedNotTexted"]).toMatch(/\{customer\}/);
    }
    expect(en["field.tk.deletedNotTexted"]).toMatch(/not told/i);
    expect(en["field.tk.deletedTexted"]).toMatch(/texted/i);
  });

  test("REQ-1006 fieldClient.deleteTask is typed with texted", () => {
    const m = /deleteTask:[\s\S]*?api\.delete<([^>]*)>/.exec(client);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/texted\??:\s*boolean/);
  });

  test("REQ-1006 FieldTasksPage.remove() reads texted and flashes through deletedNotice", () => {
    const start = island.indexOf("async function remove(");
    expect(start).toBeGreaterThan(-1);
    const body = island.slice(start, island.indexOf("catch (e)", start));
    expect(body).toMatch(/=\s*await fieldClient\.deleteTask\(/);
    expect(body).toMatch(/deletedNotice\(/);
    expect(body).toMatch(/\.texted/);
    expect(body).not.toMatch(/setFlash\(t\("field\.tk\.deleted"\)\)/);
  });
});
