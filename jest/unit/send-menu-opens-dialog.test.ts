/**
 * REQ-459 (demo-loop cycle 3, issue m44) — a pick in the review card's ▾
 * send menu does something.
 *
 * m44: pair 6 clicked "Solo correo" in the ▾ menu and "NOTHING happened (no
 * dialog, no request)". The item only ran setSendChannel + closed the menu,
 * and since REQ-402 the main button reads a fixed "Send…", so the pick left
 * no trace. Now a pick opens the send dialog with that channel already
 * selected, and the main button names the picked channel ("Send by email…").
 */
import * as fs from "fs";
import * as path from "path";
import { sendOpenLabelKey } from "../../front-end/lib/send-dialog.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-459 m44 sendOpenLabelKey names the picked channel", () => {
  it("REQ-459 email / sms / both → their own 'Send by …' key", () => {
    expect(sendOpenLabelKey("email")).toBe("asstChat.preview.sendOpenEmail");
    expect(sendOpenLabelKey("sms")).toBe("asstChat.preview.sendOpenSms");
    expect(sendOpenLabelKey("both")).toBe("asstChat.preview.sendOpenBoth");
  });
  it("REQ-459 the dictionaries carry the three labels in en and es", () => {
    expect(en["asstChat.preview.sendOpenEmail"]).toBe("Send by email…");
    expect(en["asstChat.preview.sendOpenSms"]).toBe("Send by text…");
    expect(en["asstChat.preview.sendOpenBoth"]).toBe("Send by text + email…");
    expect(es["asstChat.preview.sendOpenEmail"]).toBe("Enviar por correo…");
    expect(es["asstChat.preview.sendOpenSms"]).toBe("Enviar por texto…");
    expect(es["asstChat.preview.sendOpenBoth"]).toBe(
      "Enviar por texto + correo…",
    );
  });
});

describe("REQ-459 m44 the island: a menu pick opens the dialog on that channel", () => {
  const src = read("front-end/islands/AsstChat.tsx");
  const mStart = src.indexOf('class="quote-review__send-menu"');
  const menu = src.slice(mStart, src.indexOf("menuCopyLink", mStart));
  const mainStart = src.indexOf('class="quote-review__send-main"');
  const main = src.slice(mainStart, src.indexOf("</button>", mainStart));

  it("REQ-459 the menu item's onClick opens the send dialog with the picked channel", () => {
    expect(mStart).toBeGreaterThan(0);
    const item = menu.slice(menu.indexOf('role="menuitem"'));
    const onClick = item.slice(
      item.indexOf("onClick="),
      item.indexOf("<I d={icon}"),
    );
    expect(onClick).toMatch(/openSendDialog\(ch\)/);
  });
  it("REQ-459 openSendDialog pre-selects its channel and opens the dialog", () => {
    const fStart = src.indexOf("const openSendDialog");
    expect(fStart).toBeGreaterThan(0);
    const fn = src.slice(fStart, src.indexOf("};", fStart));
    expect(fn).toMatch(/setDialogChannel\(ch\)/);
    expect(fn).toMatch(/setSendDialogOpen\(true\)/);
    expect(fn).toMatch(/setChannelMenuOpen\(false\)/);
  });
  it("REQ-459 the main button opens the same dialog and names a picked channel", () => {
    expect(main).toMatch(/openSendDialog\(sendChannel\)/);
    expect(main).toMatch(/sendOpenLabelKey\(pickedChannel\)/);
    // REQ-402: with no pick it still reads the neutral "Send…".
    expect(main).toContain('"asstChat.preview.sendOpen"');
  });
});
