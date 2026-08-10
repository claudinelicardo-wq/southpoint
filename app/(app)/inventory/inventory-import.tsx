"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Canonical fields the retail import understands. Only "name" is required.
type Field = "name" | "brand" | "quantity" | "cost" | "srp" | "sku" | "barcode" | "category";

// Forgiving header aliases: whatever the owner named their columns, map to ours.
const ALIASES: Record<string, Field> = {
  product_name: "name", name: "name", item: "name", product: "name",
  item_name: "name", description: "name",
  brand: "brand", make: "brand",
  quantity: "quantity", qty: "quantity", stock: "quantity", on_hand: "quantity",
  opening_stock: "quantity", count: "quantity",
  cost: "cost", unit_cost: "cost", cost_price: "cost", buying_price: "cost", capital: "cost",
  srp: "srp", selling_price: "srp", price: "srp", retail_price: "srp",
  sell_price: "srp", srp_price: "srp",
  sku: "sku", code: "sku", item_code: "sku",
  barcode: "barcode", upc: "barcode", ean: "barcode",
  category: "category", cat: "category",
};

const TEMPLATE =
  "Product Name,Brand,Quantity,Cost,SRP,SKU,Barcode,Category\n" +
  [
    "Coke Mismo,Coca-Cola,24,12,20,RET-COKE,4800012345678,Convenience Store",
    "Piattos,Jack n Jill,30,15,22,,,Convenience Store",
    "Bottled Water 500ml,Nature's Spring,48,7,12,RET-WATER,,Convenience Store",
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

/** RFC-4180-ish CSV parser: quoted fields, escaped quotes, CRLF. */
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

const NUMERIC_FIELDS = new Set<Field>(["quantity", "cost", "srp"]);

// Strip currency symbols, thousands separators, and stray spaces so values like
// "₱1,198.00" or "PHP 95" import as plain numbers.
function cleanNumeric(v: string): string {
  return v.replace(/[^0-9.\-]/g, "");
}

function rowsFromCSV(text: string): { rows: ImportRow[]; unknown: string[] } {
  const grid = parseCSV(text);
  if (grid.length < 2) return { rows: [], unknown: [] };
  const mapped = grid[0].map((h) => ALIASES[h.trim().toLowerCase().replace(/\s+/g, "_")]);
  const unknown = grid[0].filter((_, i) => !mapped[i]).filter((h) => h.trim() !== "");
  const rows = grid.slice(1).map((cells) => {
    const obj: ImportRow = {};
    mapped.forEach((field, i) => {
      if (!field) return;
      const raw = (cells[i] ?? "").trim();
      obj[field] = NUMERIC_FIELDS.has(field) ? cleanNumeric(raw) : raw;
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
  a.download = "southpoint-products-template.csv";
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
    const { data, error: rpcError } = await supabase.rpc("retail_import", {
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
        title="Import products from CSV"
        description="Bulk-add store products with their stock. Nothing is saved until you review and confirm."
        className="max-w-2xl"
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          {done ? (
            <>
              <Alert tone="success" title="Import complete">
                Added {done.created} new product{done.created === 1 ? "" : "s"}, updated{" "}
                {done.updated}, and stocked {done.stocked}
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
                <p className="font-medium text-espresso">Columns</p>
                <p className="mt-1 text-latte">
                  <strong className="text-roast">Product Name</strong> (required),{" "}
                  <strong className="text-roast">Brand</strong>,{" "}
                  <strong className="text-roast">Quantity</strong> (stock on hand),{" "}
                  <strong className="text-roast">Cost</strong> (what you pay),{" "}
                  <strong className="text-roast">SRP</strong> (selling price). Optional: SKU,
                  Barcode, Category. Each row becomes a product you can ring up in the POS at
                  its SRP. Rows with a matching SKU are updated in place.
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
                      Import {dry.valid} product{dry.valid === 1 ? "" : "s"}
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
