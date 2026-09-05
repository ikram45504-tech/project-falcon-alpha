import { describe, expect, it } from "vitest";
import {
  COMPANY_REVOKED_MESSAGE,
  COMPANY_SUSPENDED_MESSAGE,
  assertCompanyAllowsWrites,
  companyAllowsWorkspace,
  companyAllowsWrites,
  guardCompanyWrites,
  isCompanyRevoked,
  isCompanySuspended,
  loginBlockMessage,
} from "./companyStatus";

describe("company status Active / Suspend / Revoke", () => {
  it("lets Suspended companies open the workspace but not write", () => {
    expect(companyAllowsWorkspace("SUSPENDED")).toBe(true);
    expect(companyAllowsWrites("SUSPENDED")).toBe(false);
    expect(companyAllowsWorkspace("ACTIVE")).toBe(true);
    expect(companyAllowsWrites("ACTIVE")).toBe(true);
    expect(() => assertCompanyAllowsWrites("SUSPENDED")).toThrow(COMPANY_SUSPENDED_MESSAGE);
    expect(guardCompanyWrites("ACTIVE")).toBe(true);
    expect(guardCompanyWrites("SUSPENDED")).toBe(false);
  });

  it("bars Revoked companies from login and the workspace", () => {
    expect(isCompanyRevoked("REVOKED")).toBe(true);
    expect(companyAllowsWorkspace("REVOKED")).toBe(false);
    expect(companyAllowsWrites("REVOKED")).toBe(false);
    expect(loginBlockMessage("REVOKED")).toBe(COMPANY_REVOKED_MESSAGE);
    expect(isCompanySuspended("REVOKED")).toBe(false);
  });
});
