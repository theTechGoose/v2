import { useEffect, useState } from "preact/hooks";
import { type Lang, tFor } from "../lib/i18n.ts";
import { planClient } from "../clients/profile.ts";
import { fakeReturnHref } from "../lib/plan-return.ts";

/**
 * FakePayPage (REQ-057) — the one control of the app's stand-in pay page: "Pay with the test
 * card" settles the due on the fake link builder (the CRM client's remote control, under this
 * browser's own session — the person who picked the plan is the one who pays), then says so
 * and offers the way back. REQ-059: the way back is the return address the link carried
 * (/plan/return, which activates the plan on arrival), as the CRM's receipt does; settings
 * when the link carried none. Against the real client the call answers 404 and the page says
 * the payment did not go through. The language is the page's (SSR), not the browser's store.
 */
export default function FakePayPage(
  { lang, customer, due, returnUrl, returnLabel }: { lang: Lang; customer: string; due: string; returnUrl: string; returnLabel: string },
) {
  const [state, setState] = useState<"idle" | "paying" | "paid" | "error">("idle");
  // the button waits for the island: the server-rendered one has no handler yet (REQ-067's rule)
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);

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
      <p style="margin:0;font-size:14px" data-cy="fake-pay-card">{tFor(lang, "payFake.card")}</p>
      {state === "paid"
        ? (
          <>
            <p role="status" style="margin:0;font-weight:700;color:var(--brand-green)" data-cy="fake-pay-paid">
              ✓ {tFor(lang, "payFake.paid")}
            </p>
            <a class="btn btn-primary" href={fakeReturnHref(returnUrl, due)} data-cy="fake-pay-back" style="text-decoration:none">
              {tFor(lang, "payFake.back", { app: returnLabel || tFor(lang, "payFake.theApp") })}
            </a>
          </>
        )
        : (
          <button type="button" class="btn btn-primary" data-cy="fake-pay" onClick={pay} disabled={!live || state === "paying"}>
            {state === "paying" ? tFor(lang, "payFake.paying") : tFor(lang, "payFake.pay")}
          </button>
        )}
      {state === "error" ? <p role="alert" style="margin:0;color:var(--danger, #b42318)">{tFor(lang, "payFake.error")}</p> : null}
    </div>
  );
}
