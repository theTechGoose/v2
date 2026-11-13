/**
 * REQ-213 / REQ-216 — "Pay by card" on the public invoice: the CRM's pay card, WHOLE (ppwk-crm
 * `pages/charge` — the card, its motion, its fields, its submit), branded with the business and
 * charged on the business's own gateway through a *provider* (REQ-216: "stripe" first).
 *
 *   The card (REQ-216): one character per cell, and a cell that changes slides in; the focus
 *   ring glides onto the number / name / expiry zone as the matching field takes focus; the
 *   number masks (`4242 **** **** 4242`) whenever its field is not focused; the brand mark fades
 *   up; the CVV band fills one `*` per digit; the card flips while the CVC has focus; the
 *   business's logo is printed into the malachite art as the issuer mark, placed by data.
 *
 *   The money (REQ-213): the card details go from this browser straight to the provider with
 *   the business's publishable key — never to this app's server; the server then charges the
 *   invoice's balance on the business's secret key (`POST /api/invoices/:id/card`); a card that
 *   needs 3-D Secure runs the provider's challenge and the server re-reads the intent
 *   (`/card/complete`). With a fake key (REQ-212) `apiBase` is the in-process fake.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { type Lang, tFor } from "../lib/i18n.ts";
import { Icon } from "../components/ui/Icon.tsx"; // REQ-366
import { fmtMoneyExact } from "../lib/format.ts";
import {
  brandOf,
  type CardDraft,
  cardDraftValid,
  type CardField,
  type CardPayDecision,
  cardPayDecision,
  cvcLengthFor,
  digitsOf,
  formatCardNumber,
  formatExpiry,
  paymentMethodForm,
} from "../../shared/payments/card-entry.ts";
import {
  changedCells,
  expiryParts,
  focusOutlineStyle,
  focusZoneFor,
  holderCells,
  markAnchorOf,
  markStyle,
  numberCells,
} from "../../shared/payments/pay-card.ts";

export interface CardConfig {
  available: boolean;
  /** REQ-216 — the gateway the widget is configured with; the server names it */
  provider?: "stripe";
  publishableKey?: string;
  mode?: "test" | "live";
  fake?: boolean;
  apiBase?: string;
  merchantName?: string;
  logoUrl?: string | null;
  /** the issuer mark's placement (CRM REQ-033): optional, the card's own when absent */
  markAnchor?: string;
  markSize?: number;
  markOpacity?: number;
  amountCents?: number;
  currency?: string;
  version?: number;
}

const BRAND_LOGO: Record<string, string> = {
  visa: "/paycard/visa.png",
  mastercard: "/paycard/mastercard.png",
  amex: "/paycard/amex.png",
  discover: "/paycard/discover.png",
};
const CHIP_SRC = "/paycard/chip.png";
/** the CRM's clean art (its other sets carry a watermark and are not shipped) */
const CARD_ART = "/paycard/backgrounds/malachite.jpg";

// ---- the provider: how a card becomes a token, how a challenge runs (REQ-216) ------------
interface CardProvider {
  /** the card → the gateway, with the business's publishable key; never this app */
  tokenize(
    cfg: CardConfig,
    draft: CardDraft,
  ): Promise<{ id: string } | { error: string }>;
  /** a charge that needs the payer (3-D Secure): run the gateway's challenge in this browser */
  nextAction(
    cfg: CardConfig,
    clientSecret: string,
  ): Promise<{ error?: string }>;
}

let stripeJs: Promise<unknown> | undefined;
function loadStripeJs(
  publishableKey: string,
): Promise<
  {
    handleNextAction(
      o: { clientSecret: string },
    ): Promise<{ error?: { message?: string } }>;
  }
> {
  stripeJs ??= new Promise((resolve, reject) => {
    const g = globalThis as unknown as { Stripe?: (k: string) => unknown };
    if (g.Stripe) return resolve(g.Stripe(publishableKey));
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.onload = () =>
      resolve(
        (globalThis as unknown as { Stripe: (k: string) => unknown }).Stripe(
          publishableKey,
        ),
      );
    s.onerror = () => reject(new Error("stripe.js failed to load"));
    document.head.appendChild(s);
  });
  return stripeJs as Promise<
    {
      handleNextAction(
        o: { clientSecret: string },
      ): Promise<{ error?: { message?: string } }>;
    }
  >;
}

const PROVIDERS: Record<"stripe", CardProvider> = {
  stripe: {
    async tokenize(cfg, draft) {
      const apiBase = cfg.apiBase ?? "https://api.stripe.com";
      const tok = await fetch(`${apiBase}/v1/payment_methods`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.publishableKey ?? ""}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: paymentMethodForm(draft).toString(),
      });
      const pm = await tok.json().catch(() => ({})) as {
        id?: string;
        error?: { message?: string };
      };
      if (!tok.ok || !pm.id) return { error: pm.error?.message ?? "" };
      return { id: pm.id };
    },
    async nextAction(cfg, clientSecret) {
      const stripe = await loadStripeJs(cfg.publishableKey ?? "");
      const r = await stripe.handleNextAction({ clientSecret });
      return r.error ? { error: r.error.message ?? "" } : {};
    },
  },
};

// ---- the card: a projection of the draft, cell by cell (ppwk-crm pay-card) --------------
function PayCard(
  {
    cardRef,
    cells,
    holder,
    month,
    year,
    cvvLength,
    brand,
    focusStyle,
    focusOn,
    flipped,
    logoUrl,
    markAnchor,
    markStyleStr,
    lang,
  }: {
    cardRef: { current: HTMLDivElement | null };
    cells: string[];
    holder: string[];
    month: string;
    year: string;
    cvvLength: number;
    brand: string;
    focusStyle: string;
    focusOn: boolean;
    flipped: boolean;
    logoUrl?: string | null;
    markAnchor: string;
    markStyleStr: string;
    lang: Lang;
  },
) {
  const hide = (e: Event) => {
    (e.currentTarget as HTMLElement).style.display = "none";
  };
  const hasHolder = holder.some((c) => c !== "");
  return (
    <div
      ref={cardRef}
      class={`pc-card${flipped ? " pc-card--active" : ""}`}
      aria-hidden="true"
    >
      <div class="pc-card__side pc-card__side--front">
        <div
          data-pc="focus"
          class={`pc-card__focus${
            focusOn && focusStyle ? " pc-card__focus--active" : ""
          }`}
          style={focusStyle}
        />
        <div class="pc-card__cover">
          <img src={CARD_ART} class="pc-card__bg" alt="" onError={hide} />
          {/* the issuer mark is PRINTED INTO the art (CRM REQ-014/033) */}
          {logoUrl
            ? (
              <img
                class="pc-card__brand"
                src={logoUrl}
                alt=""
                data-anchor={markAnchor}
                style={markStyleStr}
                onError={hide}
              />
            )
            : null}
        </div>
        <div class="pc-card__wrapper">
          <div class="pc-card__top">
            <img src={CHIP_SRC} class="pc-card__chip" alt="" onError={hide} />
            {brand !== "none"
              ? (
                <div class="pc-card__type pc-fade-up" key={brand}>
                  <img
                    class="pc-card__typeImg"
                    alt=""
                    src={BRAND_LOGO[brand]}
                    onError={hide}
                  />
                </div>
              )
              : null}
          </div>
          <label data-pc="number" class="pc-card__number">
            {cells.map((c, i) => (
              <span
                key={i}
                class="pc-card__numberItem"
                data-pc-cell
                data-idx={i}
              >
                {c}
              </span>
            ))}
          </label>
          <div class="pc-card__content">
            <label data-pc="name" class="pc-card__info">
              <div class="pc-card__holder">
                {tFor(lang, "publicCardPay.cardHolder")}
              </div>
              {hasHolder
                ? (
                  <div class="pc-card__name">
                    {holder.map((c, i) => (
                      <span
                        key={i}
                        class="pc-card__nameItem"
                        data-pc-cell
                        data-idx={i}
                      >
                        <span>{c}</span>
                      </span>
                    ))}
                  </div>
                )
                : (
                  <span data-name-placeholder>
                    {tFor(lang, "publicCardPay.fullName")}
                  </span>
                )}
            </label>
            <div data-pc="date" class="pc-card__date">
              <label class="pc-card__dateTitle">
                {tFor(lang, "publicCardPay.expires")}
              </label>
              <label class="pc-card__dateItem" data-pc-cell>{month}</label>
              /
              <label class="pc-card__dateItem" data-pc-cell>{year}</label>
            </div>
          </div>
        </div>
      </div>
      <div class="pc-card__side pc-card__side--back">
        <div class="pc-card__cover">
          <img src={CARD_ART} class="pc-card__bg" alt="" onError={hide} />
        </div>
        <div class="pc-card__band" />
        <div class="pc-card__cvv">
          <div class="pc-card__cvvTitle">{tFor(lang, "publicCardPay.cvv")}</div>
          <div class="pc-card__cvvBand">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} hidden={cvvLength < n}>*</span>
            ))}
          </div>
          {brand !== "none"
            ? (
              <div class="pc-card__type">
                <img
                  class="pc-card__typeImg"
                  alt=""
                  src={BRAND_LOGO[brand]}
                  onError={hide}
                />
              </div>
            )
            : null}
        </div>
      </div>
    </div>
  );
}

// ---- a field: the CRM's float-input — the label is a tab on the field; while the field is
// wrong the message IS the label (CRM REQ-019) --------------------------------------------
function Field(
  { id, label, error, invalid, input }: {
    id: string;
    label: string;
    error?: string;
    invalid: boolean;
    input: preact.JSX.Element;
  },
) {
  return (
    <div class="pc-field">
      <div class="pc-field-shell">
        <div class="pc-field-box">
          {input}
          <label
            for={id}
            class={`pc-field-label${invalid ? " pc-field-label--error" : ""}`}
            data-label={label}
          >
            {invalid && error ? error : label}
          </label>
          <div
            class={`pc-field-err-icon${invalid ? "" : " pc-hidden"}`}
            aria-hidden="true"
          >
            <svg
              class="pc-field-err-icon-svg"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fill-rule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clip-rule="evenodd"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PublicCardPay(
  { invoiceId, config, lang = "en" }: {
    invoiceId: string;
    config: CardConfig;
    lang?: Lang;
  },
) {
  const provider = PROVIDERS[config.provider ?? "stripe"];
  const merchant = config.merchantName ?? "";
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [focused, setFocused] = useState<CardField | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<CardField | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [amount, setAmount] = useState(config.amountCents ?? 0);
  const [version, setVersion] = useState(config.version);
  const [paid, setPaid] = useState<number | undefined>(undefined);
  const [focusStyle, setFocusStyle] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const prevCells = useRef<string[] | undefined>(undefined);

  const digits = digitsOf(number);
  const brand = brandOf(digits);
  const masked = focused !== "number";
  const cells = numberCells(digits, brand, masked);
  const holderCellList = holderCells(holder.trim());
  const { month, year } = expiryParts(expiry);
  const flipped = focused === "cvc";
  const zone = focusZoneFor(focused);
  const draft: CardDraft = { number, holder, expiry, cvc };

  // REQ-216 — per-cell entry animation: after each render, any cell whose text changed gets
  // the class and drops it on animationend, so the next change can re-fire it (the CRM's
  // scheduleCardAnim; the DOM is the source of truth)
  const snapshot = [...cells, ...holderCellList, month, year].join("\u0001");
  useEffect(() => {
    const root = cardRef.current;
    if (!root) return;
    const raf = requestAnimationFrame(() => {
      const spans = [...root.querySelectorAll<HTMLElement>("[data-pc-cell]")];
      const now = spans.map((s) => s.textContent ?? "");
      for (const i of changedCells(prevCells.current, now)) {
        const span = spans[i];
        const cls = span.classList.contains("pc-card__nameItem")
          ? "pc-anim-holder-fade-up"
          : "pc-anim-slide-fade-up";
        span.classList.remove(cls);
        void span.offsetWidth; // restart the animation on a span that is already animating
        span.classList.add(cls);
        span.addEventListener(
          "animationend",
          () => span.classList.remove(cls),
          {
            once: true,
          },
        );
      }
      prevCells.current = now;
    });
    return () => cancelAnimationFrame(raf);
  }, [snapshot]);

  // REQ-216 — the focus ring glides onto the zone: transform only, off the card-sized host
  // box; the very first placement does not travel (the CRM's scheduleFocusOutline)
  useEffect(() => {
    const root = cardRef.current;
    if (!root || zone === "none") return;
    const raf = requestAnimationFrame(() => {
      const target = root.querySelector<HTMLElement>(`[data-pc="${zone}"]`);
      if (!target) return;
      const c = root.getBoundingClientRect();
      const z = target.getBoundingClientRect();
      setFocusStyle((prev) => focusOutlineStyle(c, z, prev === ""));
    });
    return () => cancelAnimationFrame(raf);
  }, [zone, snapshot]);

  function markPaid(charged: number) {
    setPaid(charged);
    // the SSR chrome outside this island follows without a reload (UX-35's rule): the badge
    // reads paid and the manual "I sent it" methods are put away
    try {
      const pill = document.querySelector<HTMLElement>("[data-status-pill]");
      if (pill) {
        pill.textContent = tFor(lang, "status.paid");
        pill.style.background = "rgba(81,152,67,0.15)";
        pill.style.color = "#519843";
      }
      const wrap = document.querySelector<HTMLElement>("[data-claim-wrap]");
      if (wrap) wrap.hidden = true;
    } catch { /* decorative */ }
  }

  async function settle(
    decision: CardPayDecision,
    charged: number,
  ): Promise<void> {
    switch (decision.kind) {
      case "paid":
        markPaid(charged);
        return;
      case "already_paid":
        markPaid(0);
        return;
      case "declined":
        setError(decision.message || tFor(lang, "publicCardPay.declined"));
        return;
      case "stale_balance":
        setAmount(decision.balanceCents);
        if (typeof decision.version === "number") setVersion(decision.version);
        setError(
          tFor(lang, "publicCardPay.stale", {
            amount: fmtMoneyExact(decision.balanceCents),
          }),
        );
        try {
          const amt = document.querySelector<HTMLElement>(
            "[data-cy='invoice-balance-due']",
          );
          if (amt) amt.textContent = fmtMoneyExact(decision.balanceCents);
        } catch { /* decorative */ }
        return;
      case "requires_action": {
        const r = await provider.nextAction(config, decision.clientSecret);
        if (r.error !== undefined) {
          setError(r.error || tFor(lang, "publicCardPay.err.failed"));
          return;
        }
        const res = await fetch(`/api/invoices/${invoiceId}/card/complete`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paymentIntentId: decision.paymentIntentId }),
        });
        const next = cardPayDecision(
          res.status,
          await res.json().catch(() => ({})),
        );
        if (next.kind === "requires_action") {
          setError(tFor(lang, "publicCardPay.err.failed"));
          return;
        }
        return settle(next, charged);
      }
      default:
        setError(tFor(lang, "publicCardPay.err.failed"));
    }
  }

  async function pay() {
    if (busy) return;
    const v = cardDraftValid(draft);
    if (!v.ok) {
      setBad(v.field);
      setError(undefined);
      return;
    }
    setBad(undefined);
    setError(undefined);
    setBusy(true);
    try {
      // 1. the card → the provider (the business's publishable key); never this app
      const tok = await provider.tokenize(config, draft);
      if ("error" in tok) {
        setError(tok.error || tFor(lang, "publicCardPay.err.failed"));
        return;
      }
      // 2. the charge, on the business's secret key, server-side
      const charged = amount;
      const res = await fetch(`/api/invoices/${invoiceId}/card`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paymentMethodId: tok.id,
          amountCents: charged,
          ...(typeof version === "number" ? { version } : {}),
          payerName: holder.trim(),
        }),
      });
      await settle(
        cardPayDecision(res.status, await res.json().catch(() => ({}))),
        charged,
      );
    } catch {
      setError(tFor(lang, "publicCardPay.err.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (paid !== undefined) {
    return (
      <section class="cp-paid" data-cy="card-paid">
        <div class="cp__eyebrow">{tFor(lang, "publicCardPay.paid")}</div>
        <p>
          {tFor(lang, "publicCardPay.paidBody", {
            amount: fmtMoneyExact(paid),
          })}
        </p>
      </section>
    );
  }

  const focusOf = (f: CardField) => ({
    onFocus: () => setFocused(f),
    onBlur: () => setFocused((cur) => (cur === f ? undefined : cur)),
  });
  const fieldError = (f: CardField) =>
    bad === f ? tFor(lang, `publicCardPay.err.${f}`) : undefined;

  return (
    <section
      class="cp"
      data-cy="card-pay"
      data-mode={config.mode ?? ""}
      data-provider={config.provider ?? "stripe"}
    >
      <div class="cp__eyebrow">{tFor(lang, "publicCardPay.heading")}</div>
      <div class="cp-merchant" data-cy="card-merchant">
        {config.logoUrl
          ? <img src={config.logoUrl} alt="" data-cy="card-merchant-logo" />
          : (
            <span class="cp-merchant__mark" aria-hidden="true">
              <Icon name="receipt" size={18} />
            </span>
          )}
        <div>
          <b>{merchant}</b>
          <small>
            {tFor(lang, "publicCardPay.secure", {
              merchant: merchant || "the business",
            })}
          </small>
        </div>
      </div>

      <PayCard
        cardRef={cardRef}
        cells={cells}
        holder={holderCellList}
        month={month}
        year={year}
        cvvLength={digitsOf(cvc).length}
        brand={brand}
        focusStyle={focusStyle}
        focusOn={zone !== "none"}
        flipped={flipped}
        logoUrl={config.logoUrl}
        markAnchor={markAnchorOf(config.markAnchor)}
        markStyleStr={markStyle(config.markSize, config.markOpacity)}
        lang={lang}
      />

      <div class="cp-form" data-kbd-group>
        <Field
          id="cp-number"
          label={tFor(lang, "publicCardPay.number")}
          invalid={bad === "number"}
          error={fieldError("number")}
          input={
            <input
              id="cp-number"
              class={`pc-input${bad === "number" ? " pc-input--invalid" : ""}`}
              type="tel"
              inputMode="numeric"
              autocomplete="cc-number"
              placeholder="0000 0000 0000 0000"
              maxLength={19}
              value={number}
              data-cy="card-number"
              aria-invalid={bad === "number" ? "true" : "false"}
              {...focusOf("number")}
              onInput={(e) =>
                setNumber(
                  formatCardNumber((e.target as HTMLInputElement).value),
                )}
            />
          }
        />
        <Field
          id="cp-holder"
          label={tFor(lang, "publicCardPay.holder")}
          invalid={bad === "holder"}
          error={fieldError("holder")}
          input={
            <input
              id="cp-holder"
              class={`pc-input${bad === "holder" ? " pc-input--invalid" : ""}`}
              type="text"
              autocomplete="cc-name"
              placeholder={tFor(lang, "publicCardPay.fullName")}
              maxLength={30}
              value={holder}
              data-cy="card-holder"
              aria-invalid={bad === "holder" ? "true" : "false"}
              {...focusOf("holder")}
              onInput={(e) => setHolder((e.target as HTMLInputElement).value)}
            />
          }
        />
        <div class="cp-row">
          <Field
            id="cp-expiry"
            label={tFor(lang, "publicCardPay.expiry")}
            invalid={bad === "expiry"}
            error={fieldError("expiry")}
            input={
              <input
                id="cp-expiry"
                class={`pc-input${
                  bad === "expiry" ? " pc-input--invalid" : ""
                }`}
                type="tel"
                inputMode="numeric"
                autocomplete="cc-exp"
                maxLength={5}
                placeholder="MM/YY"
                value={expiry}
                data-cy="card-expiry"
                aria-invalid={bad === "expiry" ? "true" : "false"}
                {...focusOf("expiry")}
                onInput={(e) =>
                  setExpiry(formatExpiry((e.target as HTMLInputElement).value))}
              />
            }
          />
          <Field
            id="cp-cvc"
            label={tFor(lang, "publicCardPay.cvc")}
            invalid={bad === "cvc"}
            error={fieldError("cvc")}
            input={
              <input
                id="cp-cvc"
                class={`pc-input${bad === "cvc" ? " pc-input--invalid" : ""}`}
                type="tel"
                inputMode="numeric"
                autocomplete="cc-csc"
                placeholder="123"
                maxLength={cvcLengthFor(brand)}
                value={cvc}
                data-cy="card-cvc"
                aria-invalid={bad === "cvc" ? "true" : "false"}
                {...focusOf("cvc")}
                onInput={(e) =>
                  setCvc(
                    digitsOf((e.target as HTMLInputElement).value).slice(0, 4),
                  )}
              />
            }
          />
        </div>
        {error
          ? (
            <p class="charge-submit-msg" role="alert" data-cy="card-error">
              {error}
            </p>
          )
          : null}
        <button
          type="button"
          class="pay-submit-btn"
          data-cy="card-pay-submit"
          disabled={busy}
          aria-busy={busy ? "true" : "false"}
          onClick={pay}
        >
          {busy ? <span class="pay-submit-spinner" aria-hidden="true" /> : (
            <svg
              class="pay-submit-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          )}
          {busy
            ? tFor(lang, "publicCardPay.paying")
            : tFor(lang, "publicCardPay.pay", {
              amount: fmtMoneyExact(amount),
            })}
        </button>
        <p class="charge-secure-note">
          <svg
            class="charge-secure-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {tFor(lang, "publicCardPay.secureCheckout")}
          {" · "}
          {config.mode === "test" ? "TEST MODE · " : ""}Stripe
        </p>
      </div>
      <div class="cp-or">{tFor(lang, "publicCardPay.or")}</div>
    </section>
  );
}
