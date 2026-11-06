// REQ-153 — the deploy's root router: a WebSocket upgrade under /api reaches the backend with the
// ORIGINAL request and connects (a re-wrapped Request breaks Deno's upgrade); a plain /api call
// is stripped; the frontend goes first everywhere else with the backend as the fallthrough.
import { assertEquals } from "#std/assert";
import {
  composeRouter,
  isWebSocketUpgrade,
} from "../../../../../compose-router.ts";

function backend(req: Request): Response {
  const url = new URL(req.url);
  if (isWebSocketUpgrade(req) && url.pathname === "/api/demo-mode/ws") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.onmessage = (e) => socket.send(`echo:${e.data}`);
    return response;
  }
  if (url.pathname === "/fallthrough") return new Response("backend page");
  return new Response(JSON.stringify({ path: url.pathname }), {
    status: url.pathname === "/missing" ? 404 : 200,
  });
}
function frontend(req: Request): Response {
  const url = new URL(req.url);
  if (url.pathname === "/page") return new Response("frontend page");
  return new Response("styled 404", { status: 404 });
}

Deno.test("REQ-153 composeRouter — a WebSocket upgrade under /api connects through the backend; /api is stripped for calls; frontend first, backend fallthrough, the frontend's 404 last", async () => {
  const ac = new AbortController();
  const srv = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    composeRouter({ backendFetch: backend, frontendFetch: frontend }),
  );
  const base = `http://localhost:${srv.addr.port}`;
  try {
    const ws = new WebSocket(
      `${base.replace("http", "ws")}/api/demo-mode/ws?session=x`,
    );
    const got = await new Promise<string>((res, rej) => {
      ws.onopen = () => ws.send("hi");
      ws.onmessage = (e) => res(String(e.data));
      ws.onerror = (e) => rej(new Error((e as ErrorEvent).message));
    });
    assertEquals(got, "echo:hi");
    ws.close();
    await new Promise((r) => (ws.onclose = r));
    assertEquals(await (await fetch(`${base}/api/anything/here`)).json(), {
      path: "/anything/here",
    });
    assertEquals(await (await fetch(`${base}/page`)).text(), "frontend page");
    assertEquals(
      await (await fetch(`${base}/fallthrough`)).text(),
      "backend page",
    );
    const missing = await fetch(`${base}/missing`);
    assertEquals(missing.status, 404);
    assertEquals(await missing.text(), "styled 404");
  } finally {
    ac.abort();
    await srv.finished;
  }
});

Deno.test("REQ-153 isWebSocketUpgrade — the upgrade header, case-insensitively", () => {
  assertEquals(
    isWebSocketUpgrade(
      new Request("http://x/", { headers: { upgrade: "WebSocket" } }),
    ),
    true,
  );
  assertEquals(isWebSocketUpgrade(new Request("http://x/")), false);
});
