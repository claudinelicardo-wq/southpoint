import "server-only";

/**
 * External product identification for scanned barcodes the local catalog
 * doesn't know. Providers are abstracted behind ProductLookupProvider so new
 * sources can be added without touching the POS; results are suggestions for
 * the create-product form only — South Point's own database stays the source
 * of truth for pricing, cost, stock, tax, and suppliers.
 */

export interface ExternalProductInfo {
  barcode: string;
  productName: string | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  packageSize: string | null;
  source: string;
}

export interface ProductLookupProvider {
  name: string;
  /** Resolve a barcode to product info, or null when unknown. Throws on transport errors. */
  lookupBarcode(barcode: string): Promise<ExternalProductInfo | null>;
}

const TIMEOUT_MS = 6000;

/** Open Food Facts — free, no API key, strong coverage of packaged food/drink. */
const openFoodFacts: ProductLookupProvider = {
  name: "Open Food Facts",
  async lookupBarcode(barcode) {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands,quantity,categories,image_url,generic_name`,
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "SouthPointPOS/1.0 (inventory lookup)" },
      },
    );
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Open Food Facts responded ${res.status}`);
    }
    const json = (await res.json()) as {
      status?: number;
      product?: {
        product_name?: string;
        generic_name?: string;
        brands?: string;
        quantity?: string;
        categories?: string;
        image_url?: string;
      };
    };
    if (json.status !== 1 || !json.product) return null;
    const p = json.product;
    if (!p.product_name && !p.generic_name) return null;
    return {
      barcode,
      productName: p.product_name || p.generic_name || null,
      brand: p.brands?.split(",")[0]?.trim() || null,
      category: p.categories?.split(",").pop()?.trim() || null,
      description: p.generic_name || null,
      imageUrl: p.image_url || null,
      packageSize: p.quantity || null,
      source: "Open Food Facts",
    };
  },
};

// Ordered by priority. Key-based providers (UPCitemdb, GS1, …) can be added
// here later, reading credentials from environment variables server-side.
const PROVIDERS: ProductLookupProvider[] = [openFoodFacts];

/**
 * Try providers in order; first hit wins. Provider failures (timeouts, rate
 * limits) fall through to the next provider, and to null — never to a thrown
 * error, so the caller can always offer manual creation.
 */
export async function lookupBarcodeExternally(
  barcode: string,
): Promise<ExternalProductInfo | null> {
  for (const provider of PROVIDERS) {
    try {
      const hit = await provider.lookupBarcode(barcode);
      if (hit) return hit;
    } catch (err) {
      console.error(`[product-lookup] ${provider.name} failed:`, err);
    }
  }
  return null;
}
