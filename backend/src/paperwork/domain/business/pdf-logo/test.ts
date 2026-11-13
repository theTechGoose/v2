import { assert, assertEquals } from "#std/assert";
import { PDFDocument } from "#pdf-lib";
import { embedLogo, fitInBox, logoKind } from "./mod.ts";
import { TINY_JPG, TINY_PNG, WIDE_PNG } from "./fixtures.ts";

// REQ-628 — "They NEED THEIR LOGO NOT OURS"
Deno.test("REQ-628 fitInBox: scales to fit the box keeping the aspect ratio", () => {
  assertEquals(fitInBox(400, 100, 160, 60), { width: 160, height: 40 });
  assertEquals(fitInBox(100, 400, 160, 60), { width: 15, height: 60 });
  assertEquals(fitInBox(160, 60, 160, 60), { width: 160, height: 60 });
  // a tiny logo grows to the box, still in proportion
  assertEquals(fitInBox(16, 8, 160, 60), { width: 120, height: 60 });
});

Deno.test("REQ-628 logoKind: PNG and JPG sniffed from the bytes, anything else refused", () => {
  assertEquals(logoKind(TINY_PNG), "png");
  assertEquals(logoKind(TINY_JPG), "jpg");
  assertEquals(logoKind(new TextEncoder().encode("<svg></svg>")), undefined);
  assertEquals(logoKind(new Uint8Array()), undefined);
});

Deno.test("REQ-628 embedLogo: embeds a PNG and a JPG; a broken file is undefined, never a throw", async () => {
  const pdf = await PDFDocument.create();
  const png = await embedLogo(pdf, { bytes: TINY_PNG });
  const jpg = await embedLogo(pdf, { bytes: TINY_JPG });
  const wide = await embedLogo(pdf, { bytes: WIDE_PNG });
  assert(png && jpg && wide);
  assertEquals(wide.width / wide.height, 4);
  assertEquals(
    await embedLogo(pdf, {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]),
    }),
    undefined,
  );
  assertEquals(await embedLogo(pdf, undefined), undefined);
});
