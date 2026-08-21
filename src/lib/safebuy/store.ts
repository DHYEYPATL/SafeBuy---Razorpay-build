import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CATALOG } from "./catalog";
import { runGuardrail } from "./guardrail";
import { GENESIS_HASH, hashRecord } from "./hash";
import { parseIntentDeterministic } from "./parse-intent";
import { planCart } from "./plan";
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
  lastExplain: string;
  stockOverride: Record<string, number>;
  hydrateOk: boolean;
  setRazorpayKey: (k: string) => void;
  setLabInject: (i: LabInject) => void;
  createMandate: (m: Omit<Mandate, "id" | "status" | "spentPaise" | "remainingPaise" | "createdAt" | "revokedAt" | "afaSimulatedAt" | "afaMethod"> & { remainingPaise?: number }) => Promise<void>;
  revokeMandate: () => Promise<void>;
  appendAudit: (partial: Omit<AuditRecord, "seq" | "id" | "hash" | "prevHash" | "ts">) => Promise<AuditRecord>;
  runInstruction: (text: string, parsed?: StructuredIntent) => Promise<void>;
  tickWindow: () => void;
  confirmAfaOverride: () => Promise<void>;
  startExecute: (opts?: { razorpayOrderId?: string | null; forceFail?: FailureKind }) => Promise<void>;
  confirmPayment: (paymentId: string, orderId: string | null) => Promise<void>;
  failClosed: (reason: string) => Promise<void>;
  abortPending: (reason: string) => Promise<void>;
  resetDemo: () => void;
}

function nowIso() {
  return new Date().toISOString();
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
      razorpayKeyId: "rzp_test_1DP5mmOlF5G5ag",
      lastExplain: "Idle. Create a mandate, then instruct the agent.",
      stockOverride: {},
      hydrateOk: false,
      setRazorpayKey: (k) => set({ razorpayKeyId: k }),
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
        const intent = parsed ?? parseIntentDeterministic(text);
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
          explain: `Structured intent captured for “${text}”. Guardrail will diff the cart against this object, not raw text.`,
          payload: { intent },
        });

        const injectMismatch = get().labInject === "semantic_mismatch";
        let cart = planCart(mandate, intent, injectMismatch);

        if (get().labInject === "afa_threshold") {
          cart = {
            ...cart,
            totalPaise: AFA_EXEMPT_PAISE + 10000,
            reason: "Lab inject: inflated total above ₹15,000 AFA threshold.",
          };
        }

        if (get().labInject === "stock_race") {
          const sku = cart.lines[0]?.sku;
          if (sku) {
            set({ stockOverride: { ...get().stockOverride, [sku]: 0 } });
            await get().appendAudit({
              correlationId: cid,
              phase: "planning",
              event: "stock.race_injected",
              layer: "synthetic",
              explain: `Lab: stock of ${sku} dropped to 0 after discovery.`,
              payload: { sku },
            });
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

        if (get().labInject === "stock_race") {
          await get().appendAudit({
            correlationId: cid,
            phase: "failed",
            event: "stock.unavailable",
            layer: "live",
            explain: "Product became unavailable between discovery and execution. Debit aborted.",
            payload: { sku: cart.lines[0]?.sku },
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
                text: "Stopped. The selected SKU went out of stock after discovery. No payment was started.",
              },
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

        if (!guard.ok && guard.code === "afa_threshold") {
          const attempt: PurchaseAttempt = {
            id: newId("att"),
            correlationId: cid,
            mandateId: mandate.id,
            cart,
            intent,
            phase: "needs_confirm",
            failure: "afa_threshold",
            razorpayOrderId: null,
            razorpayPaymentId: null,
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
                text: `${guard.title}. Confirm to proceed, or change the cart.`,
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

        if (st.labInject === "soft_decline" || opts?.forceFail === "soft_decline") {
          await st.appendAudit({
            correlationId: attempt.correlationId,
            phase: "execute",
            event: "payment.soft_decline",
            layer: "live",
            explain: "Soft decline injected. Status will be fetched before any retry. No second charge without reconciliation.",
            payload: { attemptId: attempt.id },
          });
          set({
            phase: "failed",
            attempts: st.attempts.map((a) =>
              a.id === attempt.id ? { ...a, phase: "failed", failure: "soft_decline" } : a,
            ),
            chat: [
              ...st.chat,
              {
                id: newId("msg"),
                role: "agent",
                ts: nowIso(),
                text: "Razorpay returned a soft decline. Fetched status first — still failed. Stopped. No retry storm.",
              },
            ],
          });
          return;
        }

        set({
          phase: "execute",
          attempts: st.attempts.map((a) =>
            a.id === attempt.id
              ? { ...a, phase: "execute", executeAt: nowIso(), razorpayOrderId: opts?.razorpayOrderId ?? a.razorpayOrderId }
              : a,
          ),
        });
        await st.appendAudit({
          correlationId: attempt.correlationId,
          phase: "execute",
          event: "razorpay.execute_open",
          layer: "live",
          explain: "Opening real Razorpay test-mode Checkout after the notify window. This is the actual money movement.",
          payload: {
            amountPaise: cart.totalPaise,
            orderId: opts?.razorpayOrderId ?? null,
          },
        });
      },

      confirmPayment: async (paymentId, orderId) => {
        const st = get();
        const attempt = st.attempts.find((a) => a.id === st.pendingAttemptId);
        const mandate = st.mandate;
        const cart = st.pendingCart;
        if (!attempt || !cart) return;

        const remaining = Math.max(0, (mandate?.remainingPaise ?? 0) - cart.totalPaise);
        const spent = (mandate?.spentPaise ?? 0) + cart.totalPaise;
        if (mandate) {
          set({
            mandate: { ...mandate, remainingPaise: remaining, spentPaise: spent },
          });
        }
        set({
          phase: "confirmed",
          attempts: st.attempts.map((a) =>
            a.id === attempt.id
              ? {
                  ...a,
                  phase: "confirmed",
                  razorpayPaymentId: paymentId,
                  razorpayOrderId: orderId ?? a.razorpayOrderId,
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
              text: `Paid via Razorpay test-mode. Payment ${paymentId}. Remaining mandate ₹${remaining / 100}.`,
            },
          ],
        });
        await get().appendAudit({
          correlationId: attempt.correlationId,
          phase: "confirmed",
          event: "razorpay.confirmed",
          layer: "live",
          explain: `Webhook/handler confirmed payment ${paymentId}. Audit closed. Remaining cap ₹${remaining / 100}.`,
          payload: { paymentId, orderId, remainingPaise: remaining },
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
          lastExplain: "Demo reset.",
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
      }),
    },
  ),
);

export function liveStock(sku: string, override: Record<string, number>) {
  if (sku in override) return override[sku]!;
  return CATALOG.find((i) => i.sku === sku)?.stock ?? 0;
}
