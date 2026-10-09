import { define } from "../utils.ts";
import LegalPage from "../components/LegalPage.tsx";
import { legalHandler } from "../lib/legal-page.ts";

/** /sms-terms — the SMS Terms & Conditions, its own page under the website's header (REQ-066),
 *  the October 6, 2026 text in the visitor's language (REQ-065). */
export const handler = legalHandler;

export default define.page<typeof handler>(function LegalRoute(ctx) {
  return <LegalPage id="sms" lang={ctx.data.lang} />;
});
