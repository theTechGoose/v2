import { assertEquals } from "#std/assert";
import { chunk, PAGE_SIZE, sha256Hex, unchunk } from "./mod.ts";

Deno.test("chunk: empty input → empty array", () => {
  assertEquals(chunk(new Uint8Array(0)), []);
});

Deno.test("chunk: smaller than page size → single page containing the whole input", () => {
  const out = chunk(new Uint8Array([1, 2, 3, 4, 5]));
  assertEquals(out.length, 1);
  assertEquals(out[0], new Uint8Array([1, 2, 3, 4, 5]));
});

Deno.test("chunk: exactly page-size → single page", () => {
  const buf = new Uint8Array(PAGE_SIZE).fill(0xab);
  const out = chunk(buf);
  assertEquals(out.length, 1);
  assertEquals(out[0].length, PAGE_SIZE);
});

Deno.test("chunk: page-size+1 → two pages of correct lengths", () => {
  const buf = new Uint8Array(PAGE_SIZE + 1);
  const out = chunk(buf);
  assertEquals(out.length, 2);
  assertEquals(out[0].length, PAGE_SIZE);
  assertEquals(out[1].length, 1);
});

Deno.test("unchunk: reverses chunk for any input size", () => {
  const buf = new Uint8Array(PAGE_SIZE * 2 + 17);
  for (let i = 0; i < buf.length; i++) buf[i] = i & 0xff;
  assertEquals(unchunk(chunk(buf)), buf);
});

Deno.test("unchunk: empty array → empty Uint8Array", () => {
  assertEquals(unchunk([]), new Uint8Array(0));
});

Deno.test("sha256Hex: known vector for empty bytes", async () => {
  // SHA-256 of "" is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
  assertEquals(
    await sha256Hex(new Uint8Array(0)),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

Deno.test("sha256Hex: known vector for 'abc'", async () => {
  const bytes = new TextEncoder().encode("abc");
  assertEquals(
    await sha256Hex(bytes),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

Deno.test("sha256Hex: round-trip same bytes returns same hash", async () => {
  const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const a = await sha256Hex(buf);
  const b = await sha256Hex(buf);
  assertEquals(a, b);
});
