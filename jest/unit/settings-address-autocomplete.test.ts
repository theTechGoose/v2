/**
 * REQ-861 (demo-loop cycle dm4, issue setup-2) — the /settings mailing-address
 * street line suggests addresses like every other address field in the app
 * (onboarding wizard, REQ-599 New customer modal). Picking a suggestion fills
 * street, city, state and ZIP and autosaves the whole address.
 */
import * as fs from "fs";
import * as path from "path";
import * as mapbox from "../../front-end/lib/mapbox";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** the AddressEditCard function's source */
function addressCard(): string {
  const src = read("front-end/islands/SettingsPage.tsx");
  const start = src.indexOf("function AddressEditCard(");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\nfunction ", start + 10);
  return src.slice(start, end);
}

describe("REQ-861 (dm4 setup-2): /settings address suggestions", () => {
  test("addressPick maps a Mapbox suggestion to the card's four parts", () => {
    // deno-lint-ignore no-explicit-any
    const addressPick = (mapbox as any).addressPick;
    expect(typeof addressPick).toBe("function");
    expect(
      addressPick({
        label: "123 Congress Ave, Austin, TX 78701",
        street: "123 Congress Ave",
        city: "Austin",
        state: "tx",
        postal: "78701",
      }),
    ).toEqual({
      street: "123 Congress Ave",
      city: "Austin",
      state: "TX",
      postal: "78701",
    });
  });

  test("the card's street line is the shared autocomplete, in the UI language", () => {
    const card = addressCard();
    expect(card).toMatch(
      /<AddressAutocomplete[\s\S]*?data-cy="settings-street"/,
    );
    expect(card).toMatch(/<AddressAutocomplete[\s\S]*?lang=\{/);
    expect(card).toMatch(/<AddressAutocomplete[\s\S]*?useTypedLabel=\{/);
  });

  test("typing still autosaves, and a pick fills all four parts and autosaves the full payload", () => {
    const card = addressCard();
    const ac = card.slice(card.indexOf("<AddressAutocomplete"));
    const tag = ac.slice(0, ac.indexOf("/>"));
    expect(tag).toMatch(
      /onInput=\{[\s\S]*?setStreet\([\s\S]*?queueAutosave\(payload\(\{ street:/,
    );
    expect(tag).toMatch(/onPick=\{/);
    const pick = card.slice(card.indexOf("function pickAddress"));
    expect(card).toContain("function pickAddress");
    expect(pick).toMatch(/addressPick\(/);
    for (const set of ["setStreet(", "setCity(", "setStateV(", "setPostal("]) {
      expect(pick.slice(0, pick.indexOf("\n  }"))).toContain(set);
    }
    expect(pick.slice(0, pick.indexOf("\n  }"))).toMatch(
      /queueAutosave\(payload\(/,
    );
  });

  test("the documented input order holds: street (autocomplete) first, then city, state, zip, country", () => {
    const card = addressCard();
    const jsx = card.slice(card.indexOf("<EditPanel"));
    const street = jsx.indexOf("<AddressAutocomplete");
    const firstInput = jsx.indexOf("<input");
    expect(street).toBeGreaterThan(-1);
    expect(street).toBeLessThan(firstInput);
    expect((jsx.match(/<input\b/g) ?? []).length).toBe(4);
  });

  test("AddressAutocomplete hands the whole suggestion to onPick when given, else its label to onInput", () => {
    const src = read("front-end/components/AddressAutocomplete.tsx");
    expect(src).toMatch(/onPick\?: \(s: AddressSuggestion\) => void/);
    expect(src).toMatch(
      /if \(props\.onPick\) \{?\s*props\.onPick\(s\);\s*\}?\s*else onInput\(s\.label\);/,
    );
  });
});
