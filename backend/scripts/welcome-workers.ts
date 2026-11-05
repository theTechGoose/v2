/**
 * welcome-workers — REQ-154: text every existing worker of a prod account their
 * sign-in link and PIN (the REQ-151 text), for the accounts that had workers
 * before the text existed.
 *
 * Calls the secret-gated `POST /field/workers/welcome-by-owner` on prod, gated
 * exactly as `deno task wipe` (the secret from `backend/.reset.secret` or
 * RESET_SECRET; the same value set as RESET_SECRET in the prod environment).
 *
 * Usage (from backend/):
 *   deno task welcome-workers +18435551234            # the owner by phone
 *   deno task welcome-workers --business "A2Z"        # the owner by business name (one match only)
 *   deno task welcome-workers --business "A2Z" --dry-run   # list the workers, text nobody
 *   WELCOME_URL=http://localhost:5280 deno task welcome-workers …   # another target
 */
import { SITE_ORIGIN } from "#quote-flow/site-meta.ts";

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  Deno.exit(1);
}

async function readSecret(): Promise<string> {
  const fromEnv = Deno.env.get("RESET_SECRET");
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  for (const p of ["./.reset.secret", "../.reset.secret"]) {
    try {
      const v = (await Deno.readTextFile(p)).trim();
      if (v) return v;
    } catch { /* not there — try next */ }
  }
  return "";
}

const args = [...Deno.args];
const dryRun = args.includes("--dry-run");
const bi = args.indexOf("--business");
const business = bi >= 0 ? args[bi + 1] : undefined;
const phone = args.find((a, i) =>
  /\d{10}/.test(a.replace(/\D/g, "")) && i !== bi + 1
);
if (!business && !phone) fail("name the owner: a phone, or --business <name>");

const base = (Deno.env.get("WELCOME_URL") ?? SITE_ORIGIN).trim().replace(
  /\/+$/,
  "",
);
const secret = await readSecret();
if (!secret) {
  fail(
    "no RESET_SECRET — put it in backend/.reset.secret (the value set in the prod Deno Deploy env), or export RESET_SECRET.",
  );
}

const body = business ? { business, dryRun } : { phoneNumber: phone, dryRun };
console.log(
  `${
    dryRun ? "dry run" : "texting"
  } — ${base}/api/field/workers/welcome-by-owner ${JSON.stringify(body)}`,
);
const res = await fetch(`${base}/api/field/workers/welcome-by-owner`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-reset-secret": secret },
  body: JSON.stringify(body),
});
const out = await res.json().catch(() => ({})) as {
  ok?: boolean;
  error?: string;
  matches?: { phone: string; business: string }[];
  owner?: { phone: string; business?: string; name?: string; language: string };
  workers?: { name: string; phone: string; texted?: boolean }[];
};
if (!res.ok) fail(`HTTP ${res.status}: ${JSON.stringify(out)}`);
if (out.ok === false) {
  if (out.error === "forbidden") {
    fail(
      "rejected: secret mismatch (or prod has not finished deploying the endpoint).",
    );
  }
  if (out.error === "ambiguous_business") {
    fail(
      `more than one account matches: ${
        out.matches!.map((m) => `${m.business} (${m.phone})`).join(", ")
      } — name one by phone.`,
    );
  }
  fail(`rejected: ${out.error ?? "unknown error"}`);
}
const o = out.owner!;
console.log(
  `owner: ${o.name ?? "(no name)"} · ${
    o.business ?? "(no business name)"
  } · ${o.phone} · ${o.language}`,
);
if (!out.workers!.length) console.log("no workers on this account.");
for (const w of out.workers!) {
  const mark = dryRun ? "·" : w.texted ? "✓ texted" : "✖ not texted";
  console.log(`  ${mark} ${w.name} — ${w.phone}`);
}
if (!dryRun) {
  console.log(
    `✓ ${out.workers!.filter((w) => w.texted).length} of ${
      out.workers!.length
    } texted.`,
  );
}
