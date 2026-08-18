import { tFor } from "./lib/i18n.ts";
for (const l of ["en", "es"] as const) {
  console.log(l, "|", tFor(l, "publicQuote.accepted.heading"));
  console.log(l, "|", tFor(l, "publicQuote.accepted.by", { name: "Maria Delgado", date: "August 18, 2026" }));
  console.log(l, "|", tFor(l, "contractDoc.qAfter"), "/", tFor(l, "contractDoc.downloadPdf"));
}
