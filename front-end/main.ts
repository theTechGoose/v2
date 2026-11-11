import { App, staticFiles } from "fresh";
import { define, type State } from "./utils.ts";
import denostories from "denostories";
import { retiredHostRedirect } from "../shared/site-host/retired.ts";

export const app = new App<State>();

// REQ-219: a request for a retired host (the old domain, any "www") is sent to
// the same path on the site's own origin — before anything else answers, so a
// static file is not served under a second name either.
app.use((ctx) => {
  const path = ctx.url.pathname + ctx.url.search;
  const to = retiredHostRedirect(ctx.req.headers.get("host"), path) ??
    retiredHostRedirect(ctx.url.host, path);
  return to
    ? new Response(null, { status: 301, headers: { location: to } })
    : ctx.next();
});

app.use(staticFiles());

app.use(denostories({ runHeadlessChecks: false }));

// Pass a shared value from a middleware
app.use(async (ctx) => {
  ctx.state.shared = "hello";
  return await ctx.next();
});

// this is the same as the /api/:name route defined via a file. feel free to delete this!
app.get("/api2/:name", (ctx) => {
  const name = ctx.params.name;
  return new Response(
    `Hello, ${name.charAt(0).toUpperCase() + name.slice(1)}!`,
  );
});

// this can also be defined via a file. feel free to delete this!
const exampleLoggerMiddleware = define.middleware((ctx) => {
  console.log(`${ctx.req.method} ${ctx.req.url}`);
  return ctx.next();
});
app.use(exampleLoggerMiddleware);

// Include file-system based routes here
app.fsRoutes();
