import { createAdminClient } from "@/lib/supabase/admin";
import {
  addDaysYMD,
  manilaNow,
  parsePreorderSettings,
  slotsForDate,
  type PreorderItemSnapshot,
} from "@/lib/preorders";
import { NextResponse } from "next/server";
import { z } from "zod";

const SubmitSchema = z.object({
  customer_name: z.string().trim().min(2).max(80),
  customer_phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{7,20}$/, "Enter a valid mobile number."),
  pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickup_slot: z.string().regex(/^\d{2}:\d{2}$/),
  gcash_reference: z.string().trim().min(4).max(40),
  notes: z.string().trim().max(300).nullable(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        variant_id: z.string().uuid().nullable(),
        qty: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(30),
});

/**
 * Public pre-order submission. No auth — validation, server-side pricing, and
 * slot-capacity checks gate everything; the row lands as 'pending' for staff
 * to verify the GCash payment before anything is prepared.
 */
export async function POST(request: Request) {
  const parsed = SubmitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid order details." },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const admin = createAdminClient();
  const now = new Date();

  const { data: settingsRow } = await admin
    .from("settings")
    .select("value")
    .eq("key", "preorders")
    .maybeSingle();
  if (!settingsRow) {
    return NextResponse.json({ error: "Pre-ordering is not available." }, { status: 503 });
  }
  const settings = parsePreorderSettings(settingsRow.value);
  if (!settings.enabled) {
    return NextResponse.json({ error: "Pre-ordering is currently closed." }, { status: 503 });
  }

  // Date must be today or tomorrow (Manila) and the slot must still be open.
  const today = manilaNow(now).date;
  if (body.pickup_date !== today && body.pickup_date !== addDaysYMD(today, 1)) {
    return NextResponse.json({ error: "Pick a pickup day of today or tomorrow." }, { status: 400 });
  }
  if (!slotsForDate(settings, body.pickup_date, now).includes(body.pickup_slot)) {
    return NextResponse.json(
      { error: "That pickup time is no longer available — pick another slot." },
      { status: 409 },
    );
  }
  const { count } = await admin
    .from("preorders")
    .select("id", { count: "exact", head: true })
    .eq("pickup_date", body.pickup_date)
    .eq("pickup_slot", body.pickup_slot)
    .not("status", "in", "(rejected,cancelled)");
  if ((count ?? 0) >= settings.slot_capacity) {
    return NextResponse.json(
      { error: "That pickup time just filled up — pick another slot." },
      { status: 409 },
    );
  }

  // Server-side pricing from the live catalog; client prices are ignored.
  const productIds = [...new Set(body.items.map((i) => i.product_id))];
  const [{ data: products }, { data: variants }] = await Promise.all([
    admin
      .from("products")
      .select("id, name, price, kind, is_available, archived_at")
      .in("id", productIds),
    admin.from("product_variants").select("id, product_id, name, price_delta"),
  ]);
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const variantById = new Map((variants ?? []).map((v) => [v.id, v]));

  const snapshot: PreorderItemSnapshot[] = [];
  let total = 0;
  for (const item of body.items) {
    const product = productById.get(item.product_id);
    if (!product || product.kind !== "prepared" || !product.is_available || product.archived_at) {
      return NextResponse.json(
        { error: "An item in your order is no longer available." },
        { status: 409 },
      );
    }
    let variantName: string | null = null;
    let unitPrice = Number(product.price);
    if (item.variant_id) {
      const variant = variantById.get(item.variant_id);
      if (!variant || variant.product_id !== product.id) {
        return NextResponse.json(
          { error: "An item option in your order is no longer available." },
          { status: 409 },
        );
      }
      variantName = variant.name;
      unitPrice += Number(variant.price_delta);
    }
    const lineTotal = Math.round(unitPrice * item.qty * 100) / 100;
    total += lineTotal;
    snapshot.push({
      product_id: product.id,
      name: product.name,
      variant_id: item.variant_id,
      variant_name: variantName,
      qty: item.qty,
      unit_price: unitPrice,
      line_total: lineTotal,
    });
  }

  const { data: numberData, error: numberError } = await admin.rpc("next_doc_number", {
    p_kind: "preorder",
  });
  if (numberError || !numberData) {
    return NextResponse.json({ error: "Could not create the order. Try again." }, { status: 500 });
  }

  const { error: insertError } = await admin.from("preorders").insert({
    preorder_number: numberData as string,
    customer_name: body.customer_name,
    customer_phone: body.customer_phone,
    pickup_date: body.pickup_date,
    pickup_slot: body.pickup_slot,
    items: snapshot,
    total: Math.round(total * 100) / 100,
    gcash_reference: body.gcash_reference,
    notes: body.notes,
  });
  if (insertError) {
    return NextResponse.json({ error: "Could not create the order. Try again." }, { status: 500 });
  }

  return NextResponse.json({ preorder_number: numberData });
}
