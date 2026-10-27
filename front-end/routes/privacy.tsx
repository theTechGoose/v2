import { define } from "../utils.ts";
import LegalPage from "../components/LegalPage.tsx";
import { publicPageHandler } from "../lib/public-page.ts";

/** /privacy — the Privacy Policy, its own page under the website's header (REQ-066),
 *  the October 6, 2026 text in the visitor's language (REQ-065). */
export const handler = publicPageHandler;

export default define.page<typeof handler>(function LegalRoute(ctx) {
  return <LegalPage id="privacy" lang={ctx.data.lang} />;
});
