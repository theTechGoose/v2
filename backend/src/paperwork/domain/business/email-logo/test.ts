import { assertEquals } from "#std/assert";
import { emailLogo } from "./mod.ts";

// REQ-160 — "these have the house logo on it not the client logo"
Deno.test("REQ-160 emailLogo: a business with a logo on file brands the email with it (the public-logo URL, named after the business); without one the house logo stays", () => {
  const app = "https://documonster.com";
  assertEquals(
    emailLogo({
      appUrl: app,
      kind: "invoice",
      id: "inv-1",
      biz: { businessName: "A2Z Landscape LLC", logoFileId: "f-9" },
    }),
    {
      src: "https://documonster.com/api/public-logo/invoice/inv-1",
      alt: "A2Z Landscape LLC",
    },
  );
  assertEquals(
    emailLogo({
      appUrl: app,
      kind: "quote",
      id: "q-1",
      biz: { businessName: "A2Z Landscape LLC", logoFileId: "f-9" },
    }),
    {
      src: "https://documonster.com/api/public-logo/quote/q-1",
      alt: "A2Z Landscape LLC",
    },
  );
  // a logo but no business name → the alt still says something
  assertEquals(
    emailLogo({
      appUrl: app,
      kind: "invoice",
      id: "inv-1",
      biz: { logoFileId: "f-9" },
    }).alt,
    "Logo",
  );
  // no logo, or no identity at all → the house logo
  const house = {
    src: "https://documonster.com/logo-email.png",
    alt: "DocuMonster",
  };
  assertEquals(
    emailLogo({
      appUrl: app,
      kind: "invoice",
      id: "inv-1",
      biz: { businessName: "A2Z Landscape LLC" },
    }),
    house,
  );
  assertEquals(
    emailLogo({ appUrl: app, kind: "invoice", id: "inv-1", biz: undefined }),
    house,
  );
});
