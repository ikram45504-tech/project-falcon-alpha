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

export function isResetPasswordPath() {
  if (typeof window === "undefined") return false;
  return window.location.pathname.replace(/\/$/, "") === "/reset-password";
}

/** Call before the Supabase client is created so tokens are not lost after the hash is consumed. */
export function capturePasswordRecoveryFromLocation() {
  if (typeof window === "undefined") return;
  const hash = window.location.hash.replace(/^#/, "");
  const search = window.location.search;
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(search);
  if (isResetPasswordPath() || hashParams.get("type") === "recovery" || searchParams.get("type") === "recovery") {
    markPasswordRecoveryPending();
  }
}

export function urlLooksLikePasswordRecovery() {
  if (typeof window === "undefined") return false;
  if (isResetPasswordPath()) return true;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(window.location.search);
  return hashParams.get("type") === "recovery" || searchParams.get("type") === "recovery";
}
