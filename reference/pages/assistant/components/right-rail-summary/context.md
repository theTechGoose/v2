# Right-rail summary (Assistant)

## What
There is **no right-rail summary** on the Assistant page in the static export. The page is a single-pane chat workspace (`<AssistantWorkspace>` → `<section class="chat">`). The plan reserved this folder name expecting a sidebar of jobs/deals/quick-actions, but in practice the right-rail role is filled by the `.phone` preview itself, which carries:

- The deal phase strip (`Quote → Terms → Send`) — a compact, glanceable summary of where the user is in the workflow.
- The phone's chat thread mirrors the desktop chat, so anyone scanning across screens sees the same conversation.

If a true right-rail summary is added later, it would live here. The desktop layout would need to grow from `1fr` to `1fr 320px` and the chat width would shrink.

## What's adjacent right now
- `phone-thread-preview/` — the current de-facto right rail.
- The deal phase strip is documented inline in that folder's snippet (it's part of `PhoneAssistant`, not a standalone component).

## Source
`pages/assistant/raw.html` lines 4705–4715 (`<AssistantWorkspace>` shows the current layout — single pane).

## Animations
N/A.
