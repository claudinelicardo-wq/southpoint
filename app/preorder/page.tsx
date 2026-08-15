import { createAdminClient } from "@/lib/supabase/admin";
import {
  addDaysYMD,
  manilaNow,
  parsePreorderSettings,
  slotsForDate,
} from "@/lib/preorders";
import { Wordmark } from "@/components/wordmark";
import { PreorderClient, type PreorderProduct } from "./preorder-client";

export const metadata = { title: "Pre-order" };
export const dynamic = "force-dynamic";

/**
 * Public pre-order page — no login. All data is fetched server-side with the
 * service-role client; the browser only ever talks to /api/preorder.
 */
export default async function PreorderPage() {
  let closedMessage: string | null = null;
  let products: PreorderProduct[] = [];
  let categories: { id: string; name: string }[] = [];
  let gcashQrImage: string | null = null;
  let dates: { date: string; slots: string[] }[] = [];

  try {
    const admin = createAdminClient();
    const now = new Date();

    const [settingsRes, receiptRes] = await Promise.all([
      admin.from("settings").select("value").eq("key", "preorders").maybeSingle(),
      admin.from("settings").select("value").eq("key", "receipt").maybeSingle(),
    ]);
    if (!settingsRes.data) {
      closedMessage = "Pre-ordering isn't set up yet. Please order at the counter.";
    } else {
      const settings = parsePreorderSettings(settingsRes.data.value);
      if (!settings.enabled) {
        closedMessage = "Pre-ordering is currently closed. Please order at the counter.";
      } else {
        gcashQrImage =
          (receiptRes.data?.value as { gcash_qr_image?: string } | null)?.gcash_qr_image ?? null;

        const today = manilaNow(now).date;
        const candidates = [today, addDaysYMD(today, 1)];

        const [p, c, v, counts] = await Promise.all([
          admin
            .from("products")
            .select("id, name, price, category_id, kind, is_available")
            .eq("kind", "prepared")
            .eq("is_available", true)
            .is("archived_at", null)
            .order("name"),
          admin.from("categories").select("id, name").is("archived_at", null).order("sort_order"),
          admin.from("product_variants").select("id, product_id, name, price_delta").order("sort_order"),
          admin
            .from("preorders")
            .select("pickup_date, pickup_slot")
            .in("pickup_date", candidates)
            .not("status", "in", "(rejected,cancelled)"),
        ]);

        const variantsByProduct = new Map<string, { id: string; name: string; price_delta: number }[]>();
        for (const row of v.data ?? []) {
          const list = variantsByProduct.get(row.product_id) ?? [];
          list.push({ id: row.id, name: row.name, price_delta: Number(row.price_delta) });
          variantsByProduct.set(row.product_id, list);
        }
        products = (p.data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          price: Number(row.price),
          category_id: row.category_id,
          variants: variantsByProduct.get(row.id) ?? [],
        }));
        categories = (c.data ?? []).filter((cat) =>
          products.some((prod) => prod.category_id === cat.id),
        );

        // Slot availability: configured slots minus the ones already at capacity.
        const bookedBySlot = new Map<string, number>();
        for (const row of counts.data ?? []) {
          const key = `${row.pickup_date}|${String(row.pickup_slot).slice(0, 5)}`;
          bookedBySlot.set(key, (bookedBySlot.get(key) ?? 0) + 1);
        }
        dates = candidates
          .map((date) => ({
            date,
            slots: slotsForDate(settings, date, now).filter(
              (slot) => (bookedBySlot.get(`${date}|${slot}`) ?? 0) < settings.slot_capacity,
            ),
          }))
          .filter((d) => d.slots.length > 0);
        if (dates.length === 0) {
          closedMessage =
            "All pickup slots are taken for now. Please try again later or order at the counter.";
        }
      }
    }
  } catch {
    closedMessage = "Pre-ordering is temporarily unavailable. Please order at the counter.";
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6">
      <div className="mb-6 flex flex-col items-center gap-1 text-center">
        <Wordmark />
        <p className="text-sm text-latte">
          Order ahead, pay via GCash, and pick up courtside.
        </p>
      </div>
      {closedMessage ? (
        <div className="rounded-(--radius-card) border border-line bg-paper p-8 text-center shadow-(--shadow-card)">
          <p className="text-espresso">{closedMessage}</p>
        </div>
      ) : (
        <PreorderClient
          products={products}
          categories={categories}
          dates={dates}
          gcashQrImage={gcashQrImage}
        />
      )}
    </main>
  );
}
