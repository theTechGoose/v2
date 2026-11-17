/**
 * REQ-859 (demo-loop cycle dm4, issue m4): "What they'll get" stays under the cursor that opened
 * it. Raphael: "fix every issue the demo found, loop until there are none."
 *
 * The demo: the customer clicked "What they'll get" in the Send dialog and the stage drew her
 * cursor 178 px below the summary. The stage was right. The dialog was vertically centred
 * (`.send-dialog__backdrop { align-items: center }`), so when the disclosure opened and the
 * email preview grew the dialog to its max height, the dialog re-centred. Its top moved up by
 * half the growth and the summary she had just clicked jumped ~178 px away from her mouse.
 *
 * In a real Chromium at 1280x800, with each of the app's two send-dialog stylesheets
 * (assistant-page.css for the chat's dialog, quotes.css for QuoteSendDialog) and the dialog's
 * markup (QuoteSendDialog.tsx / AsstChat.tsx + SendLangPreview.tsx, whose body is rendered only
 * when the <details> is open): click the summary; its top moves less than 2 px, the point that
 * was clicked is still on the summary, and the opened dialog stays inside the viewport.
 */
import { story } from "#shots";

const ROOT = new URL("../../", import.meta.url);

const dialogHtml =
  `<div class="send-dialog__backdrop"><div class="send-dialog" role="dialog" data-cy="send-dialog">
  <h4 class="send-dialog__title">How do you want to send it?</h4>
  <div class="send-dialog__options" role="radiogroup">
    <button type="button" class="send-dialog__option is-current"><span class="send-dialog__option-label">Text + Email</span></button>
    <button type="button" class="send-dialog__option"><span class="send-dialog__option-label">Text</span></button>
    <button type="button" class="send-dialog__option"><span class="send-dialog__option-label">Email</span></button>
  </div>
  <div class="send-dialog__preview-wrap">
    <div class="send-dialog__lang"><span class="send-dialog__lang-label">Sends in</span>
      <button type="button" class="quote-review__langpill is-active">English</button>
      <button type="button" class="quote-review__langpill">Spanish</button></div>
    <details class="send-dialog__preview" data-cy="send-preview"><summary>What they'll get</summary></details>
  </div>
  <div class="send-dialog__actions">
    <button type="button" class="send-dialog__cancel">Cancel</button>
    <button type="button" class="send-dialog__keep">Send</button>
  </div>
</div></div>`;

/** SendLangPreview renders its body only while the <details> is open: the email, sized to it. */
const openBody = () => {
  const d = document.querySelector(
    "[data-cy=send-preview]",
  ) as HTMLDetailsElement;
  d.addEventListener("toggle", () => {
    if (!d.open) return;
    const body = document.createElement("div");
    body.className = "send-dialog__preview-body";
    body.innerHTML =
      `<div class="send-dialog__preview-part"><h5>Email to rosa@example.com</h5>` +
      `<p class="send-dialog__preview-subject">Your quote Q-001</p>` +
      `<iframe class="send-dialog__preview-frame" style="height:900px"></iframe></div>`;
    d.appendChild(body);
  });
};

for (const sheet of ["assistant-page.css", "quotes.css"]) {
  Deno.test(`REQ-859 (dm4 m4): with ${sheet}, opening "What they'll get" at 1280x800 leaves the summary under the cursor`, (t) =>
    story(t, async ({ page, expect }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      // the app's global reset (front-end/assets/styles.css: border-box, no margins) + the sheet
      const css = (await Deno.readTextFile(
        new URL("front-end/assets/styles.css", ROOT),
      )) + (await Deno.readTextFile(
        new URL(`front-end/static/${sheet}`, ROOT),
      ));
      await page.setContent(
        `<!doctype html><html><head><style>${css}</style></head><body>${dialogHtml}</body></html>`,
        { waitUntil: "load" },
      );
      await page.evaluate(openBody);
      const rect = () =>
        page.evaluate(() => {
          const r = document.querySelector("[data-cy=send-preview] > summary")!
            .getBoundingClientRect();
          const d = document.querySelector(".send-dialog")!
            .getBoundingClientRect();
          return {
            top: r.top,
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
            dTop: d.top,
            dBottom: d.bottom,
            dH: d.height,
          };
        });
      const before = await rect();
      // the closed dialog is shorter than the screen, so a centred one would move when it grows
      expect(before.dH < 600, `closed dialog is short (${before.dH}px)`);
      await page.mouse.click(before.x, before.y);
      await page.waitForTimeout(100);
      const after = await rect();
      expect(
        after.dH > before.dH + 200,
        `the preview grew the dialog (${before.dH} → ${after.dH})`,
      );
      expect(
        Math.abs(after.top - before.top) < 2,
        `REQ-859: the summary stayed under the cursor (top ${before.top} → ${after.top})`,
      );
      const under = await page.evaluate(
        ([x, y]) =>
          !!document.elementFromPoint(x, y)?.closest(
            "[data-cy=send-preview] > summary",
          ),
        [before.x, before.y],
      );
      expect(under, "REQ-859: the clicked point is still on the summary");
      expect(
        after.dTop >= 0 && after.dBottom <= 800,
        `the opened dialog stays on screen (${after.dTop}–${after.dBottom})`,
      );
    }));
}
