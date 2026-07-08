/**
 * Minimal ambient types for the `qrcode` package — we use only the pure,
 * synchronous `create()` (module matrix) API and render the SVG ourselves
 * (components/qr.tsx), so the full @types/qrcode surface isn't needed.
 */
declare module "qrcode" {
  export interface QRCodeBitMatrix {
    size: number;
    /** 1 = dark module, 0 = light. */
    get(row: number, col: number): number;
  }
  export interface QRCodeObject {
    modules: QRCodeBitMatrix;
    version: number;
  }
  export interface QRCodeCreateOptions {
    errorCorrectionLevel?: "low" | "medium" | "quartile" | "high" | "L" | "M" | "Q" | "H";
    version?: number;
  }
  export function create(text: string, options?: QRCodeCreateOptions): QRCodeObject;
}
