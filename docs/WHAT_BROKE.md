# SafeBuy — Engineering Postmortem & What We Fixed

A transparent account of architectural flaws discovered during design and testing, and the precise engineering solutions implemented to resolve them.

---

## 1. Client-Side Confirmation Race (The "Optimistic Debit" Flaw)

### The Problem
In early iterations, the client-side checkout handler subtracted the purchase amount from the mandate's `remainingPaise` immediately upon the `handler` callback firing on the browser. If the user dismissed the modal after submission or if network connectivity dropped before server capture, the policy balance was permanently depleted even if the bank declined the transaction.

### The Solution
We decoupled UI completion from balance mutation:
- The checkout handler transitions state to `pending`.
- A backend status reconciliation loop polls Razorpay API (`GET /v1/payments/:id`) until `status === "captured"`.
- `applyConfirm()` in the state orchestrator is the **sole state mutator**: mandate `remainingPaise` decrements only after Razorpay server capture is verified.

---

## 2. Category-Only Guardrail Bypass (The "Atta for Basmati" Flaw)

### The Problem
Initial guardrails checked category membership and budget only. When a user requested `"1 kg basmati rice under ₹150"` and the basmati item was out of stock, the LLM proposed `"Whole Wheat Atta 5 kg"` (category: `grains`, price: ₹275). Because both are `grains`, the category check passed, resulting in an unauthorized grocery substitution.

### The Solution
We engineered **token-level semantic verification**:
- Structured intent extracts explicit `packTokens` (e.g. `['basmati']`) and pack size hints.
- `guardrail.ts` verifies that all requested tokens exist within the normalized item name, SKU, or description.
- Proposing atta for basmati triggers an instant `intent_mismatch` block, halting money movement and presenting an explicit Human Confirmation modal.

---

## 3. The Dwell-Window Regulatory Floor Catch

### The Problem
When integrating dynamic agent trust scores, we initially allowed high-trust agents ($\ge 80$) to reduce the Pre-Debit Notice dwell countdown from 8s to 3s (a "fast-path"). Under architectural review, we identified that this conflated agent reliability with cardholder visibility: an agent's clean track record does not mean the human is paying attention. Shortening the window below 8s created a loophole in our own safety mechanism and eroded the regulatory notify-then-execute standard.

### The Solution
We refactored `computeDwellDurationMs()` so that the 8-second dwell is an **uncompromised regulatory baseline floor** for all compliant agents. Trust incentives were moved strictly to merchant-agent business mechanics (x402 dynamic wholesale micro-fees at ₹1 vs ₹2 standard), while low-trust or suspicious agents ($< 50$) trigger an extended 12-second elevated caution dwell.

---

## 4. Checkout Without Server Order Bug

### The Problem
Razorpay Checkout.js can technically open with client-supplied `amount` and `currency` parameters without a server-side `order_id`. This created a critical vulnerability where client tampering could bypass server order logging.

### The Solution
We refactored `openRazorpayCheckout()` to make `orderId` strictly mandatory. If `createRazorpayOrder()` (`POST /v1/orders`) fails or is missing valid API keys, Checkout refuses to open and logs `fail_closed` to the immutable audit trail.
