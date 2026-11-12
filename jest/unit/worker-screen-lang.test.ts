/**
 * REQ-285 — the /worker screen opens in the worker's language (demo issue
 * customers-payments-fieldops-m3): the client type carries `language`, the
 * route tells the island whether the address chose a language (?lang=), and
 * the island switches to the worker's language once signed in unless the
 * person chose one (the EN/ES switch or ?lang=). Logging out forgets the
 * switch so the next worker's language applies.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-285 the worker screen takes the worker's language", () => {
  test("WorkerMe carries the worker's language", () => {
    const client = read("front-end/clients/field.ts");
    const me = client.slice(client.indexOf("export interface WorkerMe"));
    expect(me.slice(0, me.indexOf("}"))).toMatch(/language\?: "en" \| "es"/);
  });

  test("the route passes whether ?lang= chose the language", () => {
    const route = read("front-end/routes/worker/index.tsx");
    expect(route).toMatch(/langChosen=\{/);
  });

  test("the island applies workerScreenLang to the signed-in worker; the switch and logout track the choice", () => {
    const island = read("front-end/islands/WorkerScreen.tsx");
    expect(island).toMatch(/workerScreenLang\(who, langChosenRef\.current\)/);
    // the EN/ES switch marks the language as chosen
    expect(island).toMatch(/langChosenRef\.current = true;\s*setLang\(c\)/);
    // logging out forgets a switch made this session (back to what the address chose)
    expect(island).toMatch(/langChosenRef\.current = langChosen/);
  });
});
