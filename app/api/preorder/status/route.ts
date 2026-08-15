import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { NextResponse } from "next/server";
import { z } from "zod";

const StatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["confirmed", "ready", "picked_up", "rejected", "cancelled"]),
  reason: z.string().trim().max(300).nullable(),
});

/** Legal transitions — keeps a picked-up or rejected order from being revived. */
const ALLOWED: Record<string, string[]> = {
  pending: ["confirmed", "rejected", "cancelled"],
  confirmed: ["ready", "cancelled"],
  ready: ["picked_up", "cancelled"],
};

export async function POST(request: Request) {
  const session = await getSession();
  if (
    !session ||
    session.preview ||
    !can(session.permissions, session.profile.role, "orders.view")
  ) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const parsed = StatusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { id, status, reason } = parsed.data;
  if (status === "rejected" && !reason) {
    return NextResponse.json({ error: "A reason is required to reject." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("preorders")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ error: "Unknown pre-order." }, { status: 404 });
  }
  if (!(ALLOWED[current.status] ?? []).includes(status)) {
    return NextResponse.json(
      { error: `A ${current.status} pre-order cannot become ${status}.` },
      { status: 409 },
    );
  }

  const { error } = await admin
    .from("preorders")
    .update({
      status,
      reject_reason: status === "rejected" ? reason : null,
      handled_by: session.profile.id,
    })
    .eq("id", id)
    .eq("status", current.status); // optimistic concurrency: no racing double-updates
  if (error) {
    return NextResponse.json({ error: "Update failed. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
