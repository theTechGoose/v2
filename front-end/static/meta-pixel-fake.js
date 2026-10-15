/* REQ-080 — the fake Meta Pixel loader. Served in place of Meta's fbevents.js
 * whenever DENO_DEPLOY is unset (REQ-318: the gate, a dev box, a pin run on
 * fakes). The page's snippet has already defined the `fbq` stub with its
 * queue; this drains that queue and takes every later call, recording each
 * as a plain array on `window.__pmPixel` — what the e2e stories read — and
 * paints a small ribbon naming the events, so a person looking at the pin
 * (and the judge's frames) can see what the pixel was told. Nothing leaves
 * the browser; the real loader paints nothing. */
(function () {
  var calls = (window.__pmPixel = window.__pmPixel || []);
  var ribbon = null;
  function paint() {
    if (!ribbon) {
      ribbon = document.createElement("div");
      ribbon.id = "pm-pixel-fake";
      ribbon.setAttribute("data-meta-pixel-ribbon", "");
      ribbon.setAttribute("aria-hidden", "true");
      ribbon.style.cssText =
        "position:fixed;left:8px;top:8px;z-index:2147483647;pointer-events:none;" +
        "font:600 11px/1.4 ui-monospace,Menlo,monospace;color:#fff;background:#1877f2;" +
        "padding:4px 8px;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.35);max-width:70vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      (document.body || document.documentElement).appendChild(ribbon);
    }
    var parts = [];
    for (var i = 0; i < window.__pmPixel.length; i++) {
      var c = window.__pmPixel[i];
      if (c[0] === "init") parts.push("init " + c[1]);
      else if (c[0] === "track") {
        var p = c[2] && c[2].value ? " $" + c[2].value : "";
        var id = c[3] && c[3].eventID ? " " + c[3].eventID : "";
        parts.push(c[1] + p + id);
      }
    }
    ribbon.textContent = "Meta Pixel (fake) · " +
      (parts.join(" · ") || "nothing yet");
  }
  function record() {
    calls.push(Array.prototype.slice.call(arguments));
    paint();
  }
  var q = window.fbq;
  if (q) {
    var pending = q.queue || [];
    for (var i = 0; i < pending.length; i++) {
      calls.push(Array.prototype.slice.call(pending[i]));
    }
    if (q.queue) q.queue.length = 0;
    q.callMethod = record;
  }
  document.documentElement.setAttribute("data-meta-pixel", "fake");
  if (document.body) paint();
  else document.addEventListener("DOMContentLoaded", paint);
})();
