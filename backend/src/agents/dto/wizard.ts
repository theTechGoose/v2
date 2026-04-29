import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

/**
 * Wizard data shapes for phase 2.
 *
 *   WizardSpec   — static catalog of steps + options (the questionnaire).
 *   WizardState  — per-conversation snapshot of progress (active step, answers).
 *   WizardAnswer — a single user pick.
 *
 * Each step has button-style options. The last option is conventionally
 * `isCustom: true` and accepts a free-text `customValue` instead of a preset.
 *
 * The state lives keyed by conversationId — one wizard per conversation.
 */

export interface WizardOption {
  id: string;
  label: string;
  sub?: string;
  /** When true, the user is expected to supply a free-text customValue. */
  isCustom?: boolean;
}

export interface WizardStep {
  id: string;            // e.g. "payment_terms"
  label: string;         // sidebar label, e.g. "Payment terms"
  question: string;      // shown as the step's heading
  options: WizardOption[];
  hint?: string;
}

export interface WizardSpec {
  id: string;            // e.g. "contract-terms-v1"
  steps: WizardStep[];
}

export interface WizardAnswer {
  stepId: string;
  optionId: string;
  customValue?: string;
  answeredAt: string;
}

export interface WizardState {
  /** id matching the spec; lets us future-proof multiple wizards. */
  specId: string;
  /** Index into spec.steps; equal to spec.steps.length when done. */
  activeStepIdx: number;
  answers: WizardAnswer[];
}

export class WizardAnswerDto {
  @IsString()
  conversationId!: string;

  @IsString()
  stepId!: string;

  @IsString()
  optionId!: string;

  @IsOptional()
  @IsString()
  customValue?: string;

  /** Customer-step payload. Validation is intentionally loose; the
   *  coordinator does the deeper checks (existence, ownership, required
   *  fields on `create`). */
  @IsOptional()
  customer?: { id?: string; create?: { name: string; email?: string; phoneNumber?: string } };
}

export function parseWizardAnswer(input: unknown): WizardAnswerDto {
  const dto = plainToInstance(WizardAnswerDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid wizard answer: ${JSON.stringify(errors)}`);
  return dto;
}
