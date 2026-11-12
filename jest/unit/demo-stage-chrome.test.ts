/**
 * REQ-270 — demo issue i18n-formatting-m3: the staff's demo stage chrome.
 *  (b) the Spanish point-only hint speaks of ONE customer, not "ellos";
 *  (c) the stage takes the staff's own language from the server (initialLang), and the
 *      customer's app inside the replica frame never writes the shared pm:lang / pm_lang —
 *      the frame is same-origin, so its writes flipped the stage's language on the next load;
 *  (d) /demo/stage links a stylesheet that gives the page a real font (the pill and the
 *      banner use `font:inherit`, which inherited the browser's default serif/monospace).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

describe("REQ-270 (b) the Spanish point-only hint is singular", () => {
  test("REQ-270 es demoMode.pointOnlyHint names one customer, not 'ellos'", () => {
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    expect(en["demoMode.pointOnlyHint"]).toBeTruthy();
    expect(es["demoMode.pointOnlyHint"]).toBeTruthy();
    expect(es["demoMode.pointOnlyHint"]).not.toMatch(/\bellos\b|\bven\b/);
  });
});

type FakeEnv = { store: Record<string, string>; cookie: { v: string } };

/** load lib/lang.ts fresh in a fake browser window (name/parent decide "replica frame") */
function loadLangIn(win: { name: string; framed: boolean }): {
  mod: typeof import("../../front-end/lib/lang");
  env: FakeEnv;
} {
  const store: Record<string, string> = {};
  const cookie = { v: "" };
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  };
  g.document = {
    get cookie() {
      return cookie.v;
    },
    set cookie(v: string) {
      cookie.v = v;
    },
  };
  g.name = win.name;
  g.parent = win.framed ? {} : globalThis;
  let mod!: typeof import("../../front-end/lib/lang");
  jest.isolateModules(() => {
    mod = require("../../front-end/lib/lang");
  });
  return { mod, env: { store, cookie } };
}

describe("REQ-270 (c) the replica frame never persists a language", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  afterEach(() => {
    delete g.localStorage;
    delete g.document;
    delete g.name;
    delete g.parent;
  });

  test("REQ-270 inside the stage's replica frame, persistLang writes neither localStorage nor the cookie", () => {
    const { mod, env } = loadLangIn({ name: "pm-demo-replica", framed: true });
    mod.persistLang("en");
    expect(env.store["pm:lang"]).toBeUndefined();
    expect(env.cookie.v).toBe("");
  });

  test("REQ-270 a normal window (and a window merely NAMED like the frame but not framed) still persists", () => {
    for (const win of [{ name: "", framed: false }, { name: "pm-demo-replica", framed: false }]) {
      const { mod, env } = loadLangIn(win);
      mod.persistLang("en");
      expect(env.store["pm:lang"]).toBe("en");
      expect(env.cookie.v).toMatch(/^pm_lang=en;/);
    }
  });

  test("REQ-270 lang.ts names the same frame as the replica module", () => {
    const replica = read("front-end/lib/demo-mode/replica.ts");
    const name = replica.match(/REPLICA_FRAME_NAME = "([^"]+)"/)?.[1];
    expect(name).toBe("pm-demo-replica");
    expect(read("front-end/lib/lang.ts")).toContain(`"${name}"`);
  });
});

describe("REQ-270 (c) the stage takes the staff's language from the server", () => {
  test("REQ-270 /demo/stage passes initialLang (user.language) to DemoStage", () => {
    const route = read("front-end/routes/demo/stage.tsx");
    expect(route).toMatch(/<DemoStage\s+initialLang=\{lang\}\s*\/>/);
  });

  test("REQ-270 DemoStage seeds langSignal from initialLang", () => {
    const island = read("front-end/islands/DemoStage.tsx");
    expect(island).toMatch(/export default function DemoStage\(\s*\{\s*initialLang\s*\}/);
    expect(island).toMatch(/langSignal\.value\s*=\s*initialLang/);
  });
});

describe("REQ-270 (d) the stage has a real font", () => {
  test("REQ-270 /demo/stage links /demo-stage.css with a key, and the sheet sets the body font", () => {
    const route = read("front-end/routes/demo/stage.tsx");
    expect(route).toMatch(
      /<link\s+key="css-demo-stage"\s+rel="stylesheet"\s+href=\{asset\("\/demo-stage\.css"\)\}/,
    );
    expect(exists("front-end/static/demo-stage.css")).toBe(true);
    const css = read("front-end/static/demo-stage.css");
    expect(css).toMatch(/body\s*\{[^}]*font-family:[^;}]*(Inter|system-ui)/);
  });
});
