import { define } from "../../utils.ts";

// "Conversations" in the sidebar — same workspace as /assistant.
export const handler = define.handlers({
  GET: () => new Response(null, { status: 302, headers: { Location: "/assistant" } }),
});
