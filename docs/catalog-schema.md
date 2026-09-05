# SafeBuy — Agent-Readable Merchant Catalog Schema

SafeBuy exposes an AP2/ACP-compliant machine-readable catalog discovery schema for third-party autonomous AI buyers at:
- **Discovery Manifest:** `GET /.well-known/agent-catalog.json` (served statically from `public/.well-known/agent-catalog.json`)
- **SKU Metadata Endpoint:** `GET /api/catalog/skus.json` (served statically from `public/api/catalog/skus.json`)
- **Programmatic MCP Query Interface:** `search_catalog` tool exposed via Model Context Protocol stdio server (`src/mcp/server.ts`) and direct module (`src/lib/safebuy/catalog.ts`).

---

## Catalog JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "SafeBuyAgentCatalog",
  "type": "object",
  "required": ["merchant", "version", "currency", "items"],
  "properties": {
    "merchant": {
      "type": "object",
      "required": ["id", "name", "vpa", "city"],
      "properties": {
        "id": { "type": "string", "example": "electrocore-ai" },
        "name": { "type": "string", "example": "ElectroCore Store" },
        "vpa": { "type": "string", "example": "electrocore@icici" },
        "city": { "type": "string", "example": "Bengaluru" }
      }
    },
    "version": { "type": "string", "example": "2026-08-23" },
    "currency": { "type": "string", "example": "INR" },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["sku", "name", "brand", "category", "pricePaise", "unit", "packTokens", "stock"],
        "properties": {
          "sku": { "type": "string", "example": "RICE-BAS-1KG" },
          "name": { "type": "string", "example": "Aged Basmati Rice 1 kg" },
          "brand": { "type": "string", "example": "India Gate" },
          "category": { "type": "string", "enum": ["grains", "pulses", "oil", "dairy", "spices", "snacks", "beverages", "household"] },
          "pricePaise": { "type": "integer", "example": 14200 },
          "unit": { "type": "string", "example": "1 kg" },
          "packTokens": {
            "type": "array",
            "items": { "type": "string" },
            "example": ["basmati", "rice", "1kg", "long grain"]
          },
          "stock": { "type": "integer", "example": 18 },
          "description": { "type": "string" }
        }
      }
    }
  }
}
```

---

## Live SKU Inventory Table

| SKU | Product Name | Brand | Category | Price (INR) | Pack Tokens |
|-----|--------------|-------|----------|-------------|-------------|
| `RICE-BAS-1KG` | Aged Basmati Rice 1 kg | India Gate | `grains` | ₹142.00 | `basmati`, `rice`, `1kg` |
| `RICE-BAS-5KG` | Aged Basmati Rice 5 kg (Economy Pack) | India Gate | `grains` | ₹625.00 | `basmati`, `rice`, `5kg`, `bulk` |
| `RICE-SON-5KG` | Sona Masoori 5 kg | Lal Qilla | `grains` | ₹389.00 | `sona masoori`, `rice`, `5kg` |
| `ATA-WHL-5KG` | Whole Wheat Atta 5 kg | Aashirvaad | `grains` | ₹275.00 | `atta`, `wheat`, `flour`, `5kg` |
| `DAL-TOO-1KG` | Toor Dal 1 kg | Tata Sampann | `pulses` | ₹168.00 | `toor`, `dal`, `pulse`, `1kg` |
| `DAL-MOO-500` | Moong Dal 500 g | Organic Tattva | `pulses` | ₹92.00 | `moong`, `dal`, `organic`, `500g` |
| `SPC-TUR-200` | Turmeric Powder 200 g | Everest | `spices` | ₹48.00 | `turmeric`, `haldi`, `spice`, `200g` |
| `OIL-MUS-1L` | Cold Pressed Mustard Oil 1 L | Fortune | `oil` | ₹175.00 | `mustard`, `oil`, `sarson`, `1l` |
| `DRY-MILK-1L` | Full Cream Milk 1 L | Amul Taaza | `dairy` | ₹66.00 | `milk`, `amul`, `dairy`, `1l` |

---

## Guardrail Semantic Token Verification Algorithm

When an agent proposes a candidate cart:
1. `parseIntent` normalizes user query into `packTokens` (e.g., `"Buy 1 kg basmati under ₹150"` $\to$ `packTokens: ["basmati", "1kg"]`).
2. `guardrail.ts` scans candidate item `name`, `brand`, and `sku`.
3. If requested token `basmati` is missing (e.g. planner selects `ATA-WHL-5KG`), the guardrail **blocks with code `intent_mismatch`** and halts execution before any payment order is generated.
