/**
 * REQ-625 — the ONE customer form. Every "new customer" entry point renders
 * these fields (the Clients page's Add client, the new invoice's "New
 * client", the assistant's customer step — that one in its own look via
 * `variant="asst"`), and the client sheet's Edit opens the same dialog
 * prefilled, saving through PUT /customers/:id.
 *
 * Fields: name, company / business name, phone, email, street, city, state,
 * zip, notes. The address parts are sent as parts; the backend composes the
 * one `address` string every other reader uses. Phone and email checks are
 * lenient (shared/customer-form).
 *
 * Layout: inline styles only (a route <style> can die on hydration); the
 * paired rows use auto-fit grids so a 390px phone stacks them instead of
 * clipping.
 */
import { useState } from "preact/hooks";
import { clientsClient, type CustomerCard } from "../clients/clients.ts";
import { type Lang, tFor } from "../lib/i18n.ts";
import {
  customerCreatePayload,
  type CustomerFormErrors,
  customerFormFrom,
  type CustomerFormValues,
  type CustomerLike,
  customerUpdatePayload,
  emptyCustomerForm,
  formatPhoneLenient,
  validateCustomerForm,
} from "../../shared/customer-form/mod.ts";

export type { CustomerFormValues };

const LABEL =
  "display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560);min-width:0";
const INPUT =
  "padding:11px 13px;border:1px solid var(--border,#d8dcd5);border-radius:10px;font:inherit;font-size:15px;font-weight:400;color:var(--fg);width:100%;box-sizing:border-box;min-width:0;background:#fff";
const INPUT_BAD = `${INPUT};border-color:#c0504d`;
const ERR = "font-size:12px;font-weight:600;color:#a83b3b";
const PAIR =
  "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px";
const TRIO =
  "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,110px),1fr));gap:12px";
const SECTION =
  "margin:4px 0 -4px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--fg-muted,#6b7560)";

export function errorText(
  lang: Lang,
  errors: CustomerFormErrors,
  f: "name" | "phone" | "email",
) {
  const e = errors[f];
  if (!e) return null;
  if (f === "name") return tFor(lang, "customerForm.err.nameRequired");
  if (f === "phone") return tFor(lang, "customerForm.err.phoneInvalid");
  return tFor(lang, "customerForm.err.emailInvalid");
}

interface FieldsProps {
  values: CustomerFormValues;
  onChange: (patch: Partial<CustomerFormValues>) => void;
  lang: Lang;
  disabled?: boolean;
  /** shown only once the user tried to save (or for the assistant, live) */
  errors?: CustomerFormErrors;
  /** "asst": the assistant's look — its own input class, placeholders, no labels */
  variant?: "default" | "asst";
  autoFocus?: boolean;
  /** placeholder text per field (the assistant keeps its own wording) */
  placeholders?: Partial<Record<keyof CustomerFormValues, string>>;
}

/** The fields alone — for forms that own their own submit (new invoice, assistant). */
export function CustomerFields(
  {
    values,
    onChange,
    lang,
    disabled,
    errors = {},
    variant = "default",
    autoFocus,
    placeholders = {},
  }: FieldsProps,
) {
  const asst = variant === "asst";
  const val = (e: Event) => (e.target as HTMLInputElement).value;

  function field(
    f: keyof CustomerFormValues,
    cy: string,
    labelKey: string,
    opts: {
      type?: string;
      autoComplete?: string;
      placeholderKey?: string;
      bad?: string | null;
      focus?: boolean;
      required?: boolean;
    } = {},
  ) {
    const label = tFor(lang, labelKey);
    const value = f === "phone" ? formatPhoneLenient(values[f]) : values[f];
    const input = (
      <input
        type={opts.type ?? "text"}
        data-cy={cy}
        class={asst ? "cust-pick__search" : undefined}
        style={asst
          ? "min-width:0;width:100%;box-sizing:border-box"
          : opts.bad
          ? INPUT_BAD
          : INPUT}
        placeholder={placeholders[f] ??
          (asst
            ? label
            : opts.placeholderKey
            ? tFor(lang, opts.placeholderKey)
            : undefined)}
        aria-label={label}
        aria-invalid={opts.bad ? true : undefined}
        autoComplete={opts.autoComplete}
        autoFocus={opts.focus}
        required={opts.required}
        value={value}
        disabled={disabled}
        onInput={(e) =>
          onChange({ [f]: val(e) } as Partial<CustomerFormValues>)}
      />
    );
    if (asst) {
      return (
        <div style="display:flex;flex-direction:column;gap:3px;min-width:0">
          {input}
          {opts.bad && <span style={ERR}>{opts.bad}</span>}
        </div>
      );
    }
    return (
      <label style={LABEL}>
        {label}
        {input}
        {opts.bad && <span style={ERR} role="alert">{opts.bad}</span>}
      </label>
    );
  }

  const notesLabel = tFor(lang, "customerForm.notes");
  return (
    <div
      data-cy="customer-fields"
      style="display:flex;flex-direction:column;gap:12px;min-width:0"
    >
      {field("name", "cf-name", "customerForm.name", {
        autoComplete: "name",
        bad: errorText(lang, errors, "name"),
        focus: autoFocus,
        required: true,
      })}
      {field("businessName", "cf-business", "customerForm.business", {
        autoComplete: "organization",
      })}
      <div style={PAIR}>
        {field("phone", "cf-phone", "customerForm.phone", {
          type: "tel",
          autoComplete: "tel",
          bad: errorText(lang, errors, "phone"),
        })}
        {field("email", "cf-email", "customerForm.email", {
          type: "email",
          autoComplete: "email",
          bad: errorText(lang, errors, "email"),
        })}
      </div>
      {!asst && (
        <div style={SECTION}>{tFor(lang, "customerForm.addressHeading")}</div>
      )}
      {field("street", "cf-street", "customerForm.street", {
        autoComplete: "address-line1",
      })}
      <div style={TRIO}>
        {field("city", "cf-city", "customerForm.city", {
          autoComplete: "address-level2",
        })}
        {field("state", "cf-state", "customerForm.state", {
          autoComplete: "address-level1",
        })}
        {field("zip", "cf-zip", "customerForm.zip", {
          autoComplete: "postal-code",
        })}
      </div>
      {asst
        ? (
          <textarea
            data-cy="cf-notes"
            class="cust-pick__search"
            rows={2}
            style="min-width:0;width:100%;box-sizing:border-box;resize:vertical;font:inherit"
            placeholder={placeholders.notes ?? notesLabel}
            aria-label={notesLabel}
            value={values.notes}
            disabled={disabled}
            onInput={(e) =>
              onChange({ notes: (e.target as HTMLTextAreaElement).value })}
          />
        )
        : (
          <label style={LABEL}>
            {notesLabel}
            <textarea
              data-cy="cf-notes"
              rows={3}
              style={`${INPUT};resize:vertical`}
              placeholder={tFor(lang, "customerForm.notesPlaceholder")}
              value={values.notes}
              disabled={disabled}
              onInput={(e) =>
                onChange({ notes: (e.target as HTMLTextAreaElement).value })}
            />
          </label>
        )}
    </div>
  );
}

interface DialogProps {
  mode: "create" | "edit";
  lang: Lang;
  /** the customer being edited (mode="edit") */
  customer?: (CustomerLike & { id: string }) | null;
  onSaved: (saved: CustomerCard) => void | Promise<void>;
  onClose: () => void;
}

/** The modal: title, the fields, one solid Save, a ghost Cancel. */
export default function CustomerFormDialog(
  { mode, lang, customer, onSaved, onClose }: DialogProps,
) {
  const [values, setValues] = useState<CustomerFormValues>(() =>
    mode === "edit" ? customerFormFrom(customer) : emptyCustomerForm()
  );
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const errors = validateCustomerForm(values);
  const invalid = Object.keys(errors).length > 0;

  async function submit(e: Event) {
    e.preventDefault();
    setTried(true);
    if (invalid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const saved = mode === "edit" && customer
        ? await clientsClient.update(customer.id, customerUpdatePayload(values))
        : await clientsClient.create(customerCreatePayload(values));
      await onSaved(saved);
    } catch (x) {
      setErr(
        x instanceof Error && x.message
          ? x.message
          : tFor(lang, "customerForm.err.save"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={() => !busy && onClose()}
      style="position:fixed;inset:0;background:rgba(20,40,45,0.45);display:flex;align-items:flex-start;justify-content:center;z-index:1100;padding:20px 12px;overflow-y:auto"
    >
      <form
        role="dialog"
        aria-modal="true"
        data-cy="customer-form"
        data-mode={mode}
        noValidate
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style="background:#fff;border-radius:16px;padding:22px 20px;max-width:520px;width:100%;box-sizing:border-box;box-shadow:0 24px 64px rgba(20,72,82,0.22);display:flex;flex-direction:column;gap:14px;margin:auto 0"
      >
        <h2 style="margin:0;font-size:20px;font-weight:800;color:var(--fg,#144852)">
          {mode === "edit"
            ? tFor(lang, "customerForm.titleEdit")
            : tFor(lang, "customerForm.titleNew")}
        </h2>
        <CustomerFields
          values={values}
          onChange={(p) => setValues((v) => ({ ...v, ...p }))}
          lang={lang}
          disabled={busy}
          errors={tried ? errors : {}}
          autoFocus
        />
        {err && (
          <p
            role="alert"
            data-cy="cf-error"
            style="margin:0;color:#a83b3b;font-size:13.5px;font-weight:600"
          >
            {err}
          </p>
        )}
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:4px">
          <button
            type="button"
            data-cy="cf-cancel"
            disabled={busy}
            onClick={onClose}
            style="padding:10px 16px;border:0;background:transparent;color:var(--fg-muted,#6b7560);font:inherit;font-weight:700;cursor:pointer;border-radius:10px"
          >
            {tFor(lang, "common.cancel")}
          </button>
          <button
            type="submit"
            data-cy="cf-save"
            disabled={busy || !values.name.trim()}
            style="padding:10px 20px;border:0;border-radius:10px;background:var(--brand-green,#519843);color:#fff;font:inherit;font-weight:800;cursor:pointer"
          >
            {busy
              ? "…"
              : mode === "edit"
              ? tFor(lang, "customerForm.saveChanges")
              : tFor(lang, "customerForm.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

export { CustomerFormDialog };
