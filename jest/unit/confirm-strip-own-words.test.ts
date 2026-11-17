/**
 * REQ-381 (demo M20, cycle 2) — the confirm step's green strip echoes the
 * message the contractor typed, but clicking it ran `applyJobOption`, the same
 * handler as Continue: it confirmed whichever card was selected — the
 * pre-selected version 1 — overwrote the typed message with v1's bullets and
 * advanced to pricing. The strip now submits what it shows: the contractor's
 * own words, run through the shared scope pass (`ownWordsOption` in
 * shared/quote-flow/own-words-option.ts), and its label says so. Continue
 * still confirms the selected card. The browser proof is
 * e2e/confirm-strip-own-words.
 */
import * as fs from "fs";
import * as path from "path";

type Lang = "en" | "es";
type Opt = { jobName: string; summary: string; bullets: string[] };
type Mod = { ownWordsOption: (raw: string, lang: Lang) => Opt | null };

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const load = (): Mod => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../shared/quote-flow/own-words-option");
};

describe("REQ-381 the confirm strip submits the contractor's own words (demo M20)", () => {
  test("the own-words option is the typed message's scope lines, prices and openers stripped", () => {
    const opt = load().ownWordsOption(
      "I need to replace the kitchen faucet\nInstall a new garbage disposal for $300\nwhat should I charge?",
      "en",
    );
    expect(opt).not.toBeNull();
    expect(opt!.bullets).toEqual([
      "Replace the kitchen faucet",
      "Install a new garbage disposal",
    ]);
    expect(opt!.summary).toBe("Replace the kitchen faucet");
    // Job Names are ≤3 words platform-wide (roadmap p.10)
    expect(opt!.jobName).toBe("Replace the kitchen");
  });

  test("Spanish works the same way", () => {
    const opt = load().ownWordsOption(
      "Necesito pintar la sala por $900 todo incluido",
      "es",
    );
    expect(opt!.bullets).toEqual(["Pintar la sala"]);
  });

  test("when no scope line survives the pass, the typed lines are kept as written — the contractor chose them", () => {
    expect(load().ownWordsOption("ok", "en")!.bullets).toEqual(["ok"]);
  });

  test("an empty message gives no option", () => {
    expect(load().ownWordsOption("   \n ", "en")).toBeNull();
  });

  const chat = read("front-end/islands/AsstChat.tsx");
  const stripTag = chat.slice(
    chat.indexOf('data-cy="confirm-details"'),
    chat.indexOf(">", chat.indexOf('data-cy="confirm-details"')),
  );

  test("the strip's click confirms the own-words option, not the selected card", () => {
    expect(stripTag).not.toMatch(/onClick=\{applyJobOption\}/);
    expect(stripTag).toMatch(/onClick=\{confirmOwnWords\}/);
    const fn = chat.slice(
      chat.indexOf("function confirmOwnWords("),
      chat.indexOf("\n  }\n", chat.indexOf("function confirmOwnWords(")),
    );
    expect(fn).toMatch(/ownWordsOption\(\s*pendingJobDetailsRaw/);
    expect(fn).not.toMatch(/selectedOptionId/);
    expect(chat).toMatch(
      /import \{ ownWordsOption \} from "\.\.\/\.\.\/shared\/quote-flow\/own-words-option\.ts";/,
    );
  });

  test("the strip's label names what it submits, in both languages", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    const k = "asstChat.confirmDetails.cta";
    expect(en[k]).toMatch(/what I wrote/i);
    expect(es[k]).toMatch(/lo que escrib[ií]/i);
    expect(en[k]).not.toMatch(/confirm these details/i);
  });
});
