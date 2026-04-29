# Animations — contact-section

Three keyframes drive the chat-preview micro-interactions; full definitions in `shared/design-tokens/motion.md`.

| Keyframe | Selector | Behavior |
|---|---|---|
| `cfPulse` | `.cf-phone__avatar` (or `.cf-phone__live`) | Outer green ring softly pulses to convey "online" status. |
| `cfDot`   | `.cf-typing i` | Three typing dots stagger Y-translate every ~0.6s to suggest a reply being written. |
| `cfSlideIn` | `.cf-bubble--reply` | 420ms ease-bounce backward — used when JS pushes a new reply bubble into the thread. |

```css
.cf-phone__avatar { animation: cfPulse 1.6s ease-in-out infinite; }

.cf-typing i { animation: cfDot 1.4s infinite ease-in-out; }
.cf-typing i:nth-child(2) { animation-delay: 0.18s; }
.cf-typing i:nth-child(3) { animation-delay: 0.36s; }

.cf-bubble--reply { animation: cfSlideIn 420ms var(--ease-bounce) backwards; }
```
