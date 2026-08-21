# SafeBuy — 5-Minute Video Walkthrough Script

> **Track 01: Agentic Commerce Submission (Option B)**  
> **Video Target Duration:** 4:30 – 5:00 minutes (Unlisted YouTube / Loom link)  
> **Setup:** Keep the Razorpay Test Dashboard in a split window or secondary monitor so real Order IDs and Payment IDs are in frame.

---

## Video Timeline & Talking Points

```text
[0:00 - 0:40] Problem & Regulatory Truth (The UAP / AP2 Gap)
[0:40 - 2:10] The Happy Path: Policy -> Natural Intent -> Notice -> Real Razorpay Test Order
[2:10 - 3:15] Guardrail Depth: Token-Level Failure (Atta vs Basmati) & Ask-Back Clarification
[3:15 - 4:05] Failure Recovery: Soft Decline with Status Fetch & Stock Race Recovery
[4:05 - 5:00] AP2 Primitives, Cryptographic Audit Verification, & Closing
```

---

### Segment 1: The Problem & Regulatory Truth (0:00 – 0:40)
- **On Screen:** SafeBuy App Header & USP Spec Panel.
- **Script:**
  > *"Welcome. This is SafeBuy for Track 01 Agentic Commerce.  
  > Before showing code, let’s be honest about the rail: In India, no payment rail permits silent, unbounded autonomous debit without e-mandate registration and 24-hour pre-debit notification.  
  > SafeBuy is the missing deterministic safety layer: The AI Agent plans and gates, while execution is customer-present hosted Checkout on a real Razorpay Order created by our server. The pre-debit notice record and dwell window is the safety gate."*

---

### Segment 2: Full Happy Path Execution (0:40 – 2:10)
- **On Screen:** Policy setup → Buy Panel → Razorpay Checkout Modal → Razorpay Dashboard in frame showing new Order & Payment.
- **Actions:**
  1. Click **Establish Spending Policy** (₹1500 cap, grains/pulses/oil allowed, simulated registration authorization).
  2. Click the golden utterance: `"Buy 1 kg basmati under ₹150"`.
  3. Show the **Candidate Cart** (`India Gate Basmati Rice 1 kg`, ₹142) and parsed `packTokens: ["basmati"]`.
  4. Point out the **Pre-Debit Notice Record** (`#not_...`) and **Merchant Order** (`#mord_...` reserved stock).
  5. Allow the 8s dwell window to complete (or click *Proceed Now*).
  6. **Razorpay Checkout modal opens with real `order_id`**.
  7. Enter test card `4111 1111 1111 1111`, expiry `12/30`, CVV `123`, OTP `123456`.
  8. Point out the **PENDING** phase badge: *“The client handler does NOT debit the mandate. Our backend polling loop verifies `GET /v1/payments/:id` status is `captured` before the single `applyConfirm` mutator subtracts the spend and decrements live stock.”*
  9. Switch to the **Razorpay Dashboard** tab to show the captured payment and matched receipt ID.

---

### Segment 3: Token Guardrail & Ask-Back Clarification (2:10 – 3:15)
- **On Screen:** Buy Panel & Guardrail Modal.
- **Actions:**
  1. Click utterance `"Buy 1 kg basmati under ₹50"`.
  2. Show that instead of a dead end or silent failure, the Agent triggers an **Ask-Back Clarification**: *“The lowest available price in grains is ₹142 (Aged Basmati Rice 1 kg). Would you like to increase your budget?”*
  3. Switch to Lab Tab, trigger **LLM Mismatch** or type a query that substitutes atta for basmati.
  4. Show that because `guardrail.ts` verifies `packTokens`, the same-category substitution **fails the guardrail** and surfaces the **Human Override Confirmation** modal.

---

### Segment 4: Failure Lab & Rail Recovery (3:15 – 4:05)
- **On Screen:** Lab Tab → Buy Panel.
- **Actions:**
  1. Demonstrate **Stock Race Recovery**: When the primary SKU stock drops to 0 after discovery, the planner automatically re-plans with the next-best in-mandate alternative and routes it back through the guardrail.
  2. Demonstrate **Soft Decline**: Razorpay failure card (`4000 0000 0000 1003`). Show that SafeBuy fetches backend status first, enforces a strict 1-retry cap, and halts safely without multiple charges.

---

### Segment 5: Bounded Upsell & Third-Party Agent Discovery (3:45 – 4:30)
- **On Screen:** Pre-Debit Window with Upsell Card & Terminal running `external-agent-demo.ts`.
- **Actions:**
  1. Show the **Bounded Upsell Card** during notice dwell: *“When buying 1kg Basmati, the deterministic upsell engine surfaces the 5kg Economy Pack (12% cheaper per kg) strictly bounded by remaining mandate limits and brand preference.”*
  2. Switch to terminal and run `npx tsx scripts/external-agent-demo.ts`.
  3. Show the live output: A completely independent external AI buyer fetching `/.well-known/agent-catalog.json`, querying `packTokens`, and selecting compliant SKUs with zero SafeBuy internal imports.
  4. Script: *“This proves our merchant is machine-transactable by ANY third-party agent using AP2/ACP discovery, not just our frontend.”*

---

### Segment 6: AP2 Primitives & Cryptographic Audit Trail (4:30 – 5:00)
- **On Screen:** AP2 Primitives Tab & Audit Tab.
- **Actions:**
  1. Show the **AP2 Primitives tab**: Live generated `AP2IntentMandate` (policy), `AP2CartMandate` (locked items + merchant reservation), and `AP2PaymentMandate` (Razorpay order settlement).
  2. Navigate to the **Audit tab** and click **"Verify Audit Chain"**.
  3. Point out the green verification banner: *“All records form an unbroken, untampered SHA-256 hash sequence from genesis.”*
  4. **Closing statement:** *“SafeBuy makes merchants transactable by AI buyers today with real Razorpay test-mode Orders, deterministic guardrails, and cryptographic accountability.”*
