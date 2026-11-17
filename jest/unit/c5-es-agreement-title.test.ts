/**
 * REQ-721 — "fix every issue the demo found, loop until there are none"
 * (demo-loop cycle 5, run r37f88707, issue p18-2d): the Spanish agreement
 * title "Acuerdo de corte de césped de María López" reads as if María does the
 * mowing. RCA (analyst CONFIRMED, skeptic UPHELD at 2444608a):
 * `shared/quote-flow/agreement-title.ts:60-63` built
 * `Acuerdo de ${job} de ${customer}` — a literal mirror of
 * "{customer}'s {job} Agreement" that stacks two "de" phrases.
 *
 * The Spanish shape is now "Acuerdo de <job> para <Customer>", and with no
 * job "Acuerdo con <Customer>". English is unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const at = (): any => require("../../shared/quote-flow/agreement-title");

describe("REQ-721 (p18-2d) the Spanish agreement title names the customer with 'para'", () => {
  test("REQ-721 es: 'Acuerdo de corte de césped para María López' (the demo's exact case)", () => {
    expect(
      at().agreementTitle({ customer: "María López", job: "Corte de césped", lang: "es" }),
    ).toBe("Acuerdo de corte de césped para María López");
  });

  test("REQ-721 es: never two stacked 'de' phrases before the customer", () => {
    const title: string = at().agreementTitle({
      customer: "María López",
      job: "Corte de césped",
      lang: "es",
    });
    expect(title).not.toMatch(/ de María López$/);
  });

  test("REQ-721 es: no job → 'Acuerdo con <Customer>'", () => {
    expect(at().agreementTitle({ customer: "María López", lang: "es" }))
      .toBe("Acuerdo con María López");
    expect(
      at().agreementTitle({ customer: "María López", job: "Nuevo trabajo", lang: "es" }),
    ).toBe("Acuerdo con María López");
  });

  test("REQ-721 es: a job that is only the customer's name reads as no job (REQ-579)", () => {
    expect(
      at().agreementTitle({ customer: "Ana López", job: "López", lang: "es" }),
    ).toBe("Acuerdo con Ana López");
  });

  test("REQ-721 en is unchanged", () => {
    expect(
      at().agreementTitle({ customer: "María López", job: "Lawn Mowing", lang: "en" }),
    ).toBe("María López's Lawn Mowing Agreement");
    expect(at().agreementTitle({ customer: "María López", lang: "en" }))
      .toBe("María López's Agreement");
  });
});
