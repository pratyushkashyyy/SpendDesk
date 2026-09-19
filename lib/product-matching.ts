import type { CatalogProduct, ProductPerformance } from "./types";
const numericId = (id: string) => id.split("/").pop();
// Match exact identifiers only. A similar title is not evidence of a product link.
export function matchProduct(
  itemId: string,
  products: CatalogProduct[],
): string | null {
  const shopify = /^shopify_(?:[A-Za-z]{2}_)?(\d+)_(\d+)$/.exec(itemId);
  if (shopify) {
    const found = products.find(
      (p) =>
        numericId(p.id) === shopify[1] &&
        p.variants.some((v) => numericId(v.id) === shopify[2]),
    );
    return found?.id || null;
  }
  const matches = products.filter(
    (p) =>
      numericId(p.id) === itemId ||
      p.variants.some(
        (v) => numericId(v.id) === itemId || (v.sku && v.sku === itemId),
      ),
  );
  return matches.length === 1 ? matches[0].id : null;
}
export function productRows(
  productId: string,
  products: CatalogProduct[],
  rows: ProductPerformance[],
) {
  return rows.filter((r) => matchProduct(r.itemId, products) === productId);
}
