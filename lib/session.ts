import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Profile } from "@/lib/types";

export interface Session {
  profile: Profile;
  /** Permission keys granted to this role (owner is handled by `can`). */
  permissions: ReadonlySet<string>;
  /** True when running without a configured Supabase project (UI preview only). */
  preview: boolean;
}

const PREVIEW_PROFILE: Profile = {
  id: "00000000-0000-0000-0000-000000000000",
  full_name: "Preview Owner",
  role: "owner",
  is_active: true,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

/**
 * Loads the signed-in staff member's profile and role permissions.
 * Returns null when signed out or the profile is missing/deactivated.
 *
 * When Supabase is not configured (fresh checkout, no project yet) it returns a
 * clearly-labeled preview session so the UI can be exercised without a backend.
 */
export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured) {
    return { profile: PREVIEW_PROFILE, permissions: new Set(), preview: true };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();
  if (!profile || !profile.is_active) return null;

  let permissions = new Set<string>();
  if (profile.role !== "owner") {
    const { data: perms } = await supabase
      .from("role_permissions")
      .select("permission")
      .eq("role", profile.role);
    permissions = new Set((perms ?? []).map((p) => p.permission));
  }

  return { profile, permissions, preview: false };
}
