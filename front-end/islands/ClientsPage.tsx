/**
 * Top-level data island for /clients. The SSR route renders only the page
 * shell (sidebar + topbar); this island fetches the full payload from the
 * backend on mount and renders the editorial board.
 */
import { useEffect, useState } from "preact/hooks";
import {
  clientsClient,
  type ClientSegmentsResponse,
  type CustomerCard,
  type TopClientsResponse,
} from "../clients/clients.ts";
import {
  ClientsHero,
  ClientsSegments,
  LoopBar,
  TopClients,
} from "../components/ClientsSections.tsx";
import ClientsBoard from "./ClientsBoard.tsx";
import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  ShimmerStyle,
} from "../components/Skeletons.tsx";
import { langSignal, tFor } from "../lib/i18n.ts";

interface State {
  loading: boolean;
  error: string | null;
  cards: CustomerCard[];
  top: TopClientsResponse;
  segments: ClientSegmentsResponse;
}

const INITIAL: State = {
  loading: true,
  error: null,
  cards: [],
  top: { results: [] },
  segments: { segments: [] },
};

function pickLoop(cards: CustomerCard[]): CustomerCard[] {
  const candidates = cards.filter((c) =>
    c.status === "lead" || c.status === "owes"
  );
  candidates.sort((a, b) => b.daysSinceContact - a.daysSinceContact);
  return candidates.slice(0, 3);
}

export default function ClientsPage({ lang: _lang }: { lang?: "en" | "es" }) {
  const lang = langSignal.value;
  const [s, setS] = useState<State>(INITIAL);
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");

  async function refreshClients() {
    const cards = await clientsClient.list().catch(() => null);
    if (cards) setS((prev) => ({ ...prev, cards }));
  }

  async function submitAddClient(e: Event) {
    e.preventDefault();
    if (!addName.trim() || adding) return;
    setAdding(true);
    setAddErr(null);
    try {
      await clientsClient.create({
        name: addName.trim(),
        ...(addPhone.trim() ? { phoneNumber: addPhone.trim() } : {}),
        ...(addEmail.trim() ? { email: addEmail.trim() } : {}),
      });
      setAddName("");
      setAddPhone("");
      setAddEmail("");
      setAddOpen(false);
      await refreshClients();
    } catch (err) {
      setAddErr(err instanceof Error ? err.message : "Could not add client");
    } finally {
      setAdding(false);
    }
  }

  useEffect(() => {
    let alive = true;
    Promise.all([
      clientsClient.list().catch(() => [] as CustomerCard[]),
      clientsClient.top(5).catch(() => ({ results: [] } as TopClientsResponse)),
      clientsClient.segments().catch(
        () => ({ segments: [] } as ClientSegmentsResponse),
      ),
    ]).then(([cards, top, segments]) => {
      if (!alive) return;
      setS({ loading: false, error: null, cards, top, segments });
    }).catch((err: Error) => {
      if (!alive) return;
      setS({ ...INITIAL, loading: false, error: err.message });
    });
    return () => {
      alive = false;
    };
  }, []);

  if (s.loading) {
    return (
      <>
        <ShimmerStyle />
        <PageHeaderSkeleton />
        <CardGridSkeleton rows={3} />
      </>
    );
  }
  if (s.error) {
    return (
      <div class="cpage-error">
        {tFor(lang, "clientsPage.loadError", { error: s.error })}
      </div>
    );
  }

  const { cards: rawCards, top, segments } = s;
  const cards = Array.isArray(rawCards) ? rawCards : [];
  const activeJobs = cards.filter((c) => c.status === "active").length;
  const owedTotal = cards.reduce(
    (sum, c) => sum + (c.balanceCents > 0 ? c.balanceCents : 0),
    0,
  ) / 100;
  const quietCount = cards.filter((c) => c.status === "cold").length;
  const loopPicks = pickLoop(cards);

  return (
    <>
      <ClientsHero
        totalClients={cards.length}
        activeJobs={activeJobs}
        owedTotal={owedTotal}
        quietCount={quietCount}
        lang={lang}
        onAdd={() => {
          setAddErr(null);
          setAddOpen(true);
        }}
      />
      <LoopBar picks={loopPicks} lang={lang} />
      <ClientsBoard cards={cards} lang={lang}>
        <TopClients rows={top.results} lang={lang} />
        <ClientsSegments rows={segments.segments} lang={lang} />
      </ClientsBoard>

      {addOpen && (
        <div
          onClick={() => !adding && setAddOpen(false)}
          style="position:fixed;inset:0;background:rgba(20,40,45,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitAddClient}
            style="background:#fff;border-radius:16px;padding:24px 26px;max-width:440px;width:100%;box-shadow:0 24px 64px rgba(20,72,82,0.22);display:flex;flex-direction:column;gap:14px"
          >
            <h2 style="margin:0;font-size:20px;font-weight:800;color:var(--fg,#144852)">
              {tFor(lang, "clientsHero.addClient")}
            </h2>
            <label style="display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560)">
              {tFor(lang, "settings.name")}
              <input
                type="text"
                autoFocus
                required
                value={addName}
                onInput={(e) => setAddName((e.target as HTMLInputElement).value)}
                style="padding:11px 13px;border:1px solid var(--border,#d8dcd5);border-radius:10px;font:inherit;font-size:15px;font-weight:400;color:var(--fg)"
              />
            </label>
            <label style="display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560)">
              {tFor(lang, "settings.phone")}
              <input
                type="tel"
                value={addPhone}
                onInput={(e) =>
                  setAddPhone((e.target as HTMLInputElement).value)}
                style="padding:11px 13px;border:1px solid var(--border,#d8dcd5);border-radius:10px;font:inherit;font-size:15px;font-weight:400;color:var(--fg)"
              />
            </label>
            <label style="display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560)">
              {tFor(lang, "settings.email")}
              <input
                type="email"
                value={addEmail}
                onInput={(e) =>
                  setAddEmail((e.target as HTMLInputElement).value)}
                style="padding:11px 13px;border:1px solid var(--border,#d8dcd5);border-radius:10px;font:inherit;font-size:15px;font-weight:400;color:var(--fg)"
              />
            </label>
            {addErr && (
              <p
                role="alert"
                style="margin:0;color:#a83b3b;font-size:13.5px;font-weight:600"
              >
                {addErr}
              </p>
            )}
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">
              <button
                type="button"
                disabled={adding}
                onClick={() => setAddOpen(false)}
                style="padding:10px 16px;border:0;background:transparent;color:var(--fg-muted,#6b7560);font:inherit;font-weight:700;cursor:pointer;border-radius:10px"
              >
                {tFor(lang, "common.cancel")}
              </button>
              <button
                type="submit"
                disabled={adding || !addName.trim()}
                style="padding:10px 20px;border:0;border-radius:10px;background:var(--brand-green,#519843);color:#fff;font:inherit;font-weight:800;cursor:pointer;opacity:1"
              >
                {adding ? "…" : tFor(lang, "common.add")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
