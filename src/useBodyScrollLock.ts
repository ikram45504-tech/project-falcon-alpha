import { useEffect } from "react";

let lockCount = 0;
let savedScrollY = 0;

function applyBodyScrollLock() {
  savedScrollY = window.scrollY;
  document.documentElement.classList.add("modal-scroll-locked");
  document.body.classList.add("modal-scroll-locked");
  document.body.style.top = `-${savedScrollY}px`;
}

function releaseBodyScrollLock() {
  document.documentElement.classList.remove("modal-scroll-locked");
  document.body.classList.remove("modal-scroll-locked");
  document.body.style.top = "";
  window.scrollTo(0, savedScrollY);
}

export function lockBodyScroll() {
  if (lockCount === 0) applyBodyScrollLock();
  lockCount += 1;
  return () => {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) releaseBodyScrollLock();
  };
}

export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    return lockBodyScroll();
  }, [active]);
}
