"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import type { SettingRow } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Json = Record<string, unknown>;

function useSetting(settings: SettingRow[], key: string): Json {
  return useMemo(
    () => (settings.find((s) => s.key === key)?.value ?? {}) as Json,
    [settings, key],
  );
}

function SaveState({ state }: { state: "idle" | "saved" | "error" }) {
  if (state === "saved") return <Badge tone="success">Saved</Badge>;
  if (state === "error") return <Badge tone="danger">Save failed</Badge>;
  return null;
}

function useSave() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(key: string, value: Json) {
    setSaving(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_setting", {
      p_key: key,
      p_value: value,
    });
    setSaving(false);
    if (error) {
      setState("error");
      setMessage(error.message);
      return;
    }
    setState("saved");
    router.refresh();
    setTimeout(() => setState("idle"), 2500);
  }
  return { save, state, saving, message };
}

export function SettingsForms({
  settings,
  isOwner,
  preview,
}: {
  settings: SettingRow[];
  isOwner: boolean;
  preview: boolean;
}) {
  return (
    <div className="space-y-6">
      {preview && (
        <Alert tone="warning">
          Settings need a connected Supabase project. Values shown are defaults.
        </Alert>
      )}
      <BusinessProfileForm settings={settings} disabled={preview} />
      <ReceiptForm settings={settings} disabled={preview} />
      <PreordersForm settings={settings} disabled={preview} />
      <TaxForm settings={settings} disabled={preview || !isOwner} ownerOnly />
      <InventoryPolicyForm settings={settings} disabled={preview || !isOwner} ownerOnly />
      <ShiftsForm settings={settings} disabled={preview || !isOwner} ownerOnly />
      <LoyaltyForm settings={settings} disabled={preview || !isOwner} ownerOnly />
    </div>
  );
}

function SectionCard({
  title,
  description,
  ownerOnly,
  children,
}: {
  title: string;
  description: string;
  ownerOnly?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={ownerOnly ? <Badge tone="accent">Owner-only</Badge> : undefined}
      />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function BusinessProfileForm({
  settings,
  disabled,
}: {
  settings: SettingRow[];
  disabled: boolean;
}) {
  const value = useSetting(settings, "business_profile");
  const { save, state, saving, message } = useSave();
  const [form, setForm] = useState({
    name: String(value.name ?? "South Point Cafe & Lounge"),
    tagline: String(value.tagline ?? ""),
    address: String(value.address ?? ""),
    phone: String(value.phone ?? ""),
    email: String(value.email ?? ""),
  });

  return (
    <SectionCard
      title="Business profile"
      description="Shown on receipts, reports, and printed documents."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save("business_profile", form);
        }}
      >
        {message && <Alert tone="danger">{message}</Alert>}
        <Field label="Business name">
          <Input
            required
            value={form.name}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Tagline">
          <Input
            value={form.tagline}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
          />
        </Field>
        <Field label="Address">
          <Textarea
            value={form.address}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone">
            <Input
              value={form.phone}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-3">
          <SaveState state={state} />
          <Button type="submit" loading={saving} disabled={disabled}>
            Save
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function ReceiptForm({
  settings,
  disabled,
}: {
  settings: SettingRow[];
  disabled: boolean;
}) {
  const value = useSetting(settings, "receipt");
  const { save, state, saving, message } = useSave();
  const [form, setForm] = useState({
    width_mm: Number(value.width_mm ?? 58),
    footer: String(value.footer ?? ""),
    show_loyalty_points: Boolean(value.show_loyalty_points ?? true),
    gcash_qr_image: (value.gcash_qr_image as string | null) ?? null,
  });
  const [qrError, setQrError] = useState<string | null>(null);

  function onQrFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setQrError(null);
    if (!file.type.startsWith("image/")) {
      setQrError("Choose an image file (PNG or JPG).");
      return;
    }
    if (file.size > 1_500_000) {
      setQrError("Image is too large — use one under 1.5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, gcash_qr_image: reader.result as string }));
    reader.readAsDataURL(file);
  }

  return (
    <SectionCard
      title="Receipt"
      description="Thermal printer format, receipt footer, and the GCash QR code shown at checkout."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save("receipt", form);
        }}
      >
        {message && <Alert tone="danger">{message}</Alert>}
        <Field label="Printer width">
          <Select
            value={String(form.width_mm)}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, width_mm: Number(e.target.value) })}
          >
            <option value="58">58 mm</option>
            <option value="80">80 mm</option>
          </Select>
        </Field>
        <Field label="Footer message">
          <Input
            value={form.footer}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, footer: e.target.value })}
          />
        </Field>
        <Switch
          checked={form.show_loyalty_points}
          disabled={disabled}
          onChange={(v) => setForm({ ...form, show_loyalty_points: v })}
          label="Show loyalty points on receipts"
        />
        <Field
          label="GCash QR code"
          hint="Shown to the customer whenever GCash is selected as the payment method, in POS and tab settlement."
        >
          <div className="flex items-start gap-3">
            {form.gcash_qr_image && (
              <img
                src={form.gcash_qr_image}
                alt="GCash QR code"
                className="h-24 w-24 rounded-lg border border-line object-contain"
              />
            )}
            <div className="space-y-1.5">
              <input
                type="file"
                accept="image/*"
                disabled={disabled}
                onChange={onQrFile}
                className="block text-sm text-roast file:mr-3 file:rounded-lg file:border-0 file:bg-court file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-court-deep"
              />
              {form.gcash_qr_image && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, gcash_qr_image: null }))}
                  className="text-xs text-danger underline underline-offset-2"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          {qrError && <p className="mt-1 text-xs text-danger">{qrError}</p>}
        </Field>
        <div className="flex items-center justify-end gap-3">
          <SaveState state={state} />
          <Button type="submit" loading={saving} disabled={disabled}>
            Save
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function PreordersForm({
  settings,
  disabled,
}: {
  settings: SettingRow[];
  disabled: boolean;
}) {
  const value = useSetting(settings, "preorders");
  const missing = !settings.some((s) => s.key === "preorders");
  const { save, state, saving, message } = useSave();
  const [form, setForm] = useState({
    enabled: Boolean(value.enabled ?? false),
    open_time: String(value.open_time ?? "10:00"),
    close_time: String(value.close_time ?? "21:00"),
    // Strings while editing — Number("") snaps a controlled input back to 0.
    slot_capacity: String(value.slot_capacity ?? 4),
    lead_minutes: String(value.lead_minutes ?? 45),
  });

  return (
    <SectionCard
      title="Pre-orders"
      description="The public pre-order page at /preorder: customers pay via your GCash QR and pick a 30-minute pickup slot; staff verify and confirm on the Pre-orders page."
    >
      {missing ? (
        <Alert tone="warning">
          Apply migration 0014_preorders.sql to the database first (Supabase dashboard → SQL
          editor), then reload this page.
        </Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save("preorders", {
              ...form,
              slot_capacity: Math.max(1, Number(form.slot_capacity) || 4),
              lead_minutes: Math.max(0, Number(form.lead_minutes) || 0),
            });
          }}
        >
          {message && <Alert tone="danger">{message}</Alert>}
          <Switch
            checked={form.enabled}
            disabled={disabled}
            onChange={(v) => setForm({ ...form, enabled: v })}
            label="Accept pre-orders"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First pickup slot">
              <Input
                type="time"
                value={form.open_time}
                disabled={disabled}
                onChange={(e) => setForm({ ...form, open_time: e.target.value })}
              />
            </Field>
            <Field label="Last pickup ends">
              <Input
                type="time"
                value={form.close_time}
                disabled={disabled}
                onChange={(e) => setForm({ ...form, close_time: e.target.value })}
              />
            </Field>
            <Field label="Max orders per 30-min slot">
              <Input
                type="number"
                min="1"
                value={form.slot_capacity}
                disabled={disabled}
                onChange={(e) => setForm({ ...form, slot_capacity: e.target.value })}
              />
            </Field>
            <Field label="Lead time (minutes)" hint="Earliest pickup is this long from now.">
              <Input
                type="number"
                min="0"
                value={form.lead_minutes}
                disabled={disabled}
                onChange={(e) => setForm({ ...form, lead_minutes: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex items-center justify-end gap-3">
            <SaveState state={state} />
            <Button type="submit" loading={saving} disabled={disabled}>
              Save
            </Button>
          </div>
        </form>
      )}
    </SectionCard>
  );
}

function TaxForm({
  settings,
  disabled,
  ownerOnly,
}: {
  settings: SettingRow[];
  disabled: boolean;
  ownerOnly?: boolean;
}) {
  const value = useSetting(settings, "tax");
  const { save, state, saving, message } = useSave();
  const [form, setForm] = useState({
    vat_registered: Boolean(value.vat_registered ?? false),
    pricing_mode: String(value.pricing_mode ?? "tax_inclusive"),
    // Kept as strings while editing — Number("") coercing to 0 on every
    // keystroke made the field snap back to "0" and block typing.
    vat_rate: String(value.vat_rate ?? 0.12),
    service_charge_rate: String(value.service_charge_rate ?? 0),
    sc_pwd_discount_rate: String(value.sc_pwd_discount_rate ?? 0.2),
    sc_pwd_vat_exempt: Boolean(value.sc_pwd_vat_exempt ?? true),
  });

  return (
    <SectionCard
      title="Tax & service charge"
      description="VAT registration, pricing mode, and Senior Citizen / PWD treatment. Align these with your accountant. Historical sales keep the tax snapshot they were posted with."
      ownerOnly={ownerOnly}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save("tax", {
            ...form,
            vat_rate: Number(form.vat_rate) || 0,
            service_charge_rate: Number(form.service_charge_rate) || 0,
            sc_pwd_discount_rate: Number(form.sc_pwd_discount_rate) || 0,
          });
        }}
      >
        {message && <Alert tone="danger">{message}</Alert>}
        <Switch
          checked={form.vat_registered}
          disabled={disabled}
          onChange={(v) => setForm({ ...form, vat_registered: v })}
          label="VAT registered"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pricing mode">
            <Select
              value={form.pricing_mode}
              disabled={disabled || !form.vat_registered}
              onChange={(e) => setForm({ ...form, pricing_mode: e.target.value })}
            >
              <option value="tax_inclusive">Tax-inclusive prices</option>
              <option value="tax_exclusive">Tax-exclusive prices</option>
            </Select>
          </Field>
          <Field label="VAT rate" hint="0.12 = 12%">
            <Input
              type="number"
              step="0.001"
              min="0"
              max="1"
              value={form.vat_rate}
              disabled={disabled || !form.vat_registered}
              onChange={(e) => setForm({ ...form, vat_rate: e.target.value })}
            />
          </Field>
          <Field label="Service charge rate" hint="0 disables service charge">
            <Input
              type="number"
              step="0.001"
              min="0"
              max="1"
              value={form.service_charge_rate}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, service_charge_rate: e.target.value })}
            />
          </Field>
          <Field label="SC / PWD discount rate" hint="0.20 = 20%">
            <Input
              type="number"
              step="0.001"
              min="0"
              max="1"
              value={form.sc_pwd_discount_rate}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, sc_pwd_discount_rate: e.target.value })}
            />
          </Field>
        </div>
        <Switch
          checked={form.sc_pwd_vat_exempt}
          disabled={disabled}
          onChange={(v) => setForm({ ...form, sc_pwd_vat_exempt: v })}
          label="SC / PWD sales are VAT-exempt"
        />
        <div className="flex items-center justify-end gap-3">
          <SaveState state={state} />
          <Button type="submit" loading={saving} disabled={disabled}>
            Save
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function InventoryPolicyForm({
  settings,
  disabled,
  ownerOnly,
}: {
  settings: SettingRow[];
  disabled: boolean;
  ownerOnly?: boolean;
}) {
  const value = useSetting(settings, "inventory_policy");
  const { save, state, saving, message } = useSave();
  const [form, setForm] = useState({
    allow_negative_stock: Boolean(value.allow_negative_stock ?? false),
    low_stock_behavior: String(value.low_stock_behavior ?? "warn"),
    // Kept as a string while editing — Number("") coercing to 0 on every
    // keystroke made the field snap back to "0" and block typing.
    expiring_soon_days: String(value.expiring_soon_days ?? 7),
  });

  return (
    <SectionCard
      title="Inventory policy"
      description="How the POS behaves when stock runs low or out."
      ownerOnly={ownerOnly}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save("inventory_policy", {
            ...form,
            expiring_soon_days: Number(form.expiring_soon_days) || 0,
          });
        }}
      >
        {message && <Alert tone="danger">{message}</Alert>}
        <Switch
          checked={form.allow_negative_stock}
          disabled={disabled}
          onChange={(v) => setForm({ ...form, allow_negative_stock: v })}
          label="Allow selling into negative stock"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Low-stock behavior">
            <Select
              value={form.low_stock_behavior}
              disabled={disabled}
              onChange={(e) =>
                setForm({ ...form, low_stock_behavior: e.target.value })
              }
            >
              <option value="warn">Warn cashier</option>
              <option value="hide">Hide item from POS</option>
            </Select>
          </Field>
          <Field label="“Expiring soon” window (days)">
            <Input
              type="number"
              min="1"
              max="90"
              value={form.expiring_soon_days}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, expiring_soon_days: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-3">
          <SaveState state={state} />
          <Button type="submit" loading={saving} disabled={disabled}>
            Save
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function ShiftsForm({
  settings,
  disabled,
  ownerOnly,
}: {
  settings: SettingRow[];
  disabled: boolean;
  ownerOnly?: boolean;
}) {
  const value = useSetting(settings, "shifts");
  const { save, state, saving, message } = useSave();
  const [form, setForm] = useState({
    show_expected_cash_before_count: Boolean(
      value.show_expected_cash_before_count ?? false,
    ),
  });

  return (
    <SectionCard
      title="Shifts & cash drawer"
      description="Blind-count policy for closing shifts."
      ownerOnly={ownerOnly}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save("shifts", form);
        }}
      >
        {message && <Alert tone="danger">{message}</Alert>}
        <Switch
          checked={form.show_expected_cash_before_count}
          disabled={disabled}
          onChange={(v) => setForm({ ...form, show_expected_cash_before_count: v })}
          label="Show expected cash to cashiers before they count the drawer"
        />
        <div className="flex items-center justify-end gap-3">
          <SaveState state={state} />
          <Button type="submit" loading={saving} disabled={disabled}>
            Save
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function LoyaltyForm({
  settings,
  disabled,
  ownerOnly,
}: {
  settings: SettingRow[];
  disabled: boolean;
  ownerOnly?: boolean;
}) {
  const value = useSetting(settings, "loyalty");
  const { save, state, saving, message } = useSave();
  const [form, setForm] = useState({
    enabled: Boolean(value.enabled ?? true),
    // Kept as strings while editing — Number("") coercing to 0 on every
    // keystroke made the field snap back to "0" and block typing.
    points_per_peso: String(value.points_per_peso ?? 0.02),
    min_purchase: String(value.min_purchase ?? 100),
    redemption_value_per_point: String(value.redemption_value_per_point ?? 1),
    max_redemption_pct: String(value.max_redemption_pct ?? 0.5),
    points_expiry_days: String(value.points_expiry_days ?? 365),
    birthday_bonus_points: String(value.birthday_bonus_points ?? 50),
  });

  return (
    <SectionCard
      title="Loyalty program"
      description="Digital loyalty rules. Points are awarded after payment completes and reversed on refunds."
      ownerOnly={ownerOnly}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save("loyalty", {
            ...form,
            points_per_peso: Number(form.points_per_peso) || 0,
            min_purchase: Number(form.min_purchase) || 0,
            redemption_value_per_point: Number(form.redemption_value_per_point) || 0,
            max_redemption_pct: Number(form.max_redemption_pct) || 0,
            points_expiry_days: Number(form.points_expiry_days) || 0,
            birthday_bonus_points: Number(form.birthday_bonus_points) || 0,
          });
        }}
      >
        {message && <Alert tone="danger">{message}</Alert>}
        <Switch
          checked={form.enabled}
          disabled={disabled}
          onChange={(v) => setForm({ ...form, enabled: v })}
          label="Loyalty program enabled"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Points per peso" hint="0.02 = 1 point per ₱50">
            <Input
              type="number"
              step="0.001"
              min="0"
              value={form.points_per_peso}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, points_per_peso: e.target.value })}
            />
          </Field>
          <Field label="Minimum purchase to earn (₱)">
            <Input
              type="number"
              min="0"
              value={form.min_purchase}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, min_purchase: e.target.value })}
            />
          </Field>
          <Field label="Peso value per point">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.redemption_value_per_point}
              disabled={disabled}
              onChange={(e) =>
                setForm({ ...form, redemption_value_per_point: e.target.value })
              }
            />
          </Field>
          <Field label="Max redemption per order" hint="0.5 = up to 50% of the bill">
            <Input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={form.max_redemption_pct}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, max_redemption_pct: e.target.value })}
            />
          </Field>
          <Field label="Points expire after (days)" hint="0 = never">
            <Input
              type="number"
              min="0"
              value={form.points_expiry_days}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, points_expiry_days: e.target.value })}
            />
          </Field>
          <Field label="Birthday bonus points">
            <Input
              type="number"
              min="0"
              value={form.birthday_bonus_points}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, birthday_bonus_points: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-3">
          <SaveState state={state} />
          <Button type="submit" loading={saving} disabled={disabled}>
            Save
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
