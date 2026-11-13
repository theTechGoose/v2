/**
 * REQ-282 — demo issue customers-payments-fieldops-m2: the worker view
 * (/worker) had no way back to the office app. The office sidebar links to
 * /worker, but WorkerScreen's header carried only the brand, EN/ES and
 * Sign out. The /worker route now reads the owner's session (if any) and the
 * island shows a "Back to office" link to /field/tasks — only to an owner.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-282 the worker view links back to the office for a signed-in owner", () => {
  test("REQ-282 the /worker route reads the owner's session and hands it to the island", () => {
    const route = read("front-end/routes/worker/index.tsx");
    expect(route).toMatch(/loadUser\(ctx\.req\)/);
    expect(route).toMatch(/<WorkerScreen[^>]*\boffice=\{/s);
  });

  test("REQ-282 WorkerScreen renders a Back to office link to /field/tasks, only when office is set", () => {
    const island = read("front-end/islands/WorkerScreen.tsx");
    expect(island).toMatch(/office\?: boolean/);
    const link = island.match(
      /\{office && \(\s*<a[\s\S]*?<\/a>\s*\)\}/,
    )?.[0];
    expect(link).toBeDefined();
    // REQ-417 (m44): the href is the route-resolved office page, /field/tasks by default
    expect(link).toMatch(/href=\{officeHref\}/);
    expect(island).toMatch(/officeHref = WORKER_OFFICE_FALLBACK/);
    expect(link).toMatch(/data-cy="w-office"/);
    expect(link).toMatch(/t\("worker\.backToOffice"\)/);
  });

  test("REQ-282 the link's label exists in both languages", () => {
    expect(typeof en["worker.backToOffice"]).toBe("string");
    expect(typeof es["worker.backToOffice"]).toBe("string");
    expect(en["worker.backToOffice"]).not.toBe(es["worker.backToOffice"]);
  });
});
