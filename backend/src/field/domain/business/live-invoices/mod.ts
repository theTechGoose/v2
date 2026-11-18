/** The invoices that still bill their tasks: every non-void one, and (REQ-627)
 *  a void one whose "Void & duplicate" copy — followed to the end — still lives.
 *  REQ-924: shared by the visits batches and the customer workspace. Pure. */
import type { Invoice } from "@paperwork/dto/invoice.ts";

export const liveIds = (invoices: Pick<Invoice, "id" | "status" | "replacedBy">[]): Set<string> => {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const live = new Set<string>();
  for (const inv of invoices) {
    let cur: Pick<Invoice, "id" | "status" | "replacedBy"> | undefined = inv;
    for (let hops = 0; cur && cur.status === "void" && hops < 20; hops++) {
      cur = cur.replacedBy ? byId.get(cur.replacedBy) : undefined;
    }
    if (cur && cur.status !== "void") live.add(inv.id);
  }
  return live;
};
