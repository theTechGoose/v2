/**
 * REQ-435 — demo-loop cycle 3, issue M4: "Assistant drops customer details:
 * house number, name, job address, address on draft card".
 *
 * Root cause (RCA M4, analyst + skeptic UPHELD at cc5d4b0e), in
 * shared/quote-flow/quick-quote-prefill.ts:
 *   - the US street form needs the street type AFTER the name, so
 *     "4410 Avenue F" failed and the REQ-386 city/state fallback kept
 *     "Avenue F Austin TX 78751" without the 4410;
 *   - leadInName stopped at "casa" in "para la casa de Ana Pérez";
 *   - the number-less "on Barton Hills Dr" was taken only with a ZIP;
 *   - the draft action_card carried no serviceAddress to show.
 */
import * as fs from "fs";
import * as path from "path";

// deno-lint-ignore no-explicit-any
let prefill: any;
beforeAll(() => {
  prefill = require("../../shared/quote-flow/quick-quote-prefill");
});

const LINDA =
  "Paint my living room and hallway, $1,850. It's for Linda Moreno. Her phone 512-555-0177, linda.moreno@example.com, 4410 Avenue F Austin TX 78751";
const ANA =
  "Corte de césped semanal y limpieza de hojas para la casa de Ana Pérez, 4 cuartos de acre, $180";
const HENDERSON =
  "Kitchen renovation and cleanup for the Hendersons on Barton Hills Dr, Austin, $14,500";

describe("REQ-435 M4 extractServiceAddress — the house number is never dropped", () => {
  test("the demo's '4410 Avenue F Austin TX 78751' keeps the 4410", () => {
    expect(prefill.extractServiceAddress(LINDA)).toBe(
      "4410 Avenue F Austin TX 78751",
    );
  });
  test("other street-type-first forms: Ave B, County Road 175, Highway 71", () => {
    expect(prefill.extractServiceAddress("deck at 12 Ave B, Austin, $900"))
      .toBe("12 Ave B, Austin");
    expect(
      prefill.extractServiceAddress(
        "fence at 900 County Road 175 Leander TX 78641",
      ),
    ).toBe("900 County Road 175 Leander TX 78641");
    expect(prefill.extractServiceAddress("barn at 5100 Highway 71, $3,000"))
      .toBe("5100 Highway 71");
  });
  test("the city/state fallback keeps a house number typed right before it", () => {
    expect(prefill.extractServiceAddress("roof at 77 Lakeview Austin TX 78751"))
      .toBe("77 Lakeview Austin TX 78751");
  });
  test("the classic forms still read the same", () => {
    expect(
      prefill.extractServiceAddress("for Maria Lopez, 412 Oak St Austin, $350"),
    )
      .toBe("412 Oak St Austin");
    expect(prefill.extractServiceAddress("Austin, TX 78745, $500")).toBe(
      "Austin, TX 78745",
    );
    expect(prefill.extractServiceAddress("6 paneles, $3,000")).toBeNull();
  });
});

describe("REQ-435 M4 extractServiceAddress — 'on <Street> <type>' with a city or a comma clause", () => {
  test("the demo's 'for the Hendersons on Barton Hills Dr, Austin' → the street", () => {
    expect(prefill.extractServiceAddress(HENDERSON)).toBe(
      "Barton Hills Dr, Austin",
    );
  });
  test("a comma clause or the end of the text closes it too", () => {
    expect(
      prefill.extractServiceAddress(
        "cleanup for the Hendersons on Barton Hills Dr, $500",
      ),
    ).toBe("Barton Hills Dr");
    expect(prefill.extractServiceAddress("mow the lawn on Elm Street"))
      .toBe("Elm Street");
  });
  test("never 'on Monday', never a lowercase phrase", () => {
    expect(prefill.extractServiceAddress("on Monday 78704")).toBeNull();
    expect(prefill.extractServiceAddress("work on the roof, $500")).toBeNull();
  });
});

describe("REQ-435 M4 extractCustomerName — 'la casa de / the house of' names who it is", () => {
  test("the demo's 'para la casa de Ana Pérez' → 'Ana Pérez'", () => {
    expect(prefill.extractCustomerName(ANA)).toBe("Ana Pérez");
  });
  test("'for the house of John Reed' / 'para la familia de Nguyen'", () => {
    expect(
      prefill.extractCustomerName("paint for the house of John Reed, $900"),
    )
      .toBe("John Reed");
    expect(
      prefill.extractCustomerName("patio para la familia de Nguyen, $3,700"),
    )
      .toBe("Familia Nguyen");
  });
  test("the demo's Linda sentence still names Linda Moreno", () => {
    expect(prefill.extractCustomerName(LINDA)).toBe("Linda Moreno");
  });
});

describe("REQ-435 M4 the draft card shows the job address", () => {
  const root = path.resolve(__dirname, "../..");
  const island = fs.readFileSync(
    path.join(root, "front-end/islands/AsstChat.tsx"),
    "utf8",
  );
  test("ActionCardPayload carries serviceAddress and the card renders it", () => {
    const iface = island.slice(island.indexOf("interface ActionCardPayload"));
    expect(iface.slice(0, iface.indexOf("}"))).toMatch(
      /serviceAddress\?: string/,
    );
    expect(island).toMatch(/data-cy="action-card-address"/);
    expect(island).toMatch(/payload\.serviceAddress/);
  });
  test("en and es both name the address row", () => {
    const en = JSON.parse(
      fs.readFileSync(path.join(root, "lang/en.json"), "utf8"),
    );
    const es = JSON.parse(
      fs.readFileSync(path.join(root, "lang/es.json"), "utf8"),
    );
    expect(en["asstChat.actionCard.jobAddress"]).toBe("Job address");
    expect(es["asstChat.actionCard.jobAddress"]).toBe("Dirección del trabajo");
  });
});
