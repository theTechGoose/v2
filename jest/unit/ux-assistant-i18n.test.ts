/**
 * UX-12 / UX-14 / UX-19 / UX-34 — assistant i18n + thread-title contracts
 * (ux-problems.md, first-session audit). Dictionary/source scans, each
 * red-verified against the live lang files and component/controller source.
 *
 *   UX-12 "English divider chips inside the Spanish chat. 'A little more
 *          info' renders between Spanish bubbles during the quick-quote flow."
 *   UX-14 "Thread list is unhelpful for returning users. The one conversation
 *          is titled 'Nueva conversación' with preview 'garantía: 6 meses'
 *          (last checklist item) — should be job + customer ('Patio · María
 *          Nguyen'). The 'Nueva conversación' button shows a ⌘N hint inside
 *          the MOBILE drawer."
 *   UX-19 "Mobile empty-state says '¡Haz clic en una casilla…!' — click
 *          language on a touch device, and 'casilla' (checkbox) for what are
 *          option chips. 'Toca una opción o escribe abajo para comenzar.'"
 *   UX-34 "'Haz clic aquí para clientes existentes' — click-language calque
 *          as the ES dropdown trigger (the EN cluster was fixed to 'Choose an
 *          existing customer'; the ES twin kept the old pattern)."
 *
 * ----------------------------------------------------------------------------
 * GROUND-TRUTH FINDING on UX-12 (evidence over the anticipated shape): the
 * divider string is NOT hardcoded English in a component. Both dictionaries
 * already carry it (lang/en.json:2466 "A little more info" / lang/es.json:2466
 * "Un poco más de información") and the backend renders it via t(lang, …)
 * (backend/src/agents/domain/coordinators/transition-to-terms/mod.ts:70-75).
 * The REAL defect is lang plumbing: the coordinator defaults `lang` to "en"
 * (mod.ts:41-42) and NO caller ever passes it —
 *   - backend/src/agents/entrypoints/conversations-controller/mod.ts:97-101
 *     runs transitionFlow.run({ userId, conversationId }) with no lang, and
 *   - front-end/islands/AsstChat.tsx:1979 + :2391-2394 POST
 *     /agents/conversations/:id/transition-to-terms with no body —
 * so the phase_divider message is STORED as English ("A little more info")
 * and the FE renders the frozen stored string (AsstChat.tsx:4684 label =
 * dp.label ?? m.content, rendered at :4716-4721) between Spanish bubbles.
 * The naive dict scan the brief anticipated would PASS today (accidental
 * green) — so the red below pins the missing plumbing instead: at least one
 * link in the chain must carry the user's language.
 *
 * UX-14 ⌘N-hint half: AsstThreads.tsx:192-194 renders `.threads__new-kbd`
 * (asstThreads.newKbd "⌘N") UNCONDITIONALLY — no pure, importable contract
 * exists to pin (it's island render logic), so that half lives in the e2e
 * (cypress/e2e/ux-assistant-i18n.cy.ts, 390×844 drawer shows no ⌘N). No fake
 * unit red is written for it.
 *
 * ----------------------------------------------------------------------------
 * EXPECTED EXPORT CONTRACT for the green agent — NEW module
 * shared/quote-flow/thread-title.ts (missing today → "Cannot find module"
 * is the intended red):
 *
 *   export interface ThreadTitleParts {
 *     jobName?: string | null;      // the quote's ≤3-word job name, once set
 *     customerName?: string | null; // the bound customer
 *     title?: string | null;        // legacy fallback (first user message)
 *   }
 *   export function threadTitle(parts: ThreadTitleParts, lang: "en" | "es"): string
 *     - job + customer → "«jobName» · «customerName»"  (middot separator)
 *     - customer only  → customerName; job only → jobName
 *     - neither        → title when present, else the localized
 *                        "Nueva conversación"/"New conversation" fallback
 *                        (same strings as lang asstThreads.newConversation)
 *
 *   WIRING: front-end/islands/AsstThreads.tsx:248-251 titleFor() currently
 *   returns customerName || title || tFor("asstThreads.newConversation") —
 *   it must derive through threadTitle. The list projection must denormalize
 *   jobName + customerName: backend/src/agents/entrypoints/conversations-
 *   controller/mod.ts:40-45 (GET /agents/conversations → store.listByUser)
 *   returns AgentConversation rows that today carry NEITHER field
 *   (backend/src/agents/dto/conversation.ts:17-37).
 *
 * Phones used: none (pure unit / source scans).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..");
const en: Record<string, string> = require("../../lang/en.json");
const es: Record<string, string> = require("../../lang/es.json");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Strip /* *​/ and // comments so doc-strings can't fake a wiring match. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ---------------------------------------------------------------------------
// UX-12 — the ES flow must never store/render the EN divider
// ---------------------------------------------------------------------------
describe("UX-12 phase-divider language plumbing", () => {
  it("UX-12 [contract-pin, green by design] both dicts carry the divider string (the fix must USE them, not add them)", () => {
    // Labeled pin (brief rule 7): these two passing assertions freeze the
    // ground truth the red below depends on — the copy exists in both
    // languages, so the ONLY legitimate fix is plumbing the lang through.
    expect(en["transitionToTerms.phaseDivider"]).toBe("A little more info");
    expect(es["transitionToTerms.phaseDivider"]).toBe(
      "Un poco más de información",
    );
  });

  it("UX-12 some link in the transition chain passes the user's language (today NONE does → EN divider frozen into ES chats)", () => {
    // Desired: the phase_divider is stored in the contractor's language.
    // Any ONE of these fixes satisfies the contract:
    //  (a) the controller resolves the authed user's language and passes it
    //      into transitionFlow.run(...)  — conversations-controller/mod.ts:97-101
    //  (b) the coordinator resolves it itself (injects a user/profile store)
    //      — transition-to-terms/mod.ts (today its only dependencies are the
    //      conversation + message stores)
    //  (c) the FE sends { lang } on its transition POSTs — AsstChat.tsx:1979,
    //      :2391-2394
    const controllerSrc = stripComments(
      read("backend/src/agents/entrypoints/conversations-controller/mod.ts"),
    );
    const tStart = controllerSrc.indexOf('@Post(":id/transition-to-terms")');
    expect(tStart).toBeGreaterThan(-1); // route must still exist
    const tEnd = controllerSrc.indexOf("@Post(", tStart + 10);
    const transitionBlock = controllerSrc.slice(
      tStart,
      tEnd === -1 ? undefined : tEnd,
    );
    const controllerPassesLang = /\blang(uage)?\b/.test(transitionBlock);

    const coordSrc = stripComments(
      read(
        "backend/src/agents/domain/coordinators/transition-to-terms/mod.ts",
      ),
    );
    const coordResolvesLang = /UserStore|ProfileStore|users\s*[:.]/.test(
      coordSrc,
    );

    const feSrc = stripComments(read("front-end/islands/AsstChat.tsx"));
    // Every FE transition call site, with a small trailing window to catch
    // the request body/options.
    const feCallSites: string[] = [];
    let idx = feSrc.indexOf("/transition-to-terms");
    while (idx !== -1) {
      feCallSites.push(feSrc.slice(idx, idx + 300));
      idx = feSrc.indexOf("/transition-to-terms", idx + 1);
    }
    expect(feCallSites.length).toBeGreaterThan(0);
    const fePassesLang = feCallSites.some((w) => /\blang(uage)?\b/.test(w));

    expect(
      controllerPassesLang || coordResolvesLang || fePassesLang,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UX-19 — ES assistant empty-state is touch-first, chips not checkboxes
// ---------------------------------------------------------------------------
describe("UX-19 ES assistant empty-state copy", () => {
  // Today (lang/es.json:217): "¡Haz clic en una casilla o en el campo de
  // texto de abajo para comenzar!" — click language + "casilla" (checkbox)
  // for what are option chips. Desired shape: "Toca una opción o escribe
  // abajo para comenzar."
  it("UX-19 no 'Haz clic' on the touch-first empty state", () => {
    expect(es["asstChat.empty.title"]).not.toMatch(/haz clic/i);
  });

  it("UX-19 no 'casilla' (the prompts are option chips, not checkboxes)", () => {
    expect(es["asstChat.empty.title"]).not.toMatch(/casilla/i);
  });

  it("UX-19 the ES empty state leads with the touch verb (Toca …)", () => {
    expect(es["asstChat.empty.title"]).toMatch(/\btoca\b/i);
  });
});

// ---------------------------------------------------------------------------
// UX-34 — ES existing-customer dropdown trigger drops the click calque
// ---------------------------------------------------------------------------
describe("UX-34 ES existing-customer dropdown trigger", () => {
  // Rendered at front-end/islands/AsstChat.tsx:7483-7485 (.cust-dd__trigger
  // → .cust-dd__placeholder). EN was fixed to "Choose an existing customer"
  // (lang/en.json:190); the ES twin (lang/es.json:190) still reads
  // "Haz clic aquí para clientes existentes".
  it("UX-34 [contract-pin, green by design] the fixed EN anchor stays 'Choose an existing customer'", () => {
    expect(en["asstChat.customerStep.existingTrigger"]).toBe(
      "Choose an existing customer",
    );
  });

  it("UX-34 the ES trigger has no 'Haz clic' calque", () => {
    expect(es["asstChat.customerStep.existingTrigger"]).not.toMatch(
      /haz clic/i,
    );
  });

  it("UX-34 the ES trigger matches the EN imperative-choose pattern (e.g. 'Elige un cliente existente')", () => {
    expect(es["asstChat.customerStep.existingTrigger"]).toMatch(
      /^(elige|escoge|selecciona)\b/i,
    );
  });
});

// ---------------------------------------------------------------------------
// UX-14 — thread-title derivation contract (shared/quote-flow/thread-title)
// ---------------------------------------------------------------------------
describe("UX-14 threadTitle — job + customer, never a bare 'Nueva conversación'", () => {
  let mod: any;
  beforeAll(() => {
    // RED today: module does not exist → "Cannot find module".
    mod = require("../../shared/quote-flow/thread-title");
  });

  it("UX-14 job + customer → '«job» · «customer»' (the audit's 'Patio · María Nguyen')", () => {
    expect(
      mod.threadTitle(
        { jobName: "Patio", customerName: "María Nguyen" },
        "es",
      ),
    ).toBe("Patio · María Nguyen");
  });

  it("UX-14 customer only → the customer name", () => {
    expect(
      mod.threadTitle({ customerName: "María Nguyen" }, "es"),
    ).toBe("María Nguyen");
  });

  it("UX-14 job only → the job name", () => {
    expect(mod.threadTitle({ jobName: "Patio" }, "es")).toBe("Patio");
  });

  it("UX-14 neither → the legacy title fallback when present", () => {
    expect(
      mod.threadTitle({ title: "Reparar cerca del sur" }, "es"),
    ).toBe("Reparar cerca del sur");
  });

  it("UX-14 nothing at all → the localized new-conversation fallback (dict parity)", () => {
    expect(mod.threadTitle({}, "es")).toBe(es["asstThreads.newConversation"]);
    expect(mod.threadTitle({}, "en")).toBe(en["asstThreads.newConversation"]);
  });

  it("UX-14 blank/whitespace parts are treated as missing (no ' · ' orphans)", () => {
    expect(
      mod.threadTitle({ jobName: "  ", customerName: "María Nguyen" }, "es"),
    ).toBe("María Nguyen");
    expect(
      mod.threadTitle({ jobName: "Patio", customerName: "" }, "es"),
    ).toBe("Patio");
  });
});
