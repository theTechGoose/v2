import { define } from "../utils.ts";
import { tFor } from "../lib/i18n.ts";

export default define.page(function TestPage() {
  return <div style="padding:40px;font:24px sans-serif">{tFor("en", "testPage.body")}</div>;
});
