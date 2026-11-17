/**
 * REQ-335 (demo-loop cycle 1, issue M31): what a tap inside a job-option card
 * on the Job Details picker does.
 *
 * The rule: a tap ANYWHERE in a card chooses that card — its bullet text, a
 * bullet's pencil, delete/restore, the title, the title's pencil. Editing a
 * card's content implies choosing it. Only the pencils open inline editing;
 * a bullet tap just selects (so Continue applies the card the contractor
 * actually touched, and a first tap never pops the phone keyboard).
 */
export type OptionTapKind =
  | "card"
  | "title"
  | "titlePencil"
  | "bullet"
  | "bulletPencil"
  | "delete";

export interface OptionTap {
  kind: OptionTapKind;
  optionId: string;
  bulletId?: string;
  /** the bullet is struck through — a deleted bullet is never edited */
  deleted?: boolean;
}

export interface OptionTapEffect {
  /** the card the tap chooses — always the tapped one */
  selectedOptionId: string;
  /** the bullet to open for inline editing, if any */
  editBullet: string | null;
  /** open the title for inline editing */
  editTitle: boolean;
  /** the bullet whose deleted flag flips, if any */
  toggleDeleted: string | null;
}

export function optionTap(tap: OptionTap): OptionTapEffect {
  const fx: OptionTapEffect = {
    selectedOptionId: tap.optionId,
    editBullet: null,
    editTitle: false,
    toggleDeleted: null,
  };
  switch (tap.kind) {
    case "titlePencil":
      fx.editTitle = true;
      break;
    case "bulletPencil":
      if (tap.bulletId && !tap.deleted) fx.editBullet = tap.bulletId;
      break;
    case "delete":
      if (tap.bulletId) fx.toggleDeleted = tap.bulletId;
      break;
    default:
      break;
  }
  return fx;
}
