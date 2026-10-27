import { createDefine } from "fresh";
import type { User } from "./lib/auth.ts";
import type { Lang } from "./lib/lang.ts";

// This specifies the type of "ctx.state" which is used to share
// data among middlewares, layouts and routes.
export interface State {
  shared: string;
  user?: User;
  /** REQ-122 — the language a public page resolved for itself
   *  (lib/public-page.ts); the app shell labels <html> with it. */
  lang?: Lang;
}

export const define = createDefine<State>();
