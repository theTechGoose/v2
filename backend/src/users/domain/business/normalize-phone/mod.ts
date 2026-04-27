/**
 * Normalize a phone string into E.164 form (e.g., "+15125551234").
 *
 * Accepts: "(512) 555-1234", "512-555-1234", "5125551234", "+1 512 555 1234".
 * Defaults the country code to "+1" (US/CA) when 10 digits are supplied.
 * Throws when the result isn't a plausible 11-15 digit international number.
 */
export function normalizePhone(input: string): string {
  if (typeof input !== "string") throw new Error("phone must be a string");
  const trimmed = input.trim();
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) throw new Error("phone has no digits");

  let normalized: string;
  if (hadPlus) {
    if (digits.length < 8 || digits.length > 15) {
      throw new Error(`phone has invalid length: ${digits.length}`);
    }
    normalized = `+${digits}`;
  } else if (digits.length === 10) {
    normalized = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    normalized = `+${digits}`;
  } else {
    throw new Error(`phone has unsupported length: ${digits.length}`);
  }
  return normalized;
}
