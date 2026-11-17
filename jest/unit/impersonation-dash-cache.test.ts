/**
 * REQ-908 — demo-loop run 7 (dm7), issue m4: after End from the stage, the presenter's /admin
 * showed the CUSTOMER's account card ("ML Maria Lopez · Lopez Roofing", no Admin item) for
 * ~0.3 s while the header already said "Hola, Alex", then switched. The sidebar seeds itself from
 * the tab's dash cache (sessionStorage, REQ-624) — which still held the impersonated customer's
 * profile: nothing cleared it when the impersonation ended (the sidebar clears it only on its own
 * logout and account switch). Now the admin client clears the dash cache whenever an impersonation
 * starts or stops: the next page in this tab is the next person's from its first paint.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-908 (dm7, m4) — an impersonation's start and end clear the tab's dash cache", () => {
  test("REQ-908 wiring: adminClient.impersonate and stopImpersonating clear the dash cache once the server answered", () => {
    const client = read("front-end/clients/admin.ts");
    expect(client).toMatch(
      /import \{ clearDashCache \} from "\.\.\/lib\/dash-cache\.ts";/,
    );
    const imp = client.slice(
      client.indexOf("impersonate: ("),
      client.indexOf("stopImpersonating: ("),
    );
    expect(imp).toMatch(
      /\.then\(\(r\) => \{\s*clearDashCache\(\);\s*return r;\s*\}\)/,
    );
    const stop = client.slice(
      client.indexOf("stopImpersonating: ("),
      client.indexOf("stopImpersonating: (") + 400,
    );
    expect(stop).toMatch(
      /\.then\(\(r\) => \{\s*clearDashCache\(\);\s*return r;\s*\}\)/,
    );
  });
});
