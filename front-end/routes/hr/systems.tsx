/**
 * REQ-912 — /hr/systems moved: the connected systems live under Account → Systems now
 * (/settings?tab=systems), with everything else DocuMonster runs on. Old links land there.
 * The auth gate stays in _middleware.ts.
 */
import { define } from "../../utils.ts";

export const handler = define.handlers({
  GET: () =>
    new Response(null, {
      status: 302,
      headers: { Location: "/settings?tab=systems" },
    }),
});
