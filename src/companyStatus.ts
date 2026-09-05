import { COMPANY_NAME } from "./brand";

export type AgencyCompanyStatus = "ACTIVE" | "PENDING_APPROVAL" | "SUSPENDED" | "REVOKED" | "INACTIVE";

export const COMPANY_SUSPENDED_MESSAGE = "This account has been suspended.";
export const COMPANY_REVOKED_MESSAGE = `This account has been revoked. Please contact ${COMPANY_NAME}.`;
export const COMPANY_SUSPENDED_EVENT = "th-company-suspended";

export function companyStatusKey(status?: string | null) {
  return String(status || "").toUpperCase();
}

export function isCompanyActive(status?: string | null) {
  return companyStatusKey(status) === "ACTIVE";
}

export function isCompanySuspended(status?: string | null) {
  return companyStatusKey(status) === "SUSPENDED";
}

export function isCompanyRevoked(status?: string | null) {
  return companyStatusKey(status) === "REVOKED";
}

/** Suspended companies may view the workspace. Revoked / pending / inactive may not. */
export function companyAllowsWorkspace(status?: string | null) {
  const key = companyStatusKey(status);
  return key === "ACTIVE" || key === "SUSPENDED";
}

export function companyAllowsWrites(status?: string | null) {
  return isCompanyActive(status);
}

export function notifyCompanySuspended() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COMPANY_SUSPENDED_EVENT, {
      detail: { title: "Account suspended", message: COMPANY_SUSPENDED_MESSAGE },
    }),
  );
}

/** Returns true when writes are allowed. Otherwise shows the suspend dialog. */
export function guardCompanyWrites(status?: string | null) {
  if (companyAllowsWrites(status)) return true;
  notifyCompanySuspended();
  return false;
}

export function assertCompanyAllowsWrites(status?: string | null) {
  if (isCompanyRevoked(status)) {
    throw new Error(COMPANY_REVOKED_MESSAGE);
  }
  if (isCompanySuspended(status)) {
    notifyCompanySuspended();
    throw new Error(COMPANY_SUSPENDED_MESSAGE);
  }
}

export function loginBlockMessage(status?: string | null) {
  if (isCompanyRevoked(status)) return COMPANY_REVOKED_MESSAGE;
  if (companyStatusKey(status) === "PENDING_APPROVAL") {
    return `Your registration is under review. ${COMPANY_NAME} will contact you shortly once your account is activated.`;
  }
  return `This company cannot open the workspace right now. Please contact ${COMPANY_NAME} for help.`;
}
