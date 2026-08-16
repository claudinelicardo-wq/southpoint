import { lookupBarcodeExternally } from "@/lib/product-lookup";
import { getSession } from "@/lib/session";
import { NextResponse } from "next/server";

/**
 * External product identification for a barcode the local catalog doesn't
 * know. Staff-only (any signed-in role — it's read-only suggestion data);
 * provider credentials and calls stay server-side.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ barcode: string }> },
) {
  const session = await getSession();
  if (!session || session.preview) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const { barcode } = await params;
  if (!/^[0-9A-Za-z.\-]{4,40}$/.test(barcode)) {
    return NextResponse.json({ error: "Invalid barcode." }, { status: 400 });
  }

  const product = await lookupBarcodeExternally(barcode);
  if (!product) {
    return NextResponse.json({ found: false, source: null, product: null });
  }
  return NextResponse.json({ found: true, source: "external", product });
}
