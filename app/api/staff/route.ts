import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/session";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateStaffSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  role: z.enum(["owner", "manager", "cashier", "kitchen", "inventory", "accountant"]),
});

/**
 * Creates a staff auth account + profile. Owner only.
 * Uses the service-role key server-side; the profile row is created by the
 * on_auth_user_created trigger from the user metadata.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.preview || session.profile.role !== "owner") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const parsed = CreateStaffSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid staff details." }, { status: 400 });
  }
  const { full_name, email, password, role } = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role, is_active: true },
  });
  if (error || !data.user) {
    const message = error?.message?.includes("already been registered")
      ? "That email already has an account."
      : "Could not create the account.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Audit via definer RPC as the acting owner (not the service role).
  await admin.rpc("log_audit_service", {
    p_actor: session.profile.id,
    p_action: "staff.create",
    p_entity: "profiles",
    p_entity_id: data.user.id,
    p_after: { full_name, email, role },
  });

  return NextResponse.json({ id: data.user.id });
}
