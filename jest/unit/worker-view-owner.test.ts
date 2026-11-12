/**
 * REQ-602 — demo-loop cycle 4, issue M35: "Owner's Worker view is a dead end
 * (needs worker phone+PIN)". The office sidebar's "Worker view" linked every
 * owner to /worker — a cell + PIN sign-in that only a worker can pass — even
 * an account with no workers; and the sign-in card never said whose screen it
 * was. Now: an account with no workers is sent to /field/workers instead, and
 * an owner (office session, no worker session) on /worker is told this is the
 * screen their workers sign into, with a link to /field/workers.
 */
import * as fs from "fs";
import * as path from "path";
import {
  WORKER_SCREEN_HREF,
  WORKERS_PAGE_HREF,
  workerViewHref,
} from "../../front-end/lib/worker-view-link";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-602 (cycle 4, M35) the owner's Worker view is not a dead end", () => {
  test("REQ-602 an account with no workers is sent to /field/workers", () => {
    expect(WORKERS_PAGE_HREF).toBe("/field/workers");
    expect(workerViewHref(0)).toBe("/field/workers");
  });

  test("REQ-602 an account with workers, or an unknown count, keeps /worker", () => {
    expect(WORKER_SCREEN_HREF).toBe("/worker");
    expect(workerViewHref(1)).toBe("/worker");
    expect(workerViewHref(5)).toBe("/worker");
    expect(workerViewHref(null)).toBe("/worker");
  });

  test("REQ-602 the sidebar's Worker view link takes its href from the worker count", () => {
    const sb = read("front-end/islands/DashSidebar.tsx");
    const link =
      sb.match(/<a[^>]*?data-cy="nav-worker-view"[\s\S]*?<\/a>/)?.[0] ??
      sb.match(
        /<a\s+href=\{[^}]*\}[\s\S]*?data-cy="nav-worker-view"[\s\S]*?<\/a>/,
      )?.[0];
    expect(link).toBeDefined();
    expect(link).toMatch(/href=\{workerViewHref\(workerCount\)\}/);
    expect(link).not.toMatch(/href="\/worker"/);
    expect(sb).toMatch(/fieldClient\.workers\(\)/);
  });

  test("REQ-602 WorkerScreen explains itself to a signed-in owner and links to /field/workers", () => {
    const island = read("front-end/islands/WorkerScreen.tsx");
    const note = island.match(
      /\{office && \(\s*<div[^>]*data-cy="w-owner-note"[\s\S]*?<\/div>\s*\)\}/,
    )?.[0];
    expect(note).toBeDefined();
    expect(note).toMatch(/t\("worker\.ownerNote"\)/);
    expect(note).toMatch(/href=\{WORKERS_PAGE_HREF\}/);
    expect(note).toMatch(/data-cy="w-owner-workers"/);
    expect(note).toMatch(/t\("worker\.ownerManage"\)/);
    // it sits with the sign-in card — only when no worker is signed in
    const signedOut = island.match(
      /\{me === null && \([\s\S]*?<form class="login"/,
    )?.[0];
    expect(signedOut).toMatch(/data-cy="w-owner-note"/);
  });

  test("REQ-602 the note's copy exists in en and es and says cell + PIN", () => {
    for (const k of ["worker.ownerNote", "worker.ownerManage"]) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toBe(es[k]);
    }
    expect(en["worker.ownerNote"]).toMatch(/workers/i);
    expect(en["worker.ownerNote"]).toMatch(/PIN/);
    expect(es["worker.ownerNote"]).toMatch(/trabajadores/i);
    expect(es["worker.ownerNote"]).toMatch(/PIN/);
  });
});
