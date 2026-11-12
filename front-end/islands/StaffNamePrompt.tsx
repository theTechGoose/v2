import { useEffect, useState } from "preact/hooks";
import { langSignal, tFor } from "../lib/i18n.ts";
import { profileClient } from "../clients/profile.ts";
import { announceProfile } from "../lib/profile-events.ts";
import { isPlaceholderName } from "../../shared/quote-flow/outbound-identity.ts";

/**
 * REQ-355 — "What's your name?" for a staff member (super admin) still on the
 * seeded sign-in placeholder. The customer wizard, the app's only other name
 * question, never runs for staff (REQ-227), so without this a staff account
 * stayed "Nuevo usuario" — the name a demo's customer saw guiding them.
 * The route mounts it only for a super admin whose name is still the
 * placeholder; once a real name is saved it is gone for good. "Not now" hides
 * it for this page view.
 */
export default function StaffNamePrompt() {
  const lang = langSignal.value;
  const [name, setName] = useState("");
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  // the input is marked ready only once hydrated, so nothing types into a dead form
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!open) return null;

  async function save(e: Event) {
    e.preventDefault();
    const trimmed = name.trim();
    if (isPlaceholderName(trimmed) || busy) return;
    setBusy(true);
    setErr(false);
    try {
      const u = await profileClient.updateUser({ name: trimmed });
      announceProfile({ name: u?.name ?? trimmed });
      setOpen(false);
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-cy="staff-name-prompt"
      role="region"
      aria-labelledby="staff-name-title"
      style="background:#fff;border:1px solid var(--border);border-radius:18px;padding:18px 20px;margin:0 0 18px;box-shadow:0 6px 18px rgba(0,0,0,0.05)"
    >
      <h2
        id="staff-name-title"
        style="margin:0 0 4px;font-family:var(--font-heading);font-size:18px;font-weight:800"
      >
        {tFor(lang, "staffNamePrompt.title")}
      </h2>
      <p style="margin:0 0 12px;font-size:14px;opacity:0.8">
        {tFor(lang, "staffNamePrompt.lead")}
      </p>
      <form
        onSubmit={save}
        noValidate
        style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"
      >
        <input
          id="staff-name-input"
          data-cy="staff-name-input"
          data-ready={mounted ? "" : undefined}
          type="text"
          autoComplete="name"
          aria-label={tFor(lang, "staffNamePrompt.label")}
          placeholder={tFor(lang, "staffNamePrompt.label")}
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          style="flex:1 1 220px;min-width:0;padding:11px 14px;border:1px solid var(--border);border-radius:12px;font-size:15px"
        />
        <button
          type="submit"
          class="btn btn--quote"
          data-cy="staff-name-save"
          disabled={busy || isPlaceholderName(name)}
        >
          {tFor(lang, "staffNamePrompt.save")}
        </button>
        <button
          type="button"
          class="btn btn--ghost"
          data-cy="staff-name-later"
          style="background:transparent;border:none"
          onClick={() => setOpen(false)}
        >
          {tFor(lang, "staffNamePrompt.later")}
        </button>
      </form>
      {err && (
        <p role="alert" style="margin:8px 0 0;color:#c0392b;font-size:13px">
          {tFor(lang, "staffNamePrompt.error")}
        </p>
      )}
    </section>
  );
}
