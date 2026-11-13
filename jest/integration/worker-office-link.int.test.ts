/**
 * REQ-282 — over the REAL dev stack (frontend :5280, or FRONTEND_BASE_URL):
 * demo issue customers-payments-fieldops-m2, "Worker view (/worker) has no way
 * back to the office app". The SSR'd /worker page carries the Back to office
 * link for an owner who is signed in, and not for a worker on their phone.
 */
import { contractor } from "./helpers/api";

const FE = process.env.FRONTEND_BASE_URL ?? "http://localhost:5280";

const officeLinks = (html: string) =>
  html.match(/<a[^>]*data-cy="w-office"[^>]*>[^<]*<\/a>/g) ?? [];

describe("REQ-282 /worker links back to the office only for the owner", () => {
  it("REQ-282 an owner's /worker carries one link to /field/tasks", async () => {
    const owner = await contractor("+15125550282");
    const res = await fetch(`${FE}/worker?lang=en`, {
      headers: { cookie: owner.cookieHeaderValue() },
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    const links = officeLinks(await res.text());
    expect(links).toHaveLength(1);
    expect(links[0]).toMatch(/href="\/field\/tasks"/);
    // the label is the dictionary's, not the bare key (which language the
    // SSR pass picks is the worker screen's own language rule, not REQ-282's)
    expect(links[0]).toMatch(/>(Back to office|Volver a la oficina)<\/a>$/);
  });

  it("REQ-282 a worker with no owner session sees no office link", async () => {
    const res = await fetch(`${FE}/worker?lang=en`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(officeLinks(await res.text())).toHaveLength(0);
  });
});

/**
 * REQ-417 — demo-loop cycle 2, demo issue m44: "'Volver a la oficina' always goes to /field/tasks".
 * The SSR'd link goes back to the office page the owner came from — `?from=` or a same-origin
 * Referer, allow-listed to the office's own sections — and to /field/tasks otherwise.
 */
describe("REQ-417 (m44) /worker's office link goes back where the owner came from", () => {
  const hrefOf = async (path: string, headers: Record<string, string>) => {
    const res = await fetch(`${FE}${path}`, { headers, redirect: "manual" });
    expect(res.status).toBe(200);
    const links = officeLinks(await res.text());
    expect(links).toHaveLength(1);
    return /href="([^"]*)"/.exec(links[0])?.[1];
  };

  it("REQ-417 ?from=/field/workers → the link goes back to /field/workers", async () => {
    const owner = await contractor("+15125550417");
    const cookie = owner.cookieHeaderValue();
    expect(
      await hrefOf("/worker?lang=en&from=%2Ffield%2Fworkers", { cookie }),
    ).toBe("/field/workers");
  });

  it("REQ-417 a same-origin Referer is used; an off-site one or an off-site ?from= is not", async () => {
    const owner = await contractor("+15125550418");
    const cookie = owner.cookieHeaderValue();
    const origin = new URL(FE).origin;
    expect(
      await hrefOf("/worker?lang=en", {
        cookie,
        referer: `${origin}/customers`,
      }),
    ).toBe("/customers");
    expect(
      await hrefOf("/worker?lang=en", {
        cookie,
        referer: "https://evil.example/customers",
      }),
    ).toBe("/field/tasks");
    expect(
      await hrefOf("/worker?lang=en&from=https%3A%2F%2Fevil.example%2F", {
        cookie,
      }),
    ).toBe("/field/tasks");
  });
});
