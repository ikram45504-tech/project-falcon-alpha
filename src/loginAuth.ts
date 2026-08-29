import { supabase } from "./supabaseClient";

/**
 * Resolves the Supabase auth email for sign-in.
 * - Email only (no company code): uses the email directly.
 * - Company code + username or email: looks up via get_user_email RPC.
 */
export async function resolveLoginEmail(companyCode: string, identifier: string): Promise<string> {
  const code = companyCode.trim();
  const loginId = identifier.trim();

  if (!loginId) {
    throw new Error("Enter your username or email address.");
  }

  if (!code && loginId.includes("@")) {
    return loginId;
  }

  if (!code) {
    throw new Error("Enter your Company Code to sign in with username.");
  }

  const { data: resolvedEmail, error: rpcError } = await supabase.rpc("get_user_email", {
    p_company_code: code,
    p_username: loginId,
  });

  if (rpcError) {
    throw new Error(rpcError.message || "Could not verify Company Code or username.");
  }

  if (!resolvedEmail) {
    throw new Error("Company Code or Username/Email is incorrect.");
  }

  return String(resolvedEmail);
}
