import { create as createQr } from "qrcode";
import type { CSSProperties } from "react";

/**
 * QrCode — real, scannable QR rendered as an inline SVG from the `qrcode`
 * module matrix (synchronous + deterministic, so server and client emit the
 * same markup — no canvas, no async, no hydration drift).
 *
 * Accessibility contract (kept from the design's placeholder): the SVG is
 * decorative (`aria-hidden`); callers must render the verify URL as visible
 * text beside it so the destination is never image-only.
 */

export interface QrCodeProps {
  /** QR payload — the credential's public verify URL. */
  value: string;
  size?: number | string;
  color?: string;
  background?: string;
  className?: string;
  style?: CSSProperties;
}

/** Quiet zone (modules of blank border) — the QR spec asks for 4; the
    consumers add their own white framing, so 2 keeps codes scannable
    without shrinking the modules further at small sizes. */
const QUIET = 2;

export function QrCode({
  value,
  size = 84,
  color = "#17233F",
  background = "#ffffff",
  className,
  style,
}: QrCodeProps) {
  const qr = createQr(value, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const box = n + QUIET * 2;
  let d = "";
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.modules.get(row, col)) {
        d += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
      }
    }
  }
  return (
    <svg
      viewBox={`0 0 ${box} ${box}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
      className={className}
      style={style}
    >
      <rect width={box} height={box} fill={background} />
      <path d={d} fill={color} />
    </svg>
  );
}
