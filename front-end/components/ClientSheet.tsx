/**
 * REQ-626 — the client's sheet: what the card's "Open card" opens, and what
 * /clients?open=<customerId> deep-links to (any page — it reads the customer
 * by id, not from the board's current page). Everything the customer form
 * holds, readable at a glance, with the two things to do with it: Edit
 * (REQ-625 — the shared form, prefilled; the one solid primary) and Message.
 */
import type { CustomerCard } from "../clients/clients.ts";
import Backdrop from "./Backdrop.tsx"; // REQ-354
import { I, ICN } from "../lib/dash-icons.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";
import { messageHref } from "../../shared/card-actions/mod.ts";
import {
  formatPhoneDisplay,
  telHref,
} from "../../shared/quote-flow/format-helpers.ts";
import { initialsOf } from "../lib/clients-display.ts";

interface Props {
  lang: Lang;
  /** null while it loads */
  customer: CustomerCard | null;
  /** the read failed (deleted, someone else's) */
  failed?: boolean;
  onClose: () => void;
  onEdit: (c: CustomerCard) => void;
}

const ROW =
  "display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--border,#eceee9);min-width:0";
const LBL =
  "font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--fg-muted,#6b7560)";
const VAL =
  "font-size:15px;color:var(--fg,#144852);overflow-wrap:anywhere;white-space:pre-line";
const ICON =
  "flex:none;width:30px;height:30px;border-radius:9px;background:rgba(81,152,67,0.12);color:var(--brand-green,#519843);display:flex;align-items:center;justify-content:center";
const BTN_PRIMARY =
  "padding:10px 18px;border:0;border-radius:10px;background:var(--brand-green,#519843);color:#fff;font:inherit;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none";
const BTN_OUTLINE =
  "padding:9px 16px;border:1.5px solid var(--border,#d8dcd5);border-radius:10px;background:#fff;color:var(--fg,#144852);font:inherit;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none";

function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${
    encodeURIComponent(address)
  }`;
}

export default function ClientSheet(
  { lang, customer: c, failed, onClose, onEdit }: Props,
) {
  const msg = c ? messageHref(c) : null;
  const address = c?.address?.trim() ?? "";
  return (
    // REQ-354 AMENDMENT (reconciled with develop on demo-fixes): develop's
    // client sheet closes through the shared <Backdrop> (guarded click + Escape)
    <Backdrop
      onClose={onClose}
      style="position:fixed;inset:0;background:rgba(20,40,45,0.45);display:flex;align-items:flex-start;justify-content:center;z-index:1050;padding:20px 12px;overflow-y:auto"
    >
      <section
        role="dialog"
        aria-modal="true"
        data-cy="client-sheet"
        onClick={(e) => e.stopPropagation()}
        style="background:#fff;border-radius:16px;padding:20px;max-width:520px;width:100%;box-sizing:border-box;box-shadow:0 24px 64px rgba(20,72,82,0.22);margin:auto 0"
      >
        <div style="display:flex;gap:12px;align-items:center;min-width:0">
          <div style="flex:none;width:44px;height:44px;border-radius:12px;background:var(--brand-green,#519843);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center">
            {c ? initialsOf(c.name) : "…"}
          </div>
          <div style="flex:1;min-width:0">
            <h2
              data-cy="client-sheet-name"
              style="margin:0;font-size:20px;font-weight:800;color:var(--fg,#144852);overflow-wrap:anywhere"
            >
              {c?.name ??
                (failed
                  ? tFor(lang, "clientSheet.notFound")
                  : tFor(lang, "clientSheet.loading"))}
            </h2>
            {c?.businessName && (
              <div style="font-size:14px;color:var(--fg-muted,#6b7560);overflow-wrap:anywhere">
                {c.businessName}
              </div>
            )}
            {c?.number && (
              <div style="font-size:12px;color:var(--fg-muted,#6b7560)">
                {c.number}
              </div>
            )}
          </div>
          <button
            type="button"
            data-cy="client-sheet-close"
            onClick={onClose}
            aria-label={tFor(lang, "common.close")}
            title={tFor(lang, "common.close")}
            style="flex:none;width:34px;height:34px;border:0;border-radius:10px;background:transparent;color:var(--fg-muted,#6b7560);cursor:pointer;display:flex;align-items:center;justify-content:center"
          >
            <I d={ICN.x} size={16} sw={2.5} />
          </button>
        </div>

        {c && (
          <div style="margin-top:14px">
            <div style={ROW}>
              <span style={ICON}>
                <I d={ICN.phone} size={14} sw={2.2} />
              </span>
              <div style="min-width:0">
                <div style={LBL}>{tFor(lang, "customerForm.phone")}</div>
                {c.phoneNumber
                  ? (
                    <a
                      href={telHref(c.phoneNumber)}
                      data-cy="client-sheet-phone"
                      style={`${VAL};text-decoration:none`}
                    >
                      {formatPhoneDisplay(c.phoneNumber)}
                    </a>
                  )
                  : <div style={VAL}>—</div>}
              </div>
            </div>
            <div style={ROW}>
              <span style={ICON}>
                <I d={ICN.mail} size={14} sw={2.2} />
              </span>
              <div style="min-width:0">
                <div style={LBL}>{tFor(lang, "customerForm.email")}</div>
                {c.email
                  ? (
                    <a
                      href={`mailto:${c.email}`}
                      data-cy="client-sheet-email"
                      style={`${VAL};text-decoration:none`}
                    >
                      {c.email}
                    </a>
                  )
                  : <div style={VAL}>—</div>}
              </div>
            </div>
            <div style={ROW}>
              <span style={ICON}>
                <I d={ICN.pin} size={14} sw={2.2} />
              </span>
              <div style="min-width:0">
                <div style={LBL}>
                  {tFor(lang, "customerForm.addressHeading")}
                </div>
                {address
                  ? (
                    <a
                      href={mapsHref(address)}
                      target="_blank"
                      rel="noopener"
                      data-cy="client-sheet-address"
                      style={`${VAL};text-decoration:none`}
                    >
                      {address}
                    </a>
                  )
                  : (
                    <div style={VAL}>
                      {tFor(lang, "clientsDisplay.address.none")}
                    </div>
                  )}
              </div>
            </div>
            {c.notes?.trim() && (
              <div style={ROW}>
                <span style={ICON}>
                  <I d={ICN.pencil} size={14} sw={2.2} />
                </span>
                <div style="min-width:0">
                  <div style={LBL}>{tFor(lang, "customerForm.notes")}</div>
                  <div style={VAL} data-cy="client-sheet-notes">{c.notes}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {c && (
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;margin-top:16px">
            {msg
              ? (
                <a
                  href={msg}
                  data-cy="client-sheet-message"
                  style={BTN_OUTLINE}
                >
                  <I d={ICN.msg} size={13} sw={2.4} />
                  {tFor(lang, "clientsBoard.panel.message")}
                </a>
              )
              : (
                /* no phone or email yet — Message leads to adding one */
                <button
                  type="button"
                  data-cy="client-sheet-message"
                  title={tFor(lang, "clientSheet.noContact")}
                  onClick={() => onEdit(c)}
                  style={BTN_OUTLINE}
                >
                  <I d={ICN.msg} size={13} sw={2.4} />
                  {tFor(lang, "clientSheet.addContact")}
                </button>
              )}
            <button
              type="button"
              data-cy="client-sheet-edit"
              onClick={() => onEdit(c)}
              style={BTN_PRIMARY}
            >
              <I d={ICN.pencil} size={13} sw={2.4} />
              {tFor(lang, "clientSheet.edit")}
            </button>
          </div>
        )}
      </section>
    </Backdrop>
  );
}
