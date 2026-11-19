/**
 * REQ-1031 (LOOP-007 cycle 2, issue q2-8; amends REQ-924(d)) —
 * "Customer-page Remind re-sends the original invoice email word for word
 * instead of a reminder".
 *
 * The customer workspace's Remind (the header's cws-remind and every
 * invoices-table row's Remind) opens the `remind` modal. That modal must send
 * the invoice's reminder nudge — POST /api/cron/invoice-reminder with
 * {invoiceId, day}, the same cadence the /invoices card's "Send a nudge" uses
 * (REQ-021 / REQ-477 / REQ-704) — never dispatchInvoice, which POSTs the
 * first-send endpoints /api/invoices/:id/email|text and re-sends the invoice.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const WS = "front-end/islands/CustomerWorkspace.tsx";

/** the JSX block rendered for `modal?.kind === "remind"` */
function remindBlock(src: string): string {
  const at = src.indexOf('modal?.kind === "remind"');
  if (at < 0) throw new Error(`${WS} has no remind modal`);
  const next = src.indexOf("modal?.kind ===", at + 10);
  return src.slice(at, next < 0 ? undefined : next);
}

/** the local module a named import comes from, resolved from the island */
function importSource(src: string, name: string): string | null {
  const re = new RegExp(
    `import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"(\\.[^"]+)"`,
  );
  const m = src.match(re);
  if (!m) return null;
  return path.join("front-end/islands", m[1]);
}

describe("REQ-1031 q2-8 the customer page's Remind sends the reminder nudge, not the invoice again", () => {
  const src = read(WS);
  const block = remindBlock(src);

  it("REQ-1031 q2-8 the remind modal never calls dispatchInvoice (the first-send /api/invoices/:id/email|text path)", () => {
    expect(block).not.toMatch(/\bdispatchInvoice\s*\(/);
    expect(block).not.toMatch(/\/api\/invoices\/\$\{[^}]+\}\/(email|text)/);
  });

  it("REQ-1031 q2-8 the remind modal posts to /api/cron/invoice-reminder (directly, or via a helper that does)", () => {
    if (block.includes("/api/cron/invoice-reminder")) return;
    // a shared helper (e.g. front-end/lib/invoice-nudge.ts sendInvoiceNudge)
    const called = [...block.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g)].map((m) =>
      m[1]
    );
    const viaHelper = called.some((fn) => {
      const from = importSource(src, fn);
      if (!from) return false;
      for (const ext of ["", ".ts", ".tsx"]) {
        const p = path.join(ROOT, from + ext);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          const helper = fs.readFileSync(p, "utf8");
          const def = helper.indexOf(`function ${fn}`);
          if (def < 0) return false;
          // the helper's own body: up to the first top-level closing brace
          const end = helper.indexOf("\n}\n", def);
          return helper.slice(def, end < 0 ? undefined : end)
            .includes("/api/cron/invoice-reminder");
        }
      }
      return false;
    });
    expect({
      postsReminder: viaHelper,
      calls: [...new Set(called)].join(", "),
    }).toEqual(expect.objectContaining({ postsReminder: true }));
  });
});
