/**
 * Static seed for the dashboard, ported verbatim from
 * Paperwork Monster Dashboard.html. Used as a visual fallback when the
 * backend hasn't yet returned real data — once the user has actual jobs,
 * quotes, and activity, the route swaps in the live values and the
 * structure stays identical.
 *
 * The seed builders take a `lang` (default "en") so the placeholder copy
 * renders in the contractor's language; numeric KPIs are language-agnostic.
 */
import type {
  ActivityEntry,
  JobRow,
  OutstandingRow,
  QuoteRow,
} from "../components/DashSections.tsx";
import { type Lang, tFor } from "./i18n.ts";

export const SEED_JOBS = (lang: Lang = "en"): JobRow[] => [
  {
    client: tFor(lang, "dashSeed.client.mapleGroveApartments"),
    task: tFor(lang, "dashSeed.jobs.reRoofBuildingC"),
    amount: "$4,800",
    paid: tFor(lang, "dashSeed.jobs.amountPaid", { amt: "$2,400" }),
    pct: 50,
    due: tFor(lang, "dashSeed.due.today"),
    icon: "hardhat",
    color: "var(--brand-green)",
    status: { kind: "green", txt: tFor(lang, "dashSeed.jobs.status.onTrack") },
  },
  {
    client: tFor(lang, "dashSeed.client.sarahChen"),
    task: tFor(lang, "dashSeed.jobs.bathroomRemodel"),
    amount: "$8,200",
    paid: tFor(lang, "dashSeed.jobs.amountPaid", { amt: "$3,000" }),
    pct: 36,
    due: tFor(lang, "dashSeed.due.wed"),
    icon: "wrench",
    color: "var(--brand-pink)",
    status: { kind: "green", txt: tFor(lang, "dashSeed.jobs.status.crewOnsite") },
  },
  {
    client: tFor(lang, "dashSeed.client.marshallAndSons"),
    task: tFor(lang, "dashSeed.jobs.drivewayRepour"),
    amount: "$2,950",
    paid: tFor(lang, "dashSeed.jobs.deposit"),
    pct: 18,
    due: tFor(lang, "dashSeed.due.fri"),
    icon: "truck",
    color: "var(--coffee-500)",
    status: { kind: "warn", txt: tFor(lang, "dashSeed.jobs.status.awaitingPermit") },
  },
  {
    client: tFor(lang, "dashSeed.client.janaPatel"),
    task: tFor(lang, "dashSeed.jobs.interiorPaint2br"),
    amount: "$1,650",
    paid: tFor(lang, "dashSeed.jobs.quoted"),
    pct: 0,
    due: tFor(lang, "dashSeed.due.monApr29"),
    icon: "paint",
    color: "var(--brand-pink)",
    status: { kind: "teal", txt: tFor(lang, "dashSeed.jobs.status.scheduled") },
  },
  {
    client: tFor(lang, "dashSeed.client.cobblestoneCafe"),
    task: tFor(lang, "dashSeed.jobs.patioReTile"),
    amount: "$3,400",
    paid: tFor(lang, "dashSeed.jobs.amountPaid", { amt: "$1,000" }),
    pct: 30,
    due: tFor(lang, "dashSeed.due.apr30"),
    icon: "ruler",
    color: "var(--brand-green)",
    status: { kind: "green", txt: tFor(lang, "dashSeed.jobs.status.onTrack") },
  },
];

export const SEED_QUOTES = (lang: Lang = "en"): QuoteRow[] => [
  {
    client: tFor(lang, "dashSeed.client.tomLindaK"),
    desc: tFor(lang, "dashSeed.quotes.garageEpoxyFloor"),
    amt: "$3,400",
    sent: tFor(lang, "dashSeed.quotes.sentMonViewedTwice"),
    hot: true,
  },
  {
    client: tFor(lang, "dashSeed.client.greenleafHoa"),
    desc: tFor(lang, "dashSeed.quotes.commonAreaPaint"),
    amt: "$5,800",
    sent: tFor(lang, "dashSeed.quotes.sentTueViewed"),
    hot: false,
  },
  {
    client: tFor(lang, "dashSeed.client.marcusLin"),
    desc: tFor(lang, "dashSeed.quotes.kitchenBacksplash"),
    amt: "$1,920",
    sent: tFor(lang, "dashSeed.quotes.sentToday"),
    hot: false,
  },
  {
    client: tFor(lang, "dashSeed.client.baysideProperties"),
    desc: tFor(lang, "dashSeed.quotes.gutterCleaning4Unit"),
    amt: "$1,680",
    sent: tFor(lang, "dashSeed.quotes.sent4DaysAgo"),
    hot: false,
    cold: true,
  },
];

export const SEED_OUTSTANDING = (lang: Lang = "en"): OutstandingRow[] => [
  {
    client: tFor(lang, "dashSeed.client.hilltopDiner"),
    meta: tFor(lang, "dashSeed.outstanding.daysOverdue", { inv: "#INV-204" }),
    metaColor: "var(--pink-700)",
    metaWeight: 700,
    amount: "$1,160",
  },
  {
    client: tFor(lang, "dashSeed.client.sarahChen"),
    meta: tFor(lang, "dashSeed.outstanding.dueIn3Days", { inv: "#INV-208" }),
    metaColor: "var(--coffee-500)",
    metaWeight: 600,
    amount: "$1,920",
  },
  {
    client: tFor(lang, "dashSeed.client.mapleGroveApts"),
    meta: tFor(lang, "dashSeed.outstanding.dueApr30", { inv: "#INV-210" }),
    metaColor: "var(--green-600)",
    metaWeight: 600,
    amount: "$3,340",
  },
];

export const SEED_ACTIVITY = (lang: Lang = "en"): ActivityEntry[] => [
  {
    icon: "check",
    bg: "var(--green-50)",
    fg: "var(--green-600)",
    html: tFor(lang, "dashSeed.activity.quoteOpenedSecondTime"),
    time: tFor(lang, "dashSeed.time.2MinAgo"),
  },
  {
    icon: "send",
    bg: "var(--pink-50)",
    fg: "var(--pink-700)",
    html: tFor(lang, "dashSeed.activity.textedQuoteDrafted"),
    time: tFor(lang, "dashSeed.time.1HrAgo"),
  },
  {
    icon: "card",
    bg: "var(--green-50)",
    fg: "var(--green-600)",
    html: tFor(lang, "dashSeed.activity.paidInvoiceDeposit"),
    time: tFor(lang, "dashSeed.time.3HrAgo"),
  },
  {
    icon: "contract",
    bg: "var(--teal-50)",
    fg: "var(--teal-600)",
    html: tFor(lang, "dashSeed.activity.eSignedContract"),
    time: tFor(lang, "dashSeed.time.yesterday"),
  },
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
