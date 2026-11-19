/**
 * REQ-1077 — LOOP-007 cycle 2, issue q2-67 (AMENDMENT of REQ-530): the
 * one-customer /customers headline is chosen from the CURRENT customer count
 * (`summary.totalClients` = `cards.length` of customers that still exist), so
 * after adding two customers and deleting one the remaining customer is told
 * it is "Your first customer" / "Tu primer cliente". The singular headline
 * must make no ordinal claim: "You have one customer on your list." /
 * "Tienes un cliente en tu lista."
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

describe("REQ-1077 (LOOP-007 q2-67) the one-customer /customers headline makes no ordinal claim", () => {
  test("REQ-1077 EN never calls the remaining customer 'first'", () => {
    expect(headlineOne(en)).not.toMatch(/first/i);
    expect(headlineOne(en)).toBe("You have one customer on your list.");
  });

  test("REQ-1077 ES never calls the remaining customer 'primer'", () => {
    expect(headlineOne(es)).not.toMatch(/primer/i);
    expect(headlineOne(es)).toBe("Tienes un cliente en tu lista.");
  });

  test("REQ-1077 still names a customer, not a boss (REQ-530)", () => {
    expect(headlineOne(en)).not.toMatch(/person|work for/i);
    expect(headlineOne(es)).not.toMatch(/persona|trabajas/i);
  });

  test("REQ-1077 the singular copy is chosen from the current count, so it must not depend on history", () => {
    const src = read("front-end/components/ClientsSections.tsx");
    expect(src).toMatch(/totalClients === 1/);
  });
});
