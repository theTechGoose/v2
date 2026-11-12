/**
 * REQ-212 — the business connects its own Stripe in settings: the pure key rules, and the
 * settings card's wiring (status, masked secret, merchant name + logo line, disconnect).
 */
import * as fs from "fs";
import * as path from "path";
import {
  checkKeyPair,
  maskSecret,
  STRIPE_API,
  stripeApiBaseFor,
  stripeKeyInfo,
} from "../../shared/payments/stripe-keys.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-212 stripe-keys — the pure rules", () => {
  test("a key's kind and mode come from its prefix; anything else is invalid", () => {
    expect(stripeKeyInfo("pk_test_51abc")).toEqual({
      kind: "publishable",
      mode: "test",
      fake: false,
    });
    expect(stripeKeyInfo("pk_live_51abc")).toEqual({
      kind: "publishable",
      mode: "live",
      fake: false,
    });
    expect(stripeKeyInfo("sk_test_51abc")).toEqual({
      kind: "secret",
      mode: "test",
      fake: false,
    });
    expect(stripeKeyInfo("sk_live_51abc")).toEqual({
      kind: "secret",
      mode: "live",
      fake: false,
    });
    expect(stripeKeyInfo("rk_live_51abc")).toEqual({
      kind: "restricted",
      mode: "live",
      fake: false,
    });
    expect(stripeKeyInfo("  sk_test_51abc  ").kind).toBe("secret");
    expect(stripeKeyInfo("whsec_abc")).toEqual({
      kind: "invalid",
      fake: false,
    });
    expect(stripeKeyInfo("")).toEqual({ kind: "invalid", fake: false });
    expect(stripeKeyInfo("sk_test_")).toEqual({ kind: "invalid", fake: false });
  });
  test("the fake keys are the ones whose body starts with fake", () => {
    expect(stripeKeyInfo("sk_test_fake_acme")).toEqual({
      kind: "secret",
      mode: "test",
      fake: true,
    });
    expect(stripeKeyInfo("pk_test_fake_acme").fake).toBe(true);
    expect(stripeKeyInfo("sk_test_fakery").fake).toBe(false);
    expect(stripeKeyInfo("sk_live_fake_acme").fake).toBe(false);
  });
  test("a pair must be a publishable and a secret of the same mode", () => {
    expect(checkKeyPair("pk_test_a", "sk_test_b")).toEqual({
      ok: true,
      mode: "test",
      fake: false,
    });
    expect(checkKeyPair("pk_live_a", "rk_live_b")).toEqual({
      ok: true,
      mode: "live",
      fake: false,
    });
    expect(checkKeyPair("pk_test_fake_acme", "sk_test_fake_acme")).toEqual({
      ok: true,
      mode: "test",
      fake: true,
    });
    expect(checkKeyPair("pk_test_a", "sk_live_b")).toEqual({
      ok: false,
      reason: "mode_mismatch",
    });
    expect(checkKeyPair("sk_test_a", "sk_test_b")).toEqual({
      ok: false,
      reason: "publishable_invalid",
    });
    expect(checkKeyPair("pk_test_a", "pk_test_b")).toEqual({
      ok: false,
      reason: "secret_invalid",
    });
    expect(checkKeyPair("pk_test_fake_acme", "sk_test_real")).toEqual({
      ok: false,
      reason: "fake_mismatch",
    });
  });
  test("the secret is only ever shown as its last four", () => {
    expect(maskSecret("sk_test_51abcdefWXYZ")).toBe("sk_test_••••WXYZ");
    expect(maskSecret("sk_live_51abcdefWXYZ")).toBe("sk_live_••••WXYZ");
    expect(maskSecret("rk_live_51abcdefWXYZ")).toBe("rk_live_••••WXYZ");
    expect(maskSecret("")).toBe("");
  });
  test("the browser tokenizes against Stripe, or the in-process fake for fake keys", () => {
    expect(STRIPE_API).toBe("https://api.stripe.com");
    expect(stripeApiBaseFor("pk_test_51abc")).toBe("https://api.stripe.com");
    expect(stripeApiBaseFor("pk_live_51abc")).toBe("https://api.stripe.com");
    expect(stripeApiBaseFor("pk_test_fake_acme")).toBe("/api/dev/stripe");
  });
});

describe("REQ-212 the settings card", () => {
  const page = read("front-end/islands/SettingsPage.tsx");
  test("the card is on the page, under the manual methods", () => {
    expect(page).toMatch(/function CardPaymentsCard\(/);
    expect(page).toMatch(
      /<PaymentsEditCard snapshot=\{p\} onSaved=\{onSaved\} \/>\s*<CardPaymentsCard snapshot=\{p\} \/>/,
    );
  });
  test("it connects with both keys, shows the account, the mode and the masked secret, and disconnects", () => {
    expect(page).toMatch(/dataCy="stripe-card"/);
    expect(page).toMatch(/data-cy="stripe-pk"/);
    expect(page).toMatch(/data-cy="stripe-sk"[^>]*type="password"/);
    expect(page).toMatch(/data-cy="stripe-connect"/);
    expect(page).toMatch(/data-cy="stripe-status"/);
    expect(page).toMatch(/data-cy="stripe-disconnect"/);
    expect(page).toMatch(/stripeClient\.connect\(/);
    expect(page).toMatch(/stripeClient\.disconnect\(/);
    expect(page).toMatch(/stripeClient\.status\(/);
    expect(page).toMatch(/maskSecret\(/);
  });
  test("it previews the merchant: the business name and the logo, and says where the money goes", () => {
    expect(page).toMatch(/data-cy="stripe-merchant"/);
    expect(page).toMatch(/data-cy="stripe-merchant-logo"/);
    expect(page).toMatch(/settings\.stripe\.direct/);
  });
  test("the client talks to /me/stripe", () => {
    const client = read("front-end/clients/stripe.ts");
    expect(client).toMatch(/api\.get<StripeStatus>\("\/me\/stripe"/);
    expect(client).toMatch(/api\.put<StripeStatus>\("\/me\/stripe"/);
    expect(client).toMatch(/api\.delete<StripeStatus>\("\/me\/stripe"/);
  });
  test("the words exist in both languages", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const k of [
        "settings.stripe",
        "settings.stripe.intro",
        "settings.stripe.direct",
        "settings.stripe.connect",
        "settings.stripe.disconnect",
        "settings.stripe.connected",
        "settings.stripe.testMode",
        "settings.stripe.liveMode",
        "settings.stripe.merchant",
        "settings.stripe.noLogo",
        "settings.stripe.pk",
        "settings.stripe.sk",
        "settings.stripe.err.mode_mismatch",
        "settings.stripe.err.stripe_rejected",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
    }
  });
});
