/** Runs before React so mobile PWA gets correct shell class immediately (avoids stale layout flash). */
(function bootstrapMobileShell() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;

  var ua = navigator.userAgent || "";
  var touchPrimary = window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(hover: none)").matches;
  var mobileUa =
    /iPhone|iPod|iPad|Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  var narrow = window.matchMedia("(max-width: 820px)").matches;

  var useMobileShell = mobileUa || touchPrimary || (standalone && (touchPrimary || narrow));

  if (useMobileShell) {
    document.documentElement.classList.add("phone-ui");
    document.documentElement.dataset.shell = "mobile";
    document.documentElement.dataset.layout = "layout-mobile";
  }
})();
