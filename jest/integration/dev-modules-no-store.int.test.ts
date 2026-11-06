/**
 * REQ-189 — the running dev server answers `Cache-Control: no-store` for every transformed module
 * (the client entry, an island file, a project module), so a browser never reuses island code
 * from before an edit. Runs against the dev stack (deno task serve → :5280).
 */
const FRONT = (process.env.API_BASE_URL ?? "http://localhost:5280/api").replace(
  /\/api$/,
  "",
);

describe("REQ-189 dev modules are never cached", () => {
  test.each([
    "/@id/fresh:client-entry",
    "/@id/fresh-island::LoginForm",
    "/islands/LoginForm.tsx",
    "/lib/i18n.ts",
  ])("%s is served no-store", async (p) => {
    const r = await fetch(`${FRONT}${p}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    await r.text();
  });
});
