/**
 * REQ-530 — demo-loop cycle 3, issue p7: with one customer the /customers
 * hero read "The person you work for." / "La persona para la que trabajas."
 * — that names a boss, not a contractor's customer. The singular headline
 * now reads "You have one customer on your list." /
 * "Tienes un cliente en tu lista." (REQ-1077 dropped the ordinal "first":
 * the count is of current customers, so the one left may not be the first.)
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

/** What front-end/components/ClientsSections.tsx renders when totalClients === 1. */
const headlineOne = (d: Record<string, string>) =>
  [
    d["clientsHero.titlePre.one"],
    d["clientsHero.people.one"],
    d["clientsHero.titlePost.one"],
  ].join(" ").replace(/\s+/g, " ").trim();

describe("REQ-530 (demo cycle 3, p7) the one-customer /customers headline names a customer", () => {
  test("REQ-530 EN reads 'You have one customer on your list.' (REQ-1077: no ordinal)", () => {
    expect(headlineOne(en)).toBe("You have one customer on your list.");
    expect(headlineOne(en)).not.toMatch(/person|work for/i);
  });

  test("REQ-530 ES reads 'Tienes un cliente en tu lista.' (REQ-1077: no ordinal)", () => {
    expect(headlineOne(es)).toBe("Tienes un cliente en tu lista.");
    expect(headlineOne(es)).not.toMatch(/persona|trabajas/i);
  });

  test("REQ-530 the hero still builds the one-customer headline from the .one keys", () => {
    const src = read("front-end/components/ClientsSections.tsx");
    expect(src).toMatch(/"clientsHero\.titlePre\.one"/);
    expect(src).toMatch(/"clientsHero\.titlePost\.one"/);
    expect(src).toMatch(/clientsHero\.people\.\$\{/);
  });
});
