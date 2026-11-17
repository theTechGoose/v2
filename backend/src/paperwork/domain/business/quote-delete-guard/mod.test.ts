import { assertEquals } from "#std/assert";
import { quoteDeleteBlock } from "./mod.ts";

// REQ-485 (demo-loop cycle 3, issue m22): a signed quote is a binding
// agreement and a billed quote has invoices hanging off it — neither may be
// deleted. A draft / sent / lost quote with no live invoice still can.

Deno.test("REQ-485 m22 quoteDeleteBlock: an accepted quote is locked_accepted", () => {
  assertEquals(quoteDeleteBlock({ status: "accepted" }, []), "locked_accepted");
});

Deno.test("REQ-485 m22 quoteDeleteBlock: an acceptedAt stamp alone also locks", () => {
  assertEquals(
    quoteDeleteBlock(
      { status: "sent", acceptedAt: "2026-11-12T00:00:00Z" },
      [],
    ),
    "locked_accepted",
  );
});

Deno.test("REQ-485 m22 quoteDeleteBlock: a quote with a non-void invoice is locked_invoiced", () => {
  assertEquals(
    quoteDeleteBlock({ status: "sent" }, [{ status: "void" }, {
      status: "draft",
    }]),
    "locked_invoiced",
  );
  assertEquals(
    quoteDeleteBlock({ status: "draft" }, [{ status: "paid" }]),
    "locked_invoiced",
  );
});

Deno.test("REQ-485 m22 quoteDeleteBlock: a draft, a sent or a lost quote with only void invoices deletes", () => {
  assertEquals(quoteDeleteBlock({ status: "draft" }, []), null);
  assertEquals(
    quoteDeleteBlock({ status: "sent" }, [{ status: "void" }]),
    null,
  );
  assertEquals(quoteDeleteBlock({ status: "lost" }, []), null);
});
