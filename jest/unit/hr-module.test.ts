/**
 * REQ-883 — the HR module's wiring on the front end: the HR folder on the sidebar's root with its
 * six entries, the strings in both dictionaries, the routes that mount the islands (and the public
 * /sign/:token page with no dashboard chrome), the client, the pure helpers.
 */
import * as fs from "fs";
import * as path from "path";
import {
  folderPathTo,
  isFolder,
  viewAt,
} from "../../front-end/lib/nav-folders";
import { NAV } from "../../front-end/lib/nav-tree";
import {
  donutSlices,
  initialsOf,
  inviteText,
  matchesHire,
  placeField,
  sortHires,
  STATUS_CHIP,
} from "../../front-end/lib/hr";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (rel: string) => JSON.parse(read(rel)) as Record<string, string>;
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

describe("REQ-883 the HR module", () => {
  test("REQ-883a the HR folder sits on the root between Roles and Reports with Overview, New hires, Documents, Departments, HR settings (REQ-912: Systems moved under Account)", () => {
    const root = viewAt(NAV, []).items.map((n) => n.id);
    expect(root.indexOf("hr")).toBe(root.indexOf("manage") + 1);
    expect(root.indexOf("reports")).toBe(root.indexOf("hr") + 1);
    const hr = viewAt(NAV, []).items.find((n) => n.id === "hr")!;
    expect(isFolder(hr)).toBe(true);
    expect((hr as { icon: string }).icon).toBe("badge");
    const items = viewAt(NAV, ["hr"]).items;
    // REQ-912: Systems moved to Settings → Systems; the folder has five entries
    expect(items.map((n) => n.id)).toEqual([
      "hrHome",
      "hires",
      "hrDocuments",
      "departments",
      "hrSettings",
    ]);
    expect(items.map((n) => (n as { href?: string }).href)).toEqual([
      "/hr",
      "/hr/hires",
      "/hr/documents",
      "/hr/departments",
      "/hr/settings",
    ]);
    for (const id of ["hires", "hrDocuments", "departments"]) {
      expect(folderPathTo(NAV, id)).toEqual(["hr"]);
    }
    // the icons exist
    const icons = read("front-end/lib/dash-icons.tsx");
    expect(icons).toContain("\n  badge: (");
    expect(icons).toContain("\n  plug: (");
  });

  test("REQ-883d both dictionaries carry the nav entries and every hr.* string, with the same keys", () => {
    const en = dict("lang/en.json"), es = dict("lang/es.json");
    expect(en["nav.hr"]).toBe("HR");
    expect(es["nav.hr"]).toBe("RR. HH.");
    for (
      const k of [
        "nav.hrHome",
        "nav.hires",
        "nav.hrDocuments",
        "nav.departments",
        "nav.hrSystems",
        "nav.hrSettings",
        "hr.home.docTitle",
        "hr.home.title",
        "hr.home.stat.sent",
        "hr.home.stat.completed",
        "hr.home.stat.awaiting",
        "hr.home.stat.accounts",
        "hr.hires.docTitle",
        "hr.hires.title",
        "hr.hires.add",
        "hr.hires.col.name",
        "hr.hires.col.dept",
        "hr.hires.col.start",
        "hr.hires.col.progress",
        "hr.hires.col.status",
        "hr.hires.empty",
        "hr.status.invited",
        "hr.status.opened",
        "hr.status.signing",
        "hr.status.signed",
        "hr.status.provisioning",
        "hr.status.active",
        "hr.status.expired",
        "hr.status.offboarded",
        "hr.new.title",
        "hr.new.first",
        "hr.new.last",
        "hr.new.email",
        "hr.new.phone",
        "hr.new.dept",
        "hr.new.start",
        "hr.new.packet",
        "hr.new.create",
        "hr.detail.send",
        "hr.detail.resend",
        "hr.detail.copy",
        "hr.detail.copied",
        "hr.detail.offboard",
        "hr.detail.packet",
        "hr.detail.view",
        "hr.detail.accounts",
        "hr.detail.retry",
        "hr.detail.markDone",
        "hr.detail.arm.ok",
        "hr.detail.arm.manual",
        "hr.detail.arm.fault",
        "hr.detail.step.invited",
        "hr.detail.step.opened",
        "hr.detail.step.signing",
        "hr.detail.step.signed",
        "hr.detail.step.provisioned",
        "hr.proof.title",
        "hr.proof.audit",
        "hr.docs.docTitle",
        "hr.docs.title",
        "hr.docs.new",
        "hr.docs.openPdf",
        "hr.docs.save",
        "hr.docs.discard",
        "hr.docs.field.signature",
        "hr.docs.field.initials",
        "hr.docs.field.date",
        "hr.docs.field.name",
        "hr.docs.field.text",
        "hr.docs.field.check",
        "hr.depts.docTitle",
        "hr.depts.title",
        "hr.depts.add",
        "hr.systems.docTitle",
        "hr.systems.title",
        "hr.systems.connect",
        "hr.systems.disconnect",
        "hr.systems.detach",
        "hr.settings.docTitle",
        "hr.settings.title",
        "hr.settings.company",
        "hr.settings.hrEmail",
        "hr.settings.expiry",
        "hr.settings.autoSend",
        "hr.settings.autoProvision",
        "hr.settings.remind24h",
        "hr.settings.notifyOnComplete",
        "hr.settings.save",
        "hr.sign.step",
        "hr.sign.ack",
        "hr.sign.printed",
        "hr.sign.draw",
        "hr.sign.clear",
        "hr.sign.continue",
        "hr.sign.finish",
        "hr.sign.done.title",
        "hr.sign.expired",
        "hr.sign.notFound",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
    }
    const enHr = Object.keys(en).filter((k) => k.startsWith("hr."));
    const esHr = Object.keys(es).filter((k) => k.startsWith("hr."));
    expect(esHr.sort()).toEqual(enHr.sort());
  });

  test("REQ-883b the routes mount their islands behind the owner gate; /sign/:token is public with no dashboard chrome (REQ-883c)", () => {
    const pages: [string, string, string][] = [
      ["front-end/routes/hr/index.tsx", "HrOverviewPage", "hrHome"],
      ["front-end/routes/hr/hires/index.tsx", "HrHiresPage", "hires"],
      ["front-end/routes/hr/hires/new.tsx", "HrNewHirePage", "hires"],
      ["front-end/routes/hr/hires/[id].tsx", "HrHireDetailPage", "hires"],
      ["front-end/routes/hr/documents.tsx", "HrDocumentsPage", "hrDocuments"],
      [
        "front-end/routes/hr/departments.tsx",
        "HrDepartmentsPage",
        "departments",
      ],
      // REQ-912: /hr/systems is a 302 to /settings?tab=systems now — no island of its own
      ["front-end/routes/hr/settings.tsx", "HrSettingsPage", "hrSettings"],
    ];
    for (const [rel, island, active] of pages) {
      const src = read(rel);
      expect(src).toContain(`islands/${island}.tsx`);
      expect(src).toContain(`<DashSidebar active="${active}" />`);
      expect(src).toContain('asset("/hr.css")');
      expect(exists(`front-end/islands/${island}.tsx`)).toBe(true);
    }
    expect(read("front-end/routes/hr/_middleware.ts")).toContain(
      'from "../clients/_middleware.ts"',
    );
    const sign = read("front-end/routes/sign/[token].tsx");
    expect(sign).toContain("islands/HrSignPacket.tsx");
    expect(sign).not.toContain("DashSidebar");
    expect(sign).not.toContain("DashTopbar");
    expect(sign).toContain("langFromCookie");
    expect(exists("front-end/routes/sign/_middleware.ts")).toBe(false);
    // the client covers every endpoint
    const client = read("front-end/clients/hr.ts");
    for (
      const p of [
        '"/hr/dashboard"',
        '"/hr/hires"',
        "/send`",
        "/provision`",
        "/done`",
        "/offboard`",
        "/proofs/",
        '"/hr/documents"',
        "/pdf`",
        '"/hr/departments"',
        '"/hr/systems"',
        '"/hr/settings"',
        "`/hr/sign/${encodeURIComponent(token)}`",
        "/docs/${encodeURIComponent(docId)}`",
      ]
    ) expect(client).toContain(p);
  });

  test("REQ-884c the roster helpers: unfinished first, search across name/email/phone/department, status chips for all eight", () => {
    const mk = (o: Partial<Record<string, unknown>>) => ({
      name: "A A",
      departmentName: "Sales",
      startDate: "2026-01-01",
      progress: { done: 0, total: 2 },
      status: "invited",
      email: "",
      phone: "",
      ...o,
    });
    const rows = [
      mk({ name: "Zed Active", status: "active" }),
      mk({ name: "Ann Expired", status: "expired" }),
      mk({ name: "Bo Signed", status: "signed" }),
      mk({ name: "Cy Opened", status: "opened" }),
    ] as unknown as Parameters<typeof sortHires>[0];
    expect(sortHires(rows, "status", "asc").map((h) => h.status)).toEqual([
      "expired",
      "opened",
      "signed",
      "active",
    ]);
    expect(sortHires(rows, "name", "desc").map((h) => h.name)[0]).toBe(
      "Zed Active",
    );
    const h = mk({
      name: "Maria Lopez",
      email: "maria@x.com",
      phone: "+17025551100",
      departmentName: "Inbound Sales",
    }) as unknown as Parameters<typeof matchesHire>[0];
    expect(matchesHire(h, "lop")).toBe(true);
    expect(matchesHire(h, "maria@")).toBe(true);
    expect(matchesHire(h, "5551100")).toBe(true);
    expect(matchesHire(h, "inbound")).toBe(true);
    expect(matchesHire(h, "zzz")).toBe(false);
    expect(Object.keys(STATUS_CHIP).sort()).toEqual([
      "active",
      "expired",
      "invited",
      "offboarded",
      "opened",
      "provisioning",
      "signed",
      "signing",
    ]);
    expect(initialsOf("Maria Lopez")).toBe("ML");
    expect(initialsOf("Cher")).toBe("CH");
  });

  test("REQ-886b a stamped field is clamped onto the page; REQ-889d the donut sums to one; the invite text carries the link", () => {
    const f = placeField("signature", 2, 120, -4);
    expect(f.page).toBe(2);
    expect(f.xPct).toBe(99);
    expect(f.yPct).toBe(1);
    expect(f.type).toBe("signature");
    expect(f.id).toMatch(/^f/);
    const s = donutSlices({ signed: 3, awaiting: 1, expired: 0 });
    expect(s.map((x) => x.key)).toEqual(["signed", "awaiting", "expired"]);
    expect(s.reduce((a, x) => a + x.pct, 0)).toBeCloseTo(1);
    expect(
      donutSlices({ signed: 0, awaiting: 0, expired: 0 }).every((x) =>
        x.pct === 0
      ),
    ).toBe(true);
    expect(inviteText("Dani", "Monster", "https://x/sign/t")).toContain(
      "Hey Dani!",
    );
    expect(inviteText("Dani", "Monster", "https://x/sign/t")).toContain(
      "https://x/sign/t",
    );
  });
});
