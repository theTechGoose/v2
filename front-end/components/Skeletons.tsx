/**
 * Shared loading-skeleton primitives used by the per-page top-level islands
 * (DashboardPage, ClientsPage, QuotesPage, …). The page islands fetch on
 * mount, so the SSR'd first render is the loading state — replacing the
 * literal "Loading X…" line with a layout-shaped skeleton avoids the empty
 * blink the audit flagged on cold-route navigations.
 */

const SHIMMER_KEYFRAMES =
  `@keyframes pmShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`;

const SHIMMER =
  "background:linear-gradient(90deg,#eef2ed 0%,#f6f7f3 50%,#eef2ed 100%);background-size:200% 100%;animation:pmShimmer 1.4s ease-in-out infinite";

export function ShimmerStyle() {
  return <style>{SHIMMER_KEYFRAMES}</style>;
}

interface SkelBlockProps {
  h: number;
  w?: string;
  r?: number;
  mt?: number;
}

export function SkelBlock({ h, w, r = 8, mt = 0 }: SkelBlockProps) {
  return (
    <div
      style={`height:${h}px;width:${w ?? "100%"};border-radius:${r}px;${SHIMMER};margin-top:${mt}px`}
    />
  );
}

/** Shared header skeleton: title, sub-text, two-row chip strip. */
export function PageHeaderSkeleton() {
  return (
    <section style="margin-bottom:18px">
      <SkelBlock h={32} w="60%" />
      <SkelBlock h={14} w="40%" mt={12} />
    </section>
  );
}

/** Generic two-column card grid skeleton — matches `.grid` panel layouts. */
export function CardGridSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div class="grid">
      <div class="panel">
        <SkelBlock h={20} w="40%" />
        {Array.from({ length: rows }).map((_, i) => <SkelBlock key={i} h={56} mt={i === 0 ? 18 : 12} />)}
      </div>
      <div class="panel">
        <SkelBlock h={20} w="40%" />
        {Array.from({ length: rows }).map((_, i) => <SkelBlock key={i} h={56} mt={i === 0 ? 18 : 12} />)}
      </div>
    </div>
  );
}

/** Single-column list skeleton for /payments, /invoices etc. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div class="panel">
      <SkelBlock h={20} w="30%" />
      {Array.from({ length: rows }).map((_, i) => <SkelBlock key={i} h={64} mt={i === 0 ? 18 : 12} />)}
    </div>
  );
}
