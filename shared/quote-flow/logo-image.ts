/**
 * REQ-252 (demo issue M30) — what counts as a business logo: a PNG, JPEG, GIF or WebP image.
 * The logo heads every customer document and paperwork email, so anything else (a PDF, a text
 * file, an SVG that could carry script) is refused. Pure; shared by the browser (a type check
 * before upload) and the server (a sniff of the stored bytes, which decides).
 */

export const LOGO_IMAGE_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** the file input's `accept` hint — the same four types */
export const LOGO_IMAGE_ACCEPT = LOGO_IMAGE_TYPES.join(",");

/** the browser's check on a picked file's reported type */
export function isLogoImageType(type: string | undefined | null): boolean {
  if (!type) return false;
  return LOGO_IMAGE_TYPES.includes(type.trim().toLowerCase());
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** the image type the bytes are, by their magic number — or null when they are not a logo image */
export function sniffLogoImage(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))
  ) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    return "image/webp";
  }
  return null;
}
