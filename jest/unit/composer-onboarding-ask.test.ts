/**
 * REQ-582 — Raphael, 2026-11-12: "fix every issue the demo found, loop until
 * there are none." Demo-loop cycle 4 (run r857a9d67), issue m39: "Composer
 * placeholder shows unrelated onboarding prompts mid-thread."
 *
 * RCA: AsstChat's composerPlaceholder regex-matched the LAST assistant text
 * in any thread: a reply mentioning "email" ("email: no recipient; …") gave
 * "name@yourbusiness.com — or 'skip'", one mentioning "payment" ("You can
 * check the payment status in the Invoices section.") gave "Venmo @handle,
 * Zelle email, etc.". Nothing checked that an onboarding ask was open.
 *
 * Fix: an onboarding placeholder shows only while the latest assistant
 * message IS an onboarding ask — the same template identity the server's
 * classifyLastAsk uses to route the reply into onboarding — otherwise the
 * REQ-450 trade/flow example.
 */
import * as fs from "fs";
import * as path from "path";
import { composerPlaceholderKey } from "../../shared/quote-flow/trade-fit";
import { openOnboardingAsk } from "../../shared/quote-flow/onboarding-composer";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dicts = {
  en: JSON.parse(read("lang/en.json")) as Record<string, string>,
  es: JSON.parse(read("lang/es.json")) as Record<string, string>,
};
const tpl = (lang: "en" | "es", key: string) => dicts[lang][key] ?? key;
const fill = (s: string) =>
  s.replace(
    /\{(\w+)\}/g,
    (_, k) => k === "firstName" ? "Rafa" : k === "stateName" ? "Texas" : "512",
  );

/** The island's choice: the open onboarding ask's placeholder, else REQ-450's. */
const composerKeyFor = (
  msgs: M[],
  t: typeof tpl,
  biz: string,
  flow: "ask" | "priced",
) => openOnboardingAsk(msgs, t) ?? composerPlaceholderKey(biz, flow);

type M = { role: string; kind: string; content: string };
const asst = (content: string, kind = "text"): M => ({
  role: "assistant",
  kind,
  content,
});
const user = (content: string): M => ({ role: "user", kind: "text", content });

describe("REQ-582 m39 — onboarding placeholders only while an onboarding ask is open", () => {
  it("REQ-582: an unrelated reply mentioning payment shows the trade/flow example, not 'Venmo @handle'", () => {
    const msgs = [
      user("where do I see if they paid?"),
      asst("You can check the payment status in the Invoices section."),
    ];
    expect(openOnboardingAsk(msgs, tpl)).toBeNull();
    expect(composerKeyFor(msgs, tpl, "Riley Roofing", "ask")).toBe(
      composerPlaceholderKey("Riley Roofing", "ask"),
    );
    expect(composerKeyFor(msgs, tpl, "Riley Roofing", "ask")).not.toBe(
      "asstChat.composer.payment",
    );
  });

  it("REQ-582: the change-order reply mentioning email shows the trade/flow example, not the email placeholder", () => {
    const msgs = [
      asst("Change order sent — email: no recipient; text: (555) 010-0100"),
    ];
    expect(composerKeyFor(msgs, tpl, "Sparkle Cleaning", "priced")).toBe(
      composerPlaceholderKey("Sparkle Cleaning", "priced"),
    );
  });

  it("REQ-582: replies that merely mention a name, a state or an address do not trigger onboarding placeholders", () => {
    for (
      const c of [
        "What's your business name on the invoice? I can change it in Settings.",
        "Which state is the job in? Tax rules differ.",
        "I'll put the business address on the quote.",
        "How do you want to get paid for this one — Zelle or check?",
      ]
    ) {
      expect(openOnboardingAsk([asst(c)], tpl)).toBeNull();
    }
  });

  it("REQ-582: each open onboarding ask (en and es) maps to its placeholder", () => {
    const cases: [string, string][] = [
      ["onboarding.askName", "asstChat.composer.firstName"],
      ["onboarding.askNameAndBusiness", "asstChat.composer.firstName"],
      ["onboardingChat.name.reprompt", "asstChat.composer.firstName"],
      ["onboarding.askBusiness", "asstChat.composer.businessName"],
      ["onboardingChat.business.reprompt", "asstChat.composer.businessName"],
      ["onboarding.askState", "asstChat.composer.stateCode"],
      ["onboarding.askStateGuess", "asstChat.composer.stateCode"],
      ["onboardingChat.state.reprompt", "asstChat.composer.stateCode"],
      ["onboarding.askAddress", "asstChat.composer.address"],
      ["onboardingChat.address.reprompt", "asstChat.composer.address"],
      ["onboarding.askPayout", "asstChat.composer.email"],
    ];
    for (const lang of ["en", "es"] as const) {
      for (const [askKey, placeholder] of cases) {
        const msgs = [user("hi"), asst(fill(tpl(lang, askKey)))];
        expect([lang, askKey, composerKeyFor(msgs, tpl, "Acme", "ask")])
          .toEqual([lang, askKey, placeholder]);
      }
    }
  });

  it("REQ-582: once a later assistant reply follows the ask (the handoff, any answer), the ask is no longer open", () => {
    const payout = asst(fill(tpl("en", "onboarding.askPayout")));
    expect(
      openOnboardingAsk([
        payout,
        user("skip"),
        asst(fill(tpl("en", "onboarding.handoff"))),
      ], tpl),
    ).toBeNull();
    expect(
      openOnboardingAsk([
        payout,
        user("quote a fence"),
        asst("Sure — how long is the fence?"),
      ], tpl),
    ).toBeNull();
  });

  it("REQ-582: the island takes the placeholder from the shared choice, with no free-text regex", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const start = src.indexOf("function composerPlaceholder(");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).toContain("openOnboardingAsk(msgs, tFor)");
    expect(body).not.toMatch(/\/email\/|venmo|zelle|cash app/);
  });
});
