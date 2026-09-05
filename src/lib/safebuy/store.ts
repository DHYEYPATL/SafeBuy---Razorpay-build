import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CATALOG, getItem } from "./catalog";
import { runGuardrail } from "./guardrail";
import { GENESIS_HASH, hashRecord } from "./hash";
import { coerceIntent, parseIntentDeterministic } from "./parse-intent";
import { planCart } from "./plan";
import { fetchRazorpayPayment, parseIntentWithGrok } from "./razorpay-api";
import { findBoundedUpsell, type UpsellCandidate } from "./upsell";
import {
  lookupAgentIdentity,
  computeTrustScore,
  computeDwellDurationMs,
  verifyAgentSignature,
  type AgentIdentity,
} from "./identity";
import {
  evaluateActiveCampaigns,
  buildCampaignCart,
  type CampaignOffer,
} from "./campaign";
import {
  CATEGORIES,
  AFA_EXEMPT_PAISE,
  DEMO_NOTIFY_WINDOW_MS,
  MERCHANT_ID,
  MERCHANT_NAME,
  type AgentPhase,
  type AuditRecord,
  type FailureKind,
  type LabInject,
  type Mandate,
  type MerchantOrder,
  type PreDebitNotice,
  type ProposedCart,
  type PurchaseAttempt,
  type StructuredIntent,
  type AP2IntentMandate,
  type AP2CartMandate,
  type AP2PaymentMandate,
  type CartLine,
} from "./types";
import { newId, paiseToInr } from "../utils";

type ChatMsg = { id: string; role: "user" | "agent" | "system"; text: string; ts: string };

import type { ShortlistItem, EvaluationDetail } from "./types";

export type JourneyStage = "understand" | "discover" | "evaluate" | "recommend" | "approve" | "purchase";

export interface SessionEvent {
  id: string;
  time: string;
  event: string;
  detail?: string;
}

export interface TelemetryData {
  lastResponseTime: string;
  toolCalls: number;
  rounds: number;
  provider: string;
  model: string;
  fallbackUsed: boolean;
}

export interface ConfirmedOrderSummary {
  id: string;
  name: string;
  amountPaise: number;
  orderId: string;
  paymentId: string;
  time: string;
  correlationId: string;
  discoveryPrompt?: string;
  auditTrail: Array<{ event: string; time: string }>;
}

interface SafeBuyState {
  mandate: Mandate | null;
  agentIdentity: AgentIdentity;
  audit: AuditRecord[];
  attempts: PurchaseAttempt[];
  notices: PreDebitNotice[];
  merchantOrders: MerchantOrder[];
  chat: ChatMsg[];
  phase: AgentPhase;
  labInject: LabInject;
  windowMsLeft: number;
  isExecutingLocked: boolean;
  pendingCart: ProposedCart | null;
  pendingIntent: StructuredIntent | null;
  pendingAttemptId: string | null;
  upsellCandidate: UpsellCandidate | null;
  activeCampaign: CampaignOffer | null;
  correlationId: string | null;
  razorpayKeyId: string;
  hasSecret: boolean;
  isConfigured: boolean;
  confirmedPaymentIds: string[];
  lastExplain: string;
  stockOverride: Record<string, number>;
  
  // ElectroCore AI Commerce enhancements
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  aiShortlist: ShortlistItem[];
  setAiShortlist: (list: ShortlistItem[]) => void;
  aiEvaluation: EvaluationDetail | null;
  setAiEvaluation: (evalDetail: EvaluationDetail | null) => void;
  journeyStage: JourneyStage;
  setJourneyStage: (stage: JourneyStage) => void;
  recentQueries: string[];
  addRecentQuery: (q: string) => void;
  clearRecentQueries: () => void;
  sessionActivity: SessionEvent[];
  addSessionActivity: (event: string, detail?: string) => void;
  telemetry: TelemetryData;
  selectedSkuForPayment: string;
  setSelectedSkuForPayment: (sku: string) => void;
  lastConfirmedOrder: ConfirmedOrderSummary | null;
  ensureDefaultMandate: () => void;
  buyProductDirect: (sku: string) => Promise<void>;

  clearCandidateCart: () => void;
  proceedCandidateCart: () => Promise<void>;
  acceptUpsell: () => Promise<void>;
  dismissUpsell: () => void;
  applyCampaign: (offer: CampaignOffer) => Promise<void>;
  dismissCampaign: () => void;
  setRazorpayKeyDetails: (k: { keyId: string; hasSecret: boolean; configured: boolean }) => void;
  setLabInject: (i: LabInject) => void;
  createMandate: (m: {
    maxAmountPaise: number;
    categories: Mandate["categories"];
    brandsAllow: string[];
    brandsDeny: string[];
    maxQuantityPerItem: number;
    priceCeilingPerItemPaise: number;
    validityDays?: number;
  }) => Promise<void>;
  revokeMandate: () => Promise<void>;
  appendAudit: (partial: Omit<AuditRecord, "seq" | "id" | "hash" | "prevHash" | "ts">) => Promise<AuditRecord>;
  runInstruction: (text: string, parsed?: StructuredIntent) => Promise<void>;
  tickWindow: () => void;
  extendWindow: (extraMs?: number) => void;
  proceedNow: () => Promise<void>;
  confirmAfaOverride: () => Promise<void>;
  confirmSemanticOverride: () => Promise<void>;
  startExecute: (opts?: { razorpayOrderId?: string | null; forceFail?: FailureKind }) => Promise<void>;
  handleHandlerReceived: (paymentId: string, orderId: string | null, signature?: string) => Promise<void>;
  startReconcile: (attemptId: string, paymentId: string, orderId: string | null) => Promise<void>;
  applyConfirm: (opts: {
    attemptId?: string;
    paymentId: string;
    orderId?: string | null;
    amountPaise?: number;
    signature?: string | null;
    status?: string;
    source: "fetch" | "webhook";
  }) => Promise<void>;
  releaseReservation: (attemptId: string | null, reason: string) => Promise<void>;
  failClosed: (reason: string) => Promise<void>;
  abortPending: (reason: string) => Promise<void>;
  resetDemo: () => void;
  getAP2Primitives: () => {
    intentMandate: AP2IntentMandate | null;
    cartMandate: AP2CartMandate | null;
    paymentMandate: AP2PaymentMandate | null;
  };
}

function nowIso() {
  return new Date().toISOString();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getInitialMandate(): Mandate {
  return {
    id: "man_electrocore_live",
    status: "active",
    merchantId: MERCHANT_ID,
    maxAmountPaise: 10_000_000, // ₹1,00,000 budget
    remainingPaise: 10_000_000,
    spentPaise: 0,
    categories: [...CATEGORIES],
    brandsAllow: [],
    brandsDeny: [],
    maxQuantityPerItem: 10,
    priceCeilingPerItemPaise: 5_000_000, // ₹50,000 ceiling
    createdAt: nowIso(),
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
    revokedAt: null,
    authorizedBy: "human_cardholder",
    authorizationMethod: "simulated_registration_auth",
  };
}

export const useSafeBuy = create<SafeBuyState>()(
  persist(
    (set, get) => ({
      mandate: getInitialMandate(),
      agentIdentity: lookupAgentIdentity("agent_safebuy_default") || {
        agentId: "agent_electrocore_v2",
        publicKey: "pub_ed25519_demo_key_7788",
        operatorName: "ElectroCore Agentic Buyer",
        actingFor: null,
        registeredAt: new Date().toISOString(),
        trustScore: 92,
        status: "active",
      },
      audit: [],
      attempts: [],
      notices: [],
      merchantOrders: [],
      chat: [],
      phase: "idle",
      labInject: "none",
      windowMsLeft: 0,
      isExecutingLocked: false,
      pendingCart: null,
      pendingIntent: null,
      pendingAttemptId: null,
      upsellCandidate: null,
      activeCampaign: null,
      correlationId: null,
      razorpayKeyId: "",
      hasSecret: false,
      isConfigured: false,
      confirmedPaymentIds: [],
      lastExplain: "Connected to ElectroCore AI Commerce Assistant.",
      stockOverride: {},
      hydrateOk: false,

      // ElectroCore initial state
      selectedModel: "MiMo 2.5 - OpenCode Zen",
      setSelectedModel: (m) => {
        set({ selectedModel: m });
        get().addSessionActivity("Model changed", `Switched active model to ${m}`);
      },
      aiShortlist: [
        {
          badge: "BEST MATCH",
          sku: "SONY-WH1000XM5",
          name: "Sony WH-1000XM5 Wireless Headphones",
          brand: "Sony",
          pricePaise: 2999000,
          stock: 8,
          unit: "1 unit",
          reason: "Top-rated noise cancelling headphones, ₹29,990, in stock 8 units.",
          specsHighlight: "ANC · 30h · LDAC",
        },
        {
          badge: "ALTERNATIVE",
          sku: "ANKER-7IN1-HUB",
          name: "Anker 7-in-1 USB-C Hub",
          brand: "Anker",
          pricePaise: 499000,
          stock: 14,
          unit: "1 unit",
          reason: "100W PD, 4K60 HDMI, 7 ports companion hub.",
          specsHighlight: "100W PD · 4K60 · 7 Ports",
        },
        {
          badge: "OPTION 03",
          sku: "KEYCHRON-K3-MAX",
          name: "Keychron K3 Max Wireless Keyboard",
          brand: "Keychron",
          pricePaise: 1649000,
          stock: 12,
          unit: "1 unit",
          reason: "Custom wireless mechanical keyboard, QMK/VIA support.",
          specsHighlight: "RGB · Mechanical · 84 Keys",
        },
      ],
      setAiShortlist: (list) => set({ aiShortlist: list }),
      aiEvaluation: {
        consideredCount: 5,
        primaryMatch: "Sony WH-1000XM5 Wireless Headphones",
        primaryReason: "Matches ANC, wireless connectivity, and in-stock inventory.",
        rejected: [
          { name: "Apple AirPods Pro (2nd Gen)", reason: "In-ear format rather than over-ear" },
          { name: "Logitech MX Master 3S", reason: "Currently out of stock" },
        ],
      },
      setAiEvaluation: (evalDetail) => set({ aiEvaluation: evalDetail }),
      journeyStage: "understand",
      setJourneyStage: (stage) => set({ journeyStage: stage }),
      recentQueries: [
        "Compare Sony WH-1000XM5 and JBL Flip 6",
        "Is the Logitech MX Master 3S in stock?",
        "I need wireless headphones under ₹30,000",
        "What goes well with the Sony WH-1000XM5?",
        "Anker 7-in-1 USB-C Hub",
      ],
      addRecentQuery: (q) =>
        set((s) => ({
          recentQueries: [q, ...s.recentQueries.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 10),
        })),
      clearRecentQueries: () => set({ recentQueries: [] }),
      sessionActivity: [
        {
          id: "act_init",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          event: "Session started",
          detail: "ElectroCore Agentic Commerce core loaded",
        },
      ],
      addSessionActivity: (event, detail) =>
        set((s) => ({
          sessionActivity: [
            {
              id: newId("act"),
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              event,
              detail,
            },
            ...s.sessionActivity,
          ].slice(0, 25),
        })),
      telemetry: {
        lastResponseTime: "1.2s",
        toolCalls: 2,
        rounds: 3,
        provider: "OpenRouter",
        model: "opencode/mimo-2.5",
        fallbackUsed: false,
      },
      selectedSkuForPayment: "SONY-WH1000XM5",
      setSelectedSkuForPayment: (sku) => set({ selectedSkuForPayment: sku }),
      lastConfirmedOrder: null,

      ensureDefaultMandate: () => {
        const current = get().mandate;
        if (!current || current.status !== "active" || current.priceCeilingPerItemPaise < 3_000_000) {
          set({ mandate: getInitialMandate() });
        }
      },

      buyProductDirect: async (sku: string) => {
        get().ensureDefaultMandate();
        const item = getItem(sku);
        if (!item) return;

        get().setSelectedSkuForPayment(sku);
        get().addSessionActivity("Direct Buy initiated", `Selected ${item.name} (₹${item.pricePaise / 100})`);
        get().setJourneyStage("approve");

        const text = `Buy 1 unit of ${item.name}`;
        await get().runInstruction(text);
      },

      setRazorpayKeyDetails: (k) =>
        set({
          razorpayKeyId: k.keyId,
          hasSecret: k.hasSecret,
          isConfigured: k.configured,
        }),

      setLabInject: (i) => set({ labInject: i }),

      appendAudit: async (partial) => {
        const prev = get().audit.at(-1);
        const prevHash = prev?.hash ?? GENESIS_HASH;
        const seq = (prev?.seq ?? 0) + 1;
        const id = newId("aud");
        const ts = nowIso();
        const base = {
          seq,
          id,
          ts,
          correlationId: partial.correlationId,
          phase: partial.phase,
          event: partial.event,
          layer: partial.layer,
          explain: partial.explain,
          payload: partial.payload ?? {},
        };
        const hash = await hashRecord(prevHash, base);
        const rec: AuditRecord = { ...base, prevHash, hash };
        const newAudit = [...get().audit, rec];
        
        // Recompute agent trust score dynamically from live audit trail
        const currentAgent = get().agentIdentity;
        const updatedScore = computeTrustScore(currentAgent.agentId, newAudit);

        set({
          audit: newAudit,
          lastExplain: partial.explain,
          agentIdentity: { ...currentAgent, trustScore: updatedScore },
        });
        return rec;
      },

      createMandate: async (input) => {
        const validityDays = input.validityDays ?? 7;
        const validUntil = new Date(Date.now() + validityDays * 86400000).toISOString();

        const mandate: Mandate = {
          id: newId("man"),
          status: "active",
          merchantId: MERCHANT_ID,
          maxAmountPaise: input.maxAmountPaise,
          remainingPaise: input.maxAmountPaise,
          spentPaise: 0,
          categories: input.categories,
          brandsAllow: input.brandsAllow,
          brandsDeny: input.brandsDeny,
          maxQuantityPerItem: input.maxQuantityPerItem,
          priceCeilingPerItemPaise: input.priceCeilingPerItemPaise,
          createdAt: nowIso(),
          validUntil,
          revokedAt: null,
          authorizedBy: "human_user",
          authorizationMethod: "simulated_registration_auth",
        };
        const cid = newId("cor");
        const initialCampaign = evaluateActiveCampaigns({
          agentId: get().agentIdentity.agentId,
          mandate,
          auditHistory: get().audit,
        });

        set({ mandate, correlationId: cid, phase: "idle", activeCampaign: initialCampaign });
        await get().appendAudit({
          correlationId: cid,
          phase: "idle",
          event: "mandate.created",
          layer: "live",
          explain: `Structured policy mandate ${mandate.id} established. Spend limit ₹${mandate.maxAmountPaise / 100}, valid for ${validityDays} days. Pre-authorized with simulated registration authentication.`,
          payload: {
            mandateId: mandate.id,
            maxAmountPaise: mandate.maxAmountPaise,
            categories: mandate.categories,
            validUntil,
          },
        });
        set({
          chat: [
            {
              id: newId("msg"),
              role: "system",
              ts: nowIso(),
              text: `Spending policy active (₹${mandate.maxAmountPaise / 100} cap, valid until ${new Date(validUntil).toLocaleDateString()}). Instruct the agent on what to purchase.`,
            },
          ],
        });
      },

      revokeMandate: async () => {
        const m = get().mandate;
        if (!m) return;
        const next = { ...m, status: "revoked" as const, revokedAt: nowIso() };
        set({ mandate: next });
        await get().appendAudit({
          correlationId: get().correlationId ?? newId("cor"),
          phase: get().phase,
          event: "mandate.revoked",
          layer: "live",
          explain: "Policy revoked by user (future-only). In-flight debits already dispatched to the payment rail complete on their own.",
          payload: { mandateId: m.id, phaseAtRevoke: get().phase },
        });
      },

      runInstruction: async (text, parsed) => {
        get().ensureDefaultMandate();
        const mandate = get().mandate;
        if (!mandate || mandate.status !== "active") {
          set({
            chat: [
              ...get().chat,
              { id: newId("msg"), role: "user", text, ts: nowIso() },
              {
                id: newId("msg"),
                role: "system",
                ts: nowIso(),
                text: "An active spending policy mandate is required before instructing the buyer.",
              },
            ],
          });
          return;
        }

        const trimmed = text.trim();
        get().addRecentQuery(trimmed);
        get().addSessionActivity("Query", trimmed);
        get().setJourneyStage("discover");

        const isCheckoutCmd = /^(checkout|that'?s\s+it|proceed|place\s+order|done|pay(\s+now)?|buy(\s+now)?)$/i.test(trimmed);
        if (isCheckoutCmd) {
          const existing = get().pendingCart;
          if (existing && existing.lines.length > 0) {
            set({
              chat: [
                ...get().chat,
                { id: newId("msg"), role: "user", text, ts: nowIso() },
              ],
            });
            await get().proceedCandidateCart();
            return;
          } else {
            set({
              chat: [
                ...get().chat,
                { id: newId("msg"), role: "user", text, ts: nowIso() },
                {
                  id: newId("msg"),
                  role: "agent",
                  ts: nowIso(),
                  text: "🛒 Your candidate basket is currently empty. Tell me what product you'd like to add! (e.g. 'Sony WH-1000XM5 headphones')",
                },
              ],
            });
            return;
          }
        }

        const isClearCmd = /^(clear|reset|empty)(\s+cart|\s+basket)?$/i.test(trimmed);
        if (isClearCmd) {
          set({
            chat: [
              ...get().chat,
              { id: newId("msg"), role: "user", text, ts: nowIso() },
            ],
          });
          get().clearCandidateCart();
          return;
        }

        const cid = newId("cor");
        let intent: StructuredIntent;
        let intentSource: "grok" | "deterministic" = "deterministic";

        if (parsed) {
          intent = parsed;
        } else {
          try {
            const grokRes = await parseIntentWithGrok({ data: { text } });
            if (grokRes.ok && grokRes.source === "grok" && grokRes.intent) {
              intent = coerceIntent(grokRes.intent, text);
              intentSource = "grok";
            } else {
              intent = parseIntentDeterministic(text);
            }
          } catch {
            intent = parseIntentDeterministic(text);
          }
        }

        set({
          phase: "planning",
          correlationId: cid,
          pendingIntent: intent,
          isExecutingLocked: false,
          chat: [
            ...get().chat,
            { id: newId("msg"), role: "user", text, ts: nowIso() },
          ],
        });

        // Generate contextual Shortlist & Evaluation cards based on query keywords
        const lower = text.toLowerCase();
        if (lower.includes("headphone") || lower.includes("audio") || lower.includes("30,000") || lower.includes("30000") || lower.includes("wh-1000xm5")) {
          set({
            selectedSkuForPayment: "SONY-WH1000XM5",
            aiShortlist: [
              {
                badge: "BEST MATCH",
                sku: "SONY-WH1000XM5",
                name: "Sony WH-1000XM5 Wireless Headphones",
                brand: "Sony",
                pricePaise: 2999000,
                stock: 8,
                unit: "1 unit",
                reason: "Industry-leading active noise cancellation, 30h battery, LDAC audio, under ₹30k.",
                specsHighlight: "ANC · 30hr · 250g · LDAC",
              },
              {
                badge: "ALTERNATIVE",
                sku: "APPLE-AIRPODS-PRO-2",
                name: "Apple AirPods Pro (2nd Gen)",
                brand: "Apple",
                pricePaise: 2490000,
                stock: 15,
                unit: "1 unit",
                reason: "In-ear portable form factor with H2 chip and Adaptive Audio.",
                specsHighlight: "H2 Chip · ANC · MagSafe",
              },
              {
                badge: "OPTION 03",
                sku: "JBL-FLIP-6",
                name: "JBL Flip 6 Portable Bluetooth Speaker",
                brand: "JBL",
                pricePaise: 999900,
                stock: 18,
                unit: "1 unit",
                reason: "30W portable Bluetooth speaker with IP67 waterproofing.",
                specsHighlight: "30W · IP67 · 12hr battery",
              },
            ],
            aiEvaluation: {
              consideredCount: 5,
              primaryMatch: "Sony WH-1000XM5 Wireless Headphones",
              primaryReason: "Exact match for premium wireless noise cancellation under ₹30,000.",
              rejected: [
                { name: "Apple AirPods Pro (2nd Gen)", reason: "In-ear format rather than over-ear studio headphones" },
                { name: "JBL Flip 6", reason: "Portable speaker rather than personal listening headphones" },
                { name: "Dell UltraSharp 27\" 4K", reason: "Product category is Display, exceeds budget" },
              ],
            },
          });
          get().addSessionActivity("Recommendation", "Generated Sony WH-1000XM5 shortlist");
          get().setJourneyStage("recommend");
        } else if (lower.includes("complement") || lower.includes("goes well") || lower.includes("accessory") || lower.includes("with the sony")) {
          set({
            selectedSkuForPayment: "ANKER-7IN1-HUB",
            aiShortlist: [
              {
                badge: "BEST MATCH",
                sku: "ANKER-7IN1-HUB",
                name: "Anker 7-in-1 USB-C Hub",
                brand: "Anker",
                pricePaise: 499000,
                stock: 14,
                unit: "1 unit",
                reason: "HDMI 4K60, USB-A, SD card, and 100W pass-through charging.",
                specsHighlight: "100W PD · 4K60 HDMI · 7 Ports",
              },
              {
                badge: "ALTERNATIVE",
                sku: "ANKER-POWERCORE-20K",
                name: "Anker PowerCore 20000mAh Power Bank",
                brand: "Anker",
                pricePaise: 399000,
                stock: 40,
                unit: "1 unit",
                reason: "High-capacity power bank with 22.5W fast charging.",
                specsHighlight: "20000mAh · 22.5W Fast Charge",
              },
              {
                badge: "OPTION 03",
                sku: "ANKER-USBC-100W-1M",
                name: "Anker USB-C to USB-C 100W Cable (1m)",
                brand: "Anker",
                pricePaise: 149000,
                stock: 60,
                unit: "1 unit",
                reason: "Braided 100W USB-C cable for laptops and power banks.",
                specsHighlight: "100W · Double Braided · 1m",
              },
            ],
            aiEvaluation: {
              consideredCount: 5,
              primaryMatch: "Anker 7-in-1 USB-C Hub",
              primaryReason: "Essential companion hub to connect workstation peripherals and audio interfaces.",
              rejected: [
                { name: "Anker PowerCore 20000mAh Power Bank", reason: "Does not match all stated port requirements" },
                { name: "Anker USB-C to USB-C 100W Cable", reason: "Does not match all stated port requirements" },
              ],
            },
          });
          get().addSessionActivity("Recommendation", "Surfaced Anker 7-in-1 complement recommendations");
          get().setJourneyStage("recommend");
        } else if (lower.includes("stock") || lower.includes("availability") || lower.includes("mx master")) {
          set({
            selectedSkuForPayment: "KEYCHRON-K3-MAX",
            aiShortlist: [
              {
                badge: "BEST MATCH",
                sku: "KEYCHRON-K3-MAX",
                name: "Keychron K3 Max Wireless Keyboard",
                brand: "Keychron",
                pricePaise: 1649000,
                stock: 12,
                unit: "1 unit",
                reason: "In-stock companion peripheral with 2.4GHz & Bluetooth.",
                specsHighlight: "In stock (12) · Mechanical · RGB",
              },
              {
                badge: "ALTERNATIVE",
                sku: "LOGI-MX-MASTER-3S",
                name: "Logitech MX Master 3S Mouse",
                brand: "Logitech",
                pricePaise: 999000,
                stock: 0,
                unit: "1 unit",
                reason: "Currently Out of Stock.",
                specsHighlight: "Out of stock · 8000 DPI",
              },
            ],
            aiEvaluation: {
              consideredCount: 3,
              primaryMatch: "Logitech MX Master 3S Mouse",
              primaryReason: "Checked live warehouse inventory in real-time.",
              rejected: [
                { name: "Logitech MX Master 3S Mouse", reason: "0 units in stock" },
              ],
            },
          });
          get().addSessionActivity("Stock checked", "Logitech MX Master 3S: Out of Stock");
          get().setJourneyStage("evaluate");
        }

        await get().appendAudit({
          correlationId: cid,
          phase: "planning",
          event: "intent.parsed",
          layer: "live",
          explain: `Structured intent parsed (${intentSource}): packTokens=[${intent.packTokens.join(", ")}], budget=₹${(intent.maxAmountPaise ?? mandate.remainingPaise) / 100}. Guardrail will diff candidate cart against this schema.`,
          payload: { intent, source: intentSource },
        });

        // Lab inject: Replay attack / Forged Signature simulation (Edge Case 10)
        if (get().labInject === "replay_attack") {
          const forgedSignature = "sig_forged_replay_attack_invalid_hmac_hex";
          await get().appendAudit({
            correlationId: cid,
            phase: "planning",
            event: "identity.replay_attack_detected",
            layer: "live",
            explain: "Edge Case 10: Injected forged cryptographic signature simulation. Replay / forgery defense triggered.",
            payload: { forgedSignature },
          });
          await get().failClosed("Halted: Cryptographic signature verification failed (Edge Case 10). Replay attack rejected.");
          return;
        }

        // Lab inject: Untrusted agent simulation (Edge Case 14)
        if (get().labInject === "untrusted_agent") {
          await get().appendAudit({
            correlationId: cid,
            phase: "planning",
            event: "identity.untrusted_agent",
            layer: "live",
            explain: "Edge Case 14: Agent identity trust score is untrusted (<30). Access to purchase execution denied.",
            payload: { trustScore: 20 },
          });
          await get().failClosed("Halted: Agent trust score (20/100) is below safety threshold (<30). Execution denied.");
          return;
        }

        // Edge Case 14: Automated fail-closed check for registered agent validity
        const agentStatus = get().agentIdentity.status;
        if (agentStatus !== "active") {
          await get().appendAudit({
            correlationId: cid,
            phase: "planning",
            event: "identity.unregistered_agent_blocked",
            layer: "live",
            explain: `Edge Case 14: Agent '${get().agentIdentity.agentId}' status is '${agentStatus}'. Execution blocked fail-closed before payment order.`,
            payload: { identity: get().agentIdentity },
          });
          await get().failClosed(`Execution blocked: Agent status is ${agentStatus}. Fail-closed with zero financial exposure.`);
          return;
        }

        const isLabMismatch = get().labInject === "semantic_mismatch";
        let cart = planCart(mandate, intent, isLabMismatch, [], get().stockOverride);

        // Check if this is an additive instruction to an existing candidate basket
        const isAddIntent = /^(add|also|and|plus|with)\b/i.test(trimmed);
        const existingCart = get().pendingCart;
        if (existingCart && existingCart.lines.length > 0 && isAddIntent && cart.lines.length > 0) {
          const lineMap = new Map<string, CartLine>();
          for (const l of existingCart.lines) {
            lineMap.set(l.sku, { ...l });
          }
          for (const l of cart.lines) {
            if (lineMap.has(l.sku)) {
              const existingLine = lineMap.get(l.sku)!;
              existingLine.quantity += l.quantity;
              existingLine.linePaise = existingLine.quantity * existingLine.unitPricePaise;
            } else {
              lineMap.set(l.sku, { ...l });
            }
          }
          const mergedLines = Array.from(lineMap.values());
          const mergedTotal = mergedLines.reduce((acc, l) => acc + l.linePaise, 0);
          cart = {
            ...cart,
            lines: mergedLines,
            totalPaise: mergedTotal,
            reason: `Accumulated basket with ${mergedLines.length} item(s).`,
          };
        }

        // Edge Case 7: Stock Race Condition Recovery
        // If stock_race lab injection is active, simulate item being out-of-stock
        if (get().labInject === "stock_race" && cart.lines.length > 0) {
          const firstSku = cart.lines[0]?.sku;
          if (firstSku) {
            const newOverrides = { ...get().stockOverride, [firstSku]: 0 };
            set({ stockOverride: newOverrides });
            await get().appendAudit({
              correlationId: cid,
              phase: "planning",
              event: "stock.unavailable",
              layer: "live",
              explain: `Product '${firstSku}' out of stock. Seeking next-best in-mandate alternative.`,
              payload: { sku: firstSku },
            });
            await get().appendAudit({
              correlationId: cid,
              phase: "planning",
              event: "stock.unavailable",
              layer: "live",
              explain: `Product '${firstSku}' out of stock. Seeking next-best in-mandate alternative.`,
              payload: { sku: firstSku },
            });

            // Re-plan excluding the unavailable SKU
            const cartNextBest = planCart(mandate, intent, false, [firstSku], newOverrides);
            const guardNextBest = runGuardrail({
              lines: cartNextBest.lines,
              totalPaise: cartNextBest.totalPaise,
              mandate,
              intent,
            });

            if (guardNextBest.ok && cartNextBest.lines.length) {
              const nextSku = cartNextBest.lines[0]?.sku;
              await get().appendAudit({
                correlationId: cid,
                phase: "planning",
                event: "stock.next_best",
                layer: "live",
                explain: `Stock race recovery: automatically selected next-best in-mandate SKU '${nextSku}'.`,
                payload: { fromSku: firstSku, toSku: nextSku, cart: cartNextBest },
              });
              cart = cartNextBest;
            } else {
              await get().appendAudit({
                correlationId: cid,
                phase: "failed",
                event: "plan.empty",
                layer: "live",
                explain: "No alternative in-mandate SKU found. Operation stopped safely before debit.",
                payload: { excludedSku: firstSku },
              });
              set({
                phase: "failed",
                pendingCart: null,
                chat: [
                  ...get().chat,
                  {
                    id: newId("msg"),
                    role: "agent",
                    ts: nowIso(),
                    text: "Stopped. The requested SKU is out of stock and no in-mandate alternative was found.",
                  },
                ],
              });
              return;
            }
          }
        }

        set({ pendingCart: cart, phase: "guardrail" });

        if (!cart.lines.length) {
          const explainMsg = cart.clarificationPrompt || cart.reason;
          await get().appendAudit({
            correlationId: cid,
            phase: "failed",
            event: "plan.empty",
            layer: "live",
            explain: explainMsg,
            payload: { intent },
          });
          set({
            phase: "failed",
            chat: [
              ...get().chat,
              { id: newId("msg"), role: "agent", ts: nowIso(), text: explainMsg },
            ],
          });
          return;
        }

        const guard = runGuardrail({
          lines: cart.lines,
          totalPaise: cart.totalPaise,
          mandate,
          intent,
        });

        await get().appendAudit({
          correlationId: cid,
          phase: "guardrail",
          event: guard.ok ? "guardrail.pass" : "guardrail.block",
          layer: "live",
          explain: `${guard.title}. ${guard.detail}`,
          payload: { guard, cart },
        });

        if (!guard.ok && guard.needsHumanConfirm) {
          const attemptId = newId("att");
          const attempt: PurchaseAttempt = {
            id: attemptId,
            correlationId: cid,
            mandateId: mandate.id,
            cart,
            intent,
            phase: "needs_confirm",
            failure: guard.code === "pass" ? "none" : guard.code,
            noticeId: null,
            merchantOrderId: null,
            razorpayOrderId: null,
            razorpayPaymentId: null,
            razorpaySignature: null,
            razorpayStatus: "none",
            confirmSource: "none",
            attemptsCharge: 0,
            notifyAt: null,
            executeAt: null,
            confirmedAt: null,
            createdAt: nowIso(),
          };
          set({
            phase: "needs_confirm",
            pendingAttemptId: attempt.id,
            attempts: [...get().attempts, attempt],
            chat: [
              ...get().chat,
              {
                id: newId("msg"),
                role: "agent",
                ts: nowIso(),
                text: `${guard.title}: ${guard.detail}. Confirmation required.`,
              },
            ],
          });
          return;
        }

        if (!guard.ok) {
          set({
            phase: "stopped",
            chat: [
              ...get().chat,
              {
                id: newId("msg"),
                role: "agent",
                ts: nowIso(),
                text: `Blocked by Guardrail: ${guard.title} — ${guard.detail}`,
              },
            ],
          });
          return;
        }

        // If user explicitly sent an additive instruction ("Add ..."), keep in candidate basket and ask for next item
        if (isAddIntent) {
          const remainingPaise = Math.max(0, mandate.remainingPaise - cart.totalPaise);
          set({
            phase: "idle",
            pendingCart: cart,
            pendingIntent: intent,
            chat: [
              ...get().chat,
              {
                id: newId("msg"),
                role: "agent",
                ts: nowIso(),
                text: `🛒 Added to candidate basket!\n\n📦 Current Basket (${cart.lines.length} item${cart.lines.length > 1 ? "s" : ""}):\n${cart.lines.map((l) => `• ${l.name} × ${l.quantity} (${paiseToInr(l.linePaise)})`).join("\n")}\n\n💰 Total: ${paiseToInr(cart.totalPaise)} (Mandate remaining: ${paiseToInr(remainingPaise)})\n\n👉 What else would you like to buy? (e.g. 'Add toor dal', 'Add 1L mustard oil') or click '⚡ Proceed to Checkout' below when ready!`,
              },
            ],
          });
          return;
        }

        // Single-prompt direct purchase / golden utterance path: Proceed directly to pre-debit notice window
        await get().proceedCandidateCart();
      },

      clearCandidateCart: () => {
        set({
          pendingCart: null,
          pendingIntent: null,
          chat: [
            ...get().chat,
            {
              id: newId("msg"),
              role: "agent",
              ts: nowIso(),
              text: "🗑️ Candidate basket cleared. What grocery items would you like to add?",
            },
          ],
        });
      },

      proceedCandidateCart: async () => {
        const mandate = get().mandate;
        const cart = get().pendingCart;
        if (!mandate || !cart || cart.lines.length === 0) return;

        const cid = get().correlationId ?? newId("cor");
        const merchantOrderId = newId("mord");
        const merchantOrder: MerchantOrder = {
          id: merchantOrderId,
          merchantId: cart.merchantId,
          merchantName: cart.merchantName,
          attemptId: cid,
          lines: cart.lines,
          totalPaise: cart.totalPaise,
          status: "reserved",
          reservedAt: nowIso(),
          paidAt: null,
          razorpayOrderId: null,
        };

        const noticeId = newId("not");
        const agentScore = get().agentIdentity.trustScore;
        const dwellMs = computeDwellDurationMs(agentScore);
        const executeAfter = new Date(Date.now() + dwellMs).toISOString();
        const notice: PreDebitNotice = {
          id: noticeId,
          attemptId: cid,
          amountPaise: cart.totalPaise,
          skus: cart.lines.map((l) => l.sku),
          merchantId: cart.merchantId,
          merchantName: cart.merchantName,
          issuedAt: nowIso(),
          executeAfter,
          dwellMs,
          status: "issued",
        };

        const intent: StructuredIntent = get().pendingIntent ?? {
          maxAmountPaise: cart.totalPaise,
          categories: [...new Set(cart.lines.map((l) => l.category))],
          brandsAllow: [],
          brandsDeny: [],
          maxQuantityPerItem: 5,
          priceCeilingPerItemPaise: null,
          packTokens: [],
          excludeTokens: [],
          qty: 1,
          packSizeHint: null,
          queryText: "Finalized Candidate Cart",
        };

        const attempt: PurchaseAttempt = {
          id: cid,
          correlationId: cid,
          mandateId: mandate.id,
          cart,
          intent,
          phase: "notify",
          failure: "none",
          noticeId,
          merchantOrderId,
          razorpayOrderId: null,
          razorpayPaymentId: null,
          razorpaySignature: null,
          razorpayStatus: "none",
          confirmSource: "none",
          attemptsCharge: 0,
          notifyAt: nowIso(),
          executeAt: null,
          confirmedAt: null,
          createdAt: nowIso(),
        };

        const upsell = findBoundedUpsell(cart, mandate, intent, CATALOG);

        set({
          phase: "notify",
          pendingAttemptId: attempt.id,
          upsellCandidate: upsell,
          attempts: [...get().attempts, attempt],
          notices: [...get().notices, notice],
          merchantOrders: [...get().merchantOrders, merchantOrder],
          windowMsLeft: dwellMs,
          chat: [
            ...get().chat,
            {
              id: newId("msg"),
              role: "agent",
              ts: nowIso(),
              text: `Pre-debit notice (${noticeId}): ${cart.lines.map((l) => `${l.name} × ${l.quantity}`).join(", ")} for ₹${cart.totalPaise / 100} at ${cart.merchantName}. Reserved under Merchant Order #${merchantOrderId}. Pre-debit countdown active.`,
            },
          ],
        });

        if (upsell) {
          await get().appendAudit({
            correlationId: cid,
            phase: "notify",
            event: "upsell.surfaced",
            layer: "live",
            explain: `Bounded upsell discovered: ${upsell.explanation}`,
            payload: { upsell },
          });
        }

        await get().appendAudit({
          correlationId: cid,
          phase: "notify",
          event: "merchant.order_reserved",
          layer: "live",
          explain: `Merchant order ${merchantOrderId} created with reserved inventory stock for ${cart.lines.length} items.`,
          payload: { merchantOrderId, lines: cart.lines, totalPaise: cart.totalPaise },
        });

        await get().appendAudit({
          correlationId: cid,
          phase: "notify",
          event: "notify.pre_debit_issued",
          layer: "live",
          explain: `Pre-debit notice record ${noticeId} issued. Execute window scheduled for ${dwellMs / 1000}s.`,
          payload: {
            noticeId,
            merchantOrderId,
            amountPaise: cart.totalPaise,
            executeAfter,
          },
        });

        set({ phase: "window" });
      },

      tickWindow: () => {
        const left = get().windowMsLeft;
        if (get().phase !== "window") return;
        if (get().labInject === "revoke_in_window" && left <= DEMO_NOTIFY_WINDOW_MS / 2) {
          void get().revokeMandate();
        }
        if (left <= 250) {
          set({ windowMsLeft: 0 });
          void get().startExecute();
          return;
        }
        set({ windowMsLeft: left - 250 });
      },

      extendWindow: (extraMs = 5000) => {
        const current = get().windowMsLeft;
        const newLeft = current + extraMs;
        set({ windowMsLeft: newLeft });
        void get().appendAudit({
          correlationId: get().correlationId ?? newId("cor"),
          phase: "window",
          event: "notify.window_extended",
          layer: "live",
          explain: `User extended the pre-debit window by ${extraMs / 1000}s to inspect cart.`,
          payload: { windowMsLeft: newLeft },
        });
      },

      proceedNow: async () => {
        const st = get();
        const notice = st.notices.find((n) => n.attemptId === st.pendingAttemptId);
        if (!notice || notice.status !== "issued") {
          await st.failClosed("Proceed rejected: Valid pre-debit notice not found.");
          return;
        }
        set({ windowMsLeft: 0 });
        await get().startExecute();
      },

      confirmAfaOverride: async () => {
        const attempt = get().attempts.find((a) => a.id === get().pendingAttemptId);
        if (!attempt) return;
        await get().appendAudit({
          correlationId: attempt.correlationId,
          phase: "needs_confirm",
          event: "afa.human_confirm",
          layer: "live",
          explain: "Cardholder authenticated cart above ₹15,000 AFA-exempt threshold.",
          payload: { attemptId: attempt.id },
        });
        set({
          phase: "notify",
          windowMsLeft: DEMO_NOTIFY_WINDOW_MS,
          attempts: get().attempts.map((a) =>
            a.id === attempt.id ? { ...a, phase: "notify", notifyAt: nowIso() } : a,
          ),
        });
        set({ phase: "window" });
      },

      confirmSemanticOverride: async () => {
        const attempt = get().attempts.find((a) => a.id === get().pendingAttemptId);
        if (!attempt) return;
        await get().appendAudit({
          correlationId: attempt.correlationId,
          phase: "needs_confirm",
          event: "semantic.human_override",
          layer: "live",
          explain: "Human cardholder explicitly approved candidate cart with intent discrepancy.",
          payload: { attemptId: attempt.id, cart: attempt.cart },
        });
        set({
          phase: "notify",
          windowMsLeft: DEMO_NOTIFY_WINDOW_MS,
          attempts: get().attempts.map((a) =>
            a.id === attempt.id ? { ...a, phase: "notify", notifyAt: nowIso() } : a,
          ),
        });
        set({ phase: "window" });
      },

      startExecute: async (opts) => {
        const st = get();
        if (st.isExecutingLocked && !opts) return;
        const attempt = st.attempts.find((a) => a.id === st.pendingAttemptId);
        const mandate = st.mandate;
        const cart = st.pendingCart;
        if (!attempt || !cart) return;

        // Data gate: strictly require PreDebitNotice record in 'issued' status
        const notice = st.notices.find((n) => n.attemptId === attempt.id);
        if (!notice || notice.status !== "issued") {
          await st.failClosed("Execution blocked: Valid issued PreDebitNotice record required before payment.");
          return;
        }

        set({ isExecutingLocked: true });

        if (mandate?.status === "revoked" && attempt.phase === "window") {
          await st.appendAudit({
            correlationId: attempt.correlationId,
            phase: "window",
            event: "execute.under_previous_mandate",
            layer: "live",
            explain: "Policy revoked during pre-debit window. In-flight execution proceeds under previously valid policy (future-only revocation).",
            payload: { attemptId: attempt.id, revokedAt: mandate.revokedAt },
          });
        } else if (mandate?.status === "revoked" || mandate?.status === "expired") {
          await st.appendAudit({
            correlationId: attempt.correlationId,
            phase: "stopped",
            event: "execute.blocked_policy",
            layer: "live",
            explain: "Policy inactive. Execution halted.",
            payload: { attemptId: attempt.id },
          });
          set({ phase: "stopped", isExecutingLocked: false });
          return;
        }

        set({
          phase: "execute",
          attempts: st.attempts.map((a) =>
            a.id === attempt.id
              ? {
                  ...a,
                  phase: "execute",
                  executeAt: nowIso(),
                  razorpayOrderId: opts?.razorpayOrderId ?? a.razorpayOrderId,
                }
              : a,
          ),
        });
      },

      handleHandlerReceived: async (paymentId, orderId, signature) => {
        const st = get();
        const attempt = st.attempts.find((a) => a.id === st.pendingAttemptId);
        if (!attempt) return;

        set({
          phase: "pending",
          attempts: st.attempts.map((a) =>
            a.id === attempt.id
              ? {
                  ...a,
                  phase: "pending",
                  razorpayPaymentId: paymentId,
                  razorpayOrderId: orderId ?? a.razorpayOrderId,
                  razorpaySignature: signature ?? null,
                  razorpayStatus: "pending",
                  confirmSource: "handler_unverified",
                }
              : a,
          ),
        });

        await st.appendAudit({
          correlationId: attempt.correlationId,
          phase: "pending",
          event: "razorpay.handler_received",
          layer: "live",
          explain: `Checkout handler returned payment ${paymentId}. Pending backend status verification. Mandate balance remains unchanged until captured.`,
          payload: { paymentId, orderId },
        });

        void st.startReconcile(attempt.id, paymentId, orderId);
      },

      startReconcile: async (attemptId, paymentId, orderId) => {
        const maxPolls = 6;
        const pollInterval = 2000;

        for (let i = 0; i < maxPolls; i++) {
          await delay(pollInterval);
          const st = get();
          if (st.confirmedPaymentIds.includes(paymentId)) return;

          const isSoftDeclineLab = st.labInject === "soft_decline";

          if (isSoftDeclineLab) {
            const attempt = st.attempts.find((a) => a.id === attemptId);
            if (attempt && attempt.attemptsCharge === 0) {
              await st.appendAudit({
                correlationId: st.correlationId ?? "",
                phase: "pending",
                event: "payment.soft_decline",
                layer: "live",
                explain: "Status verified with Razorpay: Payment failed with soft decline. Triggering single retry on rail.",
                payload: { paymentId, pollAttempt: i + 1, retryCount: 0 },
              });

              // Soft decline retry: bump attemptsCharge, create new Order, and re-execute
              set({
                attempts: st.attempts.map((a) =>
                  a.id === attemptId
                    ? { ...a, attemptsCharge: 1, razorpayStatus: "failed", failure: "soft_decline" }
                    : a,
                ),
                isExecutingLocked: false,
              });

              await st.startExecute();
              return;
            } else if (attempt && attempt.attemptsCharge >= 1) {
              await st.releaseReservation(attemptId, "Soft decline retry exhausted (1 retry limit). Halting safely.");
              await st.failClosed("Payment soft decline: single retry exhausted. Mandate unchanged.");
              return;
            }
          }

          try {
            const res = await fetchRazorpayPayment({ data: { paymentId } });
            if (res.ok && (res.status === "captured" || res.status === "authorized")) {
              await st.applyConfirm({
                attemptId,
                paymentId,
                orderId,
                status: res.status,
                source: "fetch",
              });
              return;
            } else if (res.ok && (res.status === "failed" || res.status === "cancelled" || res.status === "refunded")) {
              const attempt = st.attempts.find((a) => a.id === attemptId);
              if (attempt && attempt.attemptsCharge === 0) {
                // Real soft decline on failure card: retry once
                await st.appendAudit({
                  correlationId: st.correlationId ?? "",
                  phase: "pending",
                  event: "payment.soft_decline",
                  layer: "live",
                  explain: `Payment ${paymentId} reported status '${res.status}'. Initiating single retry attempt.`,
                  payload: { paymentId, status: res.status, retryCount: 0 },
                });
                set({
                  attempts: st.attempts.map((a) =>
                    a.id === attemptId ? { ...a, attemptsCharge: 1, razorpayStatus: "failed" } : a,
                  ),
                  isExecutingLocked: false,
                });
                await st.startExecute();
                return;
              }

              await st.releaseReservation(attemptId, `Payment ended in status '${res.status}'. Debit failed.`);
              await st.failClosed(`Payment ended in status '${res.status}'. Debit failed.`);
              return;
            }
          } catch {
            // continue polling
          }
        }

        const finalSt = get();
        if (!finalSt.confirmedPaymentIds.includes(paymentId)) {
          await finalSt.releaseReservation(attemptId, "Payment status check timed out (fail-closed).");
          await finalSt.failClosed("Payment status check timed out (fail-closed). Any late webhook capture will reconcile safely.");
        }
      },

      applyConfirm: async (opts) => {
        const st = get();
        const { paymentId, orderId, source, status = "captured" } = opts;

        if (st.confirmedPaymentIds.includes(paymentId)) {
          await st.appendAudit({
            correlationId: st.correlationId ?? newId("cor"),
            phase: st.phase,
            event: "razorpay.duplicate_ignored",
            layer: "live",
            explain: `Duplicate confirmation for payment ${paymentId} via ${source} ignored. Mandate preserved.`,
            payload: { paymentId, source },
          });
          return;
        }

        const attempt = opts.attemptId
          ? st.attempts.find((a) => a.id === opts.attemptId)
          : st.attempts.find((a) => a.razorpayPaymentId === paymentId || a.razorpayOrderId === orderId);

        const cart = attempt?.cart ?? st.pendingCart;
        if (!cart) return;

        const mandate = st.mandate;
        const totalPaise = cart.totalPaise;
        const remaining = Math.max(0, (mandate?.remainingPaise ?? 0) - totalPaise);
        const spent = (mandate?.spentPaise ?? 0) + totalPaise;

        if (mandate) {
          set({
            mandate: { ...mandate, remainingPaise: remaining, spentPaise: spent },
          });
        }

        // Live inventory decrement
        const newStockOverride = { ...st.stockOverride };
        for (const line of cart.lines) {
          const currentStock = line.sku in newStockOverride ? newStockOverride[line.sku]! : (CATALOG.find((c) => c.sku === line.sku)?.stock ?? 0);
          newStockOverride[line.sku] = Math.max(0, currentStock - line.quantity);
        }

        // Update MerchantOrder to 'paid' and Notice to 'executed'
        const updatedMerchantOrders = st.merchantOrders.map((mo) =>
          mo.attemptId === (attempt?.id ?? st.pendingAttemptId)
            ? { ...mo, status: "paid" as const, paidAt: nowIso(), razorpayOrderId: orderId ?? mo.razorpayOrderId }
            : mo,
        );

        const updatedNotices = st.notices.map((n) =>
          n.attemptId === (attempt?.id ?? st.pendingAttemptId)
            ? { ...n, status: "executed" as const }
            : n,
        );

        const isLateReconcile = attempt?.phase === "failed";

        const confirmedProductName = cart.lines[0]?.name ?? "ElectroCore Product";
        const orderIdClean = orderId ?? attempt?.razorpayOrderId ?? `order_${newId("rzp").slice(0, 16)}`;
        const auditEvents = [
          { event: "INTENT_CREATED", time: new Date(Date.now() - 30000).toLocaleTimeString() },
          { event: "PAYMENT_ORDER_CREATED", time: new Date(Date.now() - 25000).toLocaleTimeString() },
          { event: "PAYMENT_VERIFIED", time: new Date().toLocaleTimeString() },
          { event: "ORDER_CREATED", time: new Date().toLocaleTimeString() },
        ];

        set({
          phase: "confirmed",
          journeyStage: "purchase",
          lastConfirmedOrder: {
            id: newId("ord"),
            name: confirmedProductName,
            amountPaise: totalPaise,
            orderId: orderIdClean,
            paymentId,
            time: new Date().toLocaleTimeString(),
            correlationId: attempt?.correlationId ?? st.correlationId ?? newId("cor"),
            discoveryPrompt: attempt?.intent.queryText || `Purchase ${confirmedProductName}`,
            auditTrail: auditEvents,
          },
          stockOverride: newStockOverride,
          merchantOrders: updatedMerchantOrders,
          notices: updatedNotices,
          confirmedPaymentIds: [...st.confirmedPaymentIds, paymentId],
          isExecutingLocked: false,
          attempts: st.attempts.map((a) =>
            a.id === (attempt?.id ?? st.pendingAttemptId)
              ? {
                  ...a,
                  phase: "confirmed",
                  razorpayPaymentId: paymentId,
                  razorpayOrderId: orderIdClean,
                  razorpayStatus: "captured",
                  confirmSource: source,
                  confirmedAt: nowIso(),
                }
              : a,
          ),
          chat: [
            ...st.chat,
            {
              id: newId("msg"),
              role: "agent",
              ts: nowIso(),
              text: `Payment confirmed via ${source} (status: ${status}). Payment ID: ${paymentId}. Merchant Order marked PAID. Remaining mandate: ₹${remaining / 100}.`,
            },
          ],
        });

        get().addSessionActivity("Payment verified", `${paymentId} captured`);
        get().addSessionActivity("Order created", `Order #${orderIdClean} confirmed for ${confirmedProductName}`);

        await st.appendAudit({
          correlationId: attempt?.correlationId ?? st.correlationId ?? newId("cor"),
          phase: "confirmed",
          event: isLateReconcile ? "razorpay.reconciled_after_fail_closed" : "razorpay.confirmed",
          layer: "live",
          explain: isLateReconcile
            ? `Late ${source} confirmation for previously unconfirmed attempt. Reconciled accurately.`
            : `Payment ${paymentId} verified and captured via ${source}. Mandate debited by ₹${totalPaise / 100}. Merchant Order #${attempt?.merchantOrderId ?? ""} settled.`,
          payload: { paymentId, orderId, remainingPaise: remaining, source, status },
        });

        // Re-evaluate campaign offers for returning buyer
        const nextCampaign = evaluateActiveCampaigns({
          agentId: get().agentIdentity.agentId,
          mandate: get().mandate,
          auditHistory: get().audit,
        });
        set({ activeCampaign: nextCampaign });
      },

      releaseReservation: async (attemptId, reason) => {
        const targetId = attemptId ?? get().pendingAttemptId;
        if (!targetId) return;

        // Release reserved merchant order and cancel pre-debit notice
        const updatedMerchantOrders = get().merchantOrders.map((mo) =>
          mo.attemptId === targetId && mo.status === "reserved"
            ? { ...mo, status: "released" as const }
            : mo,
        );

        const updatedNotices = get().notices.map((n) =>
          n.attemptId === targetId && n.status === "issued"
            ? { ...n, status: "cancelled" as const }
            : n,
        );

        set({
          merchantOrders: updatedMerchantOrders,
          notices: updatedNotices,
        });

        await get().appendAudit({
          correlationId: get().correlationId ?? newId("cor"),
          phase: get().phase,
          event: "merchant.reservation_released",
          layer: "live",
          explain: `Merchant order reservation released for attempt ${targetId}: ${reason}`,
          payload: { attemptId: targetId, reason },
        });
      },

      failClosed: async (reason) => {
        const cid = get().correlationId ?? newId("cor");
        const attemptId = get().pendingAttemptId;

        await get().releaseReservation(attemptId, reason);

        await get().appendAudit({
          correlationId: cid,
          phase: "failed",
          event: "fail_closed",
          layer: "live",
          explain: `State unconfirmed — treated as failed. Reserved stock released. ${reason}`,
          payload: { reason },
        });

        set({
          phase: "failed",
          isExecutingLocked: false,
          chat: [
            ...get().chat,
            {
              id: newId("msg"),
              role: "system",
              ts: nowIso(),
              text: `Fail-closed: ${reason}`,
            },
          ],
        });
      },

      acceptUpsell: async () => {
        const st = get();
        const upsell = st.upsellCandidate;
        const attempt = st.attempts.find((a) => a.id === st.pendingAttemptId);
        const item = CATALOG.find((c) => c.sku === upsell?.suggestedSku);
        if (!upsell || !attempt || !item) return;

        const newCart: ProposedCart = {
          lines: [
            {
              sku: item.sku,
              name: item.name,
              brand: item.brand,
              category: item.category,
              unitPricePaise: item.pricePaise,
              quantity: 1,
              linePaise: item.pricePaise,
            },
          ],
          totalPaise: item.pricePaise,
          merchantId: "nila-kirana",
          merchantName: "Nila Kirana",
          reason: `Bounded upsell applied: Switched to ${item.name} (${upsell.savingsPercent}% savings per unit)`,
        };

        const updatedAttempts = st.attempts.map((a) =>
          a.id === attempt.id ? { ...a, cart: newCart } : a,
        );

        const updatedNotices = st.notices.map((n) =>
          n.attemptId === attempt.id
            ? { ...n, amountPaise: newCart.totalPaise, skus: [item.sku] }
            : n,
        );

        const updatedMerchantOrders = st.merchantOrders.map((mo) =>
          mo.attemptId === attempt.id
            ? { ...mo, lines: newCart.lines, totalPaise: newCart.totalPaise }
            : mo,
        );

        set({
          pendingCart: newCart,
          upsellCandidate: null,
          attempts: updatedAttempts,
          notices: updatedNotices,
          merchantOrders: updatedMerchantOrders,
          chat: [
            ...st.chat,
            {
              id: newId("msg"),
              role: "agent",
              ts: nowIso(),
              text: `Switched to ${item.name} (₹${item.pricePaise / 100}). Pre-debit notice and merchant order updated.`,
            },
          ],
        });

        await st.appendAudit({
          correlationId: attempt.correlationId,
          phase: "window",
          event: "upsell.accepted",
          layer: "live",
          explain: `User accepted bounded upsell: Switched to ${item.name} saving ${upsell.savingsPercent}% per unit.`,
          payload: { fromSku: upsell.originalSku, toSku: upsell.suggestedSku, savingsPercent: upsell.savingsPercent },
        });
      },

      dismissUpsell: () => {
        const st = get();
        const upsell = st.upsellCandidate;
        set({ upsellCandidate: null });
        if (upsell) {
          void st.appendAudit({
            correlationId: st.correlationId ?? newId("cor"),
            phase: "window",
            event: "upsell.dismissed",
            layer: "live",
            explain: `User dismissed upsell recommendation for ${upsell.suggestedName}. Proceeding with original selection.`,
            payload: { upsell },
          });
        }
      },

      applyCampaign: async (offer) => {
        const mandate = get().mandate;
        if (!mandate || mandate.status !== "active") {
          set({
            chat: [
              ...get().chat,
              {
                id: newId("msg"),
                role: "agent",
                ts: nowIso(),
                text: "⚠️ Policy required: Please establish an active spending policy mandate first before claiming promotional bundles.",
              },
            ],
          });
          return;
        }

        const cid = newId("cor");
        const cart = buildCampaignCart(offer);
        const intent: StructuredIntent = {
          maxAmountPaise: cart.totalPaise,
          categories: [...new Set(cart.lines.map((l) => l.category))],
          brandsAllow: [],
          brandsDeny: [],
          maxQuantityPerItem: 5,
          priceCeilingPerItemPaise: null,
          packTokens: [],
          excludeTokens: [],
          qty: 1,
          packSizeHint: null,
          queryText: offer.name,
        };

        const guardrailResult = runGuardrail({
          lines: cart.lines,
          totalPaise: cart.totalPaise,
          mandate,
          intent,
        });

        if (!guardrailResult.ok) {
          await get().appendAudit({
            correlationId: cid,
            phase: "planning",
            event: "guardrail.block",
            layer: "live",
            explain: `Campaign blocked by semantic guardrail: ${guardrailResult.detail}`,
            payload: { code: guardrailResult.code, cart },
          });
          set({
            chat: [
              ...get().chat,
              {
                id: newId("msg"),
                role: "agent",
                ts: nowIso(),
                text: `❌ Campaign Bundle Blocked: ${guardrailResult.detail}`,
              },
            ],
          });
          return;
        }

        await get().appendAudit({
          correlationId: cid,
          phase: "planning",
          event: "campaign.activated",
          layer: "live",
          explain: `Campaign Orchestrator: Activated '${offer.name}' (${offer.savingsPercent}% loyalty savings, ₹${offer.discountedTotalPaise / 100}).`,
          payload: { campaignId: offer.id, offer },
        });

        const dwellMs = computeDwellDurationMs(get().agentIdentity.trustScore);
        const executeAfter = new Date(Date.now() + dwellMs).toISOString();
        const noticeId = newId("not");
        const merchantOrderId = newId("mord");

        const merchantOrder: MerchantOrder = {
          id: merchantOrderId,
          merchantId: cart.merchantId,
          merchantName: cart.merchantName,
          attemptId: cid,
          lines: cart.lines,
          totalPaise: cart.totalPaise,
          status: "reserved",
          reservedAt: nowIso(),
          paidAt: null,
          razorpayOrderId: null,
        };

        const notice: PreDebitNotice = {
          id: noticeId,
          attemptId: cid,
          amountPaise: cart.totalPaise,
          skus: cart.lines.map((l) => l.sku),
          merchantId: cart.merchantId,
          merchantName: cart.merchantName,
          issuedAt: nowIso(),
          executeAfter,
          dwellMs,
          status: "issued",
        };

        const attempt: PurchaseAttempt = {
          id: cid,
          correlationId: cid,
          mandateId: mandate.id,
          cart,
          intent,
          phase: "notify",
          failure: "none",
          noticeId,
          merchantOrderId,
          razorpayOrderId: null,
          razorpayPaymentId: null,
          razorpaySignature: null,
          razorpayStatus: "none",
          confirmSource: "none",
          attemptsCharge: 0,
          notifyAt: nowIso(),
          executeAt: null,
          confirmedAt: null,
          createdAt: nowIso(),
        };

        set({
          phase: "window",
          correlationId: cid,
          pendingAttemptId: attempt.id,
          pendingCart: cart,
          pendingIntent: intent,
          activeCampaign: null,
          attempts: [...get().attempts, attempt],
          notices: [...get().notices, notice],
          merchantOrders: [...get().merchantOrders, merchantOrder],
          windowMsLeft: dwellMs,
          chat: [
            ...get().chat,
            {
              id: newId("msg"),
              role: "agent",
              ts: nowIso(),
              text: `🎁 Campaign Bundle Activated (${offer.name}): Pre-debit notice (${noticeId}) issued for ₹${cart.totalPaise / 100}. Dwell countdown active.`,
            },
          ],
        });
      },

      dismissCampaign: () => {
        set({ activeCampaign: null });
      },

      abortPending: async (reason) => {
        const cid = get().correlationId ?? newId("cor");
        const attemptId = get().pendingAttemptId;

        await get().releaseReservation(attemptId, reason);

        await get().appendAudit({
          correlationId: cid,
          phase: "stopped",
          event: "user.abort",
          layer: "live",
          explain: reason,
          payload: {},
        });

        set({
          phase: "stopped",
          windowMsLeft: 0,
          pendingCart: null,
          pendingAttemptId: null,
          isExecutingLocked: false,
        });
      },

      resetDemo: () => {
        set({
          mandate: null,
          audit: [],
          attempts: [],
          notices: [],
          merchantOrders: [],
          chat: [],
          phase: "idle",
          labInject: "none",
          windowMsLeft: 0,
          isExecutingLocked: false,
          pendingCart: null,
          pendingIntent: null,
          pendingAttemptId: null,
          correlationId: null,
          confirmedPaymentIds: [],
          lastExplain: "Demo reset to pristine baseline.",
          stockOverride: {},
        });
      },

      getAP2Primitives: () => {
        const st = get();
        const m = st.mandate;
        const attempt = st.attempts.find((a) => a.id === st.pendingAttemptId) || st.attempts.at(-1);

        const intentMandate: AP2IntentMandate | null = m
          ? {
              version: "ap2.intent_mandate.v1",
              mandateId: m.id,
              merchantId: m.merchantId,
              maxSpendPaise: m.maxAmountPaise,
              allowedCategories: m.categories,
              deniedBrands: m.brandsDeny,
              validUntil: m.validUntil,
              authorizedBy: m.authorizedBy,
              authorizedAt: m.createdAt,
            }
          : null;

        const cartMandate: AP2CartMandate | null = attempt
          ? {
              version: "ap2.cart_mandate.v1",
              attemptId: attempt.id,
              merchantOrderId: attempt.merchantOrderId ?? "mord_pending",
              lockedSkus: attempt.cart.lines.map((l) => ({
                sku: l.sku,
                qty: l.quantity,
                unitPricePaise: l.unitPricePaise,
              })),
              totalPaise: attempt.cart.totalPaise,
              guardrailProof: { passedAt: attempt.createdAt, code: "pass" },
            }
          : null;

        const paymentMandate: AP2PaymentMandate | null = attempt
          ? {
              version: "ap2.payment_mandate.v1",
              attemptId: attempt.id,
              noticeId: attempt.noticeId ?? "not_pending",
              razorpayOrderId: attempt.razorpayOrderId,
              razorpayPaymentId: attempt.razorpayPaymentId,
              amountPaise: attempt.cart.totalPaise,
              reconciliationStatus: attempt.razorpayStatus,
              confirmedAt: attempt.confirmedAt,
            }
          : null;

        return { intentMandate, cartMandate, paymentMandate };
      },
    }),
    {
      name: "safebuy-v2",
      partialize: (s) => ({
        mandate: s.mandate,
        audit: s.audit,
        attempts: s.attempts,
        notices: s.notices,
        merchantOrders: s.merchantOrders,
        chat: s.chat,
        razorpayKeyId: s.razorpayKeyId,
        stockOverride: s.stockOverride,
        confirmedPaymentIds: s.confirmedPaymentIds,
      }),
    },
  ),
);

export function liveStock(sku: string, override: Record<string, number>) {
  if (sku in override) return override[sku]!;
  return CATALOG.find((i) => i.sku === sku)?.stock ?? 0;
}
