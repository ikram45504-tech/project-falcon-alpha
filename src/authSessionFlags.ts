const PASSWORD_RECOVERY_KEY = "travelHisabPasswordRecovery";

export function markPasswordRecoveryPending() {
  sessionStorage.setItem(PASSWORD_RECOVERY_KEY, "1");
}

export function clearPasswordRecoveryPending() {
  sessionStorage.removeItem(PASSWORD_RECOVERY_KEY);
}

export function isPasswordRecoveryPending() {
  return sessionStorage.getItem(PASSWORD_RECOVERY_KEY) === "1";
}

export function urlLooksLikePasswordRecovery() {
  if (typeof window === "undefined") return false;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(window.location.search);
  if (hashParams.get("type") === "recovery" || searchParams.get("type") === "recovery") return true;
  if (window.location.pathname.replace(/\/$/, "") === "/reset-password") {
    return Boolean(hashParams.get("access_token") || searchParams.get("code"));
  }
  return false;
}
