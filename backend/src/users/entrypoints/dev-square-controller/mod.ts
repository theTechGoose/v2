/**
 * REQ-803 — the in-process fake Square's checkout page, off the real deploy only: a payment
 * link made on a FAKE token (`EAAAfake_…`) points here, the way a real one points at Square's
 * hosted checkout. The page names what is being paid and the amount; "Pay" completes the fake
 * order (one card tender) and goes back to the link's redirect, "Cancel" goes back unpaid. On
 * the real deploy none of it exists (404), exactly like dev-stripe-controller.
 *
 *   GET  /dev/square/checkout/:linkId         → the page
 *   POST /dev/square/checkout/:linkId/pay     → paid, then back to the redirect
 *   POST /dev/square/checkout/:linkId/cancel  → back to the redirect, nothing paid
 */
import { Context, Controller, Get, Param, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import {
  type EnvReader,
  onRealDeploy,
} from "@core/business/real-deploy/mod.ts";
import { fakeSquareWorld, squareEnv } from "@core/data/square-gateway/mod.ts";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
function money(cents: number): string {
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
/** Back to the redirect, the way Square's checkout returns: a page that moves on by itself.
 *  Not a 303 — the dev front-end's /api proxy FOLLOWS redirects server-side, which would serve
 *  the invoice page under the checkout's URL. */
function backTo(location: string, label: string): Response {
  const href = esc(location);
  return html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${href}">
<title>${esc(label)}</title></head>
<body><p data-cy="fake-square-returning">${
    esc(label)
  } — <a href="${href}">back to the invoice</a></p>
<script>location.replace(${
    JSON.stringify(location).replace(/</g, "\\u003c")
  });</script>
</body></html>`);
}

@Controller("dev/square/checkout")
export class DevSquareController {
  /** where the real-deploy switch is read (REQ-318); unset = `squareEnv.reader` */
  env?: EnvReader;

  @Get(":linkId")
  page(@Context() ctx: ExecutionContext, @Param("linkId") linkId: string) {
    if (onRealDeploy(this.env ?? squareEnv.reader)) {
      return ctx.json({ error: "not_found" }, 404);
    }
    const link = fakeSquareWorld().links.get(linkId);
    if (!link) return ctx.json({ error: "not_found" }, 404);
    const id = encodeURIComponent(link.id);
    return html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Checkout (fake Square)</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f2f2f2;color:#1a1a1a}
main{max-width:420px;margin:48px auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.tag{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#a06800}
h1{font-size:18px;margin:10px 0 4px}.amt{font-size:32px;font-weight:800;margin:14px 0 22px}
form{display:inline}button{font:inherit;font-weight:700;border-radius:8px;padding:12px 18px;cursor:pointer}
.pay{background:#006aff;color:#fff;border:1px solid #006aff;width:100%;margin-bottom:10px}
.cancel{background:#fff;color:#1a1a1a;border:1px solid #ccc;width:100%}
</style></head><body><main data-cy="fake-square-checkout">
<div class="tag">Fake Square checkout — no real card is charged</div>
<h1 data-cy="fake-square-name">${esc(link.name)}</h1>
<div class="amt" data-cy="fake-square-amount">${
      esc(money(link.amountCents))
    }</div>
<form method="post" action="${id}/pay"><button class="pay" type="submit" data-cy="fake-square-pay">Pay ${
      esc(money(link.amountCents))
    }</button></form>
<form method="post" action="${id}/cancel"><button class="cancel" type="submit" data-cy="fake-square-cancel">Cancel</button></form>
</main></body></html>`);
  }

  @Post(":linkId/pay")
  pay(@Context() ctx: ExecutionContext, @Param("linkId") linkId: string) {
    if (onRealDeploy(this.env ?? squareEnv.reader)) {
      return ctx.json({ error: "not_found" }, 404);
    }
    const world = fakeSquareWorld();
    if (!world.links.get(linkId)) {
      return ctx.json({ error: "not_found" }, 404);
    }
    const { redirectUrl } = world.pay(linkId);
    return backTo(redirectUrl, "Paid");
  }

  @Post(":linkId/cancel")
  cancel(@Context() ctx: ExecutionContext, @Param("linkId") linkId: string) {
    if (onRealDeploy(this.env ?? squareEnv.reader)) {
      return ctx.json({ error: "not_found" }, 404);
    }
    const link = fakeSquareWorld().links.get(linkId);
    if (!link) return ctx.json({ error: "not_found" }, 404);
    return backTo(link.redirectUrl, "Cancelled");
  }
}
