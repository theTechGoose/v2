import { assertEquals, assert } from "#std/assert";
import { generateOtpCode, isValidOtpShape } from "./mod.ts";

Deno.test("generateOtpCode: returns 6 digits with crypto.getRandomValues default", () => {
  for (let i = 0; i < 50; i++) {
    const code = generateOtpCode();
    assertEquals(code.length, 6);
    assert(/^\d{6}$/.test(code), `expected 6 digits, got ${code}`);
  }
});

Deno.test("generateOtpCode: deterministic when randomBytes is mocked", () => {
  const mock = () => new Uint8Array([0x00, 0x00, 0x00, 0x07]);    // 7
  assertEquals(generateOtpCode(mock), "000007");
});

Deno.test("generateOtpCode: handles modulo wrap to keep 6 chars", () => {
  // 0xFFFFFFFF % 1_000_000 = 967_295 → "967295"
  const mock = () => new Uint8Array([0xff, 0xff, 0xff, 0xff]);
  assertEquals(generateOtpCode(mock), "967295");
});

Deno.test("generateOtpCode: leading zeros preserved", () => {
  // 0x000003E7 = 999 → "000999"
  const mock = () => new Uint8Array([0x00, 0x00, 0x03, 0xe7]);
  assertEquals(generateOtpCode(mock), "000999");
});

Deno.test("isValidOtpShape: accepts exactly 6 digits", () => {
  assertEquals(isValidOtpShape("123456"), true);
  assertEquals(isValidOtpShape("000000"), true);
});

Deno.test("isValidOtpShape: rejects wrong length / non-digits / non-strings", () => {
  assertEquals(isValidOtpShape("12345"), false);
  assertEquals(isValidOtpShape("1234567"), false);
  assertEquals(isValidOtpShape("12345a"), false);
  assertEquals(isValidOtpShape(123456 as unknown), false);
  assertEquals(isValidOtpShape(null), false);
  assertEquals(isValidOtpShape(undefined), false);
});
