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
  type AgentPhase,
  type AuditRecord,
  type FailureKind,
  type LabInject,
  type Mandate,
  type ProposedCart,
  type PurchaseAttempt,
  type StructuredIntent,
} from "./types";
import { newId } from "../utils";

type ChatMsg = { id: string; role: "user" | "agent" | "system"; text: string; ts: string };

interface SafeBuyState {
  mandate: Mandate | null;
  audit: AuditRecord[];
  attempts: PurchaseAttempt[];
  chat: ChatMsg[];
  phase: AgentPhase;
  labInject: LabInject;
  windowMsLeft: number;
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
  createMandate: (m: Omit<Mandate, "id" | "status" | "spentPaise" | "remainingPaise" | "createdAt" | "revokedAt" | "afaSimulatedAt" | "afaMethod"> & { remainingPaise?: number }) => Promise<void>;
  revokeMandate: () => Promise<void>;
  appendAudit: (partial: Omit<AuditRecord, "seq" | "id" | "hash" | "prevHash" | "ts">) => Promise<AuditRecord>;
  runInstruction: (text: string, parsed?: StructuredIntent) => Promise<void>;
  tickWindow: () => void;
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
      chat: [],
      phase: "idle",
      labInject: "none",
      windowMsLeft: 0,
      pendingCart: null,
      pendingIntent: null,
      pendingAttemptId: null,
      correlationId: null,
      razorpayKeyId: "",
      hasSecret: false,
      isConfigured: false,
      confirmedPaymentIds: [],
      lastExplain: "Idle. Create a mandate, then instruct the agent.",
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
          revokedAt: null,
          afaSimulatedAt: nowIso(),
          afaMethod: "simulated_upi_pin",
        };
        const cid = newId("cor");
        set({ mandate, correlationId: cid, phase: "idle" });
        await get().appendAudit({
          correlationId: cid,
          phase: "idle",
          event: "mandate.created",
          layer: "live",
          explain: `Human-authenticated mandate ${mandate.id} created. Cap ₹${mandate.maxAmountPaise / 100}. AFA at registration is simulated (sandbox cannot run bank AFA).`,
          payload: { mandateId: mandate.id, maxAmountPaise: mandate.maxAmountPaise, categories: mandate.categories },
        });
        set({
          chat: [
            {
              id: newId("msg"),
              role: "system",
              ts: nowIso(),
              text: "Mandate is active. Instruct the agent in plain language, e.g. “Buy 1 kg basmati under ₹150”.",
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
          explain: "Revocation is future-only. In-flight debits already sent to Razorpay complete on their own.",
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
                text: "Create an active mandate first.",
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
          explain: `Structured intent captured via ${intentSource} for “${text}”. Guardrail will diff the cart against this schema object, not raw text.`,
          payload: { intent, source: intentSource },
        });

        const injectMismatch = get().labInject === "semantic_mismatch";
        let cart = planCart(mandate, intent, injectMismatch, [], get().stockOverride);

        if (get().labInject === "afa_threshold") {
          cart = {
            ...cart,
            totalPaise: AFA_EXEMPT_PAISE + 10000,
            reason: "Lab inject: inflated total above ₹15,000 AFA threshold.",
          };
        }

        // P1-2: Stock Race handling with next-best in-mandate re-plan
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
              explain: `Lab: stock of SKU ${firstSku} dropped to 0 after discovery.`,
              payload: { sku: firstSku },
            });
            await get().appendAudit({
              correlationId: cid,
              phase: "planning",
              event: "stock.unavailable",
              layer: "live",
              explain: `Product ${firstSku} became unavailable. Seeking next-best in-mandate SKU.`,
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
                explain: `Stock race recovery: automatically replaced ${firstSku} with next-best in-mandate item ${nextSku}.`,
                payload: { fromSku: firstSku, toSku: nextSku, cart: cartNextBest },
              });
              cart = cartNextBest;
            } else {
              await get().appendAudit({
                correlationId: cid,
                phase: "failed",
                event: "plan.empty",
                layer: "live",
                explain: "No alternative in-mandate SKU was available. Purchase stopped before debit.",
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
                    text: "Stopped. The selected item is out of stock and no in-mandate alternative was found. No payment was initiated.",
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

        // P1-3: Needs human confirmation (AFA > 15k or Semantic Intent Mismatch)
        if (!guard.ok && guard.needsHumanConfirm) {
          const attempt: PurchaseAttempt = {
            id: newId("att"),
            correlationId: cid,
            mandateId: mandate.id,
            cart,
            intent,
            phase: "needs_confirm",
            failure: guard.code === "pass" ? "none" : guard.code,
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
                text: `${guard.title} — ${guard.detail}. Confirmation required to proceed.`,
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
                text: `Blocked. ${guard.title} — ${guard.detail}`,
              },
            ],
          });
          return;
        }

        const attempt: PurchaseAttempt = {
          id: newId("att"),
          correlationId: cid,
          mandateId: mandate.id,
          cart,
          intent,
          phase: "notify",
          failure: "none",
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
          windowMsLeft: DEMO_NOTIFY_WINDOW_MS,
          chat: [
            ...get().chat,
            {
              id: newId("msg"),
              role: "agent",
              ts: nowIso(),
              text: `Pre-debit notice (simulated SMS + in-app): ${cart.lines.map((l) => l.name).join(", ")} for ₹${cart.totalPaise / 100} at Nila Kirana. Window ${DEMO_NOTIFY_WINDOW_MS / 1000}s (compressed demo of RBI notify-then-execute).`,
            },
          ],
        });

        await get().appendAudit({
          correlationId: cid,
          phase: "notify",
          event: "notify.pre_debit",
          layer: "synthetic",
          explain: "Simulated pre-debit notification. Razorpay test-mode will not send a real bank SMS. Window is compressed for the demo.",
          payload: {
            amountPaise: cart.totalPaise,
            merchant: cart.merchantName,
            items: cart.lines.map((l) => l.sku),
            windowMs: DEMO_NOTIFY_WINDOW_MS,
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

      confirmAfaOverride: async () => {
        const attempt = get().attempts.find((a) => a.id === get().pendingAttemptId);
        if (!attempt) return;
        await get().appendAudit({
          correlationId: attempt.correlationId,
          phase: "needs_confirm",
          event: "afa.human_confirm",
          layer: "live",
          explain: "Human re-confirmed a cart above the ₹15,000 AFA-exempt threshold.",
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
          explain: "Human explicitly reviewed and approved a cart with an intent mismatch.",
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
        const attempt = st.attempts.find((a) => a.id === st.pendingAttemptId);
        const mandate = st.mandate;
        const cart = st.pendingCart;
        if (!attempt || !cart) return;

        if (mandate?.status === "revoked" && attempt.phase === "window") {
          await st.appendAudit({
            correlationId: attempt.correlationId,
            phase: "window",
            event: "execute.under_previous_mandate",
            layer: "live",
            explain: "Mandate revoked during the window. This in-flight attempt still proceeds (future-only revocation) and is logged as completed under a previously valid mandate.",
            payload: { attemptId: attempt.id, revokedAt: mandate.revokedAt },
          });
        } else if (mandate?.status === "revoked") {
          await st.appendAudit({
            correlationId: attempt.correlationId,
            phase: "stopped",
            event: "execute.blocked_revoked",
            layer: "live",
            explain: "Mandate revoked before notify. Future use blocked.",
            payload: { attemptId: attempt.id },
          });
          set({ phase: "stopped" });
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
          explain: `Checkout handler received payment ID ${paymentId}. Pending backend status verification. Mandate will not change until verified captured.`,
          payload: { paymentId, orderId },
        });

        // Start reconciliation loop
        void st.startReconcile(attempt.id, paymentId, orderId);
      },

      startReconcile: async (attemptId, paymentId, orderId) => {
        const maxPolls = 6;
        const pollInterval = 2000;

        for (let i = 0; i < maxPolls; i++) {
          await delay(pollInterval);
          const st = get();
          // If already confirmed (e.g. by webhook race)
          if (st.confirmedPaymentIds.includes(paymentId)) return;

          const isSoftDeclineLab = st.labInject === "soft_decline";

          if (isSoftDeclineLab) {
            // Lab inject simulation through fetch reconciliation path
            await st.appendAudit({
              correlationId: st.correlationId ?? "",
              phase: "pending",
              event: "payment.soft_decline",
              layer: "live",
              explain: "Fetched status from Razorpay: status is failed (soft decline). No double-charge without reconciliation.",
              payload: { paymentId, pollAttempt: i + 1, retryCount: 0 },
            });

            // Single retry cap check
            const attempt = st.attempts.find((a) => a.id === attemptId);
            if (attempt && attempt.attemptsCharge === 0) {
              set({
                attempts: st.attempts.map((a) =>
                  a.id === attemptId
                    ? { ...a, attemptsCharge: 1, razorpayStatus: "failed", failure: "soft_decline" }
                    : a,
                ),
              });
              await st.failClosed("Payment returned soft decline. Status verified as failed. Single retry policy exhausted.");
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
            // continue polling until timeout
          }
        }

        // Timed out
        const finalSt = get();
        if (!finalSt.confirmedPaymentIds.includes(paymentId)) {
          await finalSt.failClosed("Payment status check timed out (fail-closed). Any late webhook capture will reconcile safely.");
        }
      },

      applyConfirm: async (opts) => {
        const st = get();
        const { paymentId, orderId, source, status = "captured" } = opts;

        // Idempotency check: if payment_id already confirmed, do not apply twice
        if (st.confirmedPaymentIds.includes(paymentId)) {
          await st.appendAudit({
            correlationId: st.correlationId ?? newId("cor"),
            phase: st.phase,
            event: "razorpay.duplicate_ignored",
            layer: "live",
            explain: `Duplicate confirmation for payment ${paymentId} via ${source} safely ignored. Mandate preserved.`,
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

        // Decrement live inventory stock
        const newStockOverride = { ...st.stockOverride };
        for (const line of cart.lines) {
          const currentStock = line.sku in newStockOverride ? newStockOverride[line.sku]! : (CATALOG.find((c) => c.sku === line.sku)?.stock ?? 0);
          newStockOverride[line.sku] = Math.max(0, currentStock - line.quantity);
        }

        const isLateReconcile = attempt?.phase === "failed";

        set({
          phase: "confirmed",
          stockOverride: newStockOverride,
          confirmedPaymentIds: [...st.confirmedPaymentIds, paymentId],
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
              text: `Payment confirmed via ${source} (status: ${status}). Payment ID: ${paymentId}. Remaining mandate: ₹${remaining / 100}.`,
            },
          ],
        });

        await st.appendAudit({
          correlationId: attempt?.correlationId ?? st.correlationId ?? newId("cor"),
          phase: "confirmed",
          event: isLateReconcile ? "razorpay.reconciled_after_fail_closed" : "razorpay.confirmed",
          layer: "live",
          explain: isLateReconcile
            ? `Late ${source} confirmation for previously unconfirmed attempt. Mandate reconciled accurately.`
            : `Payment ${paymentId} verified and captured via ${source}. Mandate debited by ₹${totalPaise / 100}.`,
          payload: { paymentId, orderId, remainingPaise: remaining, source, status },
        });
      },

      failClosed: async (reason) => {
        const cid = get().correlationId ?? newId("cor");
        await get().appendAudit({
          correlationId: cid,
          phase: "failed",
          event: "fail_closed",
          layer: "live",
          explain: `State unconfirmed — treated as failed. ${reason}`,
          payload: { reason },
        });
        set({
          phase: "failed",
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
        });
      },

      resetDemo: () => {
        set({
          mandate: null,
          audit: [],
          attempts: [],
          chat: [],
          phase: "idle",
          labInject: "none",
          windowMsLeft: 0,
          pendingCart: null,
          pendingIntent: null,
          pendingAttemptId: null,
          correlationId: null,
          confirmedPaymentIds: [],
          lastExplain: "Demo reset to pristine baseline.",
          stockOverride: {},
        });
      },
    }),
    {
      name: "safebuy-v1",
      partialize: (s) => ({
        mandate: s.mandate,
        audit: s.audit,
        attempts: s.attempts,
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
