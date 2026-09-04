import { createClient } from "@supabase/supabase-js";
import { capturePasswordRecoveryFromLocation } from "./authSessionFlags";

capturePasswordRecoveryFromLocation();

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Missing Supabase environment variables. Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.",
  );
}

/** Separate persisted sessions so Master Control and agency can stay signed in together. */
export const AGENCY_AUTH_STORAGE_KEY = "travelhisab-agency-auth";
export const MASTER_AUTH_STORAGE_KEY = "travelhisab-master-auth";

function isControlBootPath() {
  if (typeof window === "undefined") return false;
  return window.location.pathname.replace(/\/$/, "").startsWith("/control");
}

const onControlBoot = isControlBootPath();

/** Agency / company workspace auth (default app). */
export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "", {
  auth: {
    storageKey: AGENCY_AUTH_STORAGE_KEY,
    // Only the matching surface should consume OAuth/password links from the URL.
    detectSessionInUrl: !onControlBoot,
    persistSession: true,
    autoRefreshToken: true,
  },
});

/** Master Control Panel auth — independent of agency login. */
export const supabaseMaster = createClient(supabaseUrl || "", supabaseAnonKey || "", {
  auth: {
    storageKey: MASTER_AUTH_STORAGE_KEY,
    detectSessionInUrl: onControlBoot,
    persistSession: true,
    autoRefreshToken: true,
  },
});
