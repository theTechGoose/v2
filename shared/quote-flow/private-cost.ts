/**
 * REQ-261 (demo M26) — private costs never reach customer job details.
 *
 * A contractor tells the assistant what things cost THEM ("Ray the plumber is
 * $2800", "materials 1,200 dollars"). Those amounts inform the price; they are
 * never customer-facing scope. The model is told so (systemQuote/systemTerms,
 * generateJobOptions), and every LLM-written line headed for a quote's
 * `description` / `descriptionByLang` goes through this deterministic filter:
 * a line that names a money amount is dropped. The quote's price lives in its
 * line items, never in the job details.
 */

const MONEY = new RegExp(
  [
    // $2,800 · $ 300 · $4.50 · US$900
    String.raw`\$\s?\d`,
    // 2800 USD · 1,200 dollars · 900 dólares · 500 pesos · 300 bucks
    String.raw`\d[\d,.]*\s?(?:usd|dollars?|d[oó]lares|pesos|bucks)\b`,
  ].join("|"),
  "i",
);

/** True when the line names a money amount. */
export function mentionsMoney(line: string): boolean {
  return MONEY.test(line ?? "");
}

/** The lines that do not name a money amount, order kept. */
export function withoutMoneyLines(lines: string[]): string[] {
  return lines.filter((l) => !mentionsMoney(l));
}

/** A paragraph (or newline-separated bullets) with every sentence/line that
 *  names a money amount removed. Sentence ends: ". ", "! ", "? " — a decimal
 *  point inside "$4.50" is not a sentence end. */
export function withoutMoneySentences(text: string): string {
  return (text ?? "")
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !mentionsMoney(s))
        .join(" ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}
