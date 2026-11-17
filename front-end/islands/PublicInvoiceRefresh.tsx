import { useEffect } from "preact/hooks";
import { startInvoiceRefresh } from "../lib/public-invoice-refresh.ts";

interface Props {
  invoiceId: string;
  /** the invoice state this page was rendered with */
  status?: string;
  version?: number;
}

/**
 * PublicInvoiceRefresh — REQ-321 (demo M14): a render-nothing island for the
 * /i/:id states that mount no claim island (the page opened already claimed).
 * It polls the public invoice and reloads the moment the server's state
 * leaves the one shown — the owner's confirm-payment reaches the open tab.
 */
export default function PublicInvoiceRefresh(
  { invoiceId, status, version }: Props,
) {
  useEffect(
    () =>
      startInvoiceRefresh({ invoiceId, shown: () => ({ status, version }) }),
    [invoiceId, status, version],
  );
  return null;
}
