import { AFA_EXEMPT_PAISE, type CartLine, type GuardrailResult, type Mandate, type StructuredIntent } from "./types";

export function runGuardrail(opts: {
  lines: CartLine[];
  totalPaise: number;
  mandate: Mandate;
  intent: StructuredIntent;
}): GuardrailResult {
  const { lines, totalPaise, mandate, intent } = opts;

  if (mandate.status !== "active") {
    return {
      ok: false,
      code: "mandate_revoked",
      title: "Mandate is not active",
      detail: "This mandate was revoked or has expired. Future debits are blocked.",
      needsHumanConfirm: false,
    };
  }

  // Check mandate validity period
  if (mandate.validUntil && new Date(mandate.validUntil).getTime() < Date.now()) {
    return {
      ok: false,
      code: "mandate_expired",
      title: "Mandate expired",
      detail: `This policy expired on ${new Date(mandate.validUntil).toLocaleDateString()}. Re-authorization required.`,
      needsHumanConfirm: false,
    };
  }

  if (totalPaise > mandate.remainingPaise) {
    return {
      ok: false,
      code: "mandate_exceeded",
      title: "Would exceed remaining mandate",
      detail: `Cart is ₹${(totalPaise / 100).toFixed(0)} but remaining cap is ₹${(mandate.remainingPaise / 100).toFixed(0)}.`,
      needsHumanConfirm: false,
    };
  }

  if (totalPaise > AFA_EXEMPT_PAISE) {
    return {
      ok: false,
      code: "afa_threshold",
      title: "Above ₹15,000 AFA-exempt threshold",
      detail: "RBI silent-debit exemption does not apply above ₹15,000. Human confirmation is mandatory before execution.",
      needsHumanConfirm: true,
    };
  }

  // Combined text representation of all cart items
  const cartBlob = lines
    .map((l) => `${l.name} ${l.brand} ${l.category} ${l.sku}`.toLowerCase())
    .join(" ");

  // 1. Pack Token Verification: Ensure every requested specific keyword appears in the cart
  if (intent.packTokens && intent.packTokens.length > 0) {
    for (const token of intent.packTokens) {
      // If token is not a category name and not in cart blob -> block semantic mismatch
      const isCategoryWord = (intent.categories as readonly string[]).includes(token);
      if (!isCategoryWord && !cartBlob.includes(token)) {
        return {
          ok: false,
          code: "semantic_mismatch",
          title: "Requested item not in cart",
          detail: `You asked for '${token}', but the planned cart contains '${lines.map((l) => l.name).join(", ")}' without matching '${token}'.`,
          needsHumanConfirm: true,
        };
      }
    }
  }

  // 2. Exclude Token Verification: Ensure no denied keyword appears in the cart
  if (intent.excludeTokens && intent.excludeTokens.length > 0) {
    for (const exToken of intent.excludeTokens) {
      if (cartBlob.includes(exToken)) {
        return {
          ok: false,
          code: "semantic_mismatch",
          title: "Excluded item found in cart",
          detail: `Instruction excluded '${exToken}', but cart contains items matching '${exToken}'.`,
          needsHumanConfirm: true,
        };
      }
    }
  }

  for (const line of lines) {
    if (!mandate.categories.includes(line.category)) {
      return {
        ok: false,
        code: "semantic_mismatch",
        title: "Category not on the mandate",
        detail: `${line.name} is in category '${line.category}', which the mandate does not permit.`,
        needsHumanConfirm: false,
      };
    }
    if (mandate.brandsDeny.includes(line.brand)) {
      return {
        ok: false,
        code: "semantic_mismatch",
        title: "Denied brand",
        detail: `${line.brand} is on the mandate deny list.`,
        needsHumanConfirm: false,
      };
    }
    if (mandate.brandsAllow.length && !mandate.brandsAllow.includes(line.brand)) {
      return {
        ok: false,
        code: "semantic_mismatch",
        title: "Brand not on allow list",
        detail: `${line.brand} is not in the mandate allow list.`,
        needsHumanConfirm: false,
      };
    }
    if (line.quantity > mandate.maxQuantityPerItem) {
      return {
        ok: false,
        code: "semantic_mismatch",
        title: "Quantity above mandate",
        detail: `${line.name} qty ${line.quantity} exceeds max ${mandate.maxQuantityPerItem}.`,
        needsHumanConfirm: false,
      };
    }
    if (line.unitPricePaise > mandate.priceCeilingPerItemPaise) {
      return {
        ok: false,
        code: "semantic_mismatch",
        title: "Item over price ceiling",
        detail: `${line.name} exceeds the per-item ceiling of ₹${mandate.priceCeilingPerItemPaise / 100}.`,
        needsHumanConfirm: false,
      };
    }

    if (intent.categories.length && !intent.categories.includes(line.category)) {
      return {
        ok: false,
        code: "semantic_mismatch",
        title: "Outside this instruction",
        detail: `${line.name} (${line.category}) does not match the parsed intent categories: ${intent.categories.join(", ")}.`,
        needsHumanConfirm: true,
      };
    }
    if (intent.brandsDeny.includes(line.brand)) {
      return {
        ok: false,
        code: "semantic_mismatch",
        title: "Intent denied this brand",
        detail: `Instruction excludes brand '${line.brand}'.`,
        needsHumanConfirm: true,
      };
    }
    if (intent.brandsAllow.length && !intent.brandsAllow.includes(line.brand)) {
      return {
        ok: false,
        code: "semantic_mismatch",
        title: "Brand not requested",
        detail: `Instruction asked for ${intent.brandsAllow.join(", ")}, not ${line.brand}.`,
        needsHumanConfirm: true,
      };
    }
    if (intent.maxQuantityPerItem && line.quantity > intent.maxQuantityPerItem) {
      return {
        ok: false,
        code: "semantic_mismatch",
        title: "Quantity beyond instruction",
        detail: `Asked for at most ${intent.maxQuantityPerItem} units.`,
        needsHumanConfirm: true,
      };
    }
    if (
      intent.priceCeilingPerItemPaise &&
      line.unitPricePaise > intent.priceCeilingPerItemPaise
    ) {
      return {
        ok: false,
        code: "semantic_mismatch",
        title: "Price beyond instruction cap",
        detail: `${line.name} exceeds the instruction's per-item cap.`,
        needsHumanConfirm: true,
      };
    }
  }

  if (intent.maxAmountPaise && totalPaise > intent.maxAmountPaise) {
    return {
      ok: false,
      code: "semantic_mismatch",
      title: "Cart over instruction budget",
      detail: `Instruction budget ₹${(intent.maxAmountPaise / 100).toFixed(0)} but cart total is ₹${(totalPaise / 100).toFixed(0)}.`,
      needsHumanConfirm: true,
    };
  }

  return {
    ok: true,
    code: "pass",
    title: "Guardrail passed",
    detail: "Cart is strictly within the structured mandate, pack tokens, and budget parameters.",
    needsHumanConfirm: false,
  };
}
