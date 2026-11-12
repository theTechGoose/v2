/**
 * REQ-399 (demo-loop cycle 2, issues M16 + M17) — the send dialog's Send.
 *
 * M16: a double-click on the dialog's Send sent the quote twice. keepAndSend
 * awaited the customer PUT before anything said "busy", and confirmSendQuote's
 * `if (sending)` read a stale closure, so both clicks PUT and both POSTed
 * /send-quote (two emails, two "emailed to" cards).
 * M17: "bob at gmail" went straight to PUT /customers, and the dialog showed
 * lib/api's transport line "PUT /customers/<id> failed: 400" verbatim.
 */
import * as fs from "fs";
import * as path from "path";
import {
  contactSaveErrorKey,
  runExclusive,
  sendDialogErrorKey,
} from "../../front-end/lib/send-dialog.ts";
import { ApiError } from "../../front-end/lib/api.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-399 M16 runExclusive: one Send in flight at a time", () => {
  it("REQ-399 a second call while the first is in flight never runs", async () => {
    const flag = { current: false };
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const send = () =>
      runExclusive(flag, async () => {
        runs++;
        await gate; // the customer PUT, still on the wire
        return "sent";
      });
    const first = send();
    const second = send(); // the double-click's second click
    expect(flag.current).toBe(true);
    release();
    expect(await first).toBe("sent");
    expect(await second).toBeUndefined();
    expect(runs).toBe(1);
    expect(flag.current).toBe(false);
  });

  it("REQ-399 the lock is released when the send throws, so a retry can go", async () => {
    const flag = { current: false };
    await expect(
      runExclusive(flag, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(flag.current).toBe(false);
    expect(await runExclusive(flag, () => Promise.resolve(1))).toBe(1);
  });
});

describe("REQ-399 M17 sendDialogErrorKey: format is checked before the PUT", () => {
  it("REQ-399 'bob at gmail' is an invalid email, not a request", () => {
    expect(
      sendDialogErrorKey("email", { name: "Bob" } as never, {
        email: "bob at gmail",
        phone: "",
      }),
    ).toBe("customer.invalidEmail");
  });
  it("REQ-399 a short phone is an invalid phone", () => {
    expect(
      sendDialogErrorKey("sms", {}, { email: "", phone: "555-12" }),
    ).toBe("customer.invalidPhone");
  });
  it("REQ-399 a missing contact still names what is missing (REQ-308)", () => {
    expect(sendDialogErrorKey("email", {}, { email: "", phone: "" })).toBe(
      "asstChat.customerStep.needEmail",
    );
  });
  it("REQ-399 a well-formed contact can go", () => {
    expect(
      sendDialogErrorKey("both", {}, {
        email: "bob@gmail.com",
        phone: "(512) 555-0123",
      }),
    ).toBeUndefined();
  });
});

describe("REQ-399 M17 contactSaveErrorKey: never the transport line", () => {
  it("REQ-399 the backend's customer.invalidEmail maps to its dictionary key", () => {
    const err = new ApiError(
      400,
      { message: "customer.invalidEmail" },
      "PUT /customers/43ce0d97 failed: 400",
    );
    expect(contactSaveErrorKey(err)).toBe("customer.invalidEmail");
  });
  it("REQ-399 customer.invalidPhone maps to its dictionary key", () => {
    const err = new ApiError(400, { message: "customer.invalidPhone" }, "x");
    expect(contactSaveErrorKey(err)).toBe("customer.invalidPhone");
  });
  it("REQ-399 anything else is the generic translated 'couldn't save the contact'", () => {
    const err = new ApiError(500, "oops", "PUT /customers/1 failed: 500");
    expect(contactSaveErrorKey(err)).toBe("asstChat.send.contactSaveFailed");
    expect(contactSaveErrorKey(new Error("network down"))).toBe(
      "asstChat.send.contactSaveFailed",
    );
  });
  it("REQ-399 every key the dialog can show is in en and es", () => {
    for (
      const k of [
        "asstChat.send.contactSaveFailed",
        "customer.invalidEmail",
        "customer.invalidPhone",
      ]
    ) {
      expect(en[k]).toBeTruthy();
      expect(es[k]).toBeTruthy();
      expect(en[k]).not.toMatch(/failed: \d/);
    }
  });
});

describe("REQ-399 AsstChat wires the dialog's Send through the guard", () => {
  const src = read("front-end/islands/AsstChat.tsx");
  const body = (name: string) => {
    const at = src.indexOf(`function ${name}(`);
    expect(at).toBeGreaterThan(-1);
    const next = src.indexOf("\n  async function ", at + 10);
    const next2 = src.indexOf("\n  function ", at + 10);
    const end = Math.min(
      ...[next, next2].filter((i) => i > -1),
    );
    return src.slice(at, end);
  };

  it("REQ-399 keepAndSend runs under the in-flight ref and sets sending before the PUT", () => {
    const k = body("keepAndSend");
    expect(k).toMatch(/runExclusive\(\s*sendInFlight/);
    const busy = k.indexOf("setSending(true)");
    const put = k.indexOf("clientsClient.update(");
    expect(busy).toBeGreaterThan(-1);
    expect(busy).toBeLessThan(put);
  });
  it("REQ-399 keepAndSend checks format first and never shows err.message", () => {
    const k = body("keepAndSend");
    expect(k).toMatch(/sendDialogErrorKey\(/);
    expect(k).toMatch(/contactSaveErrorKey\(/);
    expect(k).not.toMatch(/err\.message/);
  });
  it("REQ-399 the quote and invoice sends run only under keepAndSend's lock", () => {
    const k = body("keepAndSend");
    for (const fn of ["sendQuoteNow", "sendInvoiceSwapNow"]) {
      const calls = src.split(`${fn}(`).length - 2; // minus the definition
      expect(calls).toBeGreaterThan(0);
      expect(k.split(`${fn}(`).length - 1).toBe(calls);
      // no stale `if (sending ...)` closure guard left in the sender itself
      expect(body(fn)).not.toMatch(/if \(sending/);
    }
    expect(src).not.toMatch(/function confirmSendQuote\(/);
    expect(src).not.toMatch(/function confirmSendInvoiceSwap\(/);
  });
  it("REQ-399 the quote send carries a requestId the server dedupes on", () => {
    expect(src).toMatch(/sendQuoteFlow\([\s\S]{0,200}requestId/);
    expect(read("front-end/clients/assistant.ts")).toMatch(/requestId/);
  });
});
