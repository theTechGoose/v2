/**
 * REQ-884..889 — the HR module's pure rules: roster order, the frozen packet, expiry, the
 * pipeline, packet progress, document versions, the provisioning plan and its aggregate, the
 * 24-hour reminder, the overview's numbers.
 */
import { assert, assertEquals } from "#std/assert";
import {
  aggregateProvisioning,
  allDone,
  bumpsVersion,
  dashboardStats,
  expiresAt,
  isExpired,
  mintPacket,
  packetProgress,
  pipeline,
  provisionPlan,
  reminderDue,
  sortHires,
} from "@hr/domain/business/onboarding/mod.ts";
import type {
  Department,
  Hire,
  HrDocument,
  HrSystem,
  ProvisionResult,
} from "@hr/dto/hr.ts";

const doc = (id: string, over: Partial<HrDocument> = {}): HrDocument => ({
  id,
  userId: "u1",
  name: `Doc ${id}`,
  label: `Label ${id}`,
  category: "",
  kind: "ack",
  type: "text",
  creds: false,
  contentHtml: "<p>x</p>",
  pdfFileId: null,
  pdfName: null,
  fields: [],
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  discardedAt: null,
  ...over,
});
const dept = (over: Partial<Department> = {}): Department => ({
  id: "d1",
  userId: "u1",
  name: "Activations",
  division: "outbound",
  docIds: ["b", "a"],
  systemIds: ["s1", "s2"],
  createdAt: "",
  updatedAt: "",
  ...over,
});
const hire = (over: Partial<Hire> = {}): Hire => ({
  id: "h1",
  userId: "u1",
  firstName: "Casey",
  lastName: "Lin",
  email: "c@x.com",
  phone: "+17025550199",
  departmentId: "d1",
  departmentName: "Activations",
  startDate: "2026-06-30",
  status: "invited",
  token: "t",
  tokenExpiresAt: "2026-07-01T00:00:00.000Z",
  packet: [],
  systemIds: ["s1"],
  mail: { sentAt: null, openedAt: null, remindedAt: null },
  provisioning: [],
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
  signedAt: null,
  activeAt: null,
  offboardedAt: null,
  ...over,
});
const sys = (id: string, over: Partial<HrSystem> = {}): HrSystem => ({
  id,
  userId: "u1",
  key: id,
  name: `System ${id}`,
  kind: "other",
  desc: "",
  status: "connected",
  webhookUrl: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

Deno.test("REQ-884 sortHires — status ascending floats every unfinished hire to the top, start date second", () => {
  const hs = [
    hire({ id: "active", status: "active", startDate: "2026-06-01" }),
    hire({ id: "invited", status: "invited", startDate: "2026-06-05" }),
    hire({ id: "signed", status: "signed", startDate: "2026-06-02" }),
    hire({ id: "expired", status: "expired", startDate: "2026-06-09" }),
    hire({ id: "opened2", status: "opened", startDate: "2026-06-08" }),
    hire({ id: "opened1", status: "opened", startDate: "2026-06-03" }),
  ];
  assertEquals(sortHires(hs, "status", "asc").map((h) => h.id), [
    "expired",
    "opened1",
    "opened2",
    "invited",
    "signed",
    "active",
  ]);
  assertEquals(sortHires(hs, "name", "desc")[0].id, "active"); // all "Casey Lin" — ties keep start order
  assertEquals(sortHires(hs, "start", "asc").map((h) => h.id)[0], "active");
  assertEquals(sortHires(hs, "start", "desc").map((h) => h.id)[0], "expired");
});

Deno.test("REQ-884 mintPacket freezes the department's live documents, in the department's order, none done", () => {
  const docs = [
    doc("a", { kind: "sign", version: 3 }),
    doc("b"),
    doc("c"),
    doc("gone", { discardedAt: "2026-01-02T00:00:00.000Z" }),
  ];
  const packet = mintPacket(
    dept({ docIds: ["b", "gone", "a", "missing"] }),
    docs,
  );
  assertEquals(packet.map((p) => p.docId), ["b", "a"]);
  assertEquals(packet[1], {
    docId: "a",
    name: "Doc a",
    label: "Label a",
    kind: "sign",
    version: 3,
    done: false,
    doneAt: null,
    proofId: null,
  });
});

Deno.test("REQ-884 isExpired / expiresAt — an unfinished hire past its token's time is expired; a finished one never is", () => {
  const past = "2026-06-01T00:00:00.000Z", now = "2026-06-10T00:00:00.000Z";
  assert(isExpired(hire({ status: "invited", tokenExpiresAt: past }), now));
  assert(isExpired(hire({ status: "opened", tokenExpiresAt: past }), now));
  assert(isExpired(hire({ status: "signing", tokenExpiresAt: past }), now));
  assert(!isExpired(hire({ status: "signed", tokenExpiresAt: past }), now));
  assert(!isExpired(hire({ status: "active", tokenExpiresAt: past }), now));
  assert(
    !isExpired(
      hire({ status: "invited", tokenExpiresAt: "2026-06-11T00:00:00.000Z" }),
      now,
    ),
  );
  assertEquals(
    expiresAt("2026-06-10T12:00:00.000Z", 7),
    "2026-06-17T12:00:00.000Z",
  );
});

Deno.test("REQ-884 pipeline — five steps, done up to the status, the current one active", () => {
  const labels = pipeline(hire({ status: "signing" })).map((s) =>
    `${s.key}:${s.state}`
  );
  assertEquals(labels, [
    "invited:done",
    "opened:done",
    "signing:active",
    "signed:pending",
    "provisioned:pending",
  ]);
  assertEquals(pipeline(hire({ status: "invited" }))[0].state, "active");
  assertEquals(
    pipeline(hire({ status: "active" })).every((s) => s.state === "done"),
    true,
  );
  assertEquals(pipeline(hire({ status: "provisioning" })).map((s) => s.state), [
    "done",
    "done",
    "done",
    "done",
    "active",
  ]);
  // an expired link keeps what was reached: opened before it lapsed
  assertEquals(
    pipeline(
      hire({
        status: "expired",
        mail: { sentAt: "x", openedAt: "y", remindedAt: null },
      }),
    ).map((s) => s.state),
    ["done", "done", "pending", "pending", "pending"],
  );
});

Deno.test("REQ-885 packetProgress / allDone", () => {
  const p = mintPacket(dept({ docIds: ["a", "b"] }), [doc("a"), doc("b")]);
  assertEquals(packetProgress(p), { done: 0, total: 2 });
  assert(!allDone(p));
  p[0].done = true;
  assertEquals(packetProgress(p), { done: 1, total: 2 });
  p[1].done = true;
  assert(allDone(p));
  assert(!allDone([]), "an empty packet is never complete");
});

Deno.test("REQ-886 bumpsVersion — content, kind, fields or the PDF change the version; names and labels do not", () => {
  const d = doc("a");
  assert(
    !bumpsVersion(d, {
      name: "Renamed",
      label: "L",
      category: "Policies",
      creds: true,
    }),
  );
  assert(bumpsVersion(d, { contentHtml: "<p>y</p>" }));
  assert(bumpsVersion(d, { kind: "sign" }));
  assert(
    bumpsVersion(d, {
      fields: [{ id: "f", type: "date", page: 0, xPct: 1, yPct: 2 }],
    }),
  );
  assert(!bumpsVersion(d, { contentHtml: "<p>x</p>", fields: [] }));
});

Deno.test("REQ-887 provisionPlan reads the department's current connected systems, the hire's snapshot when the department is gone", () => {
  const systems = [sys("s1"), sys("s2", { status: "available" }), sys("s3")];
  assertEquals(
    provisionPlan(
      hire({ systemIds: ["s1"] }),
      dept({ systemIds: ["s3", "s2", "nope"] }),
      systems,
    ).map((s) => s.id),
    ["s3"],
  );
  assertEquals(
    provisionPlan(hire({ systemIds: ["s1", "s2"] }), null, systems).map((s) =>
      s.id
    ),
    ["s1"],
  );
});

Deno.test("REQ-888 aggregateProvisioning — active only when every arm is ok or done; an empty plan is active at once", () => {
  const r = (state: ProvisionResult["state"]): ProvisionResult => ({
    systemId: "s",
    name: "S",
    state,
    detail: null,
    at: "",
  });
  assertEquals(aggregateProvisioning([]), "active");
  assertEquals(aggregateProvisioning([r("ok"), r("done")]), "active");
  assertEquals(aggregateProvisioning([r("ok"), r("manual")]), "provisioning");
  assertEquals(aggregateProvisioning([r("ok"), r("fault")]), "provisioning");
  assertEquals(aggregateProvisioning([r("queued")]), "provisioning");
});

Deno.test("REQ-889 reminderDue — invited or opened, sent over 24 h ago, not reminded yet", () => {
  const sentAt = "2026-06-10T08:00:00.000Z";
  const mail = { sentAt, openedAt: null, remindedAt: null };
  assert(
    reminderDue(hire({ status: "invited", mail }), "2026-06-11T09:00:00.000Z"),
  );
  assert(
    reminderDue(hire({ status: "opened", mail }), "2026-06-11T09:00:00.000Z"),
  );
  assert(
    !reminderDue(hire({ status: "invited", mail }), "2026-06-11T07:00:00.000Z"),
    "too soon",
  );
  assert(
    !reminderDue(hire({ status: "signing", mail }), "2026-06-12T09:00:00.000Z"),
    "already signing",
  );
  assert(
    !reminderDue(
      hire({ status: "invited", mail: { ...mail, remindedAt: "x" } }),
      "2026-06-12T09:00:00.000Z",
    ),
    "once",
  );
  assert(
    !reminderDue(
      hire({ status: "invited", mail: { ...mail, sentAt: null } }),
      "2026-06-12T09:00:00.000Z",
    ),
    "never sent",
  );
});

Deno.test("REQ-889 dashboardStats — the tiles, the last seven days, the status mix, completion by department", () => {
  const hs = [
    hire({
      id: "1",
      status: "active",
      departmentName: "ODS",
      createdAt: "2026-06-25T10:00:00.000Z",
      signedAt: "2026-06-26T00:00:00.000Z",
      mail: {
        sentAt: "2026-06-25T10:00:00.000Z",
        openedAt: null,
        remindedAt: null,
      },
    }),
    hire({
      id: "2",
      status: "opened",
      departmentName: "ODS",
      createdAt: "2026-06-26T10:00:00.000Z",
      mail: {
        sentAt: "2026-06-26T10:00:00.000Z",
        openedAt: null,
        remindedAt: null,
      },
    }),
    hire({
      id: "3",
      status: "signed",
      departmentName: "VBA",
      createdAt: "2026-06-20T10:00:00.000Z",
      signedAt: "2026-06-21T00:00:00.000Z",
      mail: {
        sentAt: "2026-06-20T10:00:00.000Z",
        openedAt: null,
        remindedAt: null,
      },
    }),
    hire({
      id: "4",
      status: "expired",
      departmentName: "VBA",
      createdAt: "2026-06-18T10:00:00.000Z",
      mail: {
        sentAt: "2026-06-18T10:00:00.000Z",
        openedAt: null,
        remindedAt: null,
      },
    }),
  ];
  const s = dashboardStats(hs, "2026-06-26T20:00:00.000Z");
  assertEquals(s.sent, 4);
  assertEquals(s.completed, 2);
  assertEquals(s.awaiting, 1);
  assertEquals(s.accounts, 1);
  assertEquals(s.byDay.length, 7);
  assertEquals(s.byDay[6], { day: "2026-06-26", sent: 1 });
  assertEquals(s.byDay[5], { day: "2026-06-25", sent: 1 });
  assertEquals(s.byDay[0], { day: "2026-06-20", sent: 1 });
  assertEquals(s.statusMix, { signed: 2, awaiting: 1, expired: 1 });
  assertEquals(s.byDepartment, [
    { department: "ODS", signed: 1, awaiting: 1 },
    { department: "VBA", signed: 1, awaiting: 0 },
  ]);
  assertEquals(s.recent.map((h) => h.id), ["2", "1", "3"]);
});

// ── REQ-913 — DocuMonster is the source of truth: the catalog is the four built-in arms ──────────
import { SYSTEM_CATALOG } from "@hr/domain/data/hr-stores/mod.ts";
import { armMode, BUILTIN_KEYS, isBuiltin } from "./mod.ts";

Deno.test("REQ-913 the catalog is DocuMonster's four built-in arms — no Quickbase, Salesforce, Slack, ADP, Okta, DocuSign, Google, Readymode, Five9, Paychex, Twilio", () => {
  assertEquals(SYSTEM_CATALOG.map((c) => c.key), ["dm-worker", "dm-admin", "dm-email", "dm-text"]);
  assertEquals([...BUILTIN_KEYS], ["dm-worker", "dm-admin", "dm-email", "dm-text"]);
  assertEquals(SYSTEM_CATALOG.map((c) => c.kind), ["crm", "sso", "email", "comms"]);
  for (const gone of ["quickbase", "salesforce", "slack", "adp", "okta", "docusign", "gmail", "readymode", "five9", "paychex", "twilio"]) {
    assertEquals(SYSTEM_CATALOG.some((c) => c.key === gone), false, gone);
  }
});

Deno.test("REQ-913 armMode: a built-in key runs in-process; a webhook is a webhook; anything else is a manual step", () => {
  const base = { id: "s", userId: "u", name: "x", kind: "other" as const, desc: "", status: "connected" as const, createdAt: "t", updatedAt: "t" };
  assertEquals(armMode({ ...base, key: "dm-worker", webhookUrl: null }), "builtin");
  assertEquals(armMode({ ...base, key: "dm-worker", webhookUrl: "https://x" }), "builtin");
  assertEquals(armMode({ ...base, key: "custom", webhookUrl: "https://x" }), "webhook");
  assertEquals(armMode({ ...base, key: "custom", webhookUrl: null }), "manual");
  assertEquals(armMode({ ...base, key: "quickbase", webhookUrl: null }), "manual"); // an old attached one keeps working as what it is
  assertEquals(isBuiltin("dm-text"), true);
  assertEquals(isBuiltin("custom"), false);
});

// ── REQ-1036 (LOOP-007 q2, q2-19) — the welcome-email arm's catalog card says it comes from the business ──
Deno.test("REQ-1036 (q2-19) the dm-email catalog card does not say the welcome note is 'from DocuMonster' — REQ-1003's new-hire emails come from the business", () => {
  const card = SYSTEM_CATALOG.find((c) => c.key === "dm-email");
  assert(card, "dm-email is in the catalog");
  assertEquals(/documonster/i.test(card.desc), false, `desc=${JSON.stringify(card.desc)}`);
});
