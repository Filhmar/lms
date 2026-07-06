import type { CSSProperties } from "react";

/**
 * FakeQr — deterministic, dependency-free decorative QR-style SVG grid.
 * NOT a scannable code: it is the demo stand-in for the design's QR
 * placeholder blocks (p4b / p4c / d9c). Always keep it `aria-hidden` and
 * render the verify URL as visible text beside it.
 *
 * Deterministic (seeded from `code`) so server and client render the same
 * markup — no hydration drift, no Math.random.
 */

const N = 21; // modules per side, QR version-1 geometry

function fnv1a(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Finder patterns + separators occupy the three 8×8 corner zones. */
function inFinderZone(row: number, col: number): boolean {
  return (
    (row < 8 && col < 8) ||
    (row < 8 && col >= N - 8) ||
    (row >= N - 8 && col < 8)
  );
}

export interface FakeQrProps {
  /** Seed — use the full verify URL so each credential draws differently. */
  code: string;
  size?: number | string;
  color?: string;
  background?: string;
  className?: string;
  style?: CSSProperties;
}

export function FakeQr({
  code,
  size = 84,
  color = "#17233F",
  background = "#ffffff",
  className,
  style,
}: FakeQrProps) {
  const rand = mulberry32(fnv1a(code));
  const modules: [number, number][] = [];
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      if (inFinderZone(row, col)) continue;
      const isTiming = row === 6 || col === 6;
      const on = isTiming ? (row === 6 ? col : row) % 2 === 0 : rand() < 0.46;
      if (on) modules.push([col, row]);
    }
  }
  const finders: [number, number][] = [
    [0, 0],
    [N - 7, 0],
    [0, N - 7],
  ];
  return (
    <svg
      viewBox={`0 0 ${N} ${N}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
      className={className}
      style={style}
    >
      <rect width={N} height={N} fill={background} />
      {modules.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />
      ))}
      {finders.map(([x, y]) => (
        <g key={`f${x}-${y}`}>
          <rect x={x} y={y} width={7} height={7} fill={color} />
          <rect x={x + 1} y={y + 1} width={5} height={5} fill={background} />
          <rect x={x + 2} y={y + 2} width={3} height={3} fill={color} />
        </g>
      ))}
    </svg>
  );
}
