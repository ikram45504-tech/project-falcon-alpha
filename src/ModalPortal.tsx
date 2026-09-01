import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/** Render modals on document.body so position:fixed overlays the viewport. */
export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return <>{children}</>;
  return createPortal(children, document.body);
}
