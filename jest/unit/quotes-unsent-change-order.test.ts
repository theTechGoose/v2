/**
 * REQ-1030 (LOOP-007 cycle 2, q2-14) — a change order the assistant made but
 * never sent (REQ-652) is not "waiting on" the customer: the /quotes hero
 * names it as not sent yet, on its own line, in en and es.
 */
import { readFileSync } from "fs";
import { join } from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const hc = () => require("../../front-end/lib/headline-counts");

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-1030 the /quotes hero's unsent change-order line", () => {
  it("REQ-1030 heroCoUnsent names an unsent change order, never as waiting", () => {
    const { heroCoUnsent } = hc();
    expect(heroCoUnsent([])).toBeNull();
    const one = heroCoUnsent([{ number: "CO-001", client: "Maria Gonzalez" }]);
    expect(one).toEqual({
      key: "quotesHero.coUnsent.one",
      vars: { number: "CO-001", client: "Maria Gonzalez", n: 1 },
    });
    const text = en[one.key].replace("{number}", "CO-001").replace(
      "{client}",
      "Maria Gonzalez",
    );
    expect(text).toBe("CO-001 isn't sent to Maria Gonzalez yet.");
    expect(text).not.toMatch(/waiting/i);
    expect(
      heroCoUnsent([
        { number: "CO-001", client: "Maria" },
        { number: "CO-002", client: "Bo" },
      ])?.key,
    ).toBe("quotesHero.coUnsent.other");
  });

  it("REQ-1030 the hero renders it apart from quotes-hero-co-waiting, and the page passes the card's unsent list", () => {
    const src = read("front-end/components/QuotesSections.tsx");
    const hero = src.slice(
      src.indexOf("export function QuotesHero"),
      src.indexOf("interface KpisProps"),
    );
    expect(hero).toMatch(/heroCoUnsent\(unsentChangeOrders\)/);
    expect(hero).toMatch(/data-cy="quotes-hero-co-unsent"/);
    const page = read("front-end/islands/QuotesPage.tsx");
    expect(page).toMatch(/unsentChangeOrders=\{/);
  });

  it.each(["quotesHero.coUnsent.one", "quotesHero.coUnsent.other"])(
    "REQ-1030 %s exists in en and es",
    (k) => {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    },
  );
});
