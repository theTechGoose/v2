/**
 * "Professionalize that" review state machine (raw-plan p5).
 *
 * The LLM's polished breakdown is only ever a PROPOSAL: the user's own words
 * stay applied until they explicitly accept (optionally after editing), and
 * reject discards the proposal entirely.
 */

export interface ProfessionalizeState {
  /** The items currently applied to the job details. */
  applied: string[];
  /** A polished breakdown awaiting the user's accept/edit/reject; null when none. */
  proposal: string[] | null;
}

export type ProfessionalizeAction =
  | { type: "propose"; items: string[] }
  | { type: "accept" }
  | { type: "edit"; index: number; text: string }
  | { type: "reject" };

/** Split raw textarea input into one trimmed item per line (bullets stripped). */
export function parseJobLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-•*·]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

export function initialProfessionalizeState(items: string[]): ProfessionalizeState {
  return { applied: [...items], proposal: null };
}

export function professionalizeReducer(
  state: ProfessionalizeState,
  action: ProfessionalizeAction,
): ProfessionalizeState {
  switch (action.type) {
    case "propose":
      return { applied: state.applied, proposal: [...action.items] };
    case "accept":
      return {
        applied: state.proposal ? [...state.proposal] : state.applied,
        proposal: null,
      };
    case "edit": {
      if (!state.proposal) return state;
      const proposal = [...state.proposal];
      proposal[action.index] = action.text;
      return { applied: state.applied, proposal };
    }
    case "reject":
      return { applied: state.applied, proposal: null };
  }
}
