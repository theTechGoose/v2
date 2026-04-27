/**
 * Minimal icon set. Each icon is a 24×24 stroke-only SVG.
 * Add more as the UI grows; keep them dependency-free.
 */
import type { JSX } from "preact";

type Name =
  | "home" | "doc" | "file-text" | "receipt" | "chat" | "users" | "settings"
  | "bell" | "search" | "send" | "mic" | "image" | "check" | "chevron-right"
  | "menu" | "logo";

interface Props extends Omit<JSX.HTMLAttributes<SVGSVGElement>, "name" | "size"> {
  name: Name;
  size?: number;
}

const PATHS: Record<Name, JSX.Element> = {
  home:          <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  doc:           <path d="M7 3h7l5 5v13H7zM14 3v5h5" />,
  "file-text":   <><path d="M7 3h7l5 5v13H7z" /><path d="M9 13h8M9 17h8M9 9h4" /></>,
  receipt:       <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  chat:          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-13a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />,
  users:         <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5M14 20c0-2 2-3 4-3s4 1 4 3" /></>,
  settings:      <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4.8a7 7 0 0 0-1.7-1L14.5 3h-5L9.2 5.8a7 7 0 0 0-1.7 1L5 6l-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-.8a7 7 0 0 0 1.7 1L9.5 21h5l.3-2.8a7 7 0 0 0 1.7-1l2.4.8 2-3.5-2-1.5a7 7 0 0 0 .1-1z" /></>,
  bell:          <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21a2 2 0 0 0 4 0" />,
  search:        <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5" /></>,
  send:          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />,
  mic:           <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  image:         <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-6-6-9 9" /></>,
  check:         <path d="M5 12l5 5L20 6" />,
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  menu:          <path d="M3 6h18M3 12h18M3 18h18" />,
  logo:          <path d="M4 18h16l-2-9-3 3-3-6-3 6-3-3z" />,
};

export function Icon({ name, size = 18, class: cls = "", ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={1.7}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
