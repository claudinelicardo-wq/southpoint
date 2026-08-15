"use client";

import { GcashQr } from "@/components/gcash-qr";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { formatPeso } from "@/lib/format";
import { slotLabel } from "@/lib/preorders";
import { useMemo, useState } from "react";

export interface PreorderProduct {
  id: string;
  name: string;
  price: number;
  category_id: string;
  variants: { id: string; name: string; price_delta: number }[];
}

interface CartLine {
  key: string;
  product: PreorderProduct;
  variant: { id: string; name: string; price_delta: number } | null;
  qty: number;
}

function lineUnitPrice(line: CartLine): number {
  return line.product.price + (line.variant?.price_delta ?? 0);
}

export function PreorderClient({
  products,
  categories,
  dates,
  gcashQrImage,
}: {
  products: PreorderProduct[];
  categories: { id: string; name: string }[];
  dates: { date: string; slots: string[] }[];
  gcashQrImage: string | null;
}) {
  const [category, setCategory] = useState<string>("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pickupDate, setPickupDate] = useState(dates[0]?.date ?? "");
  const [slot, setSlot] = useState(dates[0]?.slots[0] ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ number: string } | null>(null);

  const visible = useMemo(
    () => products.filter((p) => category === "all" || p.category_id === category),
    [products, category],
  );
  const total = cart.reduce((s, l) => s + l.qty * lineUnitPrice(l), 0);
  const slotsForSelected = dates.find((d) => d.date === pickupDate)?.slots ?? [];

  function addToCart(product: PreorderProduct, variantId: string | null) {
    const variant = product.variants.find((v) => v.id === variantId) ?? null;
    setCart((prev) => {
      const existing = prev.find(
        (l) => l.product.id === product.id && (l.variant?.id ?? null) === (variant?.id ?? null),
      );
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { key: crypto.randomUUID(), product, variant, qty: 1 }];
    });
  }

  function bumpQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (cart.length === 0) {
      setError("Add at least one item to your order.");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/preorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        pickup_date: pickupDate,
        pickup_slot: slot,
        gcash_reference: reference.trim(),
        notes: notes.trim() || null,
        items: cart.map((l) => ({
          product_id: l.product.id,
          variant_id: l.variant?.id ?? null,
          qty: l.qty,
        })),
      }),
    });
    const json = (await res.json().catch(() => null)) as
      | { preorder_number?: string; error?: string }
      | null;
    setSubmitting(false);
    if (!res.ok || !json?.preorder_number) {
      setError(json?.error ?? "Something went wrong. Please try again.");
      return;
    }
    setDone({ number: json.preorder_number });
  }

  if (done) {
    return (
      <div className="rounded-(--radius-card) border border-line bg-paper p-8 text-center shadow-(--shadow-card)">
        <p className="font-display text-2xl font-semibold text-espresso">Order received!</p>
        <p className="mt-2 text-4xl font-bold text-court">{done.number}</p>
        <p className="mt-4 text-sm text-roast">
          Pickup {pickupDate} · {slotLabel(slot)}
        </p>
        <p className="mt-3 text-sm text-latte">
          We&apos;ll verify your GCash payment and prepare your order. Show this number at the
          counter. If there&apos;s a problem with the payment we&apos;ll call{" "}
          <span className="font-medium text-roast">{phone}</span>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* ------------------------------------------------ menu */}
      <section>
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          <CategoryPill active={category === "all"} onClick={() => setCategory("all")} label="All" />
          {categories.map((c) => (
            <CategoryPill
              key={c.id}
              active={category === c.id}
              onClick={() => setCategory(c.id)}
              label={c.name}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {visible.map((p) => (
            <MenuTile key={p.id} product={p} onAdd={addToCart} />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ cart */}
      {cart.length > 0 && (
        <section className="rounded-(--radius-card) border border-line bg-paper p-4 shadow-(--shadow-card)">
          <h2 className="mb-2 font-display text-lg font-semibold text-espresso">Your order</h2>
          <ul className="divide-y divide-line/60">
            {cart.map((l) => (
              <li key={l.key} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-espresso">
                    {l.product.name}
                    {l.variant && <span className="text-latte"> · {l.variant.name}</span>}
                  </p>
                  <p className="text-xs text-latte">{formatPeso(lineUnitPrice(l))} each</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => bumpQty(l.key, -1)}
                    className="h-8 w-8 rounded-lg bg-sand font-bold text-roast"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-semibold">{l.qty}</span>
                  <button
                    type="button"
                    onClick={() => bumpQty(l.key, 1)}
                    className="h-8 w-8 rounded-lg bg-sand font-bold text-roast"
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <span className="font-semibold text-espresso">Total</span>
            <span className="text-lg font-bold text-espresso">{formatPeso(total)}</span>
          </div>
        </section>
      )}

      {/* ------------------------------------------------ pickup + payment */}
      <section className="space-y-4 rounded-(--radius-card) border border-line bg-paper p-4 shadow-(--shadow-card)">
        <h2 className="font-display text-lg font-semibold text-espresso">Pickup & payment</h2>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pickup day">
            <Select
              value={pickupDate}
              onChange={(e) => {
                const d = e.target.value;
                setPickupDate(d);
                setSlot(dates.find((x) => x.date === d)?.slots[0] ?? "");
              }}
            >
              {dates.map((d, i) => (
                <option key={d.date} value={d.date}>
                  {i === 0 ? `Today (${d.date})` : `Tomorrow (${d.date})`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pickup time">
            <Select value={slot} onChange={(e) => setSlot(e.target.value)}>
              {slotsForSelected.map((s) => (
                <option key={s} value={s}>
                  {slotLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Your name">
            <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Mobile number" hint="We'll call this if there's an issue.">
            <Input
              required
              type="tel"
              inputMode="tel"
              placeholder="09XX XXX XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Notes" hint="Allergies, requests, etc. (optional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
        </Field>

        <div>
          <p className="text-sm font-medium text-roast">
            Pay {total > 0 ? formatPeso(total) : ""} via GCash, then enter the reference number:
          </p>
          <GcashQr image={gcashQrImage} />
          <Field label="GCash reference no.">
            <Input
              required
              minLength={4}
              maxLength={40}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="From your GCash receipt"
            />
          </Field>
        </div>

        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Place pre-order{total > 0 ? ` · ${formatPeso(total)}` : ""}
        </Button>
        <p className="text-center text-xs text-latte">
          Your order is confirmed once we verify the GCash payment. Unverified orders are not
          prepared.
        </p>
      </section>
    </form>
  );
}

function CategoryPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-espresso text-paper" : "bg-sand text-roast hover:bg-line",
      )}
    >
      {label}
    </button>
  );
}

function MenuTile({
  product,
  onAdd,
}: {
  product: PreorderProduct;
  onAdd: (p: PreorderProduct, variantId: string | null) => void;
}) {
  const [variantId, setVariantId] = useState(product.variants[0]?.id ?? "");
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-line bg-paper p-3 shadow-(--shadow-card)">
      <p className="line-clamp-2 text-sm font-medium text-espresso">{product.name}</p>
      {product.variants.length > 0 && (
        <select
          value={variantId}
          onChange={(e) => setVariantId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-line bg-paper px-2 py-1 text-xs text-roast"
        >
          {product.variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.price_delta !== 0 ? ` +${v.price_delta}` : ""}
            </option>
          ))}
        </select>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-court-deep">
          {formatPeso(
            product.price +
              (product.variants.find((v) => v.id === variantId)?.price_delta ?? 0),
          )}
        </span>
        <button
          type="button"
          onClick={() => onAdd(product, variantId || null)}
          className="rounded-lg bg-court px-3 py-1.5 text-xs font-semibold text-white active:scale-95"
        >
          Add
        </button>
      </div>
    </div>
  );
}
