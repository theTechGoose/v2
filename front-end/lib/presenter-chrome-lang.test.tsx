/**
 * REQ-855 — demo-loop cycle dm3, issues m5 + m6 + rc-17: the presenter's own chrome on a page that
 * is not the stage is the PRESENTER's. The real islands run their real hooks and clients with the
 * backend answered by a stubbed fetch, the way a staff member's browser sees a customer page
 * (/welcome, in the customer's language es) while guiding her:
 *
 *   - m6: DemoModeOverlay's presenter pill read the page's langSignal — the CUSTOMER's language —
 *     so an English presenter read "Modo demo · Guiando a Maria Lopez · Volver a la demo", and its
 *     way back to the stage went to /demo/stage?lang=es (rc-17: a Spanish stage, and a Spanish
 *     /admin after End).
 *   - m5: ImpersonationBanner drew the red "Impersonating … Return to your account" bar next to
 *     that pill, and over /admin's guide gate (it never asked whether the impersonation is a demo
 *     this staff presents).
 *
 *   cd front-end && deno test -A lib/presenter-chrome-lang.test.tsx
 *
 * Under `deno test` the islands compile with jsx "precompile": a client render makes template
 * vnodes, not DOM (and drops handlers). So each island is rendered inside a probe component that
 * keeps what it returned, and that output is read with preact-render-to-string; the overlay's
 * placePresenter is reached through the started event (the same function Back to the demo calls).
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { render, type VNode } from "preact";
import { renderToString } from "npm:preact-render-to-string@^6.6.7";
import { langSignal } from "./i18n.ts";
import DemoModeOverlay from "../islands/DemoModeOverlay.tsx";
import ImpersonationBanner from "../islands/ImpersonationBanner.tsx";

const customer = {
  id: "c1",
  name: "Maria Lopez",
  phoneNumber: "+15125550101",
  superAdmin: false,
  language: "es",
};
const alex = {
  id: "s1",
  name: "Alex",
  phoneNumber: "+18435550101",
  superAdmin: true,
  language: "en",
};
/** whoami while Alex's browser acts as Maria (REQ-341: the impersonator's own language) */
const actingAsMaria = {
  authenticated: true,
  user: customer,
  superAdmin: false,
  impersonating: true,
  impersonator: alex,
};
const presenting = {
  role: "presenter",
  session: {
    id: "demo_1",
    presenterName: "Alex",
    targetName: "Maria Lopez",
    targetUserId: "c1",
    presenters: [{ userId: "s1", name: "Alex", color: "#2f6d29" }],
  },
  targetPath: "/welcome",
  pid: "p1",
};
const noDemo = { role: null, session: null, targetPath: null, pid: null };

type Answers = { whoami: unknown; active: unknown };

/** a browser-ish global scope for one mount: deno-dom's document, the page at `path`, the backend
 *  answered by `answers`; `assigned` collects location.assign / location.href writes */
function browserish(path: string, answers: Answers) {
  const doc = new DOMParser().parseFromString(
    "<!doctype html><html><body><div id=root></div></body></html>",
    "text/html",
  )!;
  const g = globalThis as Record<string, unknown>;
  const saved: Record<string, PropertyDescriptor | undefined> = {};
  const set = (k: string, v: unknown) => {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, {
      value: v,
      configurable: true,
      writable: true,
    });
  };
  const assigned: string[] = [];
  const calls: string[] = [];
  const url = new URL(path, "http://localhost");
  const location = {
    pathname: url.pathname,
    search: url.search,
    hash: "",
    origin: url.origin,
    host: url.host,
    protocol: url.protocol,
    assign: (u: string) => void assigned.push(String(u)),
  };
  Object.defineProperty(location, "href", {
    get: () => url.href,
    set: (u: string) => void assigned.push(String(u)),
  });
  set("document", doc);
  set("window", globalThis);
  set("top", globalThis);
  set("location", location);
  set("innerWidth", 1280);
  set("innerHeight", 800);
  set("fetch", (input: string | URL | Request) => {
    const u = new URL(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url,
      "http://localhost",
    );
    calls.push(u.pathname);
    const body = u.pathname === "/api/admin/whoami"
      ? answers.whoami
      : u.pathname === "/api/demo-mode/active"
      ? answers.active
      : undefined;
    if (body === undefined) return new Promise(() => {}); // nothing else answers
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  set(
    "WebSocket",
    class {
      readyState = 0;
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    },
  );
  set("requestAnimationFrame", () => 0);
  set("cancelAnimationFrame", () => {});
  return {
    root: doc.getElementById("root")! as unknown as Element,
    assigned,
    calls,
    restore() {
      for (const [k, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete g[k];
      }
    },
  };
}

/** mounts `island` inside a probe that keeps every output it returned */
function mount(root: Element, island: () => unknown) {
  const outs: (VNode | null)[] = [];
  function Probe() {
    const out = island() as VNode | null;
    outs.push(out);
    return out;
  }
  render(<Probe />, root);
  return {
    outs,
    /** what the island shows now, as HTML ("" when it draws nothing) */
    now: () => {
      const last = outs[outs.length - 1];
      return last ? renderToString(last) : "";
    },
    /** everything it ever showed */
    all: () => outs.map((o) => (o ? renderToString(o) : "")),
    unmount: () => render(null, root),
  };
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean, ms = 3_000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await tick();
  }
}

const SPANISH = ["Modo demo", "Guiando a Maria Lopez", "Volver a la demo"];

Deno.test({
  name:
    "REQ-855 (dm3 m6): on a customer page (langSignal es) the presenter pill speaks the en impersonator's language — Demo mode · Guiding Maria Lopez · Back to the demo — with End demo and the EN | ES switch, never a frame in Spanish",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const env = browserish("/welcome", {
      whoami: actingAsMaria,
      active: presenting,
    });
    const before = langSignal.value;
    langSignal.value = "es"; // the customer's page: Maria's language
    sessionStorage.clear();
    const m = mount(env.root, () => DemoModeOverlay({}));
    try {
      await until(
        "the presenter pill is drawn",
        () => m.now().includes('data-cy="demo-rejoin"'),
      );
      await tick(50); // every answer (whoami's too) rendered
      for (const html of m.all()) {
        for (const s of SPANISH) {
          assert(
            !html.includes(s),
            `the presenter's pill is never in the customer's language ("${s}"): ${html}`,
          );
        }
      }
      const pill = m.now();
      for (
        const s of ["Demo mode", "Guiding Maria Lopez", "Back to the demo"]
      ) {
        assert(pill.includes(s), `the pill says "${s}": ${pill}`);
      }
      // where the red bar was: the presenter's way out, in the presenter's words
      assert(pill.includes("End demo"), `End demo on the pill: ${pill}`);
      // and the presenter's own language switch: the same page with ?lang=
      assert(
        /data-cy="demo-lang-en"[^>]*href="\/welcome\?lang=en"|href="\/welcome\?lang=en"[^>]*data-cy="demo-lang-en"/
          .test(pill),
        `EN goes to /welcome?lang=en: ${pill}`,
      );
      assert(
        /data-cy="demo-lang-es"[^>]*href="\/welcome\?lang=es"|href="\/welcome\?lang=es"[^>]*data-cy="demo-lang-es"/
          .test(pill),
        `ES goes to /welcome?lang=es: ${pill}`,
      );
      assert(
        /data-cy="demo-lang-en"[^>]*aria-current="true"|aria-current="true"[^>]*data-cy="demo-lang-en"/
          .test(pill),
        `EN is the current language: ${pill}`,
      );
    } finally {
      m.unmount();
      langSignal.value = before;
      sessionStorage.clear();
      env.restore();
    }
  },
});

Deno.test({
  name:
    "REQ-855 (dm3 m6 / rc-17): from a Spanish customer page the presenter's way back to the stage goes to /demo/stage?lang=en — the presenter's language, not the page's",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const env = browserish("/welcome", {
      whoami: actingAsMaria,
      active: presenting,
    });
    const before = langSignal.value;
    langSignal.value = "es";
    sessionStorage.clear();
    const m = mount(env.root, () => DemoModeOverlay({}));
    try {
      await until(
        "the presenter pill is drawn",
        () => m.now().includes('data-cy="demo-rejoin"'),
      );
      // placePresenter — what Back to the demo calls — reached through the started event
      globalThis.dispatchEvent(
        new CustomEvent("pm:demo-started", {
          detail: {
            id: "demo_1",
            targetUserId: "c1",
            targetName: "Maria Lopez",
            targetPath: null,
            createdAt: "",
          },
        }),
      );
      await until("the hop to the stage", () => env.assigned.length > 0);
      assertEquals(env.assigned, ["/demo/stage?lang=en"]);
    } finally {
      m.unmount();
      langSignal.value = before;
      sessionStorage.clear();
      env.restore();
    }
  },
});

Deno.test({
  name:
    "REQ-855 (dm3 m5): on /admin's guide gate the presenter pill stays the plain way back (the card carries the exits and the EN | ES switch), in the presenter's language",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const env = browserish("/admin", {
      whoami: actingAsMaria,
      active: presenting,
    });
    const before = langSignal.value;
    langSignal.value = "es";
    sessionStorage.clear();
    const m = mount(env.root, () => DemoModeOverlay({}));
    try {
      await until(
        "the presenter pill is drawn",
        () => m.now().includes('data-cy="demo-rejoin"'),
      );
      await tick(50);
      const pill = m.now();
      assert(pill.includes("Back to the demo"), pill);
      assert(
        !pill.includes('data-cy="demo-lang"'),
        `no second switch: ${pill}`,
      );
      assert(!pill.includes("End demo"), `no second exit: ${pill}`);
    } finally {
      m.unmount();
      langSignal.value = before;
      sessionStorage.clear();
      env.restore();
    }
  },
});

const asked = (env: ReturnType<typeof browserish>, p: string) =>
  env.calls.includes(p);

Deno.test({
  name:
    "REQ-855 (dm3 m5): while this staff presents the demo, no red impersonation bar beside the demo pill; when the overlay says the demo is gone, the bar comes back",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const env = browserish("/welcome", {
      whoami: actingAsMaria,
      active: presenting,
    });
    const m = mount(env.root, () => ImpersonationBanner());
    try {
      await until("whoami asked", () => asked(env, "/api/admin/whoami"));
      await tick(80);
      assertEquals(m.now(), "", "no red bar while presenting");
      assert(
        !m.all().some((h) => h.includes('data-cy="imp-banner"')),
        "never a frame of it",
      );
      // the overlay hears the demo end on this page: the bar is the way back again
      globalThis.dispatchEvent(
        new CustomEvent("pm:demo-presenting", { detail: false }),
      );
      await until(
        "the bar is back",
        () => m.now().includes('data-cy="imp-banner"'),
      );
    } finally {
      m.unmount();
      env.restore();
    }
  },
});

Deno.test({
  name:
    "REQ-855 (dm3 m5): /admin's guide gate has its own exits — no red bar over it, demo or not",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    for (const active of [presenting, noDemo]) {
      const env = browserish("/admin", { whoami: actingAsMaria, active });
      const m = mount(env.root, () => ImpersonationBanner());
      try {
        await until("whoami asked", () => asked(env, "/api/admin/whoami"));
        await tick(80);
        assertEquals(
          m.now(),
          "",
          `no red bar over the gate (${active.role ?? "no demo"})`,
        );
      } finally {
        m.unmount();
        env.restore();
      }
    }
  },
});

Deno.test({
  name:
    "REQ-855 (dm3 m5): a plain impersonation (no demo) keeps its bar on the customer's pages (REQ-181 / REQ-723)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const env = browserish("/welcome", {
      whoami: actingAsMaria,
      active: noDemo,
    });
    const m = mount(env.root, () => ImpersonationBanner());
    try {
      await until(
        "the bar is drawn",
        () => m.now().includes('data-cy="imp-banner"'),
      );
      assert(m.now().includes("Return to your account"), m.now());
    } finally {
      m.unmount();
      env.restore();
    }
  },
});
