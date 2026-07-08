import type { ReactNode } from "react";
import { PreviewShell } from "@/components/preview";

/** Preview surface — demo fixtures + ⚙ harness, visibly badged. */
export default function PreviewLayout({ children }: { children: ReactNode }) {
  return <PreviewShell>{children}</PreviewShell>;
}
