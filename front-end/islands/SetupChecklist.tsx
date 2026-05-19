import { useEffect, useState } from "preact/hooks";
import { profileClient, type ProfileSnapshot } from "../clients/profile.ts";

/**
 * SetupChecklist — post-onboarding "finish setting up" card on the
 * dashboard. Lists the high-leverage items that onboarding doesn't
 * collect (logo, payment method, insurance, contract defaults) plus
 * any address piece the user skipped. Self-hides once every item is
 * checked.
 *
 * Pulled into its own island so the dashboard route stays SSR-clean —
 * fetching /profile here means the checklist appears only when we
 * actually need it without coupling the dashboard route to a
 * profile-shape read on every render.
 */
interface Item {
  key: string;
  label: string;
  done: boolean;
  href: string;
}

export default function SetupChecklist() {
  const [snap, setSnap] = useState<ProfileSnapshot | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    profileClient.get().then((p) => { if (alive) setSnap(p); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!snap || dismissed) return null;

  const id = snap.identity ?? null;
  const acceptedAny = id?.acceptedPaymentMethods
    ? Object.values(id.acceptedPaymentMethods).some(
      (m) => m && (m as { enabled?: boolean }).enabled === true,
    )
    : false;

  const items: Item[] = [
    { key: "name",    label: "Your name",                 done: !!snap.user.name?.trim(),                    href: "/settings" },
    { key: "biz",     label: "Business name",             done: !!id?.businessName?.trim(),                   href: "/settings" },
    { key: "email",   label: "Email for notifications",   done: !!snap.user.email?.trim(),                    href: "/settings" },
    { key: "logo",    label: "Upload your logo",          done: !!id?.logoFileId,                             href: "/settings" },
    { key: "address", label: "Mailing address",           done: !!(snap.address?.postal?.trim() || snap.address?.street?.trim()), href: "/settings" },
    { key: "payment", label: "How you accept payment",    done: acceptedAny,                                  href: "/settings" },
    { key: "insurance", label: "Insurance (optional but helps)", done: !!snap.insurance?.provider?.trim(),    href: "/settings" },
  ];
  const remaining = items.filter((i) => !i.done);
  if (remaining.length === 0) return null;

  const pct = Math.round(((items.length - remaining.length) / items.length) * 100);

  return (
    <section
      class="panel"
      aria-label="Finish setting up"
      style="padding:18px 22px;margin-bottom:18px;background:linear-gradient(135deg,rgba(255,107,107,0.08) 0%,rgba(255,107,107,0.02) 100%);border:1px solid rgba(255,107,107,0.25)"
    >
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div>
          <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#d94e4e">
            Setup checklist
          </div>
          <h3 style="margin:4px 0 0;font-family:var(--font-heading);font-weight:800;font-size:18px;color:var(--brand-teal)">
            Finish setting up — {remaining.length} {remaining.length === 1 ? "thing" : "things"} left
          </h3>
        </div>
        <button
          type="button"
          aria-label="Hide checklist"
          onClick={() => setDismissed(true)}
          style="appearance:none;background:transparent;border:0;font:inherit;font-size:12px;color:var(--fg-muted);cursor:pointer;opacity:0.7"
        >
          Hide
        </button>
      </div>
      <div
        role="progressbar"
        aria-label="Setup completeness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        style="height:4px;border-radius:999px;background:rgba(255,107,107,0.15);overflow:hidden;margin-top:10px"
      >
        <div style={`height:100%;width:${pct}%;background:linear-gradient(90deg,#FF6B6B,#d94e4e);transition:width 480ms`} />
      </div>
      <ul style="margin:12px 0 0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px">
        {items.map((it) => (
          <li key={it.key} style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;border:1px solid rgba(20,72,82,0.10);background:#fff">
            <span
              aria-hidden="true"
              style={`display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:${it.done ? "#519843" : "rgba(20,72,82,0.10)"};color:#fff;font-size:12px;font-weight:800;flex-shrink:0`}
            >
              {it.done ? "✓" : ""}
            </span>
            <a
              href={it.href}
              style={`flex:1;font-size:13px;color:${it.done ? "var(--fg-muted)" : "var(--fg)"};text-decoration:none;font-weight:${it.done ? 400 : 600}`}
            >
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
