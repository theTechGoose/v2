/**
 * REQ-494 — demo-loop cycle 3, issue M43 ("Worker view forgets English; worker
 * sign-in turns the owner's UI and demo pill Spanish"). The wiring: the route
 * reads the /worker pick cookie into the island, the switch writes it, logout
 * forgets it, and the demo overlay's strings go through demoChromeLang.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-494 the /worker EN/ES pick survives re-entry; the demo pill keeps the viewer's language", () => {
  test("the route resolves the language with workerRouteLang from the pick cookie and passes langPicked", () => {
    const route = read("front-end/routes/worker/index.tsx");
    expect(route).toMatch(/workerLangPickFromCookie\(/);
    expect(route).toMatch(/workerRouteLang\(/);
    expect(route).toMatch(/langPicked=\{/);
  });

  test("the island counts a remembered pick as chosen, the switch remembers it, logout forgets it", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    expect(src).toMatch(/useRef\(langChosen \|\| !!langPicked\)/);
    const sw = src.slice(src.indexOf("langChosenRef.current = true;"));
    expect(sw.slice(0, 200)).toMatch(/rememberWorkerLangPick\(c\)/);
    const fn = src.slice(src.indexOf("function logout()"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(/rememberWorkerLangPick\(null\)/);
  });

  test("DemoModeOverlay's strings follow demoChromeLang (the viewer's stored language on /worker)", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    // REQ-544 (cycle 4, m49): the chrome t moved to lib/demo-chrome-t.ts so the pill's children share it
    expect(src).toMatch(/import \{ demoChromeT as t \} from "\.\.\/lib\/demo-chrome-t\.ts"/);
    expect(read("front-end/lib/demo-chrome-t.ts")).toMatch(/demoChromeLang\(/);
    expect(src).not.toMatch(/import \{ t \} from "\.\.\/lib\/i18n\.ts"/);
  });
});
