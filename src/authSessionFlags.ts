const PASSWORD_RECOVERY_KEY = "travelHisabPasswordRecovery";
const PASSWORD_RECOVERY_DONE_KEY = "travelHisabPasswordRecoveryDone";
const PASSWORD_UPDATED_NOTICE_KEY = "travelHisabPasswordUpdatedNotice";

export function markPasswordRecoveryPending() {
  sessionStorage.removeItem(PASSWORD_RECOVERY_DONE_KEY);
  sessionStorage.setItem(PASSWORD_RECOVERY_KEY, "1");
}

export function clearPasswordRecoveryPending() {
  sessionStorage.removeItem(PASSWORD_RECOVERY_KEY);
}

export function isPasswordRecoveryPending() {
  return sessionStorage.getItem(PASSWORD_RECOVERY_KEY) === "1";
}

export function markPasswordRecoveryCompleted() {
  sessionStorage.removeItem(PASSWORD_RECOVERY_KEY);
  sessionStorage.setItem(PASSWORD_RECOVERY_DONE_KEY, "1");
  sessionStorage.setItem(PASSWORD_UPDATED_NOTICE_KEY, "1");
}

export function isPasswordRecoveryCompleted() {
  return sessionStorage.getItem(PASSWORD_RECOVERY_DONE_KEY) === "1";
}

export function consumePasswordUpdatedNotice() {
  const pending = sessionStorage.getItem(PASSWORD_UPDATED_NOTICE_KEY) === "1";
  if (pending) sessionStorage.removeItem(PASSWORD_UPDATED_NOTICE_KEY);
  return pending;
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
  if (isPasswordRecoveryCompleted()) return false;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(window.location.search);
  return hashParams.get("type") === "recovery" || searchParams.get("type") === "recovery";
}

export function stripRecoveryTokensFromUrl(path = "/login") {
  if (typeof window === "undefined") return;
  window.history.replaceState(window.history.state, "", path);
}
