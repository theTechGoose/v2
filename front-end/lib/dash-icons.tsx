/**
 * Icon set ported verbatim from the prototype's `ICN` map (Dashboard.html
 * lines 2193–2228 + Assistant.html). Used by both the dashboard and the
 * assistant; keep them in one place so the same icon ID renders identically
 * across pages.
 */
import type { JSX } from "preact";

export const ICN = {
  home:    <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></>,
  user:    <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></>,
  quote:   <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6" /><path d="M9 17h4" /></>,
  contract:<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  invoice: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 10h8M8 14h6" /></>,
  pay:     <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M2 10h20" /><path d="M6 14h4" /></>,
  msg:     <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  cog:     <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  bell:    <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>,
  search:  <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></>,
  bolt:    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />,
  crown:   <><path d="M3 19h18" /><path d="M2 7l5 5 5-7 5 7 5-5-2 12H4z" /><circle cx="2" cy="7" r="1.2" fill="currentColor" /><circle cx="22" cy="7" r="1.2" fill="currentColor" /><circle cx="12" cy="5" r="1.2" fill="currentColor" /></>,
  plus:    <path d="M12 5v14M5 12h14" />,
  arrow:   <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  chev:    <path d="m9 18 6-6-6-6" />,
  check:   <path d="M20 6 9 17l-5-5" />,
  hardhat: <><path d="M2 18h20" /><path d="M3 18a9 9 0 0 1 18 0" /><path d="M12 3v3" /><path d="M9 6h6" /></>,
  wrench:  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" />,
  truck:   <><path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0z" /><path d="M15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0z" /><path d="M3 17V6a1 1 0 0 1 1-1h11v12" /><path d="M15 8h4l3 3v6h-2" /></>,
  paint:   <><path d="M19 11h2v3h-2" /><path d="M3 5h13v8H3z" /><path d="M7 13v3a3 3 0 0 0 3 3v3" /></>,
  ruler:   <><path d="M21.3 15.3 8.7 2.7a1 1 0 0 0-1.4 0L2.7 7.3a1 1 0 0 0 0 1.4l12.6 12.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4z" /><path d="M14 7l-3 3" /><path d="M11 4l-3 3" /><path d="M17 10l-3 3" /></>,
  cal:     <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  send:    <><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>,
  doc:     <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  eye:     <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
  card:    <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></>,
  trend:   <><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>,
  clock:   <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  mic:     <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2" /><path d="M12 19v3" /></>,
  clip:    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  img:     <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  sparkle: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></>,
  more:    <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  refresh: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>,
  back:    <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>,
  bookmark:<path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
  pencil:  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />,
  list:    <><line x1="8" x2="21" y1="6" y2="6" /><line x1="8" x2="21" y1="12" y2="12" /><line x1="8" x2="21" y1="18" y2="18" /><line x1="3" x2="3.01" y1="6" y2="6" /><line x1="3" x2="3.01" y1="12" y2="12" /><line x1="3" x2="3.01" y1="18" y2="18" /></>,
} as const;

export type IconName = keyof typeof ICN;

interface IconProps { d: JSX.Element; size?: number; sw?: number }

export function I({ d, size = 18, sw = 2 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={sw}
      stroke-linecap="round"
      stroke-linejoin="round"
      style="display:block;flex-shrink:0"
    >
      {d}
    </svg>
  );
}
