import { useEffect, useState } from "preact/hooks";
import { profileClient } from "../clients/profile.ts";
import { type Lang, tFor } from "../lib/i18n.ts";

/**
 * REQ-624 — "What should we call you?" An editor signed in to someone else's account (REQ-146)
 * whose own record has no name, and whose invite carried none, is asked hers ONCE: a small dialog
 * over the dashboard shell. Save writes HER user record (PUT /me while acting never touches the
 * owner's); "Not now" is remembered on this device so she is not asked again. Rendered by the
 * DashSidebar island only while the /profile snapshot says `actor.needsName`.
 */
const ASKED_KEY = (actorId: string) => `pm:actor-name-asked:${actorId}`;

const input =
  "width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border, #d8dcd5);border-radius:8px;font:inherit;font-size:15px;background:#fff;color:var(--fg,#144852)";
const ghost =
  "padding:9px 14px;border-radius:8px;border:0;background:transparent;color:var(--fg-muted,#6b7560);cursor:pointer;font:inherit;font-weight:600";

function wasAsked(actorId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(ASKED_KEY(actorId)) === "1";
  } catch {
    return false;
  }
}

function markAsked(actorId: string) {
  try {
    globalThis.localStorage?.setItem(ASKED_KEY(actorId), "1");
  } catch { /* private mode — asked again next time, harmless */ }
}

export function ActorNamePrompt(
  { actorId, needsName, lang, onSaved }: {
    actorId: string;
    needsName: boolean;
    lang: Lang;
    onSaved: (name: string) => void;
  },
) {
  // decided after mount: localStorage is the browser's, and SSR renders nothing
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setOpen(needsName && !wasAsked(actorId));
  }, [actorId, needsName]);

  if (!open) return null;
  const armed = name.trim().length > 0 && !busy;

  function later() {
    markAsked(actorId);
    setOpen(false);
  }

  async function save() {
    if (!armed) return;
    setBusy(true);
    setErr(null);
    try {
      await profileClient.updateUser({ name: name.trim() });
      markAsked(actorId);
      setOpen(false);
      onSaved(name.trim());
    } catch {
      setErr(tFor(lang, "actorName.failed"));
      setBusy(false);
    }
  }

  return (
    <div
      data-cy="actor-name-prompt"
      style="position:fixed;inset:0;z-index:70;background:rgba(20,72,82,0.35);display:flex;align-items:center;justify-content:center;padding:20px"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="actor-name-title"
        style="background:#fff;border-radius:16px;padding:20px 22px;width:min(420px,100%);box-shadow:0 20px 60px rgba(20,72,82,0.25);display:flex;flex-direction:column;gap:12px;text-align:left;color:var(--fg,#144852)"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div
          id="actor-name-title"
          style="font-size:18px;font-weight:800;color:var(--fg,#144852)"
        >
          {tFor(lang, "actorName.title")}
        </div>
        <p style="margin:0;font-size:13.5px;line-height:1.45">
          {tFor(lang, "actorName.intro")}
        </p>
        <label style="display:block">
          <span style="display:block;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-muted, #6b7560);margin-bottom:4px">
            {tFor(lang, "actorName.label")}
          </span>
          <input
            type="text"
            autoComplete="name"
            maxLength={120}
            data-cy="actor-name-input"
            style={input}
            value={name}
            disabled={busy}
            placeholder={tFor(lang, "actorName.placeholder")}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
        {err
          ? (
            <div role="alert" style="color:#a83b3b;font-size:12.5px">
              {err}
            </div>
          )
          : null}
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
          <button
            type="button"
            data-cy="actor-name-later"
            disabled={busy}
            onClick={later}
            style={ghost}
          >
            {tFor(lang, "actorName.later")}
          </button>
          <button
            type="submit"
            data-cy="actor-name-save"
            disabled={!armed}
            style={`padding:9px 16px;border-radius:8px;border:0;background:var(--brand-green,#519843);opacity:${
              armed ? 1 : 0.45
            };color:#fff;cursor:${
              armed ? "pointer" : "not-allowed"
            };font:inherit;font-weight:700`}
          >
            {busy
              ? tFor(lang, "actorName.saving")
              : tFor(lang, "actorName.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
