const PRODUCTION_WEB_ORIGIN = "https://travelhisab.vercel.app";

/** Origin that can receive Auth email and OAuth redirects. */
export function getAuthAppOrigin() {
  if (typeof window === "undefined") return PRODUCTION_WEB_ORIGIN;
  const { origin, protocol, hostname } = window.location;
  if (protocol !== "http:" && protocol !== "https:") return PRODUCTION_WEB_ORIGIN;
  if (hostname === "tauri.localhost" || hostname.endsWith(".tauri.localhost")) {
    return PRODUCTION_WEB_ORIGIN;
  }
  return origin;
}

export function passwordResetRedirectTo() {
  return `${getAuthAppOrigin()}/reset-password`;
}

export function googleOAuthRedirectTo() {
  return `${getAuthAppOrigin()}/login`;
}
