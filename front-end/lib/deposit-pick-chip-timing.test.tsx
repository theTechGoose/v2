/**
 * REQ-1082 — AMENDMENT of REQ-1048 (LOOP-007 cycle 3, q3-8): "'How big a
 * deposit?' step says the deposit is due 'now'; the agreement says a week
 * after signing".
 *
 * REQ-1048 made every payment-step sub-line name the deposit's one net-7
 * deadline ("due a week after signing"). The REQ-678 DepositAmountPicker that
 * opens right after "Deposit + balance" renders one chip per depositChoices()
 * entry, each sub-lined with `asstChat.depositPick.chipSub` — which still
 * reads "{deposit} now · {balance} when done" / "{deposit} ahora · …".
 */
import { assert } from "@std/assert";
import { depositChoices } from "../../shared/quote-flow/deposit-term.ts";
import en from "../../lang/en.json" with { type: "json" };
import es from "../../lang/es.json" with { type: "json" };
import { tFor } from "./i18n.ts";

const TOTAL = 845_050; // $8,450.50 — the tester's job
/** "now" = at the moment of picking/signing — the opposite of net-7. */
const NOW: Record<"en" | "es", RegExp> = {
  en: /\bnow\b/i,
  es: /\bahora\b/i,
};
/** the net-7 wording REQ-1048 uses on the step before this one */
const WEEK: Record<"en" | "es", RegExp> = {
  en: /a week after signing/i,
  es: /semana/i,
};

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1082 (LOOP-007 q3-8) [${lang}]: each "How big a deposit?" chip names the deposit as due a week after signing, never "now"`, () => {
    const chips = depositChoices(TOTAL);
    assert(chips.length > 0 && chips.every((c) => c.deposit && c.balance));
    const bad: string[] = [];
    for (const c of chips) {
      const sub = tFor(lang, "asstChat.depositPick.chipSub", {
        deposit: c.deposit!,
        balance: c.balance!,
      });
      if (NOW[lang].test(sub) || !WEEK[lang].test(sub)) {
        bad.push(`  ${c.pct}% chip = "${sub}"`);
      }
    }
    assert(
      bad.length === 0,
      `the previous step says the deposit is "due a week after signing", but the deposit-size chips say:\n${
        bad.join("\n")
      }`,
    );
  });

  Deno.test(`REQ-1082 (LOOP-007 q3-8) [${lang}]: no deposit lang key words the deposit as due "${
    lang === "en" ? "now" : "ahora"
  }"`, () => {
    const dict = (lang === "en" ? en : es) as Record<string, string>;
    const hits = Object.entries(dict).filter(([k, v]) =>
      /deposit/i.test(k) && typeof v === "string" && NOW[lang].test(v)
    );
    assert(
      hits.length === 0,
      `deposit keys that say the deposit is due now:\n${
        hits.map(([k, v]) => `  ${k} = "${v}"`).join("\n")
      }`,
    );
  });
}
