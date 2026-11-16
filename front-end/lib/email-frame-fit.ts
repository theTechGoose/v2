/**
 * REQ-819 (demo-loop cycle dm1, M3) — the send dialog's email preview has no scroller of its own.
 *
 * The preview is the real email in an iframe (srcdoc). At a fixed height its email scrolled
 * inside the frame's own document, which the demo mirror (top document only) never sees, so the
 * presenter's stage stayed at the top of the email while the customer read further down. Sized
 * to its email, the frame scrolls nothing: the send dialog's scroll — mirrored — is what moves.
 *
 * The frame must be readable from the page (`sandbox="allow-same-origin"`, never allow-scripts).
 * Returns the email's height, or null (frame left alone) when its document can't be read.
 */
export function fitFrameToContent(frame: HTMLIFrameElement): number | null {
  let html: HTMLElement | null | undefined;
  try {
    html = frame.contentDocument?.documentElement;
  } catch {
    return null; // an opaque-origin frame
  }
  if (!html) return null;
  const was = frame.style.height;
  // collapse first: a document is never shorter than its viewport, so a shorter email (the
  // language switch, a wider dialog) would otherwise keep the old height. Same task, no paint.
  frame.style.height = "0px";
  const content = Math.ceil(html.scrollHeight);
  if (content <= 0) {
    frame.style.height = was;
    return null;
  }
  const view = frame.ownerDocument?.defaultView;
  const sizing = view?.getComputedStyle(frame).boxSizing;
  const border = sizing === "border-box"
    ? frame.offsetHeight - frame.clientHeight
    : 0;
  frame.style.height = `${content + border}px`;
  return content;
}
