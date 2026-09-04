import { supabase, supabaseMaster } from "./supabaseClient";
import { googleOAuthRedirectTo, masterGoogleOAuthRedirectTo, passwordResetRedirectTo } from "./authRedirect";
import { resolveLoginEmail } from "./loginAuth";

export type CompanyMembershipMatch = {
  company_id: string;
  company_code: string;
  company_name: string;
  role: string;
  full_name: string;
  username: string;
  phone: string;
  status: string;
};

export async function requestPasswordReset(companyCode: string, identifier: string) {
  const email = await resolveLoginEmail(companyCode, identifier);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: passwordResetRedirectTo(),
  });
  if (error) {
    throw new Error(error.message || "Could not send the password reset email.");
  }
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: googleOAuthRedirectTo(),
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) {
    const message = error.message || "Google sign-in failed.";
    if (/provider is not enabled|unsupported provider/i.test(message)) {
      throw new Error("Google sign-in is not enabled yet. Use Company Code and password, or Forgot password.");
    }
    throw new Error(message);
  }
}

export async function signInWithGoogleAsMaster() {
  const { error } = await supabaseMaster.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: masterGoogleOAuthRedirectTo(),
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) {
    const message = error.message || "Google sign-in failed.";
    if (/provider is not enabled|unsupported provider/i.test(message)) {
      throw new Error("Google sign-in is not enabled yet.");
    }
    throw new Error(message);
  }
}

export async function linkCurrentAuthUserToCompany(companyCode: string) {
  const code = companyCode.trim();
  if (!code) throw new Error("Enter your Company Code.");

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("Sign in with Google first, then join your company.");
  }

  const { data, error } = await supabase.rpc("get_company_member_for_email", {
    p_company_code: code,
  });
  if (error) {
    throw new Error(error.message || "Could not look up this company.");
  }

  const row = (Array.isArray(data) ? data[0] : data) as CompanyMembershipMatch | null;
  if (!row?.company_id) {
    throw new Error(
      "This Google account is not a member of that company. Ask your admin to add this email, or create a new company.",
    );
  }
  if (String(row.status || "").toUpperCase() === "DISABLED") {
    throw new Error("This account is disabled. Ask your company admin to enable it.");
  }

  const { error: metadataError } = await supabase.auth.updateUser({
    data: {
      company_id: row.company_id,
      company_code: row.company_code,
      company_name: row.company_name,
      role: row.role,
      full_name: row.full_name,
      username: row.username,
      phone: row.phone || "",
    },
  });
  if (metadataError) throw new Error(metadataError.message);

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) throw new Error(refreshError.message);
}

export function googleAuthErrorFromUrl(search: string) {
  const params = new URLSearchParams(search);
  const description = params.get("error_description") || params.get("error");
  return description ? decodeURIComponent(description.replace(/\+/g, " ")) : "";
}
