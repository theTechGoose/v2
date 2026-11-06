/**
 * REQ-211 — Raphael, 2026-11-06: "There is something that says what landing page it is coming
 * from?" — "can you make it so the answer is yes?". The lead origin is what a landing form posts
 * beside its fields: the page it was on and the ad that brought the person (`?ad=`). The
 * normalizer reads it leniently — a path of safe characters, a short ad id — and DROPS what it
 * cannot read instead of refusing the form: the form's job is the lead, never the tracking.
 */
import { assertEquals } from "#std/assert";
import {
  leadOriginHere,
  leadOriginLabel,
  leadOriginOf,
  leadSourceFor,
} from "./mod.ts";

Deno.test("REQ-211 lead-origin — the page and the ad are read from the form's post, trimmed and normalized", () => {
  assertEquals(leadOriginOf({ page: "/landing5", ad: "cumple" }), {
    page: "/landing5",
    ad: "cumple",
  });
  assertEquals(leadOriginOf({ page: " /landing2 " }), { page: "/landing2" });
  assertEquals(leadOriginOf({ page: "/" }), { page: "/" });
  assertEquals(
    leadOriginOf({ page: "/landing3?ad=sabado&fbclid=abc", ad: " Sabado " }),
    { page: "/landing3", ad: "sabado" },
    "the query is stripped from the page; the ad id is lowercased",
  );
  assertEquals(leadOriginOf({ page: "/landing4", ad: "" }), {
    page: "/landing4",
  }, "an empty ad is no ad");
});

Deno.test("REQ-211 lead-origin — what cannot be read is dropped, never refused", () => {
  assertEquals(leadOriginOf(undefined), undefined);
  assertEquals(leadOriginOf(null), undefined);
  assertEquals(leadOriginOf({}), undefined);
  assertEquals(
    leadOriginOf({ ad: "cumple" }),
    undefined,
    "an ad without a page is nothing",
  );
  assertEquals(
    leadOriginOf({ page: "landing5" }),
    undefined,
    "a page is a path: it starts with /",
  );
  assertEquals(leadOriginOf({ page: "https://evil.example/x" }), undefined);
  assertEquals(
    leadOriginOf({ page: "/<script>" }),
    undefined,
    "only safe characters",
  );
  assertEquals(
    leadOriginOf({ page: "/" + "a".repeat(80) }),
    undefined,
    "over 80 characters",
  );
  assertEquals(leadOriginOf({ page: "/landing5", ad: "<b>" }), {
    page: "/landing5",
  }, "a bad ad is dropped, the page kept");
  assertEquals(leadOriginOf({ page: "/landing5", ad: "a".repeat(41) }), {
    page: "/landing5",
  }, "an ad over 40 characters is dropped");
  assertEquals(leadOriginOf({ page: 5, ad: 7 }), undefined);
});

Deno.test("REQ-211 lead-origin — the label and the CRM's lead source name the page and the ad", () => {
  assertEquals(
    leadOriginLabel({ page: "/landing5", ad: "cumple" }),
    "/landing5?ad=cumple",
  );
  assertEquals(leadOriginLabel({ page: "/landing2" }), "/landing2");
  assertEquals(leadOriginLabel(undefined), "");
  assertEquals(
    leadSourceFor("paperworkmonster.com", { page: "/landing5", ad: "cumple" }),
    "paperworkmonster.com · /landing5?ad=cumple",
  );
  assertEquals(
    leadSourceFor("paperworkmonster.com", { page: "/" }),
    "paperworkmonster.com · /",
  );
  assertEquals(
    leadSourceFor("paperworkmonster.com", undefined),
    "paperworkmonster.com",
    "no page known: the source as it always was",
  );
});

Deno.test("REQ-211 lead-origin — the browser's side: the page is the pathname, the ad the ?ad= of the location", () => {
  assertEquals(
    leadOriginHere({ pathname: "/landing5", search: "?ad=Sabado&fbclid=x" }),
    { page: "/landing5", ad: "sabado" },
  );
  assertEquals(leadOriginHere({ pathname: "/landing2", search: "" }), {
    page: "/landing2",
  });
  assertEquals(leadOriginHere({ pathname: "/", search: "?lang=en" }), {
    page: "/",
  });
  assertEquals(
    leadOriginHere(undefined),
    {},
    "no location (the server): nothing to add",
  );
});
