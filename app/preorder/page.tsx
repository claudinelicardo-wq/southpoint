import { createAdminClient } from "@/lib/supabase/admin";
import {
  addDaysYMD,
  manilaNow,
  parsePreorderSettings,
  slotsForDate,
  timeLabel,
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
  let hours: string | null = null;
  let today = "";

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
      hours = `${timeLabel(settings.open_time)} – ${timeLabel(settings.close_time)}`;
      if (!settings.enabled) {
        closedMessage = "Pre-ordering is currently closed. Please order at the counter.";
      } else {
        gcashQrImage =
          (receiptRes.data?.value as { gcash_qr_image?: string } | null)?.gcash_qr_image ?? null;

        today = manilaNow(now).date;
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
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-28 pt-6">
      {/* ------------------------------------------------ landing hero */}
      <header className="mb-6 overflow-hidden rounded-(--radius-card) border border-line bg-paper shadow-(--shadow-card)">
        <div className="flex flex-col items-center gap-2 bg-cream px-5 pb-6 pt-7 text-center">
          <Wordmark />
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-espresso sm:text-3xl">
            Skip the line. Order ahead.
          </h1>
          <p className="max-w-md text-sm text-roast">
            Pick your food and drinks, choose a pickup time, pay with GCash — we&apos;ll have it
            ready when you get here.
          </p>
          {!closedMessage && (
            <a
              href="#menu"
              className="mt-3 inline-flex h-12 items-center rounded-xl bg-court px-6 text-base font-semibold text-white shadow-sm hover:bg-court-deep"
            >
              Start your order
            </a>
          )}
          {hours && (
            <p className="mt-1 text-xs text-latte">Pickup hours: {hours} daily</p>
          )}
        </div>
        <ol className="grid grid-cols-3 divide-x divide-line border-t border-line text-center">
          {[
            ["1", "Choose", "Pick from our menu"],
            ["2", "Pay", "Send via GCash"],
            ["3", "Pick up", "At your time slot"],
          ].map(([n, title, sub]) => (
            <li key={n} className="px-2 py-3">
              <span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-espresso text-xs font-bold text-paper">
                {n}
              </span>
              <p className="mt-1.5 text-sm font-semibold text-espresso">{title}</p>
              <p className="text-xs text-latte">{sub}</p>
            </li>
          ))}
        </ol>
      </header>

      {closedMessage ? (
        <div className="rounded-(--radius-card) border border-line bg-paper p-8 text-center shadow-(--shadow-card)">
          <p className="text-espresso">{closedMessage}</p>
        </div>
      ) : (
        <PreorderClient
          products={products}
          categories={categories}
          dates={dates}
          today={today}
          gcashQrImage={gcashQrImage}
        />
      )}
    </main>
  );
}
