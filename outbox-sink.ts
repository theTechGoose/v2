// LOOP-007 — the VM's outbox: Postmark, Twilio SMS and every Twilio comms API point here, so nothing real is
// ever sent. Every call is kept as numbered files in SINK_DIR; GET /mail lists them, GET /mail/<file> serves one.
const DIR = Deno.env.get("SINK_DIR") ?? "/work/mail";
const PORT = Number(Deno.env.get("SINK_PORT") ?? 4999);
Deno.mkdirSync(DIR, { recursive: true });
let n = 0;
const next = () => String(++n).padStart(3, "0");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", json: "application/json", pdf: "application/pdf", txt: "text/plain; charset=utf-8", png: "image/png", jpg: "image/jpeg", csv: "text/csv" };
const entries: { id: string; kind: string; at: string; summary: string; files: string[] }[] = [];

async function body(req: Request): Promise<Record<string, unknown>> {
  const t = await req.text();
  if ((req.headers.get("content-type") ?? "").includes("json")) { try { return JSON.parse(t); } catch { return { raw: t }; } }
  const p = new URLSearchParams(t), o: Record<string, unknown> = {};
  for (const [k, v] of p) o[k] = o[k] === undefined ? v : [o[k], v].flat();
  return Object.keys(o).length ? o : { raw: t };
}

Deno.serve({ port: PORT, hostname: "0.0.0.0", onListen: () => console.log(`outbox-sink on :${PORT} → ${DIR}`) }, async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/mail") {
    const rows = entries.map((e) => `<tr><td>${e.id}</td><td>${e.at}</td><td>${e.kind}</td><td>${esc(e.summary)}</td><td>${e.files.map((f) => `<a href="/mail/${f}">${f}</a>`).join(" ")}</td></tr>`).join("");
    return new Response(`<!doctype html><meta charset=utf-8><title>Outbox</title><h1>Outbox (${entries.length})</h1><table border=1 cellpadding=4><tr><th>#</th><th>time</th><th>kind</th><th>summary</th><th>files</th></tr>${rows}</table>`, { headers: { "content-type": TYPES.html } });
  }
  if (req.method === "GET" && url.pathname.startsWith("/mail/")) {
    const f = decodeURIComponent(url.pathname.slice(6));
    if (!/^[A-Za-z0-9._-]+$/.test(f) || f.startsWith(".")) return new Response("not found", { status: 404 });
    try { return new Response(await Deno.readFile(`${DIR}/${f}`), { headers: { "content-type": TYPES[f.split(".").pop()!] ?? "application/octet-stream" } }); }
    catch { return new Response("not found", { status: 404 }); }
  }
  const b = await body(req);
  const id = next(), at = new Date().toISOString().slice(11, 19);
  if (url.pathname === "/email" || url.pathname === "/email/batch") {
    const files = [`${id}-email.json`];
    const { Attachments, ...rest } = b as { Attachments?: { Name: string; Content: string; ContentType: string }[] };
    Deno.writeTextFileSync(`${DIR}/${id}-email.json`, JSON.stringify({ ...rest, Attachments: (Attachments ?? []).map((a) => ({ Name: a.Name, ContentType: a.ContentType, bytes: atob(a.Content ?? "").length })) }, null, 2));
    if (b.HtmlBody) { Deno.writeTextFileSync(`${DIR}/${id}-email.html`, String(b.HtmlBody)); files.push(`${id}-email.html`); }
    if (b.TextBody) { Deno.writeTextFileSync(`${DIR}/${id}-email.txt`, String(b.TextBody)); files.push(`${id}-email.txt`); }
    for (const a of Attachments ?? []) {
      const name = `${id}-${safe(a.Name)}`;
      Deno.writeFileSync(`${DIR}/${name}`, Uint8Array.from(atob(a.Content ?? ""), (c) => c.charCodeAt(0)));
      files.push(name);
    }
    entries.push({ id, kind: "email", at, summary: `to ${b.To} · ${b.Subject}`, files });
    return Response.json({ To: b.To, SubmittedAt: new Date().toISOString(), MessageID: `sink-${id}`, ErrorCode: 0, Message: "OK" });
  }
  if (/\/Accounts\/[^/]+\/Messages\.json$/.test(url.pathname) && req.method === "POST") {
    Deno.writeTextFileSync(`${DIR}/${id}-sms.json`, JSON.stringify(b, null, 2));
    entries.push({ id, kind: "sms", at, summary: `to ${b.To} · ${b.Body}`, files: [`${id}-sms.json`] });
    return Response.json({ sid: `SMsink${id}`, status: "queued", to: b.To, from: b.From, body: b.Body }, { status: 201 });
  }
  Deno.writeTextFileSync(`${DIR}/${id}-other.json`, JSON.stringify({ method: req.method, path: url.pathname, query: url.search, body: b }, null, 2));
  entries.push({ id, kind: "other", at, summary: `${req.method} ${url.pathname}`, files: [`${id}-other.json`] });
  return Response.json({ sid: `XXsink${id}`, status: "ok" });
});
