/**
 * REQ-716 — demo-loop cycle 5, issue p2 "Text cut off or wrapping badly".
 *
 * Pairs 2, 6 and 9: in Spanish the send dialog showed "Texto + Correo" on
 * three lines. The note "Este número no puede recibir mensajes de texto"
 * (asstChat.send.cantText) was `white-space: nowrap` and pushed the channel
 * label down to its min-content width. Pairs 7 and 10: the ES sidebar item
 * "Vista del trabajador" wrapped to two lines.
 *
 * The real stylesheet (front-end/static/assistant-page.css) and the real
 * Spanish dictionary are laid out by a real browser, with the dialog's and
 * sidebar's markup (QuoteSendDialog.tsx, DashSidebar.tsx), so the test
 * measures what the user sees without a seeded quote.
 */
import { story } from "#shots";
import { keepMoneyTogether } from "../../front-end/lib/money-nowrap.ts";
import { NAV } from "../../front-end/lib/nav-tree.ts";
import { isFolder, type NavNode } from "../../front-end/lib/nav-folders.ts";

const ROOT = new URL("../../", import.meta.url);
const CSS = await Deno.readTextFile(
  new URL("front-end/static/assistant-page.css", ROOT),
);
const ES = JSON.parse(
  await Deno.readTextFile(new URL("lang/es.json", ROOT)),
) as Record<string, string>;
const EN = JSON.parse(
  await Deno.readTextFile(new URL("lang/en.json", ROOT)),
) as Record<string, string>;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const icon = `<svg width="13" height="13" viewBox="0 0 24 24"></svg>`;

/** The dialog's three rows as QuoteSendDialog renders them for a customer
 *  whose phone can't receive texts (REQ-569) and who has an email. */
function dialogHtml(dict: Record<string, string>, width: number): string {
  const row = (label: string, needs: string | null, rec: boolean) =>
    `<button type="button" class="send-dialog__option">${icon}<span class="send-dialog__option-label">${
      esc(label)
    }</span>${
      needs ? `<span class="send-dialog__needs">${esc(needs)}</span>` : ""
    }${
      rec
        ? `<span class="quote-review__send-menu-tag">${
          esc(dict["asstChat.preview.recommended"])
        }</span>`
        : ""
    }</button>`;
  return `<style>${CSS}</style><div style="width:${width}px">
    <div class="send-dialog" role="dialog"><div class="send-dialog__options">
      ${
    row(
      dict["asstChat.preview.menuBoth"],
      dict["asstChat.send.cantText"],
      false,
    )
  }
      ${
    row(dict["asstChat.preview.menuSms"], dict["asstChat.send.cantText"], false)
  }
      ${row(dict["asstChat.preview.menuEmail"], null, true)}
    </div></div></div>`;
}

for (const [lang, dict] of [["es", ES], ["en", EN]] as const) {
  for (const width of [420, 340]) {
    Deno.test(`REQ-716 p2: in ${lang} at a ${width}px dialog, every send channel label sits on one line and nothing leaves its row`, (t) =>
      story(t, async ({ page, expect }) => {
        await page.setContent(dialogHtml(dict, width), { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        const rows = await page.evaluate(() =>
          [...document.querySelectorAll(".send-dialog__option")].map((b) => {
            const label = b.querySelector(".send-dialog__option-label")!;
            const lh = parseFloat(getComputedStyle(label).lineHeight) ||
              parseFloat(getComputedStyle(label).fontSize) * 1.25;
            const r = b.getBoundingClientRect();
            const kids = [...b.children].map((c) => c.getBoundingClientRect());
            return {
              text: label.textContent,
              lines: Math.round(label.getBoundingClientRect().height / lh),
              inside: kids.every((k) =>
                k.left >= r.left - 0.5 &&
                k.right <= r.right + 0.5
              ),
              scroll: b.scrollWidth <= b.clientWidth,
            };
          })
        );
        for (const r of rows) {
          expect.eq(r.lines, 1, `"${r.text}" is on one line`);
          expect(r.inside && r.scroll, `"${r.text}" row: nothing pokes out`);
        }
      }));
  }
}

/** The sidebar's rows: every NAV node (folders and their items), the
 *  Worker view link, Log out and Back (DashSidebar.tsx). */
function navIds(nodes: NavNode<string>[]): string[] {
  return nodes.flatMap((n) => [n.id, ...(isFolder(n) ? navIds(n.items) : [])]);
}
const SIDEBAR_KEYS = [
  ...new Set([...navIds(NAV), "workerView", "logout", "back"]),
].map((id) => `nav.${id}`);

const SHEETS = ["assistant-page.css", "dashboard.css", "assistant.css"];
const SHEET_CSS = Object.fromEntries(
  await Promise.all(
    SHEETS.map(async (s) =>
      [
        s,
        await Deno.readTextFile(new URL(`front-end/static/${s}`, ROOT)),
      ] as const
    ),
  ),
);

for (const sheet of SHEETS) {
  for (const [lang, dict] of [["es", ES], ["en", EN]] as const) {
    Deno.test(`REQ-716 p2: with ${sheet}, every ${lang} sidebar label ('Vista del trabajador' included) sits on one line in the sidebar`, (t) =>
      story(t, async ({ page, expect }) => {
        const items = SIDEBAR_KEYS.map((k) =>
          `<a class="nav-item" data-k="${k}"><span class="nav-item__icon"><svg width="18" height="18"></svg></span><span class="nav-item__label">${
            esc(dict[k] ?? k)
          }</span>${
            // the pink count pill the Quotes / Invoices rows can carry
            k === "nav.quotes" || k === "nav.invoices"
              ? `<span class="nav-item__count">12</span>`
              : ""}</a>`
        ).join("");
        await page.setContent(
          `<style>${
            SHEET_CSS[sheet]
          }</style><aside class="sb" style="height:2000px"><div class="sb__inner"><nav class="sb__nav">${items}</nav></div></aside>`,
          { waitUntil: "load" },
        );
        await page.evaluate(() => document.fonts.ready);
        const lines: Record<string, number> = await page.evaluate(() => {
          const out: Record<string, number> = {};
          for (const a of document.querySelectorAll<HTMLElement>(".nav-item")) {
            const l = a.querySelector(".nav-item__label")!;
            const lh = parseFloat(getComputedStyle(l).lineHeight) ||
              parseFloat(getComputedStyle(l).fontSize) * 1.2;
            out[a.dataset.k!] = Math.round(
              l.getBoundingClientRect().height / lh,
            );
          }
          return out;
        });
        const wrapped = Object.entries(lines)
          .filter(([, n]) => n !== 1)
          .map(([k, n]) => `${dict[k]} (${n} lines)`);
        expect.eq(JSON.stringify(wrapped), "[]", "no sidebar label wraps");
      }));
  }
}

/** Pair 5: the reply "(−$500.00)" broke as "(−" / "$500.00)". The bubble's
 *  text, as AsstChat renders it, is laid out at every width from 120 to 420px:
 *  the minus and the "$" always share a line. */
Deno.test("REQ-716 p2: a chat bubble never breaks a signed amount between its sign and its $", (t) =>
  story(t, async ({ page, expect }) => {
    const reply =
      "Change order CO-002 added to Q-001 Kitchen Remodel: Credit for cheaper cabinets (−$500.00). Sent CO-002 to Dana Whitfield by email";
    await page.setContent(
      `<style>${CSS}</style><div class="msg__bubble" id="b" style="white-space:pre-wrap;display:inline-block">${
        esc(keepMoneyTogether(reply))
      }</div>`,
      { waitUntil: "load" },
    );
    await page.evaluate(() => document.fonts.ready);
    const split: number[] = await page.evaluate(() => {
      const b = document.getElementById("b")!;
      const text = b.firstChild as Text;
      const i = text.data.indexOf("−");
      const j = text.data.indexOf("$", i);
      const top = (k: number) => {
        const r = document.createRange();
        r.setStart(text, k);
        r.setEnd(text, k + 1);
        return Math.round(r.getBoundingClientRect().top);
      };
      const bad: number[] = [];
      for (let w = 120; w <= 420; w += 2) {
        b.style.width = `${w}px`;
        if (top(i) !== top(j)) bad.push(w);
      }
      return bad;
    });
    expect.eq(
      JSON.stringify(split),
      "[]",
      "widths at which '−' and '$500.00' land on different lines",
    );
  }));
