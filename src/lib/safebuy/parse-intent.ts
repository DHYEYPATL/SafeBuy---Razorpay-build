import { CATEGORIES, type Category, type StructuredIntent } from "./types";
import { CATALOG } from "./catalog";

const BRANDS = Array.from(new Set(CATALOG.map((i) => i.brand)));

const STOPWORDS = new Set([
  "under",
  "please",
  "buy",
  "need",
  "some",
  "the",
  "get",
  "give",
  "for",
  "with",
  "and",
  "pack",
  "packet",
  "bag",
  "box",
  "rs",
  "rupees",
  "inr",
  "only",
  "want",
  "around",
  "max",
]);

function asCategory(s: string): Category | null {
  const n = s.toLowerCase().trim();
  return (CATEGORIES as readonly string[]).includes(n) ? (n as Category) : null;
}

/** Deterministic intent parser — extracts pack tokens, weight hints, and budget boundaries. */
export function parseIntentDeterministic(text: string): StructuredIntent {
  const t = text.toLowerCase();
  const intent: StructuredIntent = {
    maxAmountPaise: null,
    categories: [],
    brandsAllow: [],
    brandsDeny: [],
    maxQuantityPerItem: null,
    priceCeilingPerItemPaise: null,
    packTokens: [],
    excludeTokens: [],
    qty: null,
    packSizeHint: null,
    queryText: text.trim(),
  };

  // 1. Budget extraction: "under 150", "under ₹30,000", "max 200", "around 200"
  const underMatch =
    t.match(/(?:under|below|max|maximum|within|around|upto|up to)\s*(?:rs\.?|₹)?\s*([\d,]+)/i) ||
    t.match(/(?:rs\.?|₹)\s*([\d,]+)/i);
  if (underMatch) {
    const rawVal = underMatch[1]?.replace(/,/g, "") ?? "0";
    intent.maxAmountPaise = Number(rawVal) * 100;
  }

  // 2. Pack size hint: e.g. "1kg", "1 kg", "5kg", "500g", "200g", "1l", "5l"
  const sizeMatch = t.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|gm|l|ltr|litre|ml)\b/i);
  if (sizeMatch) {
    intent.packSizeHint = `${sizeMatch[1]}${sizeMatch[2].toLowerCase().replace("gm", "g").replace("ltr", "l").replace("litre", "l")}`;
  }

  // 3. Quantity extraction: e.g. "2 packs", "2 bags", "qty 2"
  const packQtyMatch = t.match(/\b(\d+)\s*(?:packs?|bags?|bottles?|packets?|units?|pcs?|pieces?)\b/i);
  if (packQtyMatch) {
    intent.qty = Number(packQtyMatch[1]);
    intent.maxQuantityPerItem = Number(packQtyMatch[1]);
  } else {
    // default to 1 pack if only weight was specified
    intent.qty = 1;
  }

  // 4. Categories detection
  // Tech categories
  if (t.includes("headphone") || t.includes("audio") || t.includes("earbud") || t.includes("earphone") || t.includes("speaker") || t.includes("airpods") || t.includes("wh-1000xm5") || t.includes("flip 6")) {
    intent.categories.push("audio");
  }
  if (t.includes("mouse") || t.includes("keyboard") || t.includes("peripheral") || t.includes("mx master") || t.includes("keychron") || t.includes("monitor") || t.includes("ultrasharp")) {
    intent.categories.push("peripherals");
  }
  if (t.includes("power") || t.includes("powerbank") || t.includes("battery") || t.includes("charger") || t.includes("powercore")) {
    intent.categories.push("power");
  }
  if (t.includes("cable") || t.includes("wire") || t.includes("cord") || t.includes("100w cable")) {
    intent.categories.push("cables");
  }
  if (t.includes("ssd") || t.includes("storage") || t.includes("drive") || t.includes("hard drive") || t.includes("t7")) {
    intent.categories.push("storage");
  }
  if (t.includes("hub") || t.includes("dock") || t.includes("adapter") || t.includes("accessory") || t.includes("accessories") || t.includes("7-in-1")) {
    intent.categories.push("accessories");
  }

  // Grocery categories (backwards compatibility)
  if (t.includes("rice") || t.includes("basmati") || t.includes("atta") || t.includes("wheat") || t.includes("grain")) {
    intent.categories.push("grains");
  }
  if (t.includes("dal") || t.includes("pulse") || t.includes("toor") || t.includes("moong") || t.includes("chana")) {
    intent.categories.push("pulses");
  }
  if (t.includes("spice") || t.includes("turmeric") || t.includes("masala") || t.includes("chilli") || t.includes("haldi")) {
    intent.categories.push("spices");
  }
  if (t.includes("oil") || t.includes("mustard") || t.includes("sunflower")) intent.categories.push("oil");
  if (t.includes("milk") || t.includes("ghee") || t.includes("dairy") || t.includes("paneer")) intent.categories.push("dairy");
  if (t.includes("snack") || t.includes("bhujia") || t.includes("namkeen") || t.includes("chocolate") || t.includes("biscuit")) {
    intent.categories.push("snacks");
  }
  if (t.includes("tea") || t.includes("coffee") || t.includes("beverage")) intent.categories.push("beverages");
  if (t.includes("detergent") || t.includes("soap") || t.includes("cleaner") || t.includes("household")) intent.categories.push("household");

  // 5. Brand allow / deny
  for (const brand of BRANDS) {
    if (t.includes(brand.toLowerCase())) intent.brandsAllow.push(brand);
  }

  const notBrand = t.match(/(?:not|without|no|deny|exclude)\s+([a-z][a-z\s']{1,20})/i);
  if (notBrand) {
    const deniedText = notBrand[1].toLowerCase();
    const guess = BRANDS.find((b) => deniedText.includes(b.toLowerCase().split(" ")[0]!));
    if (guess) {
      intent.brandsDeny.push(guess);
    }
    // Also add to excludeTokens
    intent.excludeTokens.push(...deniedText.split(/\s+/).filter((w) => w.length > 2));
  }

  // 6. Token extraction for SKU name verification
  const words = t
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  // If a word is part of denied text, don't include in packTokens
  const deniedWords = new Set(intent.excludeTokens);
  intent.packTokens = Array.from(new Set(words.filter((w) => !deniedWords.has(w))));

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
    packTokens: [],
    excludeTokens: [],
    qty: 1,
    packSizeHint: null,
    queryText,
  };
}

export function coerceIntent(raw: unknown, fallbackText: string): StructuredIntent {
  const base = parseIntentDeterministic(fallbackText);
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const cats = Array.isArray(o.categories)
    ? (o.categories as unknown[]).map(String).map(asCategory).filter(Boolean) as Category[]
    : base.categories;

  return {
    maxAmountPaise: typeof o.maxAmountPaise === "number" ? o.maxAmountPaise : base.maxAmountPaise,
    categories: cats.length ? cats : base.categories,
    brandsAllow: Array.isArray(o.brandsAllow) && o.brandsAllow.length ? o.brandsAllow.map(String) : base.brandsAllow,
    brandsDeny: Array.isArray(o.brandsDeny) && o.brandsDeny.length ? o.brandsDeny.map(String) : base.brandsDeny,
    maxQuantityPerItem:
      typeof o.maxQuantityPerItem === "number" ? o.maxQuantityPerItem : base.maxQuantityPerItem,
    priceCeilingPerItemPaise:
      typeof o.priceCeilingPerItemPaise === "number" ? o.priceCeilingPerItemPaise : base.priceCeilingPerItemPaise,
    packTokens: Array.isArray(o.packTokens) && o.packTokens.length ? o.packTokens.map(String) : base.packTokens,
    excludeTokens: Array.isArray(o.excludeTokens) && o.excludeTokens.length ? o.excludeTokens.map(String) : base.excludeTokens,
    qty: typeof o.qty === "number" ? o.qty : base.qty,
    packSizeHint: typeof o.packSizeHint === "string" ? o.packSizeHint : base.packSizeHint,
    queryText: fallbackText,
  };
}
