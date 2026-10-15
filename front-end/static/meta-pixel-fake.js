/* REQ-080 — the fake Meta Pixel loader. Served in place of Meta's fbevents.js
 * whenever DENO_DEPLOY is unset (REQ-318: the gate, a dev box, a pin run on
 * fakes). The page's snippet has already defined the `fbq` stub with its
 * queue; this drains that queue and takes every later call, recording each
 * as a plain array on `window.__pmPixel` — what the e2e stories read — and
 * marks the document so a human can tell the fake from the real thing.
 * Nothing leaves the browser. */
(function () {
  var calls = (window.__pmPixel = window.__pmPixel || []);
  function record() {
    calls.push(Array.prototype.slice.call(arguments));
  }
  var q = window.fbq;
  if (q) {
    var pending = q.queue || [];
    for (var i = 0; i < pending.length; i++) {
      record.apply(null, Array.prototype.slice.call(pending[i]));
    }
    if (q.queue) q.queue.length = 0;
    q.callMethod = record;
  }
  document.documentElement.setAttribute("data-meta-pixel", "fake");
})();
