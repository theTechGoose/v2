import { define } from "../../utils.ts";

// "Conversations" in the sidebar — same workspace as /assistant. Pass a
// `?from=messages` flag so the assistant page can show a one-line toast
// explaining the consolidation (P6.14).
export const handler = define.handlers({
  GET: () => new Response(null, { status: 302, headers: { Location: "/assistant?from=messages" } }),
});
