/**
 * REQ-714 — demo-loop cycle 5, issue m58 ("worker view flashes English
 * first"): a signed-in worker's /worker renders in the worker's own language
 * on the server, so the page does not paint the browser's pm_lang (English)
 * and then flip to Spanish when the client's workerClient.me() returns.
 * ?lang= and the /worker pick (pm_worker_lang) still win (REQ-285/494); the
 * page language Salir returns to stays the browser's (REQ-416).
 */
import { assert, assertEquals } from "@std/assert";
import { workerRouteLang } from "./field.ts";
import { loadWorkerLang, readWorkerCookie } from "./worker-ssr.ts";

type Fetch = (req: Request) => Response | Promise<Response>;
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

Deno.test("REQ-714 workerRouteLang — a signed-in worker's language renders unless ?lang= or the pick says otherwise; the page language stays the browser's", () => {
  // the m58 case: an English browser, a Spanish worker signed in
  assertEquals(
    workerRouteLang({ query: null, picked: null, stored: "en", worker: "es" }),
    { lang: "es", pageLang: "en", chosen: false, picked: false },
  );
  // ?lang= wins (REQ-285)
  assertEquals(
    workerRouteLang({ query: "en", picked: null, stored: "en", worker: "es" }),
    { lang: "en", pageLang: "en", chosen: true, picked: false },
  );
  // the /worker pick wins (REQ-494)
  assertEquals(
    workerRouteLang({ query: null, picked: "en", stored: "es", worker: "es" }),
    { lang: "en", pageLang: "en", chosen: false, picked: true },
  );
  // no worker session: as before, ending in Spanish (REQ-155)
  assertEquals(
    workerRouteLang({ query: null, picked: null, stored: null, worker: null }),
    { lang: "es", pageLang: "es", chosen: false, picked: false },
  );
});

Deno.test("REQ-714 readWorkerCookie reads pm_worker only (not pm_worker_lang), in ; and HTTP/2 , joined headers", () => {
  assertEquals(readWorkerCookie("pm_lang=en; pm_worker=tok_1"), "tok_1");
  assertEquals(readWorkerCookie("pm_worker_lang=en, pm_worker=a%2Fb"), "a/b");
  assertEquals(readWorkerCookie("pm_worker_lang=en; pm_lang=en"), undefined);
  assertEquals(readWorkerCookie(null), undefined);
});

Deno.test("REQ-714 loadWorkerLang asks /field/worker/me with the pm_worker cookie and returns the worker's language", async () => {
  const seen: Request[] = [];
  const backend: Fetch = (req) => {
    seen.push(req);
    return json({ id: "w1", name: "Luis", role: "worker", language: "es" });
  };
  const req = new Request("http://app/worker", {
    headers: { cookie: "pm_lang=en; pm_worker=tok_1; pm_session=s" },
  });
  assertEquals(await loadWorkerLang(req, { fetch: backend }), "es");
  assertEquals(seen.length, 1);
  assertEquals(new URL(seen[0].url).pathname, "/field/worker/me");
  assertEquals(seen[0].headers.get("cookie"), "pm_worker=tok_1");
});

Deno.test("REQ-714 loadWorkerLang: no pm_worker cookie → no backend call; signed out, odd language or a failing backend → null", async () => {
  let calls = 0;
  const count: Fetch = () => {
    calls++;
    return json({ language: "es" });
  };
  const bare = new Request("http://app/worker", {
    headers: { cookie: "pm_lang=en" },
  });
  assertEquals(await loadWorkerLang(bare, { fetch: count }), null);
  assertEquals(calls, 0, "no cookie, no backend call");

  const req = new Request("http://app/worker", {
    headers: { cookie: "pm_worker=tok" },
  });
  // signed out: Danet answers 200 with an empty body
  assertEquals(
    await loadWorkerLang(req, { fetch: () => new Response("") }),
    null,
  );
  assertEquals(
    await loadWorkerLang(req, { fetch: () => json({ language: "fr" }) }),
    null,
  );
  assertEquals(
    await loadWorkerLang(req, {
      fetch: () => new Response("boom", { status: 500 }),
    }),
    null,
  );
  assertEquals(
    await loadWorkerLang(req, {
      fetch: () => Promise.reject(new Error("down")),
    }),
    null,
  );
});

Deno.test("REQ-714 the /worker route reads the worker on the server and hands the island its language and the page's own", () => {
  const route = Deno.readTextFileSync(
    new URL("../routes/worker/index.tsx", import.meta.url),
  );
  assert(
    /loadWorkerLang\(ctx\.req\)/.test(route),
    "the route asks the backend",
  );
  assert(/worker:\s*await loadWorkerLang|worker:\s*workerLang/.test(route));
  assert(/pageLang=\{pageLang\}/.test(route), "Salir's language is passed");
  const island = Deno.readTextFileSync(
    new URL("../islands/WorkerScreen.tsx", import.meta.url),
  );
  // REQ-416: the worker's language is never written into the browser's pm_lang
  assert(
    /setLang\(initialLang, \{ persist: initialLang === page \}\)/.test(island),
    "the opening language persists only when it is the page's own",
  );
});
