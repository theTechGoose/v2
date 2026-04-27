import { createDefine } from "fresh";
import type { User } from "./lib/auth.ts";

/**
 * `ctx.state` shape — populated by middlewares.
 *  - `user`: resolved by /dashboard and /assistant middlewares.
 */
export interface State {
  user?: User;
}

export const define = createDefine<State>();
