/**
 * REQ-125 — Crazy Egg's tracking script in the app shell's <head>, on
 * /landing2 alone (support@crazyegg.com's request, forwarded by Raphael
 * 2026-10-28). Crazy Egg's script on the real deploy, the app's own fake on
 * the gate and a dev box (shared/crazy-egg/script.ts); the tag as they
 * prescribe it: type text/javascript, async.
 */
import {
  crazyEggConfig,
  isCrazyEggPage,
} from "../../shared/crazy-egg/script.ts";

const CONFIG = typeof Deno !== "undefined"
  ? crazyEggConfig({
    DENO_DEPLOY: Deno.env.get("DENO_DEPLOY"),
    DENO_DEPLOYMENT_ID: Deno.env.get("DENO_DEPLOYMENT_ID"),
  })
  : null;

export default function CrazyEgg({ path }: { path: string }) {
  if (!CONFIG || !isCrazyEggPage(path)) return null;
  return (
    <script
      async
      type="text/javascript"
      src={CONFIG.src}
      data-crazy-egg={CONFIG.mode}
    />
  );
}
