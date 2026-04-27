/**
 * Static seed for the dashboard, ported verbatim from
 * Paperwork Monsters Dashboard.html. Used as a visual fallback when the
 * backend hasn't yet returned real data — once the user has actual jobs,
 * quotes, and activity, the route swaps in the live values and the
 * structure stays identical.
 */
import type { ActivityEntry, JobRow, OutstandingRow, QuoteRow } from "../components/DashSections.tsx";

export const SEED_JOBS: JobRow[] = [
  { client: "Maple Grove Apartments", task: "Re-roof — building C", amount: "$4,800", paid: "$2,400 paid", pct: 50, due: "Today",     icon: "hardhat", color: "var(--brand-green)", status: { kind: "green", txt: "On track" } },
  { client: "Sarah Chen",             task: "Bathroom remodel",     amount: "$8,200", paid: "$3,000 paid", pct: 36, due: "Wed",        icon: "wrench",  color: "var(--brand-pink)",  status: { kind: "green", txt: "Crew onsite" } },
  { client: "Marshall & Sons",        task: "Driveway repour",      amount: "$2,950", paid: "Deposit",     pct: 18, due: "Fri",        icon: "truck",   color: "var(--coffee-500)",  status: { kind: "warn",  txt: "Awaiting permit" } },
  { client: "Jana Patel",             task: "Interior paint · 2BR", amount: "$1,650", paid: "Quoted",      pct: 0,  due: "Mon Apr 29", icon: "paint",   color: "var(--brand-pink)",  status: { kind: "teal",  txt: "Scheduled" } },
  { client: "Cobblestone Cafe",       task: "Patio re-tile",        amount: "$3,400", paid: "$1,000 paid", pct: 30, due: "Apr 30",     icon: "ruler",   color: "var(--brand-green)", status: { kind: "green", txt: "On track" } },
];

export const SEED_QUOTES: QuoteRow[] = [
  { client: "Tom & Linda K.",     desc: "Garage epoxy floor",     amt: "$3,400", sent: "Sent Mon · Viewed twice", hot:  true },
  { client: "Greenleaf HOA",      desc: "Common area paint",      amt: "$5,800", sent: "Sent Tue · Viewed",       hot:  false },
  { client: "Marcus Lin",         desc: "Kitchen backsplash",     amt: "$1,920", sent: "Sent today",              hot:  false },
  { client: "Bayside Properties", desc: "4-unit gutter cleaning", amt: "$1,680", sent: "Sent 4 days ago",         hot:  false, cold: true },
];

export const SEED_OUTSTANDING: OutstandingRow[] = [
  { client: "Hilltop Diner",      meta: "11 days overdue · #INV-204", metaColor: "var(--pink-700)",   metaWeight: 700, amount: "$1,160" },
  { client: "Sarah Chen",         meta: "Due in 3 days · #INV-208",    metaColor: "var(--coffee-500)", metaWeight: 600, amount: "$1,920" },
  { client: "Maple Grove Apts.",  meta: "Due Apr 30 · #INV-210",       metaColor: "var(--green-600)",  metaWeight: 600, amount: "$3,340" },
];

export const SEED_ACTIVITY: ActivityEntry[] = [
  { icon: "check",    bg: "var(--green-50)", fg: "var(--green-600)", html: "<strong>Tom &amp; Linda K.</strong> opened your quote for the second time", time: "2 min ago" },
  { icon: "send",     bg: "var(--pink-50)",  fg: "var(--pink-700)",  html: "You texted us &quot;new job — paint kitchen for Marcus Lin&quot;. <strong>Quote drafted.</strong>", time: "1 hr ago" },
  { icon: "card",     bg: "var(--green-50)", fg: "var(--green-600)", html: "<strong>Cobblestone Cafe</strong> paid invoice #INV-198 — $1,000 deposit", time: "3 hr ago" },
  { icon: "contract", bg: "var(--teal-50)",  fg: "var(--teal-600)",  html: "<strong>Sarah Chen</strong> e-signed the bathroom remodel contract", time: "Yesterday" },
];

export const SEED_KPIS = {
  thisMonthBilled: 18420,
  activeJobs: 7,
  outstanding: 6420,
  outstandingCount: 4,
  outstandingOverdue: 1,
  pendingQuotes: 4,
  pendingTotal: 12800,
  avgJob: 2830,
  owed: 6420,
  current: 3340,
  mid: 1920,
  overdue: 1160,
};
