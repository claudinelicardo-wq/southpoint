"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface CourtSession {
  id: string;
  status: "reserved" | "in_use" | "cleaning" | "maintenance";
  group_label: string | null;
  tab_id: string | null;
  starts_at: string;
  expected_end_at: string | null;
  notes: string | null;
  tabs?: { name: string } | null;
}

const STATUS_META: Record<
  CourtSession["status"] | "available",
  { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }
> = {
  available: { label: "Available", tone: "success" },
  reserved: { label: "Reserved", tone: "info" },
  in_use: { label: "In Use", tone: "warning" },
  cleaning: { label: "Cleaning", tone: "neutral" },
  maintenance: { label: "Maintenance", tone: "danger" },
};

/** Single-court status widget with quick status changes and tab linking. */
export function CourtWidget({
  session,
  openTabs,
  canManage,
  compact = false,
}: {
  session: CourtSession | null;
  openTabs: { id: string; name: string }[];
  canManage: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [dialogStatus, setDialogStatus] = useState<"reserved" | "in_use" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = session?.status ?? "available";
  const meta = STATUS_META[status];

  async function setSimple(next: "available" | "cleaning" | "maintenance") {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("court_set", { p_status: next });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-(--radius-card) border border-line bg-paper p-4 shadow-(--shadow-card)">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "size-2.5 rounded-full",
              status === "available" && "bg-grass",
              status === "in_use" && "bg-sun-deep",
              status === "reserved" && "bg-info",
              status === "cleaning" && "bg-latte",
              status === "maintenance" && "bg-danger",
            )}
          />
          <p className="font-medium text-espresso">Pickleball Court</p>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>

      {session && (
        <div className="mt-2 text-sm text-roast">
          {session.group_label && <p className="font-medium">{session.group_label}</p>}
          <p className="text-xs text-latte">
            Since {formatTime(session.starts_at)}
            {session.expected_end_at && ` · until ${formatTime(session.expected_end_at)}`}
            {session.tabs?.name && ` · Tab: ${session.tabs.name}`}
          </p>
          {session.notes && <p className="text-xs italic text-latte">{session.notes}</p>}
        </div>
      )}

      {error && (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      )}

      {canManage && (
        <div className={cn("mt-3 flex flex-wrap gap-1.5", compact && "gap-1")}>
          {status !== "available" && (
            <Button variant="outline" size="sm" onClick={() => setSimple("available")} disabled={busy}>
              Free up
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setDialogStatus("reserved")} disabled={busy}>
            Reserve
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDialogStatus("in_use")} disabled={busy}>
            Start play
          </Button>
          {!compact && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setSimple("cleaning")} disabled={busy}>
                Cleaning
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSimple("maintenance")} disabled={busy}>
                Maintenance
              </Button>
            </>
          )}
        </div>
      )}

      {dialogStatus && (
        <CourtSessionDialog
          status={dialogStatus}
          openTabs={openTabs}
          onClose={() => setDialogStatus(null)}
          onSaved={() => {
            setDialogStatus(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CourtSessionDialog({
  status,
  openTabs,
  onClose,
  onSaved,
}: {
  status: "reserved" | "in_use";
  openTabs: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [group, setGroup] = useState("");
  const [tabId, setTabId] = useState("");
  const [hours, setHours] = useState(1);
  const [booking, setBooking] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("court_set", {
      p_status: status,
      p_group_label: group || null,
      p_customer: null,
      p_tab: tabId || null,
      p_expected_end:
        hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : null,
      p_booking_reference: booking || null,
      p_notes: notes || null,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={status === "reserved" ? "Reserve the court" : "Start a session"}
    >
      <form onSubmit={save} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Group / customer" hint='e.g. "Claudine’s Group", "6:00 PM Players"'>
          <Input value={group} onChange={(e) => setGroup(e.target.value)} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expected duration (hours)">
            <Input
              type="number"
              min="0"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </Field>
          <Field label="Link a cafe tab (optional)">
            <Select value={tabId} onChange={(e) => setTabId(e.target.value)}>
              <option value="">No tab</option>
              {openTabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Booking reference (optional)">
          <Input value={booking} onChange={(e) => setBooking(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {status === "reserved" ? "Reserve" : "Start session"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
