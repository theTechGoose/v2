/**
 * REQ-1105 (LOOP-007 cycle 3, q3-29; cites REQ-258) — the create_quote
 * `paymentTerms` description is the rule the model follows when it maps a
 * stated payment to a wizard preset. It had a rule for "half deposit" and for
 * "30/30/40" but none for a non-50% "N% deposit", so "30% deposit" was mapped
 * to the preset that starts with 30 ('30_30_40') and the payment step showed a
 * second "Suggested" chip. The description (en + es) must send "N% deposit" to
 * 'deposit_bal' and keep '30_30_40' for three stated payments only.
 */
import { assert } from "#std/assert";
import { t } from "@core/i18n/mod.ts";
import { TOOL_DEFS } from "./mod.ts";

const KEY = "prompts.tools.createQuote.paymentTerms";

function clauses(desc: string): string[] {
  return desc.split(/[;.]\s+/);
}

function checkRule(desc: string, where: string) {
  const pct = clauses(desc).filter((c) =>
    /\bN\s*%|\d+\s*%/.test(c) && /dep[oó]sito|deposit/i.test(c) &&
    c.includes("deposit_bal")
  );
  assert(
    pct.length > 0,
    `${where}: no rule maps a stated "N% deposit" (e.g. "30% deposit") to 'deposit_bal' — description: ${desc}`,
  );
  const three = clauses(desc).find((c) => c.includes("30_30_40")) ?? "";
  assert(
    /three|3 payments|tres|3 pagos/i.test(three),
    `${where}: '30_30_40' is not limited to three stated payments — clause: ${three}`,
  );
}

Deno.test("REQ-1105 (LOOP-007 q3, q3-29) create_quote paymentTerms description: '30% deposit' maps to 'deposit_bal', never '30_30_40' (tool def, en)", () => {
  const def = TOOL_DEFS.find((d) => d.function.name === "create_quote")!;
  const params = def.function.parameters as unknown as {
    properties: Record<string, { description?: string }>;
  };
  checkRule(params.properties.paymentTerms.description ?? "", "TOOL_DEFS");
});

Deno.test("REQ-1105 (LOOP-007 q3, q3-29) create_quote paymentTerms description: the rule is in en and es", () => {
  checkRule(t("en", KEY), "en");
  checkRule(t("es", KEY), "es");
});
