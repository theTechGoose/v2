/** @jsxImportSource preact */
import { render } from "npm:preact-render-to-string@6";
import { TermGrid } from "../components/doc-parts.tsx";

const labels = {
  start: "INICIO",
  estCompletion: "FIN ESTIMADO",
  termLabels: {
    start_date: "Fecha de inicio",
    wraps: "Tiempo para completar",
    payment_terms: "Plazo de pago",
    warranty: "Garantía",
  },
};
const terms = [
  { stepId: "start_date", label: "Start", value: "Right away" },
  { stepId: "wraps", label: "Time to complete", value: "2–3 days" },
  { stepId: "payment_terms", label: "Payment", value: "50/50" },
  { stepId: "warranty", label: "Warranty", value: "12 months" },
];

function rows(html: string) {
  return [...html.matchAll(/>([^<>]+)<\/div>/g)].map((m) => m[1].trim()).filter(
    Boolean,
  );
}

console.log("A) wizard start_date term present, no concrete startDate:");
console.log("   ", rows(render(<TermGrid terms={terms} lang="es" startFallback="Por agendar" labels={labels} />)).join(" | "));

console.log("\nB) no terms at all (bare agreement keeps its Start row):");
console.log("   ", rows(render(<TermGrid terms={[]} lang="es" startFallback="Por agendar" labels={labels} />)).join(" | "));

console.log("\nC) concrete startDate + wizard term (date wins, term row dropped):");
console.log("   ", rows(render(<TermGrid startDate="2026-09-01" terms={terms} lang="es" startFallback="Por agendar" labels={labels} />)).join(" | "));
