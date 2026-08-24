import { useState, useEffect } from "react";

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop("__TAURI_INTERNALS__" in window);
  }, []);

  return isDesktop;
}
