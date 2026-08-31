import { useEffect, useState } from "react";
import { isPwaUpdatePending, setPwaUpdatePending, subscribePwaUpdate } from "./pwaUpdateState";

export function usePwaUpdatePending() {
  const [pending, setPending] = useState(isPwaUpdatePending);

  useEffect(() => subscribePwaUpdate(() => setPending(isPwaUpdatePending())), []);

  return {
    updatePending: pending,
    setUpdatePending: setPwaUpdatePending,
  };
}
