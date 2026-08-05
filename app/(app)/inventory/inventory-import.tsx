"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Columns the import understands. Required: name, inventory_type, base_unit.
const COLUMNS = [
  "name",
  "sku",
  "barcode",
  "inventory_type",
  "category",
  "base_unit",
  "purchase_unit_label",
  "purchase_to_base_factor",
  "reorder_level",
  "target_level",
  "storage_location",
  "track_expiry",
  "opening_stock",
  "unit_cost",
] as const;

const TEMPLATE =
  COLUMNS.join(",") +
  "\n" +
  [
    "Coffee Beans (House),ING-BEANS,,ingredient,Coffee,g,1kg bag,1000,500,2000,Dry store,false,5000,0.85",
    "Bottled Water 500ml,RTL-WATER,4800012345678,retail,Convenience,pc,case of 24,24,24,72,Chiller,false,120,12",
    "Paper Cups 12oz,PKG-CUP12,,packaging,,pc,sleeve of 50,50,100,500,Dry store,false,600,1.5",
  ].join("\n") +
  "\n";

interface ImportRow {
  [key: string]: string;
}
interface RowError {
  row: number;
  name: string;
  error: string;
}
interface ImportResult {
  committed: boolean;
  total: number;
  valid: number;
  created: number;
  updated: number;
  stocked: number;
  error_count: number;
  errors: RowError[];
}

/** RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, CRLF. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function rowsFromCSV(text: string): { rows: ImportRow[]; unknown: string[] } {
  const grid = parseCSV(text);
  if (grid.length < 2) return { rows: [], unknown: [] };
  const headers = grid[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const known = new Set<string>(COLUMNS);
  const unknown = headers.filter((h) => h && !known.has(h));
  const rows = grid.slice(1).map((cells) => {
    const obj: ImportRow = {};
    headers.forEach((h, i) => {
      if (known.has(h)) obj[h] = (cells[i] ?? "").trim();
    });
    return obj;
  });
  return { rows, unknown };
}

function downloadTemplate() {
  const blob = new Blob([TEMPLATE], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "southpoint-inventory-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function InventoryImport({
  canImport,
  preview,
}: {
  canImport: boolean;
  preview: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [unknownCols, setUnknownCols] = useState<string[]>([]);
  const [dry, setDry] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canImport) return null;

  function reset() {
    setRows([]);
    setFileName("");
    setUnknownCols([]);
    setDry(null);
    setDone(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDone(null);
    setFileName(file.name);
    const text = await file.text();
    const { rows: parsed, unknown } = rowsFromCSV(text);
    setUnknownCols(unknown);
    if (parsed.length === 0) {
      setRows([]);
      setDry(null);
      setError("No data rows found. Make sure the first line is the column header.");
      return;
    }
    setRows(parsed);
    await runImport(parsed, false);
  }

  async function runImport(payload: ImportRow[], commit: boolean) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("inventory_import", {
      p_rows: payload,
      p_commit: commit,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const result = data as ImportResult;
    if (commit) {
      setDone(result);
      router.refresh();
    } else {
      setDry(result);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={preview}>
        Import CSV
      </Button>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title="Import inventory from CSV"
        description="Bulk-create stock items and opening quantities. Nothing is saved until you review and confirm."
        className="max-w-2xl"
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          {done ? (
            <>
              <Alert tone="success" title="Import complete">
                Created {done.created}, updated {done.updated}, and set opening stock on{" "}
                {done.stocked}
                {done.error_count > 0 ? `. ${done.error_count} row(s) were skipped.` : "."}
              </Alert>
              {done.errors.length > 0 && <ErrorTable errors={done.errors} />}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={reset}>
                  Import another file
                </Button>
                <Button
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                >
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-line bg-sand/40 p-3 text-sm text-roast">
                <p className="font-medium text-espresso">How it works</p>
                <p className="mt-1 text-latte">
                  Required columns: <code>name</code>, <code>inventory_type</code>{" "}
                  (ingredient / packaging / retail / prepared / supply), and{" "}
                  <code>base_unit</code> (g, kg, l, ml, pc, serving). Items with a matching{" "}
                  <code>sku</code> are updated in place. <code>opening_stock</code> and{" "}
                  <code>unit_cost</code> post an opening balance to the ledger.
                </p>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="mt-2 text-court-deep underline underline-offset-2 hover:text-court"
                >
                  Download the CSV template
                </button>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-roast">CSV file</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFile}
                  className="block w-full text-sm text-roast file:mr-3 file:rounded-lg file:border-0 file:bg-court file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-court-deep"
                />
                {fileName && (
                  <span className="mt-1 block text-xs text-latte">
                    {fileName} · {rows.length} row{rows.length === 1 ? "" : "s"}
                  </span>
                )}
              </label>

              {unknownCols.length > 0 && (
                <Alert tone="warning">
                  Ignored unrecognized column{unknownCols.length === 1 ? "" : "s"}:{" "}
                  {unknownCols.join(", ")}.
                </Alert>
              )}

              {dry && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-4 rounded-xl border border-line bg-paper p-3 text-sm">
                    <span>
                      <span className="font-semibold text-court-deep">{dry.valid}</span>{" "}
                      <span className="text-latte">ready to import</span>
                    </span>
                    {dry.error_count > 0 && (
                      <span>
                        <span className="font-semibold text-danger">{dry.error_count}</span>{" "}
                        <span className="text-latte">with problems (will be skipped)</span>
                      </span>
                    )}
                  </div>

                  {dry.errors.length > 0 && <ErrorTable errors={dry.errors} />}

                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" onClick={reset}>
                      Clear
                    </Button>
                    <Button
                      onClick={() => runImport(rows, true)}
                      loading={busy}
                      disabled={dry.valid === 0}
                    >
                      Import {dry.valid} item{dry.valid === 1 ? "" : "s"}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}

function ErrorTable({ errors }: { errors: RowError[] }) {
  return (
    <div className="max-h-56 overflow-y-auto">
      <Table>
        <THead>
          <TH>Row</TH>
          <TH>Name</TH>
          <TH>Problem</TH>
        </THead>
        <TBody>
          {errors.map((e, i) => (
            <TR key={i}>
              <TD className="text-latte">{e.row}</TD>
              <TD className="text-espresso">{e.name || "—"}</TD>
              <TD className="text-danger">{e.error}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
