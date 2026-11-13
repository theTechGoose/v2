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

/**
 * REQ-659 (demo-loop cycle 5, M14 / m53 / c1-M22) — private PRICING that
 * names no "$" amount: "Materials at cost +15%" (a markup), "85/hr labor" (a
 * rate), "My sub quoted me for the plumbing" (a sub cost whose amount the
 * scope pass already stripped). How the contractor prices is as private as
 * what things cost them. Scope words that merely look alike stay scope:
 * "Install overhead lighting", "a 2% slope", "a 1 inch margin at the wall".
 */
const PRIVATE_PRICING = new RegExp(
  [
    // a labor rate: 85/hr · 85 / hour · 85 per hour · 90 an hour · 85 por hora · 85 la hora
    String.raw`\d\s?\/\s?(?:hr|hrs|hour|h|hora)\b`,
    String.raw`\d[\d,.]*\s+(?:per|an|a|/)\s+(?:hr|hour)\b`,
    String.raw`\d[\d,.]*\s+(?:por|la|/)\s+hora\b`,
    String.raw`\b(?:hourly\s+rate|tarifa\s+por\s+hora)\b`,
    // markup / profit: "+15%", "15% markup", "markup on materials", "profit", "recargo", "ganancia"
    String.raw`\+\s?\d+(?:[.,]\d+)?\s?%`,
    String.raw`\bmark[\s-]?ups?\b`,
    String.raw`\b(?:profit|profits|recargo|ganancia|ganancias)\b`,
    String.raw`\b(?:my|our|profit)\s+margins?\b`,
    String.raw`\bmargen\s+de\s+ganancia\b|\b(?:mi|nuestro)\s+margen\b`,
    String.raw`\boverhead\s+(?:and|&|\+)\s+profit\b`,
    String
      .raw`\d+(?:[.,]\d+)?\s?%\s+(?:overhead|margin|margen|over\s+cost|on\s+top|sobre\s+(?:el\s+)?costo)\b`,
    // billed at the contractor's cost: "at cost", "cost plus", "al costo", "a precio de costo"
    String.raw`\bat\s+(?:my\s+|our\s+)?cost\b|\bcost[\s-]plus\b`,
    String.raw`\bal\s+costo\b|\ba\s+precio\s+de\s+costo\b`,
    // what the contractor pays: "my sub quoted me", "charges me", "costs me", "my cost", "me cobra", "me cuesta(n)", "mi costo"
    String
      .raw`\b(?:quoted|quotes|charges?|charged|costs?|bills?|billed)\s+(?:me|us)\b`,
    String.raw`\b(?:my|our)\s+(?:cost|costs)\b`,
    String
      .raw`\b(?:me|nos)\s+(?:cobra|cobran|cobr[oó]|cobraron|cuesta|cuestan|cost[oó]|costaron|cotiz[oó]|cotizaron)\b`,
    String.raw`\b(?:mi|nuestro)\s+costo\b`,
  ].join("|"),
  "i",
);

/** True when the line names a money amount, or the contractor's private
 *  pricing (a markup, a rate, what a sub or material costs them). */
export function mentionsMoney(line: string): boolean {
  const s = line ?? "";
  return MONEY.test(s) || PRIVATE_PRICING.test(s);
}

/**
 * REQ-659 (c1-M22): the contractor's own message with every amount masked —
 * the confirm strip echoes what was typed without re-showing a private cost.
 * Words stay, so the contractor still recognizes the message.
 */
export function redactMoney(text: string): string {
  return (text ?? "").replace(
    /\d(?:[\d,.]*\d)?/g,
    (m, at: number, all: string) => {
      const before = all.slice(Math.max(0, at - 3), at);
      const after = all.slice(at + m.length, at + m.length + 12);
      const priced = /\$\s?$|\+\s?$/.test(before) ||
        /^\s?(?:%|\/\s?(?:hr|hrs|hour|h|hora)\b|(?:usd|dollars?|d[oó]lares|pesos|bucks)\b|\s(?:per|an|por|la)\s+(?:hr|hour|hora)\b)/i
          .test(after);
      return priced ? "•••" : m;
    },
  );
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
