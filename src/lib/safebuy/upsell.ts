import { CATALOG } from "./catalog";
import type { CatalogItem, Mandate, ProposedCart, StructuredIntent } from "./types";

export interface UpsellCandidate {
  originalSku: string;
  originalName: string;
  suggestedSku: string;
  suggestedName: string;
  reason: "better_unit_price" | "bundle_fit" | "stock_priority";
  originalUnitPricePaise: number;
  suggestedUnitPricePaise: number;
  suggestedTotalPaise: number;
  savingsPercent: number;
  withinMandateLimit: boolean;
  explanation: string;
}

/**
 * Deterministic Bounded Upsell Engine
 *
 * Runs after semantic guardrail approval and before the pre-debit notice is locked.
 * Checks for larger pack sizes or bundle fits in the same brand & category that yield
 * a lower unit price (per kg/L) while strictly respecting the user's spending policy caps.
 */
export function findBoundedUpsell(
  cart: ProposedCart,
  mandate: Mandate | null,
  intent: StructuredIntent | null,
  catalog: CatalogItem[] = CATALOG,
): UpsellCandidate | null {
  if (!mandate || !cart.lines.length) return null;

  const targetLine = cart.lines[0];
  if (!targetLine) return null;

  const originalItem = catalog.find((c) => c.sku === targetLine.sku);
  if (!originalItem) return null;

  // Derive per-kg / per-unit price in paise for the original item
  const originalPackKg = parsePackKg(originalItem.name, originalItem.sku);
  if (!originalPackKg || originalPackKg <= 0) return null;
  const originalUnitPaisePerKg = originalItem.pricePaise / originalPackKg;

  // Search catalog for same-brand, same-category items with larger pack size
  for (const candidate of catalog) {
    if (candidate.sku === originalItem.sku) continue;
    if (candidate.stock <= 0) continue;
    if (candidate.category !== originalItem.category) continue;

    // Must be same brand (never cross-brand upsell to respect user preference)
    if (candidate.brand.toLowerCase() !== originalItem.brand.toLowerCase()) continue;

    // Check brand denials and allowances from mandate
    if (mandate.brandsDeny.some((d) => candidate.brand.toLowerCase().includes(d.toLowerCase()))) {
      continue;
    }
    if (
      mandate.brandsAllow.length > 0 &&
      !mandate.brandsAllow.some((a) => candidate.brand.toLowerCase().includes(a.toLowerCase()))
    ) {
      continue;
    }

    const candidatePackKg = parsePackKg(candidate.name, candidate.sku);
    if (!candidatePackKg || candidatePackKg <= originalPackKg) continue;

    const candidateUnitPaisePerKg = candidate.pricePaise / candidatePackKg;

    // Must yield a genuinely lower unit price (e.g. 5kg pack cheaper per kg than 1kg pack)
    if (candidateUnitPaisePerKg >= originalUnitPaisePerKg) continue;

    const totalCandidatePaise = candidate.pricePaise;

    // Hard constraint: MUST stay within remaining mandate limit
    if (totalCandidatePaise > mandate.remainingPaise) continue;

    // Hard constraint: MUST stay within per-item price ceiling if specified
    if (
      mandate.priceCeilingPerItemPaise &&
      totalCandidatePaise > mandate.priceCeilingPerItemPaise
    ) {
      continue;
    }

    // Hard constraint: If user specified an explicit budget in the prompt, respect it
    if (intent?.maxAmountPaise && totalCandidatePaise > intent.maxAmountPaise) {
      continue;
    }

    const savingsPercent = Math.round(
      ((originalUnitPaisePerKg - candidateUnitPaisePerKg) / originalUnitPaisePerKg) * 100,
    );

    if (savingsPercent <= 0) continue;

    return {
      originalSku: originalItem.sku,
      originalName: originalItem.name,
      suggestedSku: candidate.sku,
      suggestedName: candidate.name,
      reason: "better_unit_price",
      originalUnitPricePaise: originalItem.pricePaise,
      suggestedUnitPricePaise: candidate.pricePaise,
      suggestedTotalPaise: totalCandidatePaise,
      savingsPercent,
      withinMandateLimit: true,
      explanation: `Switch from ${originalItem.name} (₹${originalItem.pricePaise / 100}) to ${candidate.name} (₹${candidate.pricePaise / 100}) — saves ${savingsPercent}% per kg, strictly within your policy limit.`,
    };
  }

  return null;
}

function parsePackKg(name: string, sku: string): number | null {
  const text = `${name} ${sku}`.toLowerCase();
  if (text.includes("5kg") || text.includes("5 kg")) return 5;
  if (text.includes("2kg") || text.includes("2 kg")) return 2;
  if (text.includes("1kg") || text.includes("1 kg") || text.includes("1l") || text.includes("1 l")) return 1;
  if (text.includes("500g") || text.includes("500 g") || text.includes("500ml")) return 0.5;
  if (text.includes("250g") || text.includes("250 g")) return 0.25;
  if (text.includes("100g") || text.includes("100 g")) return 0.1;
  return null;
}
