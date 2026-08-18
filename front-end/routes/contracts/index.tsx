import { define } from "../../utils.ts";

// PDF p4 "Why is contracts back?" — contracts were folded into the unified
// Quote + Agreement document, so a standalone Contracts surface must not
// resurface. Deep links (old bookmarks, emails) land on /quotes, where the
// combined document lives. The auth gate stays in _middleware.ts.
export const handler = define.handlers({
  GET: () =>
    new Response(null, {
      status: 302,
      headers: { Location: "/quotes" },
    }),
});
