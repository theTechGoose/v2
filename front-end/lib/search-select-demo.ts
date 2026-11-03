/**
 * REQ-136 — the dev page's rows: 1,000 distinct labels (40 first names × 25 last names, every
 * pair used once; every tenth row a company instead), each with a city and its row number.
 */
import type { SearchOption } from "./search-select.ts";

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
  "Paula",
  "Diego",
  "Nina",
  "Carlos",
  "Olivia",
  "Jorge",
  "Emma",
  "Andres",
  "Clara",
  "Felix",
  "Julia",
  "Pablo",
  "Sara",
  "Tomas",
  "Laura",
  "Ivan",
  "Alma",
  "Raul",
  "Vera",
  "Simon",
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
  "Reyes",
  "Moore",
  "Vargas",
  "Clark",
  "Mendoza",
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
  "Concrete",
  "Fencing",
];

export function demoRows(): SearchOption[] {
  const out: SearchOption[] = [];
  for (let i = 0; i < 1000; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[Math.floor(i / FIRST.length) % LAST.length];
    // every tenth row is a company; the row number keeps those distinct too
    const label = i % 10 === 9
      ? `${last} ${CO[(i / 10) % CO.length | 0]} ${Math.floor(i / 100) + 1} LLC`
      : `${first} ${last}`;
    out.push({
      id: `row-${i}`,
      label,
      hint: `${CITY[(i * 31) % CITY.length]} · row ${i}`,
    });
  }
  return out;
}
