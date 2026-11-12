/**
 * REQ-252 (demo issue M30) — a non-image file is never accepted as the business logo.
 *
 * The demo uploaded a text file named "factura.pdf" through Settings' logo picker; it was
 * accepted silently ("Logo set · 514184e6…") and every customer document then showed a broken
 * image. The `accept="image/*"` hint was the only check anywhere.
 *
 * This unit pins the shared rule (shared/quote-flow/logo-image.ts) both sides use — the
 * browser's type check before upload and the server's byte sniff — and the two pickers' wiring.
 */
import * as fs from "fs";
import * as path from "path";
import {
  isLogoImageType,
  LOGO_IMAGE_TYPES,
  sniffLogoImage,
} from "../../shared/quote-flow/logo-image.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
));
const JPEG = Uint8Array.from([
  0xff,
  0xd8,
  0xff,
  0xe0,
  0,
  0x10,
  0x4a,
  0x46,
  0x49,
  0x46,
  0,
  1,
]);
const GIF = new TextEncoder().encode("GIF89a\x01\x00\x01\x00");
const WEBP = Uint8Array.from([
  ...new TextEncoder().encode("RIFF"),
  0x24,
  0,
  0,
  0,
  ...new TextEncoder().encode("WEBPVP8 "),
]);
const TEXT = new TextEncoder().encode("Factura 001 — esto no es una imagen\n");
const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0 obj\n");
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

describe("REQ-252 logo image — the shared rule", () => {
  test("the browser check: PNG, JPEG, GIF and WebP pass; a PDF, text, SVG, an empty type do not", () => {
    for (
      const t of [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "IMAGE/PNG",
      ]
    ) {
      expect(isLogoImageType(t)).toBe(true);
    }
    for (
      const t of [
        "application/pdf",
        "text/plain",
        "image/svg+xml",
        "",
        "application/octet-stream",
        undefined,
        null,
      ]
    ) {
      expect(isLogoImageType(t as string)).toBe(false);
    }
    expect([...LOGO_IMAGE_TYPES].sort()).toEqual([
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  test("the server sniff reads the bytes, not the name or the claimed type", () => {
    expect(sniffLogoImage(PNG)).toBe("image/png");
    expect(sniffLogoImage(JPEG)).toBe("image/jpeg");
    expect(sniffLogoImage(GIF)).toBe("image/gif");
    expect(sniffLogoImage(WEBP)).toBe("image/webp");
    // the demo's file: text bytes under a .pdf name
    expect(sniffLogoImage(TEXT)).toBeNull();
    expect(sniffLogoImage(PDF)).toBeNull();
    expect(sniffLogoImage(SVG)).toBeNull();
    expect(sniffLogoImage(new Uint8Array())).toBeNull();
    expect(sniffLogoImage(PNG.slice(0, 4))).toBeNull();
  });
});

describe("REQ-252 logo image — the pickers refuse a non-image before uploading", () => {
  const settings = read("front-end/islands/SettingsPage.tsx");
  const wizard = read("front-end/islands/WelcomeWizard.tsx");

  for (
    const [name, src] of [["SettingsPage", settings], [
      "WelcomeWizard",
      wizard,
    ]] as const
  ) {
    test(`${name}: checks isLogoImageType(file.type) before filesClient.uploadBlob`, () => {
      expect(src).toMatch(
        /import \{[^}]*isLogoImageType[^}]*\} from "\.\.\/\.\.\/shared\/quote-flow\/logo-image\.ts"/,
      );
      const check = src.indexOf("isLogoImageType(file.type)");
      expect(check).toBeGreaterThan(-1);
      const upload = src.indexOf("filesClient.uploadBlob(file", check);
      expect(upload).toBeGreaterThan(check);
      // the accept hint names the same four types
      expect(src).toContain("accept={LOGO_IMAGE_ACCEPT}");
    });
  }

  test("Settings shows the logo itself, not its file id", () => {
    expect(settings).not.toMatch(/logoFileId\.slice\(0, 8\)/);
    expect(settings).toContain('data-cy="settings-logo-preview"');
  });

  test("both languages carry the refusal", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (const key of ["settings.logoNotImage", "welcome.logo.notImage"]) {
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
      expect(en[key]).not.toBe(es[key]);
    }
  });
});
