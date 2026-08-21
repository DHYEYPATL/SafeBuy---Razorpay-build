# SafeBuy System Architecture

## Overview
SafeBuy establishes a deterministic governance and safety layer around an autonomous AI agent to make merchant stores safely transactable under Indian payment regulations.

---

## 1. AP2 Primitives & Merchant Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor Human as User / Cardholder
    participant UI as SafeBuy Web UI
    participant Agent as SafeBuy Orchestrator (Zustand)
    participant Guard as Deterministic Guardrail
    participant Merchant as Merchant Order System
    participant RZP_API as Razorpay API (Server)
    participant RZP_CO as Razorpay Checkout.js
    participant Audit as Hash-Chained Audit Store

    Note over Human,UI: Phase 1: Policy Mandate Creation
    Human->>UI: Establish Spending Policy (Cap, categories, validity, auth)
    UI->>Agent: createMandate()
    Agent->>Audit: appendAudit(mandate.created) [AP2 Intent Mandate]

    Note over Human,Agent: Phase 2: Natural Language Instruction & Planning
    Human->>UI: "Buy 1 kg basmati under ₹150"
    UI->>Agent: runInstruction(text)
    Agent->>Agent: parseIntent(text) -> { packTokens: ["basmati"], budget: 15000 }
    Agent->>Agent: planCart(mandate, intent, liveStock)

    Note over Agent,Guard: Phase 3: Token-Level Guardrail Gate
    Agent->>Guard: runGuardrail(cart, mandate, intent)
    alt Pack Tokens & Schema Pass
        Guard-->>Agent: { ok: true, code: "pass" }
    else Substitution Mismatch (e.g. Atta for Basmati)
        Guard-->>Agent: { ok: false, needsHumanConfirm: true }
        Agent->>UI: Show Human Override Confirmation Modal
    end

    Note over Agent,Merchant: Phase 4: Stock Hold & Pre-Debit Notice
    Agent->>Merchant: createMerchantOrder(lines, "reserved") [AP2 Cart Mandate]
    Agent->>Agent: issuePreDebitNotice(dwellMs: 8000)
    Agent->>UI: Display Dwell Countdown (+5s Hold / Proceed Now)

    Note over Agent,RZP_CO: Phase 5: Real Razorpay Execution
    Agent->>RZP_API: POST /v1/orders { amountPaise, notes: { noticeId, orderId } }
    RZP_API-->>Agent: { orderId: "order_live123" }
    Agent->>RZP_CO: openRazorpayCheckout({ orderId: "order_live123" })
    Human->>RZP_CO: Complete Test Mode Card Payment

    Note over Agent,RZP_API: Phase 6: Reconciliation & Settlement
    RZP_CO-->>Agent: handler({ payment_id, order_id, signature })
    Agent->>RZP_API: verifyCheckoutSignature(order_id, payment_id, signature)
    Agent->>Agent: phase = "pending"
    
    loop Polling Status Loop (N=6, delay 2s)
        Agent->>RZP_API: GET /v1/payments/:id
        RZP_API-->>Agent: { status: "captured" }
    end

    Note over Agent,Audit: Phase 7: Confirmation & Stock Settlement
    Agent->>Agent: applyConfirm(source: "fetch", status: "captured")
    Agent->>Merchant: updateMerchantOrder("paid") [AP2 Payment Mandate]
    Agent->>Agent: decrementLiveStock()
    Agent->>Audit: appendAudit(razorpay.confirmed)
    Agent->>UI: Confirmed state & display AP2 Primitives
```

---

## 2. Core Invariants

1. **Token-Level Intent Verification:** The deterministic guardrail strictly validates that user search tokens (e.g. `basmati`) are represented in candidate items, blocking silent same-category substitutions.
2. **Merchant Order Lifecycle:** Every purchase creates a `MerchantOrder` that reserves catalog stock before the pre-debit notice window and settles or releases inventory deterministically.
3. **Durable Pre-Debit Notice:** `PreDebitNotice` records timestamp thresholds (`executeAfter`) providing the required regulatory notice window before payment APIs execute.
4. **Order-Gated Execution:** Razorpay Checkout strictly requires a server-created `order_id`.
5. **Reconciliation-Gated Mandate Decrement:** Mandate spending balances decrement only when backend Fetch or Webhooks report `status === "captured"`.
6. **Strict Idempotency:** Duplicate payment events are deduplicated via `confirmedPaymentIds`.
