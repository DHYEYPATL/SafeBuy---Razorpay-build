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
      detail: "This mandate was revoked. Future debits are blocked.",
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
      detail: "RBI silent-debit exemption does not apply. Human confirmation is required before execution.",
      needsHumanConfirm: true,
    };
  }

  for (const line of lines) {
    if (!mandate.categories.includes(line.category)) {
      return {
        ok: false,
        code: "semantic_mismatch",
        title: "Category not on the mandate",
        detail: `${line.name} is ${line.category}, which the mandate does not allow.`,
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
        detail: `${line.name} is above the per-item ceiling.`,
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
        detail: `Instruction excludes ${line.brand}.`,
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
        title: "Quantity beyond this instruction",
        detail: `Asked for at most ${intent.maxQuantityPerItem}.`,
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
        title: "Price beyond this instruction",
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
      detail: `Instruction budget ₹${(intent.maxAmountPaise / 100).toFixed(0)} but cart is ₹${(totalPaise / 100).toFixed(0)}.`,
      needsHumanConfirm: true,
    };
  }

  return {
    ok: true,
    code: "pass",
    title: "Guardrail passed",
    detail: "Cart sits inside both the mandate and the structured intent.",
    needsHumanConfirm: false,
  };
}
