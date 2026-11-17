/**
 * REQ-258 (demo M22) — "…I supply paint. $2,400 total, half deposit." The
 * chat's create_quote now carries paymentTerms; the backend stamps the
 * payment_terms wizard step with `suggestedOptionId`. The chat island must
 * show that option as pre-selected (still a tap to confirm), and both
 * languages carry the hint.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-258 the wizard shows what the chat already said", () => {
  const chat = read("front-end/islands/AsstChat.tsx");

  test("the wizard payload type carries suggestedOptionId and the option button marks it", () => {
    const wiz = chat.slice(chat.indexOf('if (m.kind === "wizard")'));
    expect(wiz).toMatch(/suggestedOptionId\?: string;/);
    expect(wiz).toMatch(/payload\.suggestedOptionId === opt\.id/);
    expect(wiz).toMatch(/wiz-opt--suggested/);
    expect(wiz).toMatch(/"asstChat\.wiz\.fromYourMessage"/);
  });

  test("both stylesheets style the suggested option", () => {
    for (const css of ["front-end/static/assistant.css", "front-end/static/assistant-page.css"]) {
      expect(read(css)).toMatch(/\.wiz-opt--suggested\b/);
    }
  });

  test("both languages carry the hint", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(typeof en["asstChat.wiz.fromYourMessage"]).toBe("string");
    expect(typeof es["asstChat.wiz.fromYourMessage"]).toBe("string");
    expect(es["asstChat.wiz.fromYourMessage"]).not.toBe(en["asstChat.wiz.fromYourMessage"]);
  });
});
