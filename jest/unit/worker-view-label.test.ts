/**
 * REQ-739 — demo-loop cycle 5, issue p18-3f: "'Worker view' link changed from
 * /worker to /field/workers". REQ-602 sends an account with no workers to
 * /field/workers, but the sidebar row still said "Worker view" there (a label
 * that lies), and its href started as /worker (count unknown on SSR) and then
 * flipped to /field/workers once the count arrived. Now: with 0 workers the
 * row says "Add a worker" / "Agregar trabajador", and while the count is still
 * loading the row has no href at all (a hidden placeholder), so its href is
 * set exactly once.
 */
import * as fs from "fs";
import * as path from "path";
import { workerViewLink } from "../../front-end/lib/worker-view-link";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-739 (cycle 5, p18-3f) the sidebar's worker row says where it goes", () => {
  test("REQ-739 no workers → 'Add a worker' to /field/workers", () => {
    expect(workerViewLink(0)).toEqual({
      href: "/field/workers",
      labelKey: "nav.addWorker",
      pending: false,
    });
  });

  test("REQ-739 workers, or a failed count → 'Worker view' to /worker", () => {
    for (const s of [1, 7, "unknown"] as const) {
      expect(workerViewLink(s)).toEqual({
        href: "/worker",
        labelKey: "nav.workerView",
        pending: false,
      });
    }
  });

  test("REQ-739 while the count loads there is no href to flip", () => {
    const l = workerViewLink("loading");
    expect(l.href).toBeNull();
    expect(l.pending).toBe(true);
  });

  test("REQ-739 the label copy exists in en and es", () => {
    expect(en["nav.addWorker"]).toBe("Add a worker");
    expect(es["nav.addWorker"]).toBe("Agregar trabajador");
  });

  test("REQ-739 the sidebar starts 'loading', marks a failed fetch 'unknown', and renders from workerViewLink", () => {
    const sb = read("front-end/islands/DashSidebar.tsx");
    expect(sb).toMatch(/useState<WorkerCountState>\("loading"\)/);
    expect(sb).toMatch(/setWorkerCount\("unknown"\)/);
    expect(sb).toMatch(/workerViewLink\(workerCount\)/);
    const link = sb.match(/<a[^>]*?data-cy="nav-worker-view"[\s\S]*?<\/a>/)
      ?.[0] ??
      sb.match(/<a\s[\s\S]*?data-cy="nav-worker-view"[\s\S]*?<\/a>/)?.[0];
    expect(link).toBeDefined();
    expect(link).not.toMatch(/"nav\.workerView"/);
    expect(link).toMatch(/workerLink\.labelKey/);
  });
});
