/**
 * REQ-197 — no first-paint flicker on /worker: the route renders the signed-in screen (or the
 * login form) on the server, the island starts from that answer and skips the duplicate load.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-197 the worker's screen is server-rendered in its final state", () => {
  test("the route asks the backend with the browser's pm_worker cookie and falls back on failure", () => {
    const route = read("front-end/routes/worker/index.tsx");
    expect(route).toMatch(/async function loadSsr\(/);
    expect(route).toMatch(/pm_worker=/);
    expect(route).toMatch(/workerClient\.me\(\{ cookie \}\)/);
    expect(route).toMatch(
      /workerClient\.tasks\(day, me\.role === "foreman", \{ cookie \}\)/,
    );
    expect(route).toMatch(/workerClient\.taskTypes\(\{ cookie \}\)/);
    expect(route).toMatch(/catch \{\s*return undefined;/);
    expect(route).toMatch(
      /<WorkerScreen initialLang=\{lang\} initialDate=\{date\} ssr=\{ssr\} \/>/,
    );
  });
  test("the API helper forwards a cookie on the server only; the worker reads accept options", () => {
    const api = read("front-end/lib/api.ts");
    expect(api).toMatch(/cookie\?: string;/);
    expect(api).toMatch(
      /if \(opts\.cookie && isServer\(\)\) headers\["cookie"\] = opts\.cookie;/,
    );
    const client = read("front-end/clients/field.ts");
    expect(client).toMatch(/me: \(opts: ApiOptions = \{\}\) =>/);
    expect(client).toMatch(
      /tasks: \(date\?: string, all = false, opts: ApiOptions = \{\}\) =>/,
    );
    expect(client).toMatch(/taskTypes: \(opts: ApiOptions = \{\}\) =>/);
  });
  test("the island starts from the server's answer and does not fetch it a second time", () => {
    const screen = read("front-end/islands/WorkerScreen.tsx");
    expect(screen).toMatch(/export interface WorkerSsr \{/);
    expect(screen).toMatch(
      /useState<WorkerMe \| null \| undefined>\(\s*ssr \? ssr\.me : undefined,?\s*\)/,
    );
    expect(screen).toMatch(
      /useState<WorkerTaskView\[\]>\(ssr\?\.tasks \?\? \[\]\)/,
    );
    expect(screen).toMatch(/useState\(initialDate \?\? ssr\?\.date \?\? ""\)/);
    expect(screen).toMatch(
      /const primed = useRef\(Boolean\(ssr && ssr\.me\)\);/,
    );
    expect(screen).toMatch(
      /if \(primed\.current\) primed\.current = false;\s*else load\(\);/,
    );
  });
  test("the field day on the server comes from FIELD_TZ, America/New_York by default", () => {
    const field = read("front-end/lib/field.ts");
    expect(field).toMatch(/export function fieldTodayIso\(/);
    expect(field).toMatch(
      /Deno\.env\.get\("FIELD_TZ"\)[^\n]*\|\|\s*"America\/New_York"/,
    );
    expect(field).toMatch(/new Intl\.DateTimeFormat\("en-CA"/);
  });
});
