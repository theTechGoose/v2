/**
 * Generate a zero-padded 6-digit OTP code as a string.
 *
 * Uses crypto.getRandomValues so codes aren't guessable. Always returns
 * exactly 6 characters; leading zeroes preserved (e.g., "000123").
 *
 * Optional `randomBytes` override exists for tests.
 */
export function generateOtpCode(
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  const bytes = randomBytes(4);
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dataView.getUint32(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

export function isValidOtpShape(code: unknown): code is string {
  return typeof code === "string" && /^\d{6}$/.test(code);
}
