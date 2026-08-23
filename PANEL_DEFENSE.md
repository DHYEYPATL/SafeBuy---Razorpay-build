# SafeBuy — Live Panel Defense Guide

> **Audience:** Razorpay Engineers, Hackathon Judges, and Panel Evaluators  
> **Core Principle:** Speak like an engineer who has been on-call for payments, not a marketer pitching LLM magic.

---

## 1. The 30-Second Elevator Pitch

> *"In India, no payment rail permits silent, unbounded autonomous debit without e-mandate registration and 24-hour pre-debit notifications.  
> SafeBuy is the deterministic governance container around an AI buyer: The Agent parses intent and plans a cart; our deterministic guardrail enforces policy and pack tokens; a durable pre-debit notice record provides the regulatory dwell gate; and execution occurs on a real Razorpay test Order whose `captured` status is the only thing that decrements the spending cap.  
> Catalog and SMS are synthetic props; the Orders API, HMAC signature validation, reconciliation loop, and audit chain are 100% real code."*

---

## 2. Top 6 Questions Judges Will Ask & How to Answer

### Q1: "Why is Razorpay Checkout still customer-present? Where is the autonomous debit?"
**Answer:**  
*"Because in test mode (and on real Indian payment rails), headless silent debit without a pre-registered bank e-mandate does not exist. We refused to fake an instant silent debit screen. Instead, we built the real safety protocol: The agent plans and gates, issues a pre-debit notice record with an 8-second dwell countdown, creates a server Order via `POST /v1/orders`, and waits for the customer to complete Checkout. Once customer tokenization is configured, the exact same notice gate and Orders spine triggers the token charge."*

---

### Q2: "How does your guardrail prevent the classic LLM failure where the user asks for basmati and the agent buys atta?"
**Answer:**  
*"A category-only check fails here because both basmati and atta are `grains` and under budget.  
In SafeBuy, `parseIntent` extracts specific `packTokens: ['basmati']`. The deterministic `guardrail.ts` checks that every requested token appears in the normalized name, brand, or SKU of the candidate items. If the planner proposes atta, the guardrail detects that the token `basmati` is missing from the line item, halts execution, and displays the Human Override Confirmation modal."*

---

### Q3: "What broke in your initial version, and what architectural debt did you eliminate?"
**Answer:**  
1. *Checkout Without Order Bug:* Initial code opened Checkout with a client amount if API keys were missing. We refactored `openRazorpayCheckout` to mandate an `order_id` and fail closed if Order creation fails.
2. *Client-Side Confirmation:* Previously, the client handler decremented the balance instantly. We moved this to a backend reconciliation loop (`GET /v1/payments/:id` + Webhook) where only `status === 'captured'` triggers `applyConfirm`.
3. *Signature Verification:* We added timing-safe `HMAC_SHA256(order_id + '|' + payment_id, KEY_SECRET)` verification.
4. *CSS-only countdown:* Replaced a dumb UI timer with a durable `PreDebitNotice` data record with `executeAfter` timestamp validation.
5. *PIN 1234 Meme:* Replaced the hardcoded PIN with policy registration consent with 7-day expiration.

---

### Q4: "How do you ensure payment idempotency and prevent double-debiting on duplicate webhooks?"
**Answer:**  
*"We enforce two layers of idempotency:  
1. Orders are created with unique `Idempotency-Key` headers tied to the attempt ID.  
2. The state orchestrator maintains a `confirmedPaymentIds` tracking table. `applyConfirm` is the sole state mutator: any duplicate Webhook delivery or secondary Checkout callback is logged as `razorpay.duplicate_ignored` and dropped without debiting the policy."*

---

### Q5: "How does the agent handle a Soft Decline on the payment rail?"
**Answer:**  
*"When a card fails (e.g. using test card `4000 0000 0000 1003` for insufficient funds), our backend status polling verifies with Razorpay that status is `failed`. SafeBuy logs `payment.soft_decline` in the cryptographic audit trail, allows at most 1 retry, and then halts safely without endlessly cycling charges."*

---

### Q6: "Why did you model transaction state after AP2 primitives?"
**Answer:**  
*"Google and Visa's Agentic Payment Protocol (AP2) establishes a three-document lifecycle for agentic commerce. We adopted this exact architecture:  
1. `AP2IntentMandate`: Human spending policy (caps, categories, validity).  
2. `AP2CartMandate`: Locked SKU proposal and merchant order reservation after guardrail clearance.  
3. `AP2PaymentMandate`: Settlement contract linking Razorpay `order_id`, `payment_id`, notice ID, and capture status."*

---

### Q7: "How is SafeBuy different from just a frontend checkout page?"
**Answer:**  
*"SafeBuy makes the **merchant machine-transactable by ANY third-party AI buyer**, not just our frontend.  
We expose an AP2/ACP-compliant discovery endpoint at `/.well-known/agent-catalog.json` and `/api/catalog/skus`. External agents can discover stock, read structured `packTokens`, check prices, and submit carts directly. In our demo, we run `scripts/external-agent-demo.ts`—a standalone third-party script with zero SafeBuy imports that discovers and transactions with our merchant live over HTTP."*

---

### Q8: "Why is your Bounded Upsell deterministic rather than LLM-driven?"
**Answer:**  
*"Because the same safety principle that blocks bad substitutions must police good ones: Keep non-deterministic LLMs out of money-adjacent decisions.  
Our Bounded Upsell engine is a pure deterministic function that evaluates same-brand economy pack sizes (e.g. 5kg vs 1kg basmati) that lower the unit price (₹/kg) while strictly adhering to remaining mandate limits and brand deny lists. It's symmetric and provable."*

---

### Q9: "Can an external agent mint its own spending mandate via your MCP server?"
**Answer:**  
*"Never. The MCP server (`src/mcp/server.ts`) is strictly an execution and query adapter over pre-authorized policies. A spending mandate MUST already exist, created through the authenticated human UI. An external agent can only propose carts against an existing mandate ID; it possesses zero authority to mint or alter policies."*

---

### Q10: "How does SafeBuy address merchant monetization (Option A) beyond buyer protection?"
**Answer:**  
*"We implemented the emerging x402 HTTP monetization pattern (`GET /api/catalog/premium` -> `402 Payment Required`). Agents querying priority wholesale inventory and bulk pricing pay a ₹2 micro-fee via a real Razorpay Order. Upon settlement (`POST /api/x402/settle`), our server issues a session-bound 15-minute access token. This gives merchants a direct revenue stream from AI agents."*

---

### Q11: "Is your Agent Identity layer connected to a live Visa TAP or NPCI UAP directory?"
**Answer:**  
*"No. This is an honest reference pattern implementation demonstrating the missing identity/reputation seam: agent registration, HMAC message signing with registered keys, 30s replay window with nonces, and dynamic trust scores derived from our hash-chained audit trail. It illustrates the architectural separation between agent identity and human mandate authorization without claiming live directory certification."*

---

### Q12: "Where is settlement proven in SafeBuy?"
**Answer:**  
*"Settlement is proven live against real Razorpay test keys via in-session backend polling (`GET /v1/payments/:id`) verifying `status === 'captured'` before `applyConfirm` debits the policy cap. Webhook HMAC SHA-256 verification is implemented as an offline module and verified via automated test suite."*

---

### Q13: "Why doesn't a high agent trust score shorten the Pre-Debit Notice dwell window?"
**Answer:**  
*"Because the pre-debit notice window exists to protect the human cardholder, not to reward the agent. An agent's good track record tells you nothing about whether the cardholder is actively paying attention right now. Reducing the notice window below the 8-second regulatory floor would erode our own safety mechanism and create a loophole in our own guardrail.  
Instead, trust reputation translates to merchant-agent business privileges: high-trust agents earn VIP wholesale catalog pricing on the x402 rail (₹1 vs ₹2 standard) and unlock AI loyalty campaign bundles (which are strictly validated against `runGuardrail` end-to-end before order reservation). Conversely, low-trust or suspicious agents trigger elevated caution (12-second dwell) to afford the human extra reaction time."*

---

## 3. What to Have Open During the Interview
1. **SafeBuy Web App** running on `localhost:8080`.
2. **Razorpay Dashboard in Test Mode** showing real Orders and Payments.
3. **Audit Tab** ready to click "Verify Audit Chain".
4. **Terminal** ready to run `npm run test:unit` (40/40 tests passing).
