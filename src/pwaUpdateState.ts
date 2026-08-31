/** Shared PWA update state — banner + Settings can both see a pending refresh. */

type Listener = () => void;

let updatePending = false;
const listeners = new Set<Listener>();

export function isPwaUpdatePending() {
  return updatePending;
}

export function setPwaUpdatePending(pending: boolean) {
  if (updatePending === pending) return;
  updatePending = pending;
  listeners.forEach((listener) => listener());
}

export function subscribePwaUpdate(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
