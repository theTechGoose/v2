/**
 * REQ-870 (demo-loop cycle dm5, issue p7) — /admin's guide gate "Return to your account" lands
 * where the pill's End does when the leave ended the demo: `endedHref({ by: "you" }, lang)`, so
 * /admin says "You ended the demo". While a colleague stays on the demo (the leave did not end
 * it), or when the leave's outcome is unknown, it lands on the plain console — never claiming an
 * end that did not happen. The leave still comes before the account is handed back (REQ-232).
 */
import { assertEquals } from "jsr:@std/assert@1";
import { returnToOwnAccount } from "./return-to-account.ts";

type Reply = { status: number; body: unknown };

async function run(
  demoId: string | null,
  lang: string | null,
  leave: Reply,
): Promise<{ href: string; calls: string[] }> {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  const had = Object.getOwnPropertyDescriptor(globalThis, "location");
  const loc = { href: "" };
  Object.defineProperty(globalThis, "location", {
    value: loc,
    configurable: true,
    writable: true,
  });
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(new URL(url, "http://x").pathname);
    const r = url.includes("/leave")
      ? leave
      : { status: 200, body: { sessionId: "s", user: { id: "u" } } };
    return Promise.resolve(
      new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  try {
    await returnToOwnAccount(demoId, lang);
    return { href: loc.href, calls };
  } finally {
    globalThis.fetch = realFetch;
    if (had) Object.defineProperty(globalThis, "location", had);
    else delete (globalThis as { location?: unknown }).location;
  }
}

Deno.test("REQ-870 (dm5 p7): the only presenter's Return ends the demo → /admin says 'You ended the demo', in the gate's language", async () => {
  const r = await run("d1", "es", {
    status: 200,
    body: { ok: true, ended: true },
  });
  assertEquals(r.href, "/admin?demo=ended&by=you&lang=es");
  assertEquals(
    r.calls.map((p) => p.replace(/^\/api/, "")),
    ["/demo-mode/sessions/d1/leave", "/admin/stop-impersonating"],
    "leave first, then hand the account back",
  );
});

Deno.test("REQ-870 (dm5 p7): a colleague stays on the demo → the plain console, no 'You ended the demo'", async () => {
  const r = await run("d1", "en", {
    status: 200,
    body: { ok: true, ended: false },
  });
  assertEquals(r.href, "/admin?lang=en");
});

Deno.test("REQ-870 (dm5 p7): the leave failed → the plain console (an end it cannot vouch for is never claimed)", async () => {
  const r = await run("d1", "en", { status: 500, body: { message: "x" } });
  assertEquals(r.href, "/admin?lang=en");
});

Deno.test("REQ-870 (dm5 p7): no demo to leave → the plain console, no leave call", async () => {
  const r = await run(null, null, { status: 200, body: { ok: true } });
  assertEquals(r.href, "/admin");
  assertEquals(
    r.calls.map((p) => p.replace(/^\/api/, "")),
    ["/admin/stop-impersonating"],
  );
});
