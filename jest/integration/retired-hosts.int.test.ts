/**
 * REQ-219 — over the REAL dev stack (frontend :5280): a request that names a
 * retired host is answered 301 to the same path on https://documonster.com,
 * and a request for the site itself is served as before.
 *
 * Probed on the internet 2026-11-10 (the state this was written against):
 *   GET http://<old domain>/login → 404 (the registrar's forwarder answers "/" only)
 *   GET https://www.documonster.com/ → no certificate
 *
 * Static files are not probed here: in dev Vite serves them itself, ahead of
 * the app. In the built app the rule runs before staticFiles() — the unit
 * test pins that order, and the release line records the prod answer.
 *
 * The host is named with a raw HTTP request: fetch() will not send a Host
 * header that differs from the URL's.
 */
import * as http from "http";

const FE = new URL(process.env.FRONTEND_BASE_URL ?? "http://localhost:5280");
const ORIGIN = "https://documonster.com";
const OLD = ["paperwork", "monster.com"].join("");

function get(
  host: string,
  path: string,
): Promise<{ status: number; location: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: FE.hostname,
        port: FE.port,
        path,
        method: "GET",
        headers: { host },
      },
      (res) => {
        res.resume();
        resolve({
          status: res.statusCode ?? 0,
          location: String(res.headers.location ?? ""),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("REQ-219 a retired host is redirected, path and query kept", () => {
  for (
    const [host, path] of [
      [OLD, "/"],
      [OLD, "/login"],
      [`www.${OLD}`, "/contact?lang=es"],
      ["www.documonster.com", "/landing2?ad=a1"],
      [OLD, "/no/such/page"],
    ]
  ) {
    it(`REQ-219 GET ${path} for a retired host → 301 ${ORIGIN}${path}`, async () => {
      const res = await get(host, path);
      expect(res.status).toBe(301);
      expect(res.location).toBe(`${ORIGIN}${path}`);
    });
  }

  it("REQ-219 the site's own host is served, not redirected", async () => {
    for (const host of ["documonster.com", `${FE.hostname}:${FE.port}`]) {
      const res = await get(host, "/contact");
      expect(res.status).toBe(200);
    }
  });
});
