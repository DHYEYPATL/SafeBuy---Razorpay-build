import { CATALOG, getItem } from "./catalog";
import { parseIntentDeterministic } from "./parse-intent";
import {
  MERCHANT_ID,
  MERCHANT_NAME,
  type CartLine,
  type CatalogItem,
  type Mandate,
  type ProposedCart,
  type StructuredIntent,
} from "./types";

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

  const blob = `${item.name} ${item.brand} ${item.category} ${item.sku} ${item.unit}`.toLowerCase();

  // Exclude tokens
  if (intent.excludeTokens && intent.excludeTokens.some((ex) => blob.includes(ex))) {
    return false;
  }

  // Pack tokens matching
  if (intent.packTokens && intent.packTokens.length > 0) {
    const nonCategoryTokens = intent.packTokens.filter(
      (tok) => !(intent.categories as readonly string[]).includes(tok),
    );
    if (nonCategoryTokens.length > 0) {
      const hasMatch = nonCategoryTokens.some((tok) => blob.includes(tok));
      if (!hasMatch) return false;
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

  // 1. Multi-item prompt parsing (e.g., "1 kg basmati and 1 kg toor dal and 1L mustard oil")
  const rawText = intent.queryText || "";
  // Split on commas, "and", "with", "+" while preserving sub-clause meaning
  const subClauses = rawText
    .split(/,|\band\b|\bwith\b|\+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && !/^(please|buy|get|need|want|add)$/i.test(s));

  if (subClauses.length > 1) {
    const lines: CartLine[] = [];
    let total = 0;
    const usedSkus: string[] = [...excludeSkus];

    for (const clause of subClauses) {
      const subIntent = parseIntentDeterministic(clause);
      if (intent.maxAmountPaise && !subIntent.maxAmountPaise) {
        subIntent.maxAmountPaise = intent.maxAmountPaise;
      }
      const candidates = CATALOG.filter((i) => matches(i, mandate, subIntent, usedSkus, stockOverride)).sort(
        (a, b) => {
          let scoreA = 0;
          let scoreB = 0;
          if (subIntent.packSizeHint) {
            if (a.unit.toLowerCase().replace(/\s/g, "").includes(subIntent.packSizeHint)) scoreA += 100;
            if (b.unit.toLowerCase().replace(/\s/g, "").includes(subIntent.packSizeHint)) scoreB += 100;
          }
          if (scoreA !== scoreB) return scoreB - scoreA;
          return a.pricePaise - b.pricePaise;
        },
      );

      const matchedItem = candidates[0];
      if (matchedItem) {
        const liveStock = itemStock(matchedItem, stockOverride);
        const q = Math.min(subIntent.qty ?? 1, liveStock, mandate.maxQuantityPerItem);
        if (q > 0) {
          const line = toLine(matchedItem, q);
          lines.push(line);
          total += line.linePaise;
          usedSkus.push(matchedItem.sku);
        }
      }
    }

    if (lines.length > 1) {
      const names = lines.map((l) => `${l.name} × ${l.quantity}`).join(", ");
      return {
        lines,
        totalPaise: total,
        merchantId: MERCHANT_ID,
        merchantName: MERCHANT_NAME,
        reason: `Matched ${lines.length} items for multi-item basket: ${names}.`,
      };
    }
  }

  // 2. Single-item standard planning
  const qty = Math.min(intent.qty ?? intent.maxQuantityPerItem ?? 1, mandate.maxQuantityPerItem);

  // Score candidates: give priority to exact unit/packSize matches (e.g. 1kg vs 5kg)
  const candidates = CATALOG.filter((i) => matches(i, mandate, intent, excludeSkus, stockOverride)).sort(
    (a, b) => {
      let scoreA = 0;
      let scoreB = 0;
      if (intent.packSizeHint) {
        if (a.unit.toLowerCase().replace(/\s/g, "").includes(intent.packSizeHint)) scoreA += 100;
        if (b.unit.toLowerCase().replace(/\s/g, "").includes(intent.packSizeHint)) scoreB += 100;
      }
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.pricePaise - b.pricePaise;
    },
  );

  const budget = Math.min(
    mandate.remainingPaise,
    intent.maxAmountPaise ?? mandate.remainingPaise,
  );

  // Ask-back clarification check: If no candidates match due to budget
  if (candidates.length === 0) {
    const allCategoryMatches = CATALOG.filter(
      (i) => intent.categories.includes(i.category) && (itemStock(i, stockOverride) > 0),
    );
    if (allCategoryMatches.length > 0 && intent.maxAmountPaise) {
      const minPrice = Math.min(...allCategoryMatches.map((i) => i.pricePaise));
      if (minPrice > intent.maxAmountPaise) {
        return {
          lines: [],
          totalPaise: 0,
          merchantId: MERCHANT_ID,
          merchantName: MERCHANT_NAME,
          reason: `No in-stock item matched within budget of ₹${intent.maxAmountPaise / 100}. The lowest price for ${intent.categories.join(", ")} is ₹${minPrice / 100}.`,
          needsClarification: true,
          clarificationPrompt: `The lowest available price in ${intent.categories.join(", ")} is ₹${minPrice / 100} (${allCategoryMatches[0]?.name}). Would you like to increase your budget?`,
        };
      }
    }
  }

  const lines: CartLine[] = [];
  let total = 0;
  for (const item of candidates) {
    const liveItemStock = itemStock(item, stockOverride);
    const q = Math.min(qty, liveItemStock);
    if (q <= 0) continue;
    const line = toLine(item, q);
    if (total + line.linePaise > budget) continue;
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
      ? `Best in-mandate match for “${intent.queryText}”: ${names}.`
      : `No in-stock SKU matched both the mandate and the instruction.`,
  };
}

function itemStock(item: CatalogItem, stockOverride: Record<string, number>) {
  return item.sku in stockOverride ? stockOverride[item.sku]! : item.stock;
}
