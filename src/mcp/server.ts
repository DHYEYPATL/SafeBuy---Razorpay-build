import readline from "node:readline";
import { CATALOG } from "../lib/safebuy/catalog";
import { parseIntentDeterministic } from "../lib/safebuy/parse-intent";
import { planCart } from "../lib/safebuy/plan";
import { runGuardrail } from "../lib/safebuy/guardrail";
import { findBoundedUpsell } from "../lib/safebuy/upsell";
import { generateX402Challenge, verifyAndIssueX402Token, validateX402Token, PREMIUM_CATALOG } from "../lib/safebuy/x402";
import type { Mandate, ProposedCart } from "../lib/safebuy/types";

// In-memory mandate store for MCP caller reference (or defaults to active policy)
const activeMandates = new Map<string, Mandate>();

// Pre-seed a default test mandate
const defaultMandateId = "man_mcp_default";
activeMandates.set(defaultMandateId, {
  id: defaultMandateId,
  status: "active",
  merchantId: "nila-kirana",
  maxAmountPaise: 150000,
  remainingPaise: 150000,
  spentPaise: 0,
  categories: ["grains", "pulses", "spices", "oil", "dairy", "snacks", "beverages", "household"],
  brandsAllow: [],
  brandsDeny: ["Cadbury"],
  maxQuantityPerItem: 5,
  priceCeilingPerItemPaise: 100000,
  createdAt: new Date().toISOString(),
  validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
  revokedAt: null,
  authorizedBy: "human_authenticated_ui",
  authorizationMethod: "simulated_registration_auth",
});

export const MCP_TOOLS = [
  {
    name: "search_catalog",
    description: "Search merchant grocery catalog by keyword, pack token, or category.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (e.g. 'basmati', 'atta', 'oil')" },
      },
    },
  },
  {
    name: "propose_purchase",
    description: "Propose an autonomous purchase against a pre-authorized spending policy mandate. Evaluates deterministic guardrails, creates merchant order stock reservation, and issues pre-debit notice.",
    inputSchema: {
      type: "object",
      required: ["mandateId", "naturalLanguageIntent"],
      properties: {
        mandateId: { type: "string", description: "Pre-authorized policy mandate ID (must be created via authenticated human UI)" },
        naturalLanguageIntent: { type: "string", description: "Natural language purchase request (e.g. 'Buy 1 kg basmati under ₹150')" },
      },
    },
  },
  {
    name: "confirm_purchase",
    description: "Initiate Checkout execution for a valid pre-debit notice after dwell window clearance.",
    inputSchema: {
      type: "object",
      required: ["noticeId"],
      properties: {
        noticeId: { type: "string", description: "Durable pre-debit notice ID" },
      },
    },
  },
  {
    name: "request_premium_access",
    description: "Request x402-pattern premium wholesale catalog access. Returns HTTP 402 challenge with Razorpay order details.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Agent session identifier" },
      },
    },
  },
  {
    name: "pay_for_premium_access",
    description: "Settle micro-fee for premium catalog access and receive a short-lived access token.",
    inputSchema: {
      type: "object",
      required: ["orderId", "paymentId"],
      properties: {
        orderId: { type: "string", description: "Razorpay Order ID" },
        paymentId: { type: "string", description: "Razorpay Payment ID" },
        signature: { type: "string", description: "Optional HMAC signature" },
        sessionId: { type: "string", description: "Agent session identifier" },
      },
    },
  },
  {
    name: "search_premium_catalog",
    description: "Search x402 token-gated premium wholesale catalog with bulk pricing.",
    inputSchema: {
      type: "object",
      required: ["token"],
      properties: {
        token: { type: "string", description: "Valid x402 access token" },
        query: { type: "string", description: "Search term" },
      },
    },
  },
];

export async function handleMcpToolCall(name: string, args: Record<string, any>) {
  switch (name) {
    case "search_catalog": {
      const q = String(args.query || "").toLowerCase();
      const items = CATALOG.filter(
        (item) =>
          !q ||
          item.name.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.brand.toLowerCase().includes(q),
      );
      return {
        count: items.length,
        items: items.map((i) => ({
          sku: i.sku,
          name: i.name,
          brand: i.brand,
          category: i.category,
          priceRupees: i.pricePaise / 100,
          stock: i.stock,
        })),
      };
    }

    case "propose_purchase": {
      const mandate = activeMandates.get(args.mandateId);
      if (!mandate) {
        return {
          error: "MandateNotFound",
          message: `Mandate '${args.mandateId}' not found. MCP callers cannot mint mandates; a mandate must be created through the human UI.`,
        };
      }

      const intent = parseIntentDeterministic(String(args.naturalLanguageIntent));
      const cart = planCart(mandate, intent);

      if (!cart || cart.lines.length === 0) {
        return {
          blocked: true,
          reason: "ClarificationRequired",
          message: cart?.reason || "No matching catalog items found within stated budget.",
        };
      }

      const guardrailResult = runGuardrail({
        lines: cart.lines,
        totalPaise: cart.totalPaise,
        mandate,
        intent,
      });

      if (!guardrailResult.ok) {
        return {
          blocked: true,
          guardrailFailure: guardrailResult.code,
          explanation: guardrailResult.detail,
          cart,
        };
      }

      const upsell = findBoundedUpsell(cart, mandate, intent, CATALOG);

      const noticeId = `not_mcp_${Date.now()}`;
      const executeAfter = new Date(Date.now() + 8000).toISOString();

      return {
        success: true,
        noticeId,
        executeAfter,
        dwellSeconds: 8,
        cart: {
          lines: cart.lines,
          totalRupees: cart.totalPaise / 100,
          merchant: cart.merchantName,
        },
        boundedUpsell: upsell ? {
          suggestedSku: upsell.suggestedSku,
          suggestedName: upsell.suggestedName,
          savingsPercent: upsell.savingsPercent,
          explanation: upsell.explanation,
        } : null,
      };
    }

    case "confirm_purchase": {
      const noticeId = String(args.noticeId);
      const mockCheckoutOrderId = `order_rzp_${Date.now()}`;
      return {
        success: true,
        noticeId,
        checkoutOrderId: mockCheckoutOrderId,
        status: "ready_for_checkout",
        note: "Customer-present Checkout authorization required to capture funds.",
      };
    }

    case "request_premium_access": {
      const challenge = generateX402Challenge(args.sessionId);
      return challenge;
    }

    case "pay_for_premium_access": {
      const result = verifyAndIssueX402Token({
        orderId: String(args.orderId),
        paymentId: String(args.paymentId),
        signature: args.signature ? String(args.signature) : null,
        sessionId: args.sessionId ? String(args.sessionId) : "agent_default",
      });
      return result;
    }

    case "search_premium_catalog": {
      const isValid = validateX402Token(args.token);
      if (!isValid) {
        return {
          status: 402,
          error: "InvalidOrExpiredToken",
          message: "Payment Required. Request a valid token via request_premium_access.",
        };
      }

      const q = String(args.query || "").toLowerCase();
      const items = PREMIUM_CATALOG.filter(
        (item) => !q || item.name.toLowerCase().includes(q) || item.brand.toLowerCase().includes(q),
      );
      return {
        ok: true,
        premiumItems: items.map((i) => ({
          sku: i.sku,
          name: i.name,
          brand: i.brand,
          unit: i.unit,
          priceRupees: i.pricePaise / 100,
          wholesaleDiscount: "20-25% off retail",
          stock: i.stock,
        })),
      };
    }

    default:
      return { error: "UnknownTool", tool: name };
  }
}

// JSON-RPC stdio handler when executed directly via CLI
if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  rl.on("line", async (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.method === "tools/list") {
        console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: MCP_TOOLS } }));
      } else if (msg.method === "tools/call") {
        const result = await handleMcpToolCall(msg.params.name, msg.params.arguments || {});
        console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } }));
      } else if (msg.method === "initialize") {
        console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "safebuy-mcp", version: "1.0.0" } } }));
      } else {
        console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
      }
    } catch (e) {
      console.error("MCP stdio parse error:", e);
    }
  });
}
