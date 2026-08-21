import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CATALOG } from "./catalog";
import { runGuardrail } from "./guardrail";
import { GENESIS_HASH, hashRecord } from "./hash";
import { coerceIntent, parseIntentDeterministic } from "./parse-intent";
import { planCart } from "./plan";
import { fetchRazorpayPayment, parseIntentWithGrok } from "./razorpay-api";
import {
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
} from "./types";
import { newId } from "../utils";

type ChatMsg = { id: string; role: "user" | "agent" | "system"; text: string; ts: string };

interface SafeBuyState {
  mandate: Mandate | null;
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
  correlationId: string | null;
  razorpayKeyId: string;
  hasSecret: boolean;
  isConfigured: boolean;
  confirmedPaymentIds: string[];
  lastExplain: string;
  stockOverride: Record<string, number>;
  hydrateOk: boolean;
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

export const useSafeBuy = create<SafeBuyState>()(
  persist(
    (set, get) => ({
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
      razorpayKeyId: "",
      hasSecret: false,
      isConfigured: false,
      confirmedPaymentIds: [],
      lastExplain: "Idle. Create a policy mandate, then instruct the agent.",
      stockOverride: {},
      hydrateOk: false,

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
        const body = {
          seq,
          id,
          ts,
          correlationId: partial.correlationId,
          phase: partial.phase,
          event: partial.event,
          explain: partial.explain,
          layer: partial.layer,
          payload: partial.payload,
        };
        const hash = await hashRecord(prevHash, body);
        const record: AuditRecord = { ...body, prevHash, hash };
        set({ audit: [...get().audit, record], lastExplain: partial.explain });
        return record;
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
        set({ mandate, correlationId: cid, phase: "idle" });
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

        await get().appendAudit({
          correlationId: cid,
          phase: "planning",
          event: "intent.parsed",
          layer: "live",
          explain: `Structured intent parsed (${intentSource}): packTokens=[${intent.packTokens.join(", ")}], budget=₹${(intent.maxAmountPaise ?? mandate.remainingPaise) / 100}. Guardrail will diff candidate cart against this schema.`,
          payload: { intent, source: intentSource },
        });

        const injectMismatch = get().labInject === "semantic_mismatch";
        let cart = planCart(mandate, intent, injectMismatch, [], get().stockOverride);

        // Lab inject: AFA ₹15,000 threshold test
        if (get().labInject === "afa_threshold") {
          cart = {
            ...cart,
            totalPaise: AFA_EXEMPT_PAISE + 10000,
            reason: "Lab inject: cart value exceeds ₹15,000 RBI AFA exemption threshold.",
          };
        }

        // Check if planner requires clarification (ask-back)
        if (cart.needsClarification && cart.clarificationPrompt) {
          await get().appendAudit({
            correlationId: cid,
            phase: "ask_back",
            event: "agent.clarification_requested",
            layer: "live",
            explain: `Agent asking clarification: ${cart.clarificationPrompt}`,
            payload: { prompt: cart.clarificationPrompt, intent },
          });
          set({
            phase: "idle",
            chat: [
              ...get().chat,
              {
                id: newId("msg"),
                role: "agent",
                ts: nowIso(),
                text: cart.clarificationPrompt,
              },
            ],
          });
          return;
        }

        // P1-2: Stock Race recovery
        if (get().labInject === "stock_race") {
          const firstSku = cart.lines[0]?.sku;
          if (firstSku) {
            const newOverrides = { ...get().stockOverride, [firstSku]: 0 };
            set({ stockOverride: newOverrides });
            await get().appendAudit({
              correlationId: cid,
              phase: "planning",
              event: "stock.race_injected",
              layer: "synthetic",
              explain: `Lab simulation: Stock of SKU '${firstSku}' dropped to 0 after discovery.`,
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
          await get().appendAudit({
            correlationId: cid,
            phase: "failed",
            event: "plan.empty",
            layer: "live",
            explain: cart.reason,
            payload: { intent },
          });
          set({
            phase: "failed",
            chat: [
              ...get().chat,
              { id: newId("msg"), role: "agent", ts: nowIso(), text: cart.reason },
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

        // Handle semantic mismatch or AFA > 15k
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

        // Create Merchant Order with 'reserved' status
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

        // Create PreDebitNotice record
        const noticeId = newId("not");
        const executeAfter = new Date(Date.now() + DEMO_NOTIFY_WINDOW_MS).toISOString();
        const notice: PreDebitNotice = {
          id: noticeId,
          attemptId: cid,
          amountPaise: cart.totalPaise,
          skus: cart.lines.map((l) => l.sku),
          merchantId: cart.merchantId,
          merchantName: cart.merchantName,
          issuedAt: nowIso(),
          executeAfter,
          dwellMs: DEMO_NOTIFY_WINDOW_MS,
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
          phase: "notify",
          pendingAttemptId: attempt.id,
          attempts: [...get().attempts, attempt],
          notices: [...get().notices, notice],
          merchantOrders: [...get().merchantOrders, merchantOrder],
          windowMsLeft: DEMO_NOTIFY_WINDOW_MS,
          chat: [
            ...get().chat,
            {
              id: newId("msg"),
              role: "agent",
              ts: nowIso(),
              text: `Pre-debit notice (${noticeId}): ${cart.lines.map((l) => l.name).join(", ")} for ₹${cart.totalPaise / 100} at ${cart.merchantName}. Reserved under Merchant Order #${merchantOrderId}. Pre-debit countdown active.`,
            },
          ],
        });

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
          explain: `Pre-debit notice record ${noticeId} issued. Execute window scheduled for ${DEMO_NOTIFY_WINDOW_MS / 1000}s.`,
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
            await st.appendAudit({
              correlationId: st.correlationId ?? "",
              phase: "pending",
              event: "payment.soft_decline",
              layer: "live",
              explain: "Status verified with Razorpay: Payment status is 'failed'. Enforcing single retry policy.",
              payload: { paymentId, pollAttempt: i + 1, retryCount: 0 },
            });

            const attempt = st.attempts.find((a) => a.id === attemptId);
            if (attempt && attempt.attemptsCharge === 0) {
              set({
                attempts: st.attempts.map((a) =>
                  a.id === attemptId
                    ? { ...a, attemptsCharge: 1, razorpayStatus: "failed", failure: "soft_decline" }
                    : a,
                ),
              });
              await st.failClosed("Payment returned soft decline. Verified failed status. Single retry exhausted.");
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
              await st.failClosed(`Payment ended in status '${res.status}'. Debit failed.`);
              return;
            }
          } catch {
            // continue polling
          }
        }

        const finalSt = get();
        if (!finalSt.confirmedPaymentIds.includes(paymentId)) {
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

        // Update MerchantOrder to 'paid'
        const updatedMerchantOrders = st.merchantOrders.map((mo) =>
          mo.attemptId === (attempt?.id ?? st.pendingAttemptId)
            ? { ...mo, status: "paid" as const, paidAt: nowIso(), razorpayOrderId: orderId ?? mo.razorpayOrderId }
            : mo,
        );

        const isLateReconcile = attempt?.phase === "failed";

        set({
          phase: "confirmed",
          stockOverride: newStockOverride,
          merchantOrders: updatedMerchantOrders,
          confirmedPaymentIds: [...st.confirmedPaymentIds, paymentId],
          isExecutingLocked: false,
          attempts: st.attempts.map((a) =>
            a.id === (attempt?.id ?? st.pendingAttemptId)
              ? {
                  ...a,
                  phase: "confirmed",
                  razorpayPaymentId: paymentId,
                  razorpayOrderId: orderId ?? a.razorpayOrderId,
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
      },

      failClosed: async (reason) => {
        const cid = get().correlationId ?? newId("cor");
        const attemptId = get().pendingAttemptId;

        // Release reserved merchant orders
        const updatedMerchantOrders = get().merchantOrders.map((mo) =>
          mo.attemptId === attemptId ? { ...mo, status: "released" as const } : mo,
        );

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
          merchantOrders: updatedMerchantOrders,
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

      abortPending: async (reason) => {
        const cid = get().correlationId ?? newId("cor");
        const attemptId = get().pendingAttemptId;

        // Release reserved merchant orders
        const updatedMerchantOrders = get().merchantOrders.map((mo) =>
          mo.attemptId === attemptId ? { ...mo, status: "released" as const } : mo,
        );

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
          merchantOrders: updatedMerchantOrders,
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
