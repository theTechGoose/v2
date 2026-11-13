/**
 * Interactive heart of /clients: toolbar (search + filter chips) + the
 * editorial card grid + the slide-up contact panel.
 *
 * Receives ONE PAGE of the backend's `CustomerCard[]` (REQ-135) with the chip
 * counts the API counted — no seed data, no derivations the backend already
 * owns (status, balance, days-since-contact all come pre-computed via
 * BuildCustomerCards) and no list-wide filtering here: the search box and
 * the chips report upward and the island asks the API for the page.
 */
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { tFor } from "../lib/i18n.ts";
import {
  clientsClient,
  type ClientsFilter,
  type CustomerCard,
} from "../clients/clients.ts";
import type { SubscriptionView } from "../clients/field.ts";
import { fmtMoneyExact, perVisitCents } from "../lib/field.ts";
import {
  addressFor,
  balanceDisplay,
  cardDisambiguators,
  ctaFor,
  initialsOf,
  lastWhenFor,
  moodFor,
  segmentLabel,
  sinceBadge,
  storyLineFor,
} from "../lib/clients-display.ts";
import { messageHrefFor, nudgeActionFor } from "../lib/client-actions.ts";
import { isChromeClick } from "../lib/backdrop-dismiss.ts";
import {
  repeatVisitsPanelShown,
  type TradeKind,
} from "../../shared/quote-flow/trade-fit.ts"; // REQ-743
import {
  apiFieldErrorKey,
  type CardField,
  cardFieldPatch,
  openIdFromSearch,
} from "../lib/customer-card-edit.ts";
import { ApiError } from "../lib/api.ts";
import CustomerLanguageSelect, {
  type CustomerLanguageValue,
  customerLanguageValue,
} from "../components/CustomerLanguageSelect.tsx"; // REQ-715
import {
  formatPhoneDisplay,
  telHref,
} from "../../shared/quote-flow/format-helpers.ts";
import {
  clientCtaAction,
  clientCtaMessageKind,
  messageHref,
} from "../../shared/card-actions/mod.ts";

// Chip set matches the canonical reference (DocuMonster Clients.html)
// — six entries with the exact labels from the design source. URL
// bookmarking via ?segment= is additive: it doesn't change the visual
// chip set, just lets a filtered view be reloaded / shared / back-buttoned.
type FilterId = ClientsFilter;

interface FilterEntry {
  id: FilterId;
  labelKey: string;
}
const FILTER_DEFS: FilterEntry[] = [
  { id: "all", labelKey: "clientsBoard.filter.all" },
  { id: "new", labelKey: "clientsBoard.filter.new" },
  { id: "active", labelKey: "clientsBoard.filter.activeJobs" },
  { id: "lead", labelKey: "clientsBoard.filter.leads" },
  { id: "owes", labelKey: "clientsBoard.filter.oweYou" },
  { id: "regular", labelKey: "clientsBoard.filter.regulars" },
  { id: "cold", labelKey: "clientsBoard.filter.quiet" },
];

const FILTER_IDS: ReadonlyArray<string> = FILTER_DEFS.map((f) => f.id);
function isFilterId(s: string | null | undefined): s is FilterId {
  return !!s && FILTER_IDS.includes(s);
}
export function filterFromSearch(
  search: string | null | undefined,
): FilterId {
  if (!search) return "all";
  const raw = new URLSearchParams(search).get("segment");
  return isFilterId(raw) ? raw : "all";
}

function SinceBadge({ days, lang }: { days: number; lang: "en" | "es" }) {
  const { tier, num, unit } = sinceBadge(days, lang);
  return (
    <div class={`ccard2__since ccard2__since--${tier}`}>
      <span
        class={`ccard2__since-num${
          num.length > 2 ? " ccard2__since-num--word" : ""
        }`}
      >
        {num}
      </span>
      <span class="ccard2__since-unit">{unit}</span>
    </div>
  );
}

interface CardProps {
  c: CustomerCard;
  /** REQ-145 — the customer's subscriptions (the field module's), oldest first */
  subs: SubscriptionView[];
  /** REQ-743 — the business's trade kind: a service trade always shows the repeat-visits panel */
  tradeKind: TradeKind;
  idx: number;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** REQ-626 — the client's sheet (Open card, the "Open card" CTA) */
  onOpenCard: (id: string) => void;
  /** REQ-625 — the edit form (an address or a contact still to add) */
  onEdit: (c: CustomerCard) => void;
  lang: "en" | "es";
  /** REQ-390 (M18): set when another visible card shares this name — "C-002" / "···0177" */
  disambig?: string;
  /** REQ-600: a contact row was saved — the page reloads the cards */
  onSaved: () => void;
}

interface EditRowProps {
  field: CardField;
  icon: JSX.Element;
  label: string;
  /** "Add phone" — the row's control while the field is empty */
  addLabel: string;
  /** the stored value ("" when none) */
  value: string;
  /** what the row shows for it */
  display: string;
  /** tel: / mailto: for a filled contact */
  href?: string;
  inputType: "tel" | "email" | "text";
  customerId: string;
  onSaved: () => void;
  lang: "en" | "es";
}

/**
 * REQ-600 (demo-loop cycle 4, M5) — one panel row that edits in place: empty
 * → an "Add phone" button; filled → the tel:/mailto: value and a pencil. The
 * input saves through PUT /customers/:id with the New customer form's rule;
 * a refusal is shown under the row.
 */
function EditRow(
  {
    field,
    icon,
    label,
    addLabel,
    value,
    display,
    href,
    inputType,
    customerId,
    onSaved,
    lang,
  }: EditRowProps,
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [errKey, setErrKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function start() {
    setDraft(value);
    setErrKey(null);
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setErrKey(null);
  }
  async function save(e: Event) {
    e.preventDefault();
    if (saving) return;
    const r = cardFieldPatch(field, draft);
    if ("error" in r) {
      setErrKey(r.error);
      return;
    }
    if ((Object.values(r.patch)[0] ?? "") === value.trim()) {
      cancel();
      return;
    }
    setSaving(true);
    setErrKey(null);
    try {
      await clientsClient.update(customerId, r.patch);
      setEditing(false);
      onSaved();
    } catch (err) {
      // REQ-278: the backend names a refused contact by dictionary key
      const key = err instanceof ApiError
        ? apiFieldErrorKey((err.body as { message?: unknown } | null)?.message)
        : null;
      setErrKey(key ?? "clientsBoard.panel.saveError");
    } finally {
      setSaving(false);
    }
  }

  const errId = `ccard2-err-${field}-${customerId}`;
  return (
    <div
      class="ccard2__panel-row"
      data-cy={`ccard2-row-${field}`}
      style="cursor:default;flex-wrap:wrap"
    >
      <span class="ccard2__panel-row-icon">
        <I d={icon} size={13} sw={2.2} />
      </span>
      {editing
        ? (
          <form
            class="ccard2__panel-row-text"
            style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"
            onSubmit={save}
            noValidate
          >
            <div class="ccard2__panel-row-lbl" style="flex-basis:100%">
              {label}
            </div>
            <input
              type={inputType}
              data-cy={`ccard2-input-${field}`}
              aria-label={label}
              aria-invalid={errKey ? "true" : undefined}
              aria-describedby={errKey ? errId : undefined}
              autoFocus
              value={draft}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                // Escape leaves the edit, not the whole card
                if (e.key === "Escape") {
                  e.stopPropagation();
                  cancel();
                }
              }}
              style={`flex:1;min-width:0;padding:6px 8px;border:1px solid ${
                errKey ? "#a83b3b" : "var(--border,#d8dcd5)"
              };border-radius:8px;font:inherit;font-size:13px`}
            />
            <button
              type="submit"
              data-cy={`ccard2-save-${field}`}
              disabled={saving}
              style="padding:6px 10px;border:0;border-radius:8px;background:var(--brand-teal);color:#fff;font:inherit;font-size:12px;font-weight:700;cursor:pointer"
            >
              {saving ? "…" : tFor(lang, "common.save")}
            </button>
            <button
              type="button"
              data-cy={`ccard2-cancel-${field}`}
              disabled={saving}
              onClick={cancel}
              style="padding:6px 8px;border:0;background:transparent;color:var(--fg-muted);font:inherit;font-size:12px;font-weight:700;cursor:pointer"
            >
              {tFor(lang, "common.cancel")}
            </button>
            {errKey && (
              <p
                id={errId}
                role="alert"
                style="flex-basis:100%;margin:2px 0 0;color:#a83b3b;font-size:12px;font-weight:600;white-space:normal"
              >
                {tFor(lang, errKey)}
              </p>
            )}
          </form>
        )
        : (
          <>
            <span class="ccard2__panel-row-text">
              <div class="ccard2__panel-row-lbl">{label}</div>
              {value
                ? (
                  <div class="ccard2__panel-row-val">
                    {href
                      ? (
                        <a
                          href={href}
                          data-cy={`ccard2-link-${field}`}
                          style="color:inherit;text-decoration:none"
                        >
                          {display}
                        </a>
                      )
                      : display}
                  </div>
                )
                : (
                  <button
                    type="button"
                    data-cy={`ccard2-edit-${field}`}
                    onClick={start}
                    style="padding:0;border:0;background:transparent;font:inherit;font-weight:700;color:var(--brand-pink);cursor:pointer"
                  >
                    + {addLabel}
                  </button>
                )}
            </span>
            {value && (
              <button
                type="button"
                class="ccard2__panel-row-arrow"
                data-cy={`ccard2-edit-${field}`}
                onClick={start}
                aria-label={`${tFor(lang, "common.edit")} ${label}`}
                title={tFor(lang, "common.edit")}
                style="border:0;background:transparent;padding:4px;cursor:pointer"
              >
                <I d={ICN.pencil} size={12} sw={2.4} />
              </button>
            )}
          </>
        )}
    </div>
  );
}

/**
 * REQ-715 (demo-loop cycle 5, m31): the customer's language, changed in place
 * — every send to them starts in it. A pick saves at once through
 * PUT /customers/:id ("Not set" clears it); a refusal puts the old one back
 * and says so under the row.
 */
function LanguageRow(
  { customerId, value, onSaved, lang }: {
    customerId: string;
    value: string | undefined;
    onSaved: () => void;
    lang: "en" | "es";
  },
) {
  const [shown, setShown] = useState(customerLanguageValue(value));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => setShown(customerLanguageValue(value)), [value]);

  async function pick(next: CustomerLanguageValue) {
    const before = shown;
    setShown(next);
    setFailed(false);
    setSaving(true);
    try {
      await clientsClient.update(customerId, { language: next });
      onSaved();
    } catch {
      setShown(before);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const label = tFor(lang, "customer.language.label");
  return (
    <div
      class="ccard2__panel-row"
      data-cy="ccard2-row-language"
      style="cursor:default;flex-wrap:wrap"
    >
      <span class="ccard2__panel-row-icon">
        <I d={ICN.msg} size={13} sw={2.2} />
      </span>
      <span class="ccard2__panel-row-text">
        <div class="ccard2__panel-row-lbl">{label}</div>
        <CustomerLanguageSelect
          lang={lang}
          aria-label={label}
          value={shown}
          disabled={saving}
          onChange={pick}
          style="margin-top:2px;padding:4px 6px;border:1px solid var(--border,#d8dcd5);border-radius:8px;font:inherit;font-size:13px;background:#fff;color:var(--fg)"
        />
      </span>
      {failed && (
        <p
          role="alert"
          style="flex-basis:100%;margin:2px 0 0;color:#a83b3b;font-size:12px;font-weight:600;white-space:normal"
        >
          {tFor(lang, "clientsBoard.panel.saveError")}
        </p>
      )}
    </div>
  );
}

function ClientCard(
  {
    c,
    subs,
    tradeKind,
    idx,
    isOpen,
    onOpen,
    onClose,
    onOpenCard,
    onEdit,
    lang,
    disambig,
    onSaved,
  }: CardProps,
) {
  const mood = moodFor(c, lang);
  const initials = initialsOf(c.name);
  // NW-36 (REQ-013): the app never collects a customer segment, so no
  // "Unsorted" placeholder — the label renders only when a real one exists.
  const seg = c.segment ? segmentLabel(c.segment, lang) : null;
  const story = storyLineFor(c, lang);
  const cta = ctaFor(c, lang);
  const balance = balanceDisplay(c, lang);
  const address = addressFor(c, lang);
  const nudge = nudgeActionFor(c);
  const msgHref = messageHrefFor(c);

  /** REQ-626: the CTA does what it says — a pre-filled message to the
   *  client, or (its "Open card" label) the client's sheet. REQ-277: with
   *  nowhere to send (nudgeActionFor says "open") it opens the sheet. */
  function onCta(e: Event) {
    e.stopPropagation();
    const kind = clientCtaMessageKind(c);
    if (clientCtaAction(c) === "open" || !kind || nudge.kind === "open") {
      return onOpenCard(c.id);
    }
    const href = messageHref(
      c,
      tFor(lang, `clientsBoard.msg.${kind}`, {
        name: c.name.trim().split(/\s+/)[0] ?? c.name,
        amount: balance.text,
      }),
    );
    if (href) globalThis.location.href = href;
    else onOpenCard(c.id);
  }

  function onCardClick(e: Event) {
    const target = e.target as HTMLElement;
    if (target.closest(".ccard2__foot") || target.closest(".ccard2__panel")) {
      return;
    }
    if (!isOpen) onOpen();
  }

  const styleStr = `--mood-from:${mood.from};` +
    `--mood-to:${mood.to};` +
    `--mood-shadow:${mood.shadow};` +
    `--mood-status:${mood.statusFg};` +
    `animation-delay:${idx * 35}ms`;

  return (
    <div
      class={`ccard2 ${isOpen ? "ccard2--open" : ""}`}
      data-customer-id={c.id}
      style={styleStr}
      onClick={onCardClick}
    >
      <div class="ccard2__mood">
        <div class="ccard2__mood-tex" />
        <SinceBadge days={c.daysSinceContact} lang={lang} />
        <div class="ccard2__status">
          <span class="ccard2__status-dot" /> {mood.label}
        </div>
        {c.vip && (
          <div class="ccard2__crown">
            <I d={ICN.crown} size={13} sw={2.5} />
          </div>
        )}
      </div>
      <div class="ccard2__av">{initials}</div>
      <div class="ccard2__body">
        <h3 class="ccard2__name">
          {c.name}
          {disambig && (
            /* REQ-390 (M18): two "Bob" cards are told apart on their faces */
            <span
              class="ccard2__disambig"
              data-cy="ccard2-disambig"
              style="margin-left:6px;font-size:0.6em;font-weight:600;opacity:0.65;white-space:nowrap"
            >
              {disambig}
            </span>
          )}
        </h3>
        {c.businessName && <div class="ccard2__biz">{c.businessName}</div>}
        <div class="ccard2__seg">
          {seg && (
            <>
              <span>{seg}</span>
              <span class="ccard2__seg-dot" />
            </>
          )}
          {/* REQ-367: worded here, in the live language, from the timestamp */}
          <span>{lastWhenFor(c, lang)}</span>
        </div>
        <p class="ccard2__story">{story}</p>
        {subs.length > 0 && (
          /* REQ-145: the count on the face; the panel lists them */
          <div
            class="ccard2__biz"
            data-cy="ccard2-subs-count"
            style="margin-top:6px"
          >
            <I d={ICN.repeat} size={12} sw={2.2} /> {tFor(
              lang,
              subs.length === 1
                ? "clientsBoard.subsCount.one"
                : "clientsBoard.subsCount.other",
              { n: subs.length },
            )}
          </div>
        )}
      </div>
      <div class="ccard2__foot">
        {
          /* REQ-626: the nudge does what it says (onCta) — a pre-filled text
            (else mail) to the customer; "Open card" (or nowhere to send)
            opens the client's sheet. REQ-277 AMENDMENT — reconciled with
            develop on demo-fixes. */
        }
        <button
          class="ccard2__nudge"
          type="button"
          onClick={onCta}
          data-cy="ccard2-nudge"
        >
          {cta} <span class="ccard2__nudge-arrow">→</span>
        </button>
        <div class="ccard2__bal-wrap">
          <div class="ccard2__bal-lbl">
            {tFor(lang, "clientsBoard.balance")}
          </div>
          <div class={`ccard2__bal-val ${balance.cls}`}>{balance.text}</div>
        </div>
      </div>

      {
        /* REQ-419 (demo-loop cycle 2, S7c): the closed back is only faded
          out, so it leaves the accessibility tree and the tab order too */
      }
      <div
        class="ccard2__panel"
        aria-hidden={isOpen ? undefined : "true"}
        inert={!isOpen}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="ccard2__panel-head">
          <div class="ccard2__panel-av">{initials}</div>
          <div style="min-width:0;flex:1">
            <div class="ccard2__panel-name">{c.name}</div>
            {c.businessName && (
              <div class="ccard2__panel-biz">{c.businessName}</div>
            )}
            <div class="ccard2__panel-seg">
              {/* REQ-323: the customer's own number, "C-001" */}
              {c.number && <span data-cy="ccard2-number">{c.number} ·</span>}
              {seg ? `${seg} · ` : ""}
              {mood.label}
            </div>
          </div>
          <button
            class="ccard2__panel-x"
            type="button"
            onClick={onClose}
            aria-label={tFor(lang, "common.close")}
          >
            <I d={ICN.x} size={14} sw={2.5} />
          </button>
        </div>
        {
          /* REQ-600 (demo-loop cycle 4, M5): every contact row is always
            there and edits in place — a name-only customer (Field → Add
            task) gets a phone or an email here, so its invoices can go out */
        }
        <div class="ccard2__panel-rows">
          <EditRow
            field="phone"
            icon={ICN.phone}
            label={tFor(lang, "clientsBoard.panel.phone")}
            addLabel={tFor(lang, "clientsBoard.panel.addPhone")}
            value={c.phoneNumber ?? ""}
            /* One phone formatter everywhere: the dial href is always
               normalized to tel:+1…, the label always reads
               "+1 (512) 555-3150" (P-64). */
            display={c.phoneNumber ? formatPhoneDisplay(c.phoneNumber) : ""}
            href={c.phoneNumber ? telHref(c.phoneNumber) : undefined}
            inputType="tel"
            customerId={c.id}
            onSaved={onSaved}
            lang={lang}
          />
          <EditRow
            field="email"
            icon={ICN.mail}
            label={tFor(lang, "clientsBoard.panel.email")}
            addLabel={tFor(lang, "clientsBoard.panel.addEmail")}
            value={c.email ?? ""}
            display={c.email ?? ""}
            href={c.email ? `mailto:${c.email}` : undefined}
            inputType="email"
            customerId={c.id}
            onSaved={onSaved}
            lang={lang}
          />
          <EditRow
            field="address"
            icon={ICN.pin}
            label={tFor(lang, "clientsBoard.panel.address")}
            addLabel={tFor(lang, "clientsBoard.panel.addAddress")}
            value={c.address?.trim() ? c.address : ""}
            display={address}
            inputType="text"
            customerId={c.id}
            onSaved={onSaved}
            lang={lang}
          />
          {/* REQ-715 (demo-loop cycle 5, m31): the language they read */}
          <LanguageRow
            customerId={c.id}
            value={c.language}
            onSaved={onSaved}
            lang={lang}
          />
        </div>
        {/* REQ-145: every subscription of this customer, each a link to the field page */}
        {/* REQ-743 (cycle 5, p18-6c): no empty panel on a project trade's customer */}
        {repeatVisitsPanelShown(subs.length, tradeKind) && (
          <div
            class="ccard2__panel-rows"
            data-cy="ccard2-subs"
            style="margin-top:8px;max-height:150px;overflow-y:auto"
          >
            <div class="ccard2__panel-row" style="pointer-events:none">
              <span class="ccard2__panel-row-icon">
                <I d={ICN.repeat} size={13} sw={2.2} />
              </span>
              <span class="ccard2__panel-row-text">
                <div class="ccard2__panel-row-lbl">
                  {tFor(lang, "clientsBoard.panel.subs")}
                  {subs.length ? ` · ${subs.length}` : ""}
                </div>
                {subs.length === 0 && (
                  <div class="ccard2__panel-row-val">
                    {tFor(lang, "clientsBoard.panel.subsNone")}
                  </div>
                )}
              </span>
            </div>
            {subs.map((s) => (
              <a
                class="ccard2__panel-row"
                href="/field/subscriptions"
                key={s.id}
                data-cy="ccard2-sub"
                title={tFor(lang, "clientsBoard.panel.subsOpen")}
              >
                <span class="ccard2__panel-row-icon">
                  <I d={ICN.pin} size={13} sw={2.2} />
                </span>
                <span class="ccard2__panel-row-text">
                  <div class="ccard2__panel-row-lbl">
                    {/* REQ-699: a signed quote's "Monthly · $180/mo" */}
                    {s.billing?.[lang] ?? s.schedule[lang]} · {s.active
                      ? tFor(lang, "field.subs.active")
                      : tFor(lang, "field.subs.paused")}
                  </div>
                  <div class="ccard2__panel-row-val">
                    {s.billing
                      ? [s.address, s.quoteNumber].filter(Boolean).join(" · ")
                      : (
                        <>
                          {s.address} · {fmtMoneyExact(perVisitCents(s))}{" "}
                          {tFor(lang, "clientsBoard.panel.perVisit")}
                        </>
                      )}
                  </div>
                </span>
                <span class="ccard2__panel-row-arrow">
                  <I d={ICN.arrow} size={12} sw={2.4} />
                </span>
              </a>
            ))}
          </div>
        )}
        {
          /* REQ-323 (demo-loop cycle 1, m20): every quote and invoice of this
            customer, each a link to the page that opens it */
        }
        <div
          class="ccard2__panel-rows"
          data-cy="ccard2-docs"
          style="margin-top:8px;max-height:150px;overflow-y:auto"
        >
          <div class="ccard2__panel-row" style="pointer-events:none">
            <span class="ccard2__panel-row-icon">
              <I d={ICN.doc} size={13} sw={2.2} />
            </span>
            <span class="ccard2__panel-row-text">
              <div class="ccard2__panel-row-lbl">
                {tFor(lang, "clientsBoard.panel.docs")}
                {c.documents.length ? ` · ${c.documents.length}` : ""}
              </div>
              {c.documents.length === 0 && (
                <div class="ccard2__panel-row-val">
                  {tFor(lang, "clientsBoard.panel.docsNone")}
                </div>
              )}
            </span>
          </div>
          {c.documents.map((d) => (
            <a
              class="ccard2__panel-row"
              href={d.url}
              key={`${d.kind}-${d.id}`}
              data-cy="ccard2-doc"
              title={tFor(lang, "clientsBoard.panel.docOpen")}
            >
              <span class="ccard2__panel-row-icon">
                <I
                  d={d.kind === "invoice"
                    ? ICN.invoice
                    : d.kind === "change_order" // REQ-565 (demo m33)
                    ? ICN.pencil
                    : ICN.quote}
                  size={13}
                  sw={2.2}
                />
              </span>
              <span class="ccard2__panel-row-text">
                <div class="ccard2__panel-row-lbl">
                  {tFor(lang, `clientsBoard.doc.${d.kind}`)} ·{" "}
                  {tFor(lang, `clientsBoard.docState.${d.state}`)}
                </div>
                <div class="ccard2__panel-row-val">
                  {d.number} · {d.kind === "change_order"
                    ? `${d.amountCents < 0 ? "−" : "+"}${
                      fmtMoneyExact(Math.abs(d.amountCents))
                    }`
                    : fmtMoneyExact(d.amountCents)}
                  {
                    /* REQ-565 (demo m33): the quote at its agreed total, and
                      what its approved change orders added */
                  }
                  {d.kind === "quote" && d.changeOrdersCents
                    ? ` · ${
                      tFor(lang, "clientsBoard.doc.inclChangeOrders", {
                        amount: `${d.changeOrdersCents < 0 ? "−" : "+"}${
                          fmtMoneyExact(Math.abs(d.changeOrdersCents))
                        }`,
                      })
                    }`
                    : ""}
                </div>
              </span>
              <span class="ccard2__panel-row-arrow">
                <I d={ICN.arrow} size={12} sw={2.4} />
              </span>
            </a>
          ))}
        </div>
        {
          /* REQ-277 (M31): Message texts (else mails) the customer; REQ-626:
            with no contact on file it opens the edit form so one can be
            added, and Open card opens the client's sheet. */
        }
        <div class="ccard2__panel-actions">
          {msgHref
            ? (
              <a
                class="ccard2__panel-act"
                data-cy="ccard2-message"
                href={msgHref}
                style="text-decoration:none"
              >
                <I d={ICN.msg} size={12} sw={2.4} />{" "}
                {tFor(lang, "clientsBoard.panel.message")}
              </a>
            )
            : (
              <button
                class="ccard2__panel-act"
                type="button"
                data-cy="ccard2-message"
                title={tFor(lang, "clientSheet.noContact")}
                onClick={() => onEdit(c)}
              >
                <I d={ICN.msg} size={12} sw={2.4} />{" "}
                {tFor(lang, "clientsBoard.panel.message")}
              </button>
            )}
          <button
            class="ccard2__panel-act ccard2__panel-act--pink"
            type="button"
            data-cy="ccard2-open"
            onClick={() => onOpenCard(c.id)}
          >
            <I d={ICN.eye} size={12} sw={2.4} />{" "}
            {tFor(lang, "clientsBoard.panel.openCard")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface BoardProps {
  /** the page's cards, as the API cut them (REQ-135) */
  cards: CustomerCard[];
  /** the chip counts the API counted over the search */
  counts: Record<FilterId, number>;
  /** no customers on the books at all (the empty-roster copy, not "no matches") */
  rosterEmpty: boolean;
  filter: FilterId;
  onFilter: (f: FilterId) => void;
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  children?: ComponentChildren;
  lang?: "en" | "es";
  /** REQ-145 — the account's subscriptions by customer id */
  subsByCustomer?: Map<string, SubscriptionView[]>;
  /** REQ-743 — the business's trade kind (from its name); "project" when unknown */
  tradeKind?: TradeKind;
  /** REQ-600: a card saved a contact field — reload the page's cards */
  onCustomerSaved?: () => void;
  /** REQ-626 — open the client's sheet */
  onOpenCard?: (id: string) => void;
  /** REQ-625 — open the edit form */
  onEdit?: (c: CustomerCard) => void;
}

export default function ClientsBoard(
  {
    cards,
    counts,
    rosterEmpty,
    filter,
    onFilter,
    page,
    totalPages,
    onPage,
    children,
    lang = "en",
    subsByCustomer,
    tradeKind = "project",
    onCustomerSaved,
    onOpenCard = () => {},
    onEdit = () => {},
  }: BoardProps,
) {
  // REQ-600 (cycle 4, M5): /customers?open=<id> opens that customer's card —
  // the batch send's "Add an email or phone" fix links here
  const [openId, setOpenId] = useState<string | null>(() =>
    typeof globalThis.location === "undefined"
      ? null
      : openIdFromSearch(globalThis.location.search)
  );
  const [linkedId] = useState(openId);
  const linkedOnPage = !!linkedId && cards.some((c) => c.id === linkedId);
  useEffect(() => {
    if (!linkedOnPage || typeof document === "undefined") return;
    document.querySelector(`[data-customer-id="${CSS.escape(linkedId!)}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [linkedOnPage]);
  // REQ-626: the sort button sorts — the API's A–Z, or warmest first (this page)
  const [sortBy, setSortBy] = useState<"name" | "warmth">("name");

  useEffect(() => {
    if (!openId) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest(".ccard2")) return;
      // REQ-432 (m29, m40): the topbar's EN/ES, the sidebar, the demo pill are not "outside"
      if (isChromeClick(target)) return;
      setOpenId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenId(null);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  // REQ-135 — the rows ARE the page: the API searched, filtered and cut them
  const rows = sortBy === "warmth"
    ? [...cards].sort((a, b) => (b.temp ?? 0) - (a.temp ?? 0))
    : cards;
  // REQ-390 (M18): same-name cards on this page carry a short tag
  const disambigs = cardDisambiguators(rows);

  return (
    <>
      {/* REQ-799: no search box here — the topbar search is the one search */}
      <div class="ctoolbar2">
        <div class="ctoolbar2__filters">
          {FILTER_DEFS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                class={`ctoolbar2__filter ${
                  active ? "ctoolbar2__filter--active" : ""
                }`}
                onClick={() => onFilter(f.id)}
              >
                {tFor(lang, f.labelKey)}
                <span class="ctoolbar2__filter-count">
                  {counts[f.id]}
                </span>
              </button>
            );
          })}
        </div>
        <button
          class="ctoolbar2__sort"
          type="button"
          data-cy="clients-sort"
          aria-label={tFor(lang, "clientsBoard.sort.toggle")}
          onClick={() => setSortBy((s) => (s === "name" ? "warmth" : "name"))}
        >
          {sortBy === "name"
            ? tFor(lang, "clientsBoard.sort.name")
            : tFor(lang, "clientsBoard.sort.warmth")}{" "}
          <I d={<path d="m6 9 6 6 6-6" />} size={12} sw={2.5} />
        </button>
        {/* REQ-208: the customers export carries numbers, contacts, documents and balances */}
        <a
          class="ctoolbar2__sort"
          data-cy="clients-export"
          href="/api/customers/export.csv"
          style="text-decoration:none"
        >
          {tFor(lang, "export.customers")}
        </a>
      </div>

      <div class="clay2">
        <div class="clay2__main">
          <div class="ccards2">
            {rows.map((c, i) => (
              <ClientCard
                key={c.id}
                c={c}
                subs={subsByCustomer?.get(c.id) ?? []}
                tradeKind={tradeKind}
                idx={i}
                isOpen={openId === c.id}
                onOpen={() => setOpenId(c.id)}
                onClose={() => setOpenId(null)}
                onOpenCard={(id) => {
                  setOpenId(null);
                  onOpenCard(id);
                }}
                onEdit={(x) => {
                  setOpenId(null);
                  onEdit(x);
                }}
                lang={lang}
                disambig={disambigs.get(c.id)}
                onSaved={() => onCustomerSaved?.()}
              />
            ))}
            {rows.length === 0 && (
              <div class="ccards2__empty">
                {rosterEmpty
                  ? tFor(lang, "clientsBoard.empty.noClients")
                  : tFor(lang, "clientsBoard.empty.noMatches")}
              </div>
            )}
          </div>
          {
            /* REQ-135 — the pager: one page at a time from the API.
              REQ-419 (cycle 2, p13-k): only when there is a second page, and
              below the grid, never in the cell beside a card */
          }
          {!rosterEmpty && totalPages > 1 && (
            <nav class="cpager" data-cy="clients-pager" aria-label="pages">
              <button
                type="button"
                class="cpager__btn"
                data-cy="clients-prev"
                disabled={page <= 1}
                onClick={() =>
                  onPage(page - 1)}
              >
                ← {tFor(lang, "clientsBoard.prev")}
              </button>
              <span class="cpager__where" data-cy="clients-page">
                {tFor(lang, "clientsBoard.page", { page, pages: totalPages })}
              </span>
              <button
                type="button"
                class="cpager__btn"
                data-cy="clients-next"
                disabled={page >= totalPages}
                onClick={() =>
                  onPage(page + 1)}
              >
                {tFor(lang, "clientsBoard.next")} →
              </button>
            </nav>
          )}
        </div>
        <div class="cside2">
          {children}
        </div>
      </div>
    </>
  );
}
