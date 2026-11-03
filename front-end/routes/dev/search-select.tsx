/**
 * REQ-136 — /dev/search-select: the SearchSelect island over 1,000 generated rows, so it can be
 * seen and driven locally before it is mounted anywhere. A 404 on the real deploy.
 */
import { Head } from "fresh/runtime";
import { HttpError } from "fresh";
import { define } from "../../utils.ts";
import SearchSelectDemo from "../../islands/SearchSelectDemo.tsx";
import type { SearchOption } from "../../lib/search-select.ts";

const FIRST = [
  "Maria",
  "Omar",
  "Ana",
  "Luis",
  "Sofia",
  "Marcus",
  "Elena",
  "James",
  "Rosa",
  "Daniel",
  "Camila",
  "Victor",
  "Lucia",
  "Ethan",
  "Marta",
  "Noah",
  "Isabel",
  "Mario",
  "Grace",
  "Hector",
];
const LAST = [
  "Lopez",
  "Martinez",
  "Pérez",
  "Nguyen",
  "Smith",
  "García",
  "Brown",
  "Ramírez",
  "Johnson",
  "Torres",
  "Miller",
  "Hernández",
  "Davis",
  "Flores",
  "Wilson",
  "Morales",
  "Taylor",
  "Castillo",
  "Anderson",
  "Ortiz",
];
const CITY = [
  "Austin, TX",
  "Dallas, TX",
  "Houston, TX",
  "San Antonio, TX",
  "Harrisonburg, VA",
  "Richmond, VA",
  "Denver, CO",
  "Phoenix, AZ",
  "Tampa, FL",
  "Atlanta, GA",
];
const CO = [
  "Roofing",
  "Landscape",
  "Plumbing",
  "Electric",
  "Painting",
  "Properties",
  "Builders",
  "HVAC",
];

/** 1,000 deterministic rows: 900 people, 100 companies, in a fixed shuffle. */
function rows(): SearchOption[] {
  const out: SearchOption[] = [];
  for (let i = 0; i < 1000; i++) {
    const a = (i * 7919) % FIRST.length,
      b = (i * 104729) % LAST.length,
      c = (i * 31) % CITY.length;
    const label = i % 10 === 9
      ? `${LAST[b]} ${CO[(i * 13) % CO.length]} LLC`
      : `${FIRST[a]} ${LAST[b]}`;
    out.push({
      id: `row-${i}`,
      label: i % 10 === 9 ? label : `${label}`,
      hint: `${CITY[c]} · row ${i}`,
    });
  }
  return out;
}

export default define.page(function SearchSelectDev() {
  if (Deno.env.get("DENO_DEPLOY")) throw new HttpError(404);
  const options = rows();
  return (
    <>
      <Head>
        <title>SearchSelect — dev</title>
        <link key="css-dashboard" rel="stylesheet" href="/dashboard.css" />
        <link
          key="css-search-select"
          rel="stylesheet"
          href="/search-select.css"
        />
      </Head>
      <main style="max-width:560px;margin:48px auto;padding:0 20px;font-family:system-ui,sans-serif;color:var(--fg,#1a535c)">
        <h1 style="font-size:22px;margin:0 0 4px">SearchSelect</h1>
        <p style="margin:0 0 20px;color:var(--fg-muted,#555)">
          Type to filter {options.length.toLocaleString("en-US")}{" "}
          rows. Arrows move, Enter picks, Escape closes.
        </p>
        <SearchSelectDemo options={options} />
      </main>
    </>
  );
});
