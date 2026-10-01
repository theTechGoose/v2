import { useEffect, useState } from "preact/hooks";
import { langSignal } from "../lib/lang.ts";
import { t } from "../lib/i18n.ts";
import { planClient } from "../clients/profile.ts";

/**
 * FakePayPage (REQ-057) — the one control of the app's stand-in pay page: "Pay with the test
 * card" settles the due on the fake link builder (the CRM client's remote control, under this
 * browser's own session — the person who picked the plan is the one who pays), then says so
 * and offers the way back to settings, where "Check payment" turns the plan active. Against
 * the real client the call answers 404 and the page says the payment did not go through.
 */
export default function FakePayPage({ customer, due }: { customer: string; due: string }) {
  const [state, setState] = useState<"idle" | "paying" | "paid" | "error">("idle");
  // the button waits for the island: the server-rendered one has no handler yet (REQ-067's rule)
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
  // read so the island re-renders on a language switch; the copy itself comes through t()
  void langSignal.value;

  async function pay() {
    if (state === "paying" || state === "paid") return;
    setState("paying");
    try {
      await planClient.fakePaid();
      setState("paid");
    } catch {
      setState("error");
    }
  }

  return (
    <div style="display:grid;gap:12px" data-cy="fake-pay-page" data-customer={customer} data-due={due}>
      <p style="margin:0;font-size:14px" data-cy="fake-pay-card">{t("payFake.card")}</p>
      {state === "paid"
        ? (
          <>
            <p role="status" style="margin:0;font-weight:700;color:var(--brand-green)" data-cy="fake-pay-paid">
              ✓ {t("payFake.paid")}
            </p>
            <a class="btn btn-primary" href="/settings" data-cy="fake-pay-back" style="text-decoration:none">
              {t("payFake.back")}
            </a>
          </>
        )
        : (
          <button type="button" class="btn btn-primary" data-cy="fake-pay" onClick={pay} disabled={!live || state === "paying"}>
            {state === "paying" ? t("payFake.paying") : t("payFake.pay")}
          </button>
        )}
      {state === "error" ? <p role="alert" style="margin:0;color:var(--danger, #b42318)">{t("payFake.error")}</p> : null}
    </div>
  );
}
