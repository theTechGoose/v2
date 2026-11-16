/**
 * REQ-891 — /roof moved to /tools/satellite (the Tools folder; the tool is
 * "Satellite measure" now, roofs and driveways alike). The first release's
 * links and bookmarks still land: 302 to the new home.
 */
import { define } from "../../utils.ts";

export const handler = define.handlers({
  GET: () =>
    new Response(null, {
      status: 302,
      headers: { Location: "/tools/satellite" },
    }),
});
