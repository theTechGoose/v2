/**
 * P-ids covered:
 *   "P-04 [SIGNUP/I18N] The Spanish onboarding tells users to type 'omitir' — which the backend never accepts. Infinite loop."
 *   "P-23 [ASSISTANT/I18N] The Spanish chat doesn't understand 'sí'."
 *   "P-52 [PRODUCT] Two names for the assistant: onboarding/coachmark say 'Bossie'… remove bossie."
 *
 * Pure-logic contract for the onboarding intent parsers, plus a dictionary
 * scan for the retired "Bossie" brand name.
 *
 * -------------------------------------------------------------------------
 * EXPECTED EXPORT CONTRACT — shared/quote-flow/intent-parsers.ts  (NEW module;
 * it does NOT exist yet, so `Cannot find module` is the intended TDD red):
 *
 *   export function matchesSkipIntent(text: string): boolean;
 *     True when `text` is one of the "skip this question" phrases the
 *     onboarding UI advertises, in BOTH languages, case- AND accent-
 *     insensitively.
 *       - English set MIRRORS the existing SKIP_RE at
 *         backend/src/agents/domain/business/onboarding/mod.ts:37
 *         (skip · later · not now · nah · no thanks · pass · maybe later · nope).
 *       - Spanish set (the vocabulary the composer placeholders + address
 *         reprompt already print — see lang/es.json
 *         "asstChat.composer.address"/"asstChat.composer.email" = "…o 'omitir'"
 *         and "onboardingChat.address.reprompt" = "…o di 'omitir'."):
 *         omitir · más tarde · luego · ahora no · saltar.
 *     Wire it so isSkipReply() (mod.ts:54) / SKIP_RE (mod.ts:37) accept the
 *     Spanish vocabulary — P-04.
 *
 *   export function matchesConfirmIntent(text: string): boolean;
 *     True when `text` means "yes, that's right", in BOTH languages, accent-
 *     insensitively.
 *       - English set MIRRORS isAffirmativeReply at
 *         backend/src/agents/domain/business/onboarding/mod.ts:285-288
 *         (yes · yep · yup · yeah · yea · y · sure · correct · right ·
 *          that's right · exactly · sounds good/right).
 *       - Spanish set (P-23): sí · si · claro · correcto · así es — AND the
 *         state-confirm chip label itself, "Sí — está correcto"
 *         (lang/es.json "onboardingProgress.reply.yes"), which today dispatches
 *         the raw English "Yes".
 *     Wire it so isAffirmativeReply() (mod.ts:285) accepts the Spanish
 *     vocabulary — P-23.
 * -------------------------------------------------------------------------
 */
import {
  matchesConfirmIntent,
  matchesSkipIntent,
} from "../../shared/quote-flow/intent-parsers";

// Dictionary content IS the assertion for P-52, so require the real files.
const enDict: Record<string, unknown> = require("../../lang/en.json");
const esDict: Record<string, unknown> = require("../../lang/es.json");

describe("P-04: matchesSkipIntent", () => {
  // English vocabulary — mirrors SKIP_RE (mod.ts:37); these must already pass
  // once the module exists (green half of the contract).
  it("P-04: accepts the English skip vocabulary SKIP_RE already handles", () => {
    for (const t of ["skip", "later", "not now", "nah", "no thanks", "pass", "maybe later", "nope"]) {
      expect(matchesSkipIntent(t)).toBe(true);
    }
  });

  // Spanish vocabulary the UI advertises — the red half. A Spanish user typing
  // what the composer/reprompt tell them ("omitir") must be understood.
  it("P-04: accepts 'omitir' — the exact word the Spanish composer + reprompt advertise", () => {
    expect(matchesSkipIntent("omitir")).toBe(true);
  });

  it("P-04: accepts 'omitir' case-insensitively ('Omitir')", () => {
    expect(matchesSkipIntent("Omitir")).toBe(true);
  });

  it("P-04: accepts the other Spanish skip variants, case/accent-insensitively", () => {
    expect(matchesSkipIntent("MÁS TARDE")).toBe(true); // accent + upper-case
    expect(matchesSkipIntent("más tarde")).toBe(true);
    expect(matchesSkipIntent("luego")).toBe(true);
    expect(matchesSkipIntent("ahora no")).toBe(true);
    expect(matchesSkipIntent("saltar")).toBe(true);
  });

  // Negative controls — the parser must be real, not "always true".
  it("P-04: rejects a name and a real job request and empty input", () => {
    expect(matchesSkipIntent("Diego")).toBe(false);
    expect(matchesSkipIntent("Quote a fence for the Patels — $350")).toBe(false);
    expect(matchesSkipIntent("")).toBe(false);
  });
});

describe("P-23: matchesConfirmIntent", () => {
  // English vocabulary — mirrors isAffirmativeReply (mod.ts:285-288); green half.
  it("P-23: accepts the English affirmatives isAffirmativeReply already handles", () => {
    for (const t of ["yes", "yep", "yup", "yeah", "yea", "y", "sure", "correct", "right", "exactly"]) {
      expect(matchesConfirmIntent(t)).toBe(true);
    }
  });

  // Spanish — the red half (P-23).
  it("P-23: accepts 'sí' and 'si' (accent-insensitive)", () => {
    expect(matchesConfirmIntent("sí")).toBe(true);
    expect(matchesConfirmIntent("si")).toBe(true);
    expect(matchesConfirmIntent("SÍ")).toBe(true);
  });

  it("P-23: accepts 'claro', 'correcto', 'así es'", () => {
    expect(matchesConfirmIntent("claro")).toBe(true);
    expect(matchesConfirmIntent("correcto")).toBe(true); // NB: English \bcorrect\b does NOT match "correcto"
    expect(matchesConfirmIntent("así es")).toBe(true);
  });

  it("P-23: accepts the state-confirm chip label itself, 'Sí — está correcto'", () => {
    // The chip (lang/es.json onboardingProgress.reply.yes) DISPLAYS this but
    // dispatches raw "Yes" today; once it dispatches its own Spanish label,
    // the confirm parser must accept that label.
    expect(esDict["onboardingProgress.reply.yes"]).toBe("Sí — está correcto");
    expect(matchesConfirmIntent("Sí — está correcto")).toBe(true);
  });

  // Negative controls.
  it("P-23: rejects 'no', a name, and empty input", () => {
    expect(matchesConfirmIntent("no")).toBe(false);
    expect(matchesConfirmIntent("Diego")).toBe(false);
    expect(matchesConfirmIntent("")).toBe(false);
  });
});

describe("P-52: 'Bossie' appears in no dictionary VALUE (EN or ES)", () => {
  function offendingValues(dict: Record<string, unknown>): string[] {
    const hits: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node === "string") {
        if (node.includes("Bossie")) hits.push(path);
      } else if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          walk(v, path ? `${path}.${k}` : k);
        }
      }
    };
    walk(dict, "");
    return hits;
  }

  it("P-52: lang/en.json has no value containing 'Bossie'", () => {
    const hits = offendingValues(enDict);
    expect(hits).toEqual([]); // green agent must rename the assistant everywhere
  });

  it("P-52: lang/es.json has no value containing 'Bossie'", () => {
    const hits = offendingValues(esDict);
    expect(hits).toEqual([]);
  });
});
