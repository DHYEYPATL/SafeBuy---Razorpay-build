import { CATALOG, getItem } from "./catalog";
import { MERCHANT_ID, MERCHANT_NAME, type CartLine, type CatalogItem, type Mandate, type ProposedCart, type StructuredIntent } from "./types";

function matches(
  item: CatalogItem,
  mandate: Mandate,
  intent: StructuredIntent,
  excludeSkus: string[] = [],
  stockOverride: Record<string, number> = {},
) {
  if (excludeSkus.includes(item.sku)) return false;
  const currentStock = item.sku in stockOverride ? stockOverride[item.sku]! : item.stock;
  if (currentStock <= 0) return false;
  if (!mandate.categories.includes(item.category)) return false;
  if (mandate.brandsDeny.includes(item.brand)) return false;
  if (mandate.brandsAllow.length && !mandate.brandsAllow.includes(item.brand)) return false;
  if (item.pricePaise > mandate.priceCeilingPerItemPaise) return false;
  if (intent.categories.length && !intent.categories.includes(item.category)) return false;
  if (intent.brandsDeny.includes(item.brand)) return false;
  if (intent.brandsAllow.length && !intent.brandsAllow.includes(item.brand)) return false;
  if (intent.priceCeilingPerItemPaise && item.pricePaise > intent.priceCeilingPerItemPaise) {
    return false;
  }
  const q = intent.queryText.toLowerCase();
  if (q) {
    const blob = `${item.name} ${item.brand} ${item.category} ${item.sku}`.toLowerCase();
    const tokens = q
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !["under", "please", "buy", "need", "some", "the"].includes(w));
    if (tokens.length && !tokens.some((w) => blob.includes(w))) {
      // still allow category-only matches
      if (!intent.categories.includes(item.category)) return false;
    }
  }
  return true;
}

function toLine(item: CatalogItem, quantity: number): CartLine {
  return {
    sku: item.sku,
    name: item.name,
    brand: item.brand,
    category: item.category,
    unitPricePaise: item.pricePaise,
    quantity,
    linePaise: item.pricePaise * quantity,
  };
}

export function planCart(
  mandate: Mandate,
  intent: StructuredIntent,
  injectMismatch = false,
  excludeSkus: string[] = [],
  stockOverride: Record<string, number> = {},
): ProposedCart {
  if (injectMismatch) {
    const choc = getItem("SNK-CHO-90")!;
    const line = toLine(choc, 1);
    return {
      lines: [line],
      totalPaise: line.linePaise,
      merchantId: MERCHANT_ID,
      merchantName: MERCHANT_NAME,
      reason: "Lab inject: selected chocolate even though the instruction was not snacks/chocolate. This should fail the semantic guardrail.",
    };
  }

  const qty = Math.min(intent.maxQuantityPerItem ?? 1, mandate.maxQuantityPerItem);
  const candidates = CATALOG.filter((i) => matches(i, mandate, intent, excludeSkus, stockOverride)).sort(
    (a, b) => a.pricePaise - b.pricePaise,
  );

  const budget = Math.min(
    mandate.remainingPaise,
    intent.maxAmountPaise ?? mandate.remainingPaise,
  );

  const lines: CartLine[] = [];
  let total = 0;
  for (const item of candidates) {
    const liveItemStock = item.sku in stockOverride ? stockOverride[item.sku]! : item.stock;
    const q = Math.min(qty, liveItemStock);
    if (q <= 0) continue;
    const line = toLine(item, q);
    if (total + line.linePaise > budget) continue;
    if (lines.length >= 2) break;
    lines.push(line);
    total += line.linePaise;
    if (intent.categories.length <= 1) break;
  }

  const names = lines.map((l) => l.name).join(", ");
  return {
    lines,
    totalPaise: total,
    merchantId: MERCHANT_ID,
    merchantName: MERCHANT_NAME,
    reason: lines.length
      ? `Cheapest in-mandate match for “${intent.queryText}”: ${names}.`
      : `No in-stock SKU matched both the mandate and the instruction.`,
  };
}
