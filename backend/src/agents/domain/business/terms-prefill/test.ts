// REQ-258 (demo M22): what the contractor already said in the chat ("half
// deposit") pre-selects the matching option of the terms wizard step.
import { assertEquals } from "#std/assert";
import { suggestedOptionId } from "./mod.ts";
import {
  INVOICE_WIZARD_V1,
  TERMS_WIZARD_V1,
} from "@agents/domain/business/terms-wizard-spec/mod.ts";

const step = (id: string, spec = TERMS_WIZARD_V1) =>
  spec.steps.find((s) => s.id === id)!;

Deno.test("REQ-258 suggestedOptionId: the prefilled payment option is suggested on the payment_terms step", () => {
  assertEquals(
    suggestedOptionId({ payment_terms: "50_50" }, step("payment_terms")),
    "50_50",
  );
  assertEquals(
    suggestedOptionId(
      { payment_terms: "deposit_bal" },
      step("payment_terms", INVOICE_WIZARD_V1),
    ),
    "deposit_bal",
  );
});

Deno.test("REQ-258 suggestedOptionId: nothing for other steps, no prefill, an unknown id, or a custom option", () => {
  assertEquals(
    suggestedOptionId({ payment_terms: "50_50" }, step("warranty")),
    undefined,
  );
  assertEquals(suggestedOptionId(undefined, step("payment_terms")), undefined);
  assertEquals(suggestedOptionId({}, step("payment_terms")), undefined);
  assertEquals(
    suggestedOptionId({ payment_terms: "half" }, step("payment_terms")),
    undefined,
  );
  assertEquals(
    suggestedOptionId({ payment_terms: "custom" }, step("payment_terms")),
    undefined,
  );
  assertEquals(
    suggestedOptionId({ payment_terms: "50_50" }, undefined),
    undefined,
  );
});
