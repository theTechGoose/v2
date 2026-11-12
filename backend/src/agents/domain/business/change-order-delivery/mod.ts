import { type Lang, t } from "@core/i18n/mod.ts";
import {
  type ChangeOrderSentInput,
  changeOrderSentLineWith,
} from "#documents/change-order-sent-line.ts";

/**
 * REQ-456 (demo-loop cycle 3, M25) — what a chat change order's reply says
 * about its delivery to the CUSTOMER. SendChangeOrderAlert emails and texts
 * the customer the /co approval link; the reply used to say only "I've sent
 * you the link to share", which read as if nothing went to the customer.
 *
 * REQ-684 (cycle 5, m39): the wording lives in
 * shared/documents/change-order-sent-line.ts so the hand-made change order
 * on /quotes says the very same line.
 */
export type { ChangeOrderSentInput };

export function changeOrderSentLine(
  lang: Lang,
  o: ChangeOrderSentInput,
): string {
  return changeOrderSentLineWith((key, vars) => t(lang, key, vars), o);
}
