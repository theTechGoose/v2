/**
 * PublicContractView — client-side loader for the public agreement page.
 *
 * The route used to `await` the backend in SSR, so the browser saw a blank
 * white screen until the first byte (problems.md #25). This island renders a
 * skeleton immediately, then fetches `/contracts/:id/public` through the
 * same-origin /api proxy and swaps in the real document (or an error card).
 */
import { useEffect, useState } from "preact/hooks";
import {
  ContractDoc,
  type ContractPublic,
  ErrorCard,
} from "../components/contract-doc.tsx";

interface State {
  phase: "loading" | "error" | "ok";
  contract?: ContractPublic;
  message?: string;
}

const LINK_GONE = "This contract link expired or was revoked.";

export default function PublicContractView({ id }: { id: string }) {
  const [s, setS] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let alive = true;
    fetch(`/api/contracts/${id}/public`, {
      headers: { accept: "application/json" },
    })
      .then(async (r) => {
        if (!alive) return;
        if (r.ok) {
          setS({ phase: "ok", contract: (await r.json()) as ContractPublic });
        } else {
          setS({ phase: "error", message: LINK_GONE });
        }
      })
      .catch(() => {
        if (alive) setS({ phase: "error", message: LINK_GONE });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (s.phase === "ok" && s.contract) {
    return <ContractDoc contract={s.contract} />;
  }
  if (s.phase === "error") {
    return <ErrorCard message={s.message ?? "Contract not available."} />;
  }
  return <LoadingSkeleton />;
}

/** Lightweight placeholder shown while the agreement loads — mirrors the
 *  document card's shape so the swap-in isn't jarring. */
function LoadingSkeleton() {
  return (
    <>
      <style>
        {`@keyframes ctr-skel { 0%,100% { opacity:.55 } 50% { opacity:.85 } }`}
      </style>
      <div style="text-align:center;margin-bottom:18px">
        <div style="display:inline-block;height:11px;width:160px;border-radius:6px;background:#e3e8e6;animation:ctr-skel 1.2s ease-in-out infinite" />
      </div>
      <div style="background:#fffdf7;border-radius:24px;box-shadow:0 14px 50px rgba(20,72,82,0.10);overflow:hidden;border:1px solid rgba(20,72,82,0.10)">
        <div style="height:8px;background:linear-gradient(90deg,#144852 0%,#0e333b 100%)" />
        <div style="padding:36px 44px 40px;display:flex;flex-direction:column;gap:18px">
          {[220, 320, 140, 280, 200].map((w, i) => (
            <div
              key={i}
              style={`height:18px;width:${w}px;max-width:100%;border-radius:8px;background:#e9edeb;animation:ctr-skel 1.2s ease-in-out infinite;animation-delay:${
                i * 0.08
              }s`}
            />
          ))}
          <div style="margin-top:8px;height:120px;border-radius:14px;background:#eef2f0;animation:ctr-skel 1.2s ease-in-out infinite" />
        </div>
      </div>
    </>
  );
}
