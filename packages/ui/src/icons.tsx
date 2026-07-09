import type { SVGProps } from "react";

/* Icon family — 24px grid, 2.2px round stroke. Shapes carry meaning;
   each state icon stays legible at 13px inside a chip. */

export type IconName =
  | "cloud-check"
  | "phone-check"
  | "send"
  | "download"
  | "attention"
  | "no-signal"
  | "check"
  | "clock"
  | "flag"
  | "flag-fill"
  | "navigator"
  | "course"
  | "qr"
  | "pause"
  | "lock"
  | "phone-plain"
  | "home"
  | "users"
  | "tree"
  | "shield"
  | "pulse";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(size: number, props: Omit<IconProps, "size">) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true as const,
    ...props,
  };
}

const stroke = {
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function Icon({ name, size = 14, ...props }: IconProps & { name: IconName }) {
  switch (name) {
    case "cloud-check":
      return (
        <svg {...base(size, props)}>
          <circle cx="8" cy="13.5" r="4.5" fill="currentColor" />
          <circle cx="14" cy="11" r="5.5" fill="currentColor" />
          <rect x="5" y="12.5" width="14.5" height="6" rx="3" fill="currentColor" />
          <path
            d="M9.4 14.6l2 2 3.6-3.6"
            stroke="var(--chip-bg, var(--color-card))"
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "phone-check":
      return (
        <svg {...base(size, props)} {...stroke}>
          <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
          <path d="M9.5 12l1.9 1.9 3.5-3.5" />
        </svg>
      );
    case "send":
      return (
        <svg {...base(size, props)} {...stroke} strokeWidth={2.4}>
          <path d="M12 19.5V5.5" />
          <path d="M6.5 11L12 5.5 17.5 11" />
        </svg>
      );
    case "download":
      return (
        <svg {...base(size, props)} {...stroke}>
          <path d="M12 4.5v14" />
          <path d="M6.5 13L12 18.5 17.5 13" />
          <path d="M5 21.5h14" />
        </svg>
      );
    case "attention":
      return (
        <svg {...base(size, props)} {...stroke}>
          <path d="M12 4.5L21 19.5H3z" />
          <path d="M12 10.5v4" />
          <circle cx="12" cy="17" r="0.6" fill="currentColor" />
        </svg>
      );
    case "no-signal":
      return (
        <svg {...base(size, props)} {...stroke}>
          <rect x="4" y="14" width="3.5" height="6" />
          <rect x="10.2" y="10" width="3.5" height="10" />
          <rect x="16.4" y="6" width="3.5" height="14" />
          <path d="M3 21L21 3" stroke="#AE2A20" />
        </svg>
      );
    case "check":
      return (
        <svg {...base(size, props)} {...stroke} strokeWidth={2.4}>
          <path d="M5 12.5l4.7 4.7L19.5 7" />
        </svg>
      );
    case "clock":
      return (
        <svg {...base(size, props)} {...stroke}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case "flag":
      return (
        <svg {...base(size, props)} {...stroke} strokeWidth={2}>
          <path d="M6 21V4" />
          <path d="M6 4h11l-2.4 4 2.4 4H6" />
        </svg>
      );
    case "flag-fill":
      return (
        <svg {...base(size, props)} fill="currentColor">
          <path d="M6 21V4h12l-2.6 4L18 12H6z" />
        </svg>
      );
    case "navigator":
      return (
        <svg {...base(size, props)} stroke="currentColor" strokeWidth={2}>
          <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
        </svg>
      );
    case "course":
      return (
        <svg {...base(size, props)} {...stroke} strokeWidth={2}>
          <path d="M4 6.5C4 5 5 4 6.5 4H12v16H6.5C5 20 4 19 4 17.5z" />
          <path d="M20 6.5C20 5 19 4 17.5 4H12v16h5.5c1.5 0 2.5-1 2.5-2.5z" />
        </svg>
      );
    case "qr":
      return (
        <svg {...base(size, props)} stroke="currentColor" strokeWidth={2}>
          <rect x="4" y="4" width="6" height="6" />
          <rect x="14" y="4" width="6" height="6" />
          <rect x="4" y="14" width="6" height="6" />
          <rect x="14.5" y="14.5" width="2.5" height="2.5" fill="currentColor" stroke="none" />
          <rect x="18" y="18" width="2" height="2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pause":
      return (
        <svg {...base(size, props)} {...stroke} strokeWidth={2.4}>
          <path d="M9 5.5v13" />
          <path d="M15 5.5v13" />
        </svg>
      );
    case "lock":
      return (
        <svg {...base(size, props)} {...stroke}>
          <rect x="5" y="10.5" width="14" height="10" rx="2" />
          <path d="M8.5 10.5V7.5a3.5 3.5 0 017 0v3" />
        </svg>
      );
    case "phone-plain":
      return (
        <svg {...base(size, props)} {...stroke}>
          <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
          <path d="M10 18h4" />
        </svg>
      );
    /* desktop admin rail set — same 24px grid, 2px stroke */
    case "home":
      return (
        <svg {...base(size, props)} {...stroke} strokeWidth={2}>
          <path d="M4 11l8-7 8 7" />
          <path d="M6 9.5V20h12V9.5" />
          <path d="M10 20v-5.5h4V20" />
        </svg>
      );
    case "users":
      return (
        <svg {...base(size, props)} {...stroke} strokeWidth={2}>
          <circle cx="9.5" cy="8" r="3.5" />
          <path d="M3.5 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
          <path d="M16 5.2a3.5 3.5 0 010 5.9" />
          <path d="M17.8 14.8c1.7.9 2.7 2.6 2.7 4.7" />
        </svg>
      );
    case "tree":
      return (
        <svg {...base(size, props)} {...stroke} strokeWidth={2}>
          <rect x="9" y="3" width="6" height="5" rx="1" />
          <rect x="3" y="16" width="6" height="5" rx="1" />
          <rect x="15" y="16" width="6" height="5" rx="1" />
          <path d="M12 8v4" />
          <path d="M6 16v-2.5h12V16" />
        </svg>
      );
    case "shield":
      return (
        <svg {...base(size, props)} {...stroke} strokeWidth={2}>
          <path d="M12 3l7 2.8v5.4c0 4.5-3 8.2-7 9.8-4-1.6-7-5.3-7-9.8V5.8z" />
          <path d="M9 11.8l2.1 2.1 3.9-3.9" />
        </svg>
      );
    case "pulse":
      return (
        <svg {...base(size, props)} {...stroke} strokeWidth={2}>
          <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
        </svg>
      );
  }
}
