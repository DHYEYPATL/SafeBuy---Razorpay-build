# Razorpay AI Buildathon — Official Submission Form Draft

Use these pre-drafted answers when submitting the official Google Form before the deadline.

---

### Item 1: Full Name
**Dhyey Patil**

---

### Item 2: College / University Name
*(Fill your institution name)*

---

### Item 3: Graduation Year
*(Fill your grad year, e.g., 2025 / 2026)*

---

### Item 4: Confirmation for In-Person September Finals
**Yes, confirmed available for in-person finals in Bangalore.**

---

### Item 5: Internship / Role Duration Pick (6 or 12 Months)
*(Select 6 Months or 12 Months)*

---

### Item 6: Resume Link
*(Provide your public Google Drive / LinkedIn / PDF link)*

---

### Item 7: Selected Track
**Track 01 — Agentic Commerce**

---

### Item 8: Project Name
**SafeBuy — Deterministic Governance & Machine-Transactability for Autonomous AI Buyers**

---

### Item 9: One-Line Summary of What It Solves
> *"SafeBuy solves the Indian silent-debit regulatory gap by placing a deterministic schema guardrail, durable pre-debit notice gate, and cryptographic agent identity around AI buyers, proving settlement live on real Razorpay test Orders."*

---

### Item 10: Public GitHub Repository URL
`https://github.com/DHYEYPATL/SafeBuy---Razorpay-build`

---

### Item 11: 5-Minute Pitch Video Link
*(Paste unlisted YouTube link once recorded)*

#### 5-Minute Video Walkthrough Script & Timing:
- **0:00 – 0:30 (Regulatory Framing):**  
  *"In India, no payment rail permits silent, unbounded autonomous debit without e-mandate registration and pre-debit notifications. SafeBuy is not a fake instant-debit screen; it is the real deterministic governance and merchant transactability layer."*
- **0:30 – 1:30 (Happy Path & Guardrail):**  
  Show establishing a ₹1,500 spending mandate. Propose `"Buy 1 kg basmati under ₹150"`. Show the deterministic guardrail catching pack tokens (blocking unauthorized atta substitution). Show the durable `PreDebitNotice` record countdown, real Razorpay Checkout modal with server-created `order_id`, and unbroken SHA-256 audit chain verification.
- **1:30 – 2:30 (Differentiators & Third-Party Agent Discovery):**  
  Show `scripts/external-agent-demo.ts` discovering SKUs via `/.well-known/agent-catalog.json` with zero internal imports. Show the 7-tool Model Context Protocol (MCP) server, the x402 HTTP monetization challenge (`402 Payment Required`), and the AI Campaign Orchestrator 1-click loyalty bundle.
- **2:30 – 3:15 (Agent Identity Registry & Failure Lab):**  
  Open the **Agents tab**: show cryptographic HMAC public keys, `actingFor` delegation chains, and dynamic reputation score meters. Trigger Failure Lab **Replay Attack** (Edge Case 10) to demonstrate immediate fail-closed signature rejection with zero money moved.
- **3:15 – 4:00 (Self-Correction & What Broke):**  
  Walk through the honest postmortem: catching the dwell-erosion flaw during review (refusing to let high agent trust erode the 8-second human notification floor, preserving the regulatory floor for cardholder protection while moving trust incentives strictly to x402 wholesale pricing).
- **4:00 – 5:00 (Closing Thesis):**  
  *"Other submissions show an agent buying something on a fake screen. SafeBuy makes the merchant machine-transactable, monetizes AI agents via x402, and enforces Indian regulatory compliance with 40/40 verified automated tests."*

---

### Item 12: What Broke, and How You Got Out (The Engineering Postmortem)

> *"Our most significant design breakthrough came from catching our own conceptual failure mode under architectural review:  
> 
> **1. The Flaw:** When closing the loop on dynamic agent reputation scores, we initially allowed high-trust agents ($\ge 80$) to shorten the Pre-Debit Notice dwell countdown from 8s to 3s. Under self-review, we realized this conflated agent reliability with cardholder visibility: an agent's clean track record tells us nothing about whether the human is paying attention. Letting high trust shorten the notice window created a loophole in our own safety mechanism and eroded the very regulatory floor (RBI's notify-then-execute requirement) we set out to honor.  
> 
> **2. The Fix:** We refactored `computeDwellDurationMs` so the 8-second window is an uncompromised regulatory floor for all compliant agents, while low-trust or suspicious agents ($< 50$) trigger an extended 12-second elevated caution dwell. We moved all positive trust incentives strictly to merchant-agent business rails: x402 wholesale catalog access (₹1 VIP rate vs ₹2 standard, and denied for untrusted agents) and AI loyalty reorder bundles.  
> 
> **3. Additional Fixed Architectural Debt:**  
> - **Checkout-Without-Order Bug:** Refactored Checkout to strictly mandate server-created `POST /v1/orders` IDs with fail-closed aborts.  
> - **Client-Side Confirmation Race:** Migrated mandate deduction exclusively to backend status polling (`GET /v1/payments/:id`) and HMAC-validated webhooks, ensuring only `status === 'captured'` mutates spend.  
> - **Same-Category Agentic Substitutions:** Extended the deterministic guardrail from broad categories to SKU `packTokens`, preventing LLMs from silently substituting atta for basmati."*
