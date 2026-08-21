import { CATEGORIES, type Category, type StructuredIntent } from "./types";
import { CATALOG } from "./catalog";

const BRANDS = Array.from(new Set(CATALOG.map((i) => i.brand)));

function asCategory(s: string): Category | null {
  const n = s.toLowerCase().trim();
  return (CATEGORIES as readonly string[]).includes(n) ? (n as Category) : null;
}

/** Deterministic parser — always available. LLM only proposes; this (or form fields) is the source of truth. */
export function parseIntentDeterministic(text: string): StructuredIntent {
  const t = text.toLowerCase();
  const intent: StructuredIntent = {
    maxAmountPaise: null,
    categories: [],
    brandsAllow: [],
    brandsDeny: [],
    maxQuantityPerItem: null,
    priceCeilingPerItemPaise: null,
    queryText: text.trim(),
  };

  const under = t.match(/under\s*(?:rs\.?|₹)?\s*(\d+)/i) || t.match(/(?:rs\.?|₹)\s*(\d+)/);
  if (under) intent.maxAmountPaise = Number(under[1]) * 100;

  const qty = t.match(/\b(\d+)\s*(kg|g|l|ml|pack|pcs|piece|pieces)?\b/);
  if (qty && Number(qty[1]) <= 10) intent.maxQuantityPerItem = Number(qty[1]);

  if (t.includes("rice") || t.includes("basmati") || t.includes("atta") || t.includes("grain")) {
    intent.categories.push("grains");
  }
  if (t.includes("dal") || t.includes("pulse") || t.includes("toor") || t.includes("moong")) {
    intent.categories.push("pulses");
  }
  if (t.includes("spice") || t.includes("turmeric") || t.includes("masala")) {
    intent.categories.push("spices");
  }
  if (t.includes("oil") || t.includes("mustard")) intent.categories.push("oil");
  if (t.includes("milk") || t.includes("ghee") || t.includes("dairy")) intent.categories.push("dairy");
  if (t.includes("snack") || t.includes("bhujia") || t.includes("namkeen") || t.includes("chocolate")) {
    intent.categories.push("snacks");
  }
  if (t.includes("tea") || t.includes("coffee")) intent.categories.push("beverages");
  if (t.includes("detergent") || t.includes("soap")) intent.categories.push("household");

  for (const brand of BRANDS) {
    if (t.includes(brand.toLowerCase())) intent.brandsAllow.push(brand);
  }

  const notBrand = t.match(/not\s+([a-z][a-z\s']{1,20})/i);
  if (notBrand) {
    const guess = BRANDS.find((b) => notBrand[1].includes(b.toLowerCase().split(" ")[0]!));
    if (guess) intent.brandsDeny.push(guess);
  }

  intent.categories = Array.from(new Set(intent.categories));
  return intent;
}

export function emptyIntent(queryText = ""): StructuredIntent {
  return {
    maxAmountPaise: null,
    categories: [],
    brandsAllow: [],
    brandsDeny: [],
    maxQuantityPerItem: null,
    priceCeilingPerItemPaise: null,
    queryText,
  };
}

export function coerceIntent(raw: unknown, fallbackText: string): StructuredIntent {
  const base = emptyIntent(fallbackText);
  if (!raw || typeof raw !== "object") return parseIntentDeterministic(fallbackText);
  const o = raw as Record<string, unknown>;
  const cats = Array.isArray(o.categories)
    ? (o.categories as unknown[]).map(String).map(asCategory).filter(Boolean) as Category[]
    : [];
  return {
    maxAmountPaise: typeof o.maxAmountPaise === "number" ? o.maxAmountPaise : base.maxAmountPaise,
    categories: cats,
    brandsAllow: Array.isArray(o.brandsAllow) ? o.brandsAllow.map(String) : [],
    brandsDeny: Array.isArray(o.brandsDeny) ? o.brandsDeny.map(String) : [],
    maxQuantityPerItem:
      typeof o.maxQuantityPerItem === "number" ? o.maxQuantityPerItem : null,
    priceCeilingPerItemPaise:
      typeof o.priceCeilingPerItemPaise === "number" ? o.priceCeilingPerItemPaise : null,
    queryText: fallbackText,
  };
}
