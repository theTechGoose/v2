/**
 * REQ-883..889 — the HR module over HTTP, in process on an in-memory KV: settings, systems,
 * documents, departments, a hire and its link (text + email captured off the dev-mode log),
 * the phone's signing by token, provisioning through a local webhook and a manual arm,
 * retry, mark-done, offboarding, expiry and re-issue, the 24-hour reminder, the overview,
 * and account isolation.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { HrModule } from "@hr/mod-root.ts";
import { HireStore } from "@hr/domain/data/hr-stores/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [HrModule] })
class TestApp {}
const PORT = 9883;
const J = { "content-type": "application/json" };
// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any; headers: Headers; text: string };
type Call = (
  method: string,
  path: string,
  body?: unknown,
  headers?: HeadersInit,
) => Promise<Res>;

/** the dev-mode SMS and email services print what they would send; the test reads it */
function captureLog() {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.includes(":dev-mode]")) lines.push(line);
    else orig(...args);
  };
  return { lines, restore: () => (console.log = orig) };
}

async function withServer(fn: (call: Call) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("DENO_DEPLOYMENT_ID");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  const call: Call = async (method, path, body, headers = {}) => {
    const r = await fetch(`http://localhost:${PORT}${path}`, {
      method,
      headers: { ...J, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch { /* raw */ }
    return { status: r.status, body: parsed, headers: r.headers, text };
  };
  try {
    await fn(call);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(call: Call, phone: string, name: string) {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const H = { "x-session-id": v.body.sessionId as string };
  await call(
    "PUT",
    "/me",
    { name, language: "en", email: "hr@example.com" },
    H,
  );
  await call("PUT", "/profile/identity", {
    businessName: "Monster Reservations Group",
  }, H);
  return H;
}

/** a tiny PDF (one blank page) */
const PDF_BASE64 = btoa(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF",
);
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** a webhook on a free port that answers what the test tells it to */
function webhook() {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let answer = 200;
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    calls.push({ path: new URL(req.url).pathname, body: await req.json() });
    return new Response(answer === 200 ? '{"ok":true}' : "nope", {
      status: answer,
    });
  });
  return {
    url: (path: string) => `http://localhost:${server.addr.port}${path}`,
    calls,
    set(status: number) {
      answer = status;
    },
    close: () => server.shutdown(),
  };
}

Deno.test("REQ-883..889 the HR module end to end over HTTP", async () => {
  const log = captureLog();
  const hook = webhook();
  try {
    await withServer(async (call) => {
      const H = await login(call, "+15125558830", "Raphael Castro");

      // ---- REQ-889a settings: defaults off the account, then updated
      const s0 = await call("GET", "/hr/settings", undefined, H);
      assertEquals(s0.status, 200);
      assertEquals(s0.body.companyName, "Monster Reservations Group");
      assertEquals(s0.body.hrEmail, "hr@example.com");
      assertEquals(s0.body.linkExpiryDays, 7);
      assertEquals(s0.body.autoSend, true);
      assertEquals(s0.body.autoProvision, true);
      assertEquals(s0.body.remind24h, true);
      assertEquals(s0.body.notifyOnComplete, false);
      assert(
        typeof s0.body.signingDomain === "string" &&
          s0.body.signingDomain.startsWith("http"),
      );
      const bad = await call("PUT", "/hr/settings", { linkExpiryDays: 0 }, H);
      assertEquals(bad.status, 400);
      assertEquals(bad.body.code, "expiry_invalid");
      const s1 = await call("PUT", "/hr/settings", {
        notifyOnComplete: true,
        credsUsername: "Monster",
        credsPassword: "Monster2023!",
      }, H);
      assertEquals(s1.status, 200);
      assertEquals(s1.body.notifyOnComplete, true);
      assertEquals(s1.body.companyName, "Monster Reservations Group");

      // ---- REQ-888a systems: the catalog, attach, a webhook on one
      // REQ-913: the catalog is DocuMonster's own four arms; the prototype's third parties are gone
      const sys0 = await call("GET", "/hr/systems", undefined, H);
      assertEquals(sys0.status, 200);
      assertEquals(sys0.body.systems, []);
      assertEquals(
        sys0.body.catalog.map((c: { key: string }) => c.key),
        ["dm-worker", "dm-admin", "dm-email", "dm-text"],
      );
      const quickbase = await call("POST", "/hr/systems", { key: "quickbase" }, H);
      assertEquals(quickbase.status, 400, "Quickbase is not a system of ours any more");
      assertEquals(quickbase.body.code, "unknown_system");
      // anything outside DocuMonster is a custom system with a webhook (REQ-888b stands)
      const crm = await call("POST", "/hr/systems", { name: "CRM", kind: "crm", desc: "Record of record" }, H);
      assertEquals(crm.status, 201, crm.text);
      assertEquals(crm.body.name, "CRM");
      assertEquals(crm.body.key, "custom");
      assertEquals(crm.body.status, "connected");
      assertEquals(
        (await call("POST", "/hr/systems", { name: "crm" }, H)).status,
        409,
      );
      const dialer = await call("POST", "/hr/systems", { name: "Dialer", kind: "dialer" }, H);
      // the welcome text from the account's line: built in — and this account has no line yet
      const mail = await call("POST", "/hr/systems", { key: "dm-text" }, H);
      assertEquals(mail.status, 201, mail.text);
      assertEquals(mail.body.name, "Welcome text (your line)");
      assertEquals(
        (await call("POST", "/hr/systems", { key: "dm-text" }, H)).status,
        409,
      );
      const noHook = await call("PUT", `/hr/systems/${mail.body.id}`, { webhookUrl: hook.url("/x") }, H);
      assertEquals(noHook.status, 400, "a built-in arm takes no webhook");
      assertEquals(noHook.body.code, "builtin_no_webhook");
      const custom = await call("POST", "/hr/systems", {
        name: "Badge printer",
        kind: "other",
        desc: "Lobby",
      }, H);
      assertEquals(custom.status, 201);
      assertEquals(custom.body.key, "custom");
      const hooked = await call("PUT", `/hr/systems/${crm.body.id}`, {
        webhookUrl: hook.url("/crm"),
      }, H);
      assertEquals(hooked.body.webhookUrl, hook.url("/crm"));
      await call("PUT", `/hr/systems/${dialer.body.id}`, {
        webhookUrl: hook.url("/dialer"),
      }, H);
      const off = await call("PUT", `/hr/systems/${custom.body.id}`, {
        status: "available",
      }, H);
      assertEquals(off.body.status, "available");
      const sys1 = await call("GET", "/hr/systems", undefined, H);
      assertEquals(sys1.body.systems.length, 4);
      assert(
        !sys1.body.catalog.some((c: { key: string }) => c.key === "dm-text"),
        "attached ones leave the catalog",
      );

      // ---- REQ-886a documents: create, save (version), a PDF, discard
      const lib0 = await call("GET", "/hr/documents", undefined, H);
      assertEquals(lib0.body, []);
      const welcome = await call("POST", "/hr/documents", {
        name: "Welcome Letter",
        label: "Welcome to the Monster Family",
        category: "MO Culture · NHT",
        kind: "sign",
        contentHtml: "<p>The product is the vacation. The service is you.</p>",
      }, H);
      assertEquals(welcome.status, 201, welcome.text);
      assertEquals(welcome.body.version, 1);
      assertEquals(welcome.body.type, "text");
      const handbook = await call("POST", "/hr/documents", {
        name: "Handbook Acknowledgment",
        label: "Team Member Handbook",
        kind: "ack",
        creds: true,
        contentHtml: "<p>WHALE HELLO THERE!</p>",
      }, H);
      assertEquals(handbook.body.creds, true);
      const renamed = await call("PUT", `/hr/documents/${welcome.body.id}`, {
        name: "Welcome Letter v2",
        category: "Culture",
      }, H);
      assertEquals(renamed.body.version, 1, "a rename is not a new version");
      const edited = await call("PUT", `/hr/documents/${welcome.body.id}`, {
        contentHtml: "<p>Edited.</p>",
      }, H);
      assertEquals(edited.body.version, 2, "new content is a new version");
      const blank = await call("POST", "/hr/documents", {}, H);
      assertEquals(blank.status, 201);
      assertEquals(blank.body.name, "Untitled document");
      const pdf = await call("POST", `/hr/documents/${blank.body.id}/pdf`, {
        filename: "payplan.pdf",
        base64: PDF_BASE64,
      }, H);
      assertEquals(pdf.status, 200, pdf.text);
      assertEquals(pdf.body.type, "pdf");
      assertEquals(pdf.body.kind, "sign");
      assertEquals(pdf.body.pdfName, "payplan.pdf");
      assertEquals(pdf.body.version, 2);
      const stamped = await call("PUT", `/hr/documents/${blank.body.id}`, {
        name: "Pay Plan",
        label: "Your Pay Plan",
        fields: [{ id: "f1", type: "signature", page: 0, xPct: 40, yPct: 80 }, {
          id: "f2",
          type: "date",
          page: 0,
          xPct: 70,
          yPct: 80,
        }],
      }, H);
      assertEquals(stamped.body.fields.length, 2);
      assertEquals(stamped.body.version, 3);
      const bytes = await fetch(
        `http://localhost:${PORT}/hr/documents/${blank.body.id}/pdf`,
        { headers: H },
      );
      assertEquals(bytes.status, 200);
      assertEquals(bytes.headers.get("content-type"), "application/pdf");
      assertStringIncludes(await bytes.text(), "%PDF-1.1");
      const scrap = await call("POST", "/hr/documents", { name: "Scrap" }, H);
      assertEquals(
        (await call("DELETE", `/hr/documents/${scrap.body.id}`, undefined, H))
          .status,
        200,
      );
      const lib1 = await call("GET", "/hr/documents", undefined, H);
      assertEquals(lib1.body.map((d: { name: string }) => d.name).sort(), [
        "Handbook Acknowledgment",
        "Pay Plan",
        "Welcome Letter v2",
      ]);

      // ---- REQ-887a departments: create, configure, the discarded doc is refused
      const noName = await call("POST", "/hr/departments", {
        name: " ",
        division: "outbound",
      }, H);
      assertEquals(noName.status, 400);
      assertEquals(noName.body.code, "name_required");
      const act = await call("POST", "/hr/departments", {
        name: "Activations",
        division: "outbound",
      }, H);
      assertEquals(act.status, 201, act.text);
      assertEquals(act.body.docIds, []);
      assertEquals(
        (await call("POST", "/hr/departments", {
          name: "activations",
          division: "inbound",
        }, H)).status,
        409,
      );
      const unknownDoc = await call("PUT", `/hr/departments/${act.body.id}`, {
        docIds: [scrap.body.id],
      }, H);
      assertEquals(unknownDoc.status, 400);
      assertEquals(unknownDoc.body.code, "unknown_document");
      const unknownSys = await call("PUT", `/hr/departments/${act.body.id}`, {
        systemIds: ["nope"],
      }, H);
      assertEquals(unknownSys.body.code, "unknown_system");
      const cfg = await call("PUT", `/hr/departments/${act.body.id}`, {
        docIds: [welcome.body.id, handbook.body.id, blank.body.id],
        systemIds: [crm.body.id, dialer.body.id, mail.body.id, custom.body.id],
      }, H);
      assertEquals(cfg.status, 200, cfg.text);
      assertEquals(cfg.body.docIds.length, 3);
      const ids = await call("POST", "/hr/departments", {
        name: "IDS — AM",
        division: "inbound",
      }, H);
      assertEquals(
        (await call("GET", "/hr/departments", undefined, H)).body.length,
        2,
      );

      // ---- REQ-884a a hire: the packet frozen, the link sent (autoSend)
      const noDept = await call("POST", "/hr/hires", { firstName: "Casey" }, H);
      assertEquals(noDept.status, 400);
      assertEquals(noDept.body.code, "department_required");
      const noFirst = await call("POST", "/hr/hires", {
        departmentId: act.body.id,
      }, H);
      assertEquals(noFirst.body.code, "name_required");
      const badPhone = await call("POST", "/hr/hires", {
        firstName: "Casey",
        departmentId: act.body.id,
        phone: "12",
      }, H);
      assertEquals(badPhone.body.code, "phone_invalid");
      log.lines.length = 0;
      const casey = await call("POST", "/hr/hires", {
        firstName: "Casey",
        lastName: "Lin",
        email: "casey.lin@example.com",
        phone: "(702) 555-1199",
        departmentId: act.body.id,
        startDate: "2026-06-30",
      }, H);
      assertEquals(casey.status, 201, casey.text);
      assertEquals(casey.body.status, "invited");
      assertEquals(casey.body.name, "Casey Lin");
      assertEquals(casey.body.phone, "+17025551199");
      assertEquals(casey.body.departmentName, "Activations");
      assertEquals(casey.body.packet.map((d: { docId: string }) => d.docId), [
        welcome.body.id,
        handbook.body.id,
        blank.body.id,
      ]);
      assertEquals(
        casey.body.packet[0].version,
        2,
        "the version at creation is frozen on the packet",
      );
      assertEquals(casey.body.progress, { done: 0, total: 3 });
      assertEquals(casey.body.pipeline[0], { key: "invited", state: "active" });
      assert(
        typeof casey.body.token === "string" && casey.body.token.length >= 16,
      );
      assertStringIncludes(casey.body.signUrl, `/sign/${casey.body.token}`);
      assert(casey.body.mail.sentAt, "autoSend sent the link at creation");
      const sms = log.lines.find((l) =>
        l.includes("[sms:dev-mode]") && l.includes("+17025551199")
      );
      assert(sms, `the text went out: ${log.lines.join(" | ")}`);
      assertStringIncludes(sms, "Hey Casey!");
      assertStringIncludes(sms, "Monster Reservations Group");
      assertStringIncludes(sms, `/sign/${casey.body.token}`);
      const email = log.lines.find((l) => l.includes("[email:dev-mode]"));
      assert(email, "the email went out");
      assertStringIncludes(email, "MONSTERIZED");

      // the department's docs change AFTER creation: the in-flight packet keeps its three
      await call("PUT", `/hr/departments/${act.body.id}`, {
        docIds: [welcome.body.id],
      }, H);
      const still = await call(
        "GET",
        `/hr/hires/${casey.body.id}`,
        undefined,
        H,
      );
      assertEquals(still.body.packet.length, 3);
      // a rename follows through to the hire
      await call("PUT", `/hr/departments/${act.body.id}`, {
        name: "Activations (OB)",
      }, H);
      assertEquals(
        (await call("GET", `/hr/hires/${casey.body.id}`, undefined, H)).body
          .departmentName,
        "Activations (OB)",
      );

      // ---- REQ-884b resend: a second text + email, sentAt moves
      log.lines.length = 0;
      const resent = await call(
        "POST",
        `/hr/hires/${casey.body.id}/send`,
        {},
        H,
      );
      assertEquals(resent.status, 200, resent.text);
      assertEquals(
        resent.body.token,
        casey.body.token,
        "an unexpired link keeps its token",
      );
      assertEquals(
        log.lines.filter((l) => l.includes("[sms:dev-mode]")).length,
        1,
      );
      assertEquals(
        log.lines.filter((l) => l.includes("[email:dev-mode]")).length,
        1,
      );

      // ---- REQ-885a the phone opens the packet by token
      assertEquals((await call("GET", "/hr/sign/not-a-token")).status, 404);
      const open = await call("GET", `/hr/sign/${casey.body.token}`);
      assertEquals(open.status, 200, open.text);
      assertEquals(open.body.firstName, "Casey");
      assertEquals(
        open.body.lastName,
        undefined,
        "no PII beyond the first name",
      );
      assertEquals(open.body.phone, undefined);
      assertEquals(open.body.departmentName, "Activations (OB)");
      assertEquals(open.body.companyName, "Monster Reservations Group");
      assertEquals(open.body.status, "opened");
      assertEquals(open.body.docs.length, 3);
      assertEquals(open.body.docs[0].label, "Welcome to the Monster Family");
      assertEquals(open.body.docs[0].contentHtml, "<p>Edited.</p>");
      assertEquals(open.body.docs[1].creds, true);
      assertEquals(open.body.docs[1].credentials, {
        username: "Monster",
        password: "Monster2023!",
      });
      assertEquals(open.body.docs[0].credentials, undefined);
      assertEquals(open.body.docs[2].type, "pdf");
      assertEquals(open.body.docs[2].fields.length, 2);
      const opened = await call(
        "GET",
        `/hr/hires/${casey.body.id}`,
        undefined,
        H,
      );
      assertEquals(opened.body.status, "opened");
      assert(opened.body.mail.openedAt, "the open is recorded");
      assertEquals(opened.body.pipeline[1], { key: "opened", state: "active" });
      const pdfPublic = await fetch(
        `http://localhost:${PORT}/hr/sign/${casey.body.token}/pdf/${blank.body.id}`,
      );
      assertEquals(pdfPublic.status, 200);
      assertEquals(pdfPublic.headers.get("content-type"), "application/pdf");
      await pdfPublic.body?.cancel();

      // ---- REQ-885b signing: consent, a signature where required, one proof per document
      const docIds = open.body.docs.map((d: { docId: string }) => d.docId);
      const noConsent = await call(
        "POST",
        `/hr/sign/${casey.body.token}/docs/${docIds[0]}`,
        { printedName: "Casey Lin", signaturePng: PNG },
      );
      assertEquals(noConsent.status, 400);
      assertEquals(noConsent.body.code, "consent_required");
      const noSig = await call(
        "POST",
        `/hr/sign/${casey.body.token}/docs/${docIds[0]}`,
        { printedName: "Casey Lin", consent: true },
      );
      assertEquals(noSig.status, 400);
      assertEquals(noSig.body.code, "signature_required");
      const notSigned = await call(
        "GET",
        `/hr/hires/${casey.body.id}/proofs/${docIds[0]}`,
        undefined,
        H,
      );
      assertEquals(notSigned.status, 404);
      assertEquals(notSigned.body.code, "not_signed_yet");
      const p1 = await call(
        "POST",
        `/hr/sign/${casey.body.token}/docs/${docIds[0]}`,
        { printedName: "Casey Lin", consent: true, signaturePng: PNG },
        { "x-forwarded-for": "70.182.44.100", "user-agent": "Safari/iPhone" },
      );
      assertEquals(p1.status, 201, p1.text);
      assertEquals(p1.body.proof.kind, "sign");
      assertEquals(p1.body.proof.docVersion, 2);
      assertEquals(p1.body.proof.signaturePng, PNG);
      assertEquals(p1.body.proof.ip, "70.182.44.100");
      assertEquals(p1.body.proof.userAgent, "Safari/iPhone");
      assertStringIncludes(
        p1.body.proof.consentText,
        "I have read and understand",
      );
      assertEquals(p1.body.status, "signing");
      assertEquals(p1.body.progress, { done: 1, total: 3 });
      assertEquals(p1.body.complete, false);
      assertEquals(
        (await call("POST", `/hr/sign/${casey.body.token}/docs/${docIds[0]}`, {
          printedName: "Casey Lin",
          consent: true,
          signaturePng: PNG,
        })).status,
        409,
      );
      const p2 = await call(
        "POST",
        `/hr/sign/${casey.body.token}/docs/${docIds[1]}`,
        { consent: true },
      );
      assertEquals(p2.status, 201, p2.text);
      assertEquals(p2.body.proof.kind, "ack");
      assertEquals(p2.body.proof.signaturePng, null);
      assertEquals(
        p2.body.proof.printedName,
        "Casey Lin",
        "an acknowledgment carries the hire's name",
      );
      const view = await call(
        "GET",
        `/hr/hires/${casey.body.id}/proofs/${docIds[0]}`,
        undefined,
        H,
      );
      assertEquals(view.status, 200);
      assertEquals(view.body.printedName, "Casey Lin");
      assertEquals(view.body.signaturePng, PNG);
      log.lines.length = 0;
      const p3 = await call(
        "POST",
        `/hr/sign/${casey.body.token}/docs/${docIds[2]}`,
        { printedName: "Casey Lin", consent: true, signaturePng: PNG },
      );
      assertEquals(p3.status, 201, p3.text);
      assertEquals(p3.body.complete, true);

      // ---- REQ-888c/REQ-889b completion: notify + auto-provision — two webhook arms ok, the mail arm manual
      const done = await call(
        "GET",
        `/hr/hires/${casey.body.id}`,
        undefined,
        H,
      );
      assert(done.body.signedAt, "signedAt is stamped");
      assertEquals(
        done.body.status,
        "provisioning",
        JSON.stringify(done.body.provisioning),
      );
      const arms = done.body.provisioning as {
        systemId: string;
        state: string;
        name: string;
        detail: string | null;
      }[];
      assertEquals(
        arms.map((a) => a.state),
        ["ok", "ok", "manual"],
        "the available (disconnected) custom system is not in the plan",
      );
      // REQ-913: the built-in text arm says WHY it is manual — this account has no line yet
      assertStringIncludes(arms[2].detail ?? "", "line");
      assertEquals(hook.calls.map((c) => c.path), ["/crm", "/dialer"]);
      assertEquals(hook.calls[0].body.event, "hire.provision");
      assertEquals(
        (hook.calls[0].body.hire as { firstName: string }).firstName,
        "Casey",
      );
      assertEquals(
        (hook.calls[0].body.hire as { token?: string }).token,
        undefined,
        "the token never leaves",
      );
      const notice = log.lines.find((l) =>
        l.includes("[email:dev-mode]") && l.includes("hr@example.com")
      );
      assert(
        notice,
        `notify-on-completion emailed HR: ${log.lines.join(" | ")}`,
      );
      assertEquals(done.body.pipeline[4], {
        key: "provisioned",
        state: "active",
      });
      // the manual arm gets marked done → active, MONSTERIZED
      const marked = await call(
        "POST",
        `/hr/hires/${casey.body.id}/provision/${mail.body.id}/done`,
        {},
        H,
      );
      assertEquals(marked.status, 200, marked.text);
      assertEquals(marked.body.status, "active");
      assert(marked.body.activeAt);
      assertEquals(
        marked.body.pipeline.every((s: { state: string }) =>
          s.state === "done"
        ),
        true,
      );
      // a finished packet still opens, read-only
      const again = await call("GET", `/hr/sign/${casey.body.token}`);
      assertEquals(again.status, 200);
      assertEquals(
        again.body.docs.every((d: { done: boolean }) => d.done),
        true,
      );

      // ---- REQ-888c a fault and a retry of one arm (auto-provision off → manual run)
      await call("PUT", "/hr/settings", {
        autoProvision: false,
        autoSend: false,
        notifyOnComplete: false,
      }, H);
      const quiet = await call("POST", "/hr/hires", {
        firstName: "Priya",
        lastName: "Shah",
        phone: "7025551173",
        email: "p@example.com",
        departmentId: act.body.id,
        startDate: "2026-06-29",
      }, H);
      assertEquals(quiet.body.mail.sentAt, null, "autoSend off: nothing sent");
      assertEquals(
        quiet.body.packet.length,
        1,
        "the department now lists one document",
      );
      const early = await call(
        "POST",
        `/hr/hires/${quiet.body.id}/provision`,
        {},
        H,
      );
      assertEquals(early.status, 409);
      assertEquals(early.body.code, "not_signed");
      await call(
        "POST",
        `/hr/sign/${quiet.body.token}/docs/${welcome.body.id}`,
        { printedName: "Priya Shah", consent: true, signaturePng: PNG },
      );
      const signedOnly = await call(
        "GET",
        `/hr/hires/${quiet.body.id}`,
        undefined,
        H,
      );
      assertEquals(
        signedOnly.body.status,
        "signed",
        "autoProvision off: it waits",
      );
      hook.set(500);
      hook.calls.length = 0;
      const run = await call(
        "POST",
        `/hr/hires/${quiet.body.id}/provision`,
        {},
        H,
      );
      assertEquals(run.status, 200, run.text);
      assertEquals(run.body.status, "provisioning");
      assertEquals(
        run.body.provisioning.map((a: { state: string }) => a.state),
        ["fault", "fault", "manual"],
      );
      assertStringIncludes(run.body.provisioning[0].detail, "500");
      hook.set(200);
      const retry = await call("POST", `/hr/hires/${quiet.body.id}/provision`, {
        systemId: crm.body.id,
      }, H);
      assertEquals(
        retry.body.provisioning.map((a: { state: string }) => a.state),
        ["ok", "fault", "manual"],
        "only the one arm re-ran",
      );
      assertEquals(hook.calls.length, 3);
      await call("POST", `/hr/hires/${quiet.body.id}/provision`, {
        systemId: dialer.body.id,
      }, H);
      const nearly = await call(
        "POST",
        `/hr/hires/${quiet.body.id}/provision/${mail.body.id}/done`,
        {},
        H,
      );
      assertEquals(nearly.body.status, "active");

      // ---- REQ-888d offboarding tears down in reverse
      hook.calls.length = 0;
      const gone = await call(
        "POST",
        `/hr/hires/${quiet.body.id}/offboard`,
        {},
        H,
      );
      assertEquals(gone.status, 200, gone.text);
      assertEquals(gone.body.status, "offboarded");
      assert(gone.body.offboardedAt);
      assertEquals(
        gone.body.provisioning.map((a: { state: string }) => a.state),
        ["torn_down", "torn_down", "torn_down"],
      );
      assertEquals(hook.calls.map((c) => c.body.event), [
        "hire.offboard",
        "hire.offboard",
      ]);

      // ---- REQ-913 the built-in arms: a worker account, an editor, the welcome email — in DocuMonster
      const worker = await call("POST", "/hr/systems", { key: "dm-worker" }, H);
      const editor = await call("POST", "/hr/systems", { key: "dm-admin" }, H);
      const emailSys = await call("POST", "/hr/systems", { key: "dm-email" }, H);
      assertEquals([worker.status, editor.status, emailSys.status], [201, 201, 201]);
      const crew = await call("POST", "/hr/departments", { name: "Crew", division: "outbound" }, H);
      await call("PUT", `/hr/departments/${crew.body.id}`, {
        docIds: [welcome.body.id],
        systemIds: [worker.body.id, editor.body.id, emailSys.body.id],
      }, H);
      const wren = await call("POST", "/hr/hires", {
        firstName: "Wren",
        lastName: "Ortiz",
        phone: "7025551199",
        email: "wren@example.com",
        departmentId: crew.body.id,
        startDate: "2026-07-01",
      }, H);
      assertEquals(wren.status, 201, wren.text);
      await call(
        "POST",
        `/hr/sign/${wren.body.token}/docs/${welcome.body.id}`,
        { printedName: "Wren Ortiz", consent: true, signaturePng: PNG },
      );
      log.lines.length = 0;
      const built = await call("POST", `/hr/hires/${wren.body.id}/provision`, {}, H);
      assertEquals(built.status, 200, built.text);
      assertEquals(
        built.body.provisioning.map((a: { name: string; state: string }) => [a.name, a.state]),
        [["DocuMonster worker account", "ok"], ["DocuMonster editor", "ok"], ["Welcome email (Postmark)", "ok"]],
        JSON.stringify(built.body.provisioning),
      );
      assertEquals(built.body.status, "active");
      const crewList = await call("GET", "/field/workers", undefined, H);
      const wrenWorker = crewList.body.find((w: { phoneNumber: string }) => w.phoneNumber === "7025551199");
      assert(wrenWorker, `Wren is a worker now: ${crewList.text}`);
      assertEquals(wrenWorker.name, "Wren Ortiz");
      const editors = await call("GET", "/me/admins", undefined, H);
      assert(
        editors.body.some((a: { phoneNumber: string }) => a.phoneNumber === "+17025551199"),
        `Wren is an editor now: ${editors.text}`,
      );
      assert(
        log.lines.some((l) => l.includes("[email:dev-mode]") && l.includes("wren@example.com")),
        `the welcome email went to Wren: ${log.lines.join(" | ")}`,
      );
      // a second run rebuilds nothing: one worker, one editor
      await call("POST", `/hr/hires/${wren.body.id}/provision`, {}, H);
      assertEquals(
        (await call("GET", "/field/workers", undefined, H)).body.filter((w: { phoneNumber: string }) => w.phoneNumber === "7025551199").length,
        1,
      );
      // offboarding takes the worker and the editor back out
      const wrenGone = await call("POST", `/hr/hires/${wren.body.id}/offboard`, {}, H);
      assertEquals(
        wrenGone.body.provisioning.map((a: { state: string }) => a.state),
        ["torn_down", "torn_down", "torn_down"],
      );
      assertEquals(
        (await call("GET", "/field/workers", undefined, H)).body.some((w: { phoneNumber: string }) => w.phoneNumber === "7025551199"),
        false,
        "the worker account is gone",
      );
      assertEquals(
        (await call("GET", "/me/admins", undefined, H)).body.some((a: { phoneNumber: string }) => a.phoneNumber === "+17025551199"),
        false,
        "the editor is gone",
      );
      // a cell that is already a worker in ANOTHER account is a fault, not a takeover
      const { FieldWorkerStore } = await import("@field/domain/data/field-stores/mod.ts");
      await new FieldWorkerStore().put({
        id: "w-elsewhere",
        userId: "someone-else",
        name: "Zed Elsewhere",
        phoneNumber: "7025551198",
        pin: "1234",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      const zed = await call("POST", "/hr/hires", {
        firstName: "Zed",
        phone: "7025551198",
        email: "zed@example.com",
        departmentId: crew.body.id,
      }, H);
      await call(
        "POST",
        `/hr/sign/${zed.body.token}/docs/${welcome.body.id}`,
        { printedName: "Zed", consent: true, signaturePng: PNG },
      );
      const zedRun = await call("POST", `/hr/hires/${zed.body.id}/provision`, {}, H);
      assertEquals(zedRun.body.provisioning[0].state, "fault");
      assertStringIncludes(zedRun.body.provisioning[0].detail, "another account");
      assertEquals(zedRun.body.status, "provisioning");

      // ---- REQ-884c lazy expiry and re-issue with a rotated token
      // REQ-932: an empty packet is never sent, so IDS gets a document before Marcus is hired
      assertEquals(
        (await call("PUT", `/hr/departments/${ids.body.id}`, {
          docIds: [welcome.body.id],
        }, H)).status,
        200,
      );
      const marcus = await call("POST", "/hr/hires", {
        firstName: "Marcus",
        phone: "7025551100",
        departmentId: ids.body.id,
      }, H);
      assertEquals(marcus.status, 201, marcus.text);
      assertEquals(
        marcus.body.packet.map((p: { docId: string }) => p.docId),
        [welcome.body.id],
        "Marcus's packet is IDS's one document",
      );
      const store = new HireStore();
      const rec = await store.get(marcus.body.id);
      await store.put({ ...rec, tokenExpiresAt: "2020-01-01T00:00:00.000Z" });
      const lapsed = await call(
        "GET",
        `/hr/hires/${marcus.body.id}`,
        undefined,
        H,
      );
      assertEquals(lapsed.body.status, "expired");
      const dead = await call("GET", `/hr/sign/${marcus.body.token}`);
      assertEquals(dead.status, 410);
      assertEquals(dead.body.code, "link_expired");
      const reissued = await call(
        "POST",
        `/hr/hires/${marcus.body.id}/send`,
        {},
        H,
      );
      assertEquals(reissued.body.status, "invited");
      assert(reissued.body.token !== marcus.body.token, "the token rotated");
      assert(reissued.body.tokenExpiresAt > new Date().toISOString());
      assertEquals(
        (await call("GET", `/hr/sign/${marcus.body.token}`)).status,
        404,
        "the old link is dead",
      );
      assertEquals(
        (await call("GET", `/hr/sign/${reissued.body.token}`)).status,
        200,
      );

      // ---- REQ-889b the 24-hour reminder, once
      const m2 = await store.get(marcus.body.id);
      await store.put({
        ...m2,
        mail: {
          ...m2.mail,
          sentAt: new Date(Date.now() - 25 * 3_600_000).toISOString(),
        },
      });
      log.lines.length = 0;
      const roster = await call("GET", "/hr/hires", undefined, H);
      assertEquals(roster.status, 200);
      const reminded = roster.body.find((h: { id: string }) =>
        h.id === marcus.body.id
      );
      assert(reminded.mail.remindedAt, "the roster read ran the sweep");
      const reminder = log.lines.find((l) =>
        l.includes("[sms:dev-mode]") && l.includes("+17025551100")
      );
      assert(reminder, "the reminder text went out");
      assertStringIncludes(reminder, "reminder");
      log.lines.length = 0;
      await call("GET", "/hr/hires", undefined, H);
      assertEquals(log.lines.length, 0, "only once");

      // ---- REQ-884c the roster's order: unfinished first (REQ-913 added Zed, still provisioning, and Wren, offboarded)
      assertEquals(roster.body.map((h: { status: string }) => h.status), [
        "opened",
        "provisioning",
        "active",
        "offboarded",
        "offboarded",
      ]);
      const byName = await call(
        "GET",
        "/hr/hires?sort=name&dir=asc",
        undefined,
        H,
      );
      assertEquals(byName.body.map((h: { firstName: string }) => h.firstName), [
        "Casey",
        "Marcus",
        "Priya",
        "Wren",
        "Zed",
      ]);

      // ---- REQ-889c the overview
      const dash = await call("GET", "/hr/dashboard", undefined, H);
      assertEquals(dash.status, 200);
      // REQ-913 added Wren (offboarded) and Zed (provisioning) to the five
      assertEquals(dash.body.sent, 5);
      assertEquals(dash.body.completed, 4);
      assertEquals(dash.body.awaiting, 1);
      assertEquals(dash.body.accounts, 3);
      assertEquals(dash.body.byDay.length, 7);
      assertEquals(dash.body.recent.length, 3);

      // ---- REQ-883/884e account isolation
      const H2 = await login(call, "+15125558831", "Someone Else");
      assertEquals(
        (await call("GET", `/hr/hires/${casey.body.id}`, undefined, H2)).status,
        404,
      );
      assertEquals(
        (await call("GET", `/hr/documents/${welcome.body.id}`, undefined, H2))
          .status,
        404,
      );
      assertEquals(
        (await call("GET", `/hr/departments/${act.body.id}`, undefined, H2))
          .status,
        404,
      );
      assertEquals(
        (await call("PUT", `/hr/systems/${crm.body.id}`, {
          status: "available",
        }, H2)).status,
        404,
      );
      assertEquals((await call("GET", "/hr/hires", undefined, H2)).body, []);
      assertEquals((await call("GET", "/hr/hires")).status, 401);
    });
  } finally {
    log.restore();
    await hook.close();
  }
});
