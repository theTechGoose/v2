/**
 * REQ-653 (demo-loop cycle 5, M7 + m50) — Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 * M7  — "LVP no wait porcelain tile 12x24" became "Install LVP and porcelain
 *       tile" in every option; "same address" left the second quote with no
 *       job address; "email notanemail" was ignored without a word.
 * m50 — "client wants done before thanksgiving" became the scope bullet
 *       "Finish before Thanksgiving" next to start "Right away" + "3 weeks",
 *       which ends after Thanksgiving.
 *
 * These pin the shared, pure half: the self-correction pre-pass, deadline
 * phrases are schedule (never scope), "same address", a malformed e-mail —
 * and the job-options prompt (the model executes it) carries both rules.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanScopeBullet,
  stripCustomerDetails,
} from "../../shared/quote-flow/option-bullets";
import { typedScopeItems } from "../../shared/quote-flow/typed-coverage";
import {
  dropSelfCorrections,
  malformedEmailIn,
  mentionsSameAddress,
  sameAddressFor,
} from "../../shared/quote-flow/self-correction";

const ROOT = resolve(__dirname, "../..");
const prompt = (file: string) =>
  JSON.parse(readFileSync(resolve(ROOT, file), "utf8"))[
    "prompts.generateJobOptions"
  ] as string;

const DEMO =
  "gut master bath 8x10, tub out walk-in shower w/ niche, double vanity quartz, LVP no wait porcelain tile 12x24, move toilet 2ft, exhaust fan, plus kitchen backsplash 30sqft subway — client wants done before thanksgiving";

describe("REQ-653 (M7) a self-correction keeps only the correction", () => {
  it("REQ-653 'LVP no wait porcelain tile 12x24' → 'porcelain tile 12x24' (fleet-6 stdout:295)", () => {
    const out = dropSelfCorrections(DEMO);
    expect(out).toContain("porcelain tile 12x24");
    expect(out).not.toMatch(/LVP/);
    expect(out).not.toMatch(/no wait/i);
    // the rest of the message is untouched
    expect(out).toContain("double vanity quartz,");
    expect(out).toContain("walk-in shower w/ niche");
  });

  it("REQ-653 the other correction cues, EN + ES", () => {
    expect(dropSelfCorrections("white shaker, no wait, gray shaker cabinets"))
      .toBe("gray shaker cabinets");
    expect(dropSelfCorrections("double vanity quartz, no wait, marble"))
      .toBe("double vanity marble");
    expect(dropSelfCorrections("3 no wait 4 windows")).toBe("4 windows");
    expect(dropSelfCorrections("replace 3 windows make that 4 windows"))
      .toBe("replace 4 windows");
    expect(dropSelfCorrections("tile I mean porcelain on the floor"))
      .toBe("porcelain on the floor");
    expect(dropSelfCorrections("piso de LVP no espera porcelanato"))
      .toBe("piso de porcelanato");
    expect(dropSelfCorrections("azulejo mejor dicho porcelanato"))
      .toBe("porcelanato");
  });

  it("REQ-653 text with no correction is unchanged — 'actually' alone is the model's call (the prompt rule)", () => {
    for (
      const s of [
        "Actually, add the hallway too",
        "the job is actually bigger than that",
        "kitchen remodel, 22 lf of cabinets",
        "no LVP at all",
      ]
    ) {
      expect(dropSelfCorrections(s)).toBe(s);
    }
  });
});

describe("REQ-653 (m50) a deadline is schedule, never a scope bullet", () => {
  it("REQ-653 the demo's deadline bullets are dropped (fleet-6 stdout:298/225)", () => {
    for (
      const b of [
        "Finish before Thanksgiving",
        "Terminar antes de Acción de Gracias",
        "Complete by Nov 20",
        "Done before Christmas",
        "Client wants it done before Thanksgiving",
        "Deadline: Thanksgiving",
        "Listo para el 20 de noviembre",
      ]
    ) {
      expect([b, cleanScopeBullet(b, {})]).toEqual([b, null]);
    }
  });

  it("REQ-653 a scope line keeps its scope and loses the deadline part", () => {
    expect(cleanScopeBullet("Install backsplash, done before Thanksgiving", {}))
      .toBe("Install backsplash");
    expect(
      stripCustomerDetails(
        "plus kitchen backsplash 30sqft subway — client wants done before thanksgiving",
      ),
    ).toBe("plus kitchen backsplash 30sqft subway");
  });

  it("REQ-653 scope lines that only look like one stay", () => {
    for (
      const b of [
        "Complete kitchen remodel",
        "Grout done by hand",
        "Finish trim in hallway",
        "Install ready-made vanity",
      ]
    ) {
      expect(cleanScopeBullet(b, {})).toBe(b);
    }
  });

  it("REQ-653 a 'Job located on …' line is the address, never scope (fleet-6 stdout:296)", () => {
    expect(cleanScopeBullet("Job located on Shoal Creek", {})).toBeNull();
    expect(cleanScopeBullet("Trabajo ubicado en Shoal Creek", {})).toBeNull();
  });

  it("REQ-653 the typed yardstick holds no deadline item and no corrected-away LVP", () => {
    const items = typedScopeItems(dropSelfCorrections(DEMO), "en");
    expect(items.join(" | ")).not.toMatch(/thanksgiving/i);
    expect(items.join(" | ")).not.toMatch(/LVP/);
    expect(items.join(" | ")).toMatch(/backsplash/);
  });
});

describe("REQ-653 (M7) 'same address' and a malformed e-mail", () => {
  it("REQ-653 'same address' is read, EN + ES", () => {
    expect(
      mentionsSameAddress("bathroom for Dana Whitfield, same address, $5,700"),
    )
      .toBe(true);
    expect(mentionsSameAddress("misma dirección que la otra vez")).toBe(true);
    expect(mentionsSameAddress("same place as last time")).toBe(true);
    expect(mentionsSameAddress("new address: 12 Oak St")).toBe(false);
  });

  it("REQ-653 the customer's latest quote with an address wins, else their record", () => {
    const quotes = [
      { customerId: "c1", serviceAddress: "1 Old Rd", createdAt: "2026-01-01" },
      {
        customerId: "c1",
        serviceAddress: "88 Oak Hollow Dr",
        createdAt: "2026-11-01",
      },
      { customerId: "c1", createdAt: "2026-11-10" },
      { customerId: "c2", serviceAddress: "9 Elm St", createdAt: "2026-11-11" },
    ];
    expect(sameAddressFor("c1", quotes, { address: "5 Home Ln" }))
      .toBe("88 Oak Hollow Dr");
    expect(sameAddressFor("c3", quotes, { address: "5 Home Ln" }))
      .toBe("5 Home Ln");
    expect(sameAddressFor("c3", quotes, {})).toBeUndefined();
  });

  it("REQ-653 'email notanemail' is a malformed e-mail (fleet-9 stdout:37); a real one or 'email me' is not", () => {
    expect(
      malformedEmailIn(
        "panel upgrade for Bob Miller, price -500 dollars, email notanemail",
      ),
    ).toBe("notanemail");
    expect(malformedEmailIn("correo: juan@gmail")).toBe("juan@gmail");
    expect(malformedEmailIn("email bob@example.com")).toBeNull();
    expect(malformedEmailIn("email me the quote")).toBeNull();
    expect(malformedEmailIn("email them when done")).toBeNull();
    expect(malformedEmailIn("kitchen remodel $5,000")).toBeNull();
  });
});

describe("REQ-653 the job-options prompt (executed by the model) carries both rules, en + es", () => {
  for (const file of ["lang/en.json", "lang/es.json"]) {
    it(`REQ-653 ${file}: corrections keep only the correction; a deadline is schedule`, () => {
      const p = prompt(file);
      expect(p).toMatch(/no wait/);
      expect(p).toMatch(/keep only the correction/i);
      expect(p).toMatch(/finish before Thanksgiving/i);
    });
  }
});
