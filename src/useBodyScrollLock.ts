import { useEffect } from "react";

const SCROLL_LOCK_TARGETS = ".layout-content-wrapper, .mobile-layout-content";

let lockCount = 0;
let savedScrollY = 0;
let lockedScrollContainers: Array<{ el: HTMLElement; scrollTop: number }> = [];

function applyBodyScrollLock() {
  savedScrollY = window.scrollY;
  document.documentElement.classList.add("modal-scroll-locked");
  document.body.classList.add("modal-scroll-locked");

  lockedScrollContainers = Array.from(document.querySelectorAll<HTMLElement>(SCROLL_LOCK_TARGETS)).map((el) => {
    const scrollTop = el.scrollTop;
    el.classList.add("modal-scroll-locked");
    return { el, scrollTop };
  });
}

function releaseBodyScrollLock() {
  document.documentElement.classList.remove("modal-scroll-locked");
  document.body.classList.remove("modal-scroll-locked");
  lockedScrollContainers.forEach(({ el, scrollTop }) => {
    el.classList.remove("modal-scroll-locked");
    el.scrollTop = scrollTop;
  });
  lockedScrollContainers = [];
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
