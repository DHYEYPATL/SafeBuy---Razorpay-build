import { createServerFn } from "@tanstack/react-start";
import { coerceIntent, parseIntentDeterministic } from "./parse-intent";

const PUBLIC_TEST_KEY = "rzp_test_1DP5mmOlF5G5ag";

export const getRazorpayPublicKey = createServerFn({ method: "GET" }).handler(
  async () => {
    const key =
      process.env.RAZORPAY_KEY_ID ||
      process.env.VITE_RAZORPAY_KEY_ID ||
      PUBLIC_TEST_KEY;
    return {
      keyId: key,
      mode: key.startsWith("rzp_test") ? ("test" as const) : ("live" as const),
      hasSecret: Boolean(process.env.RAZORPAY_KEY_SECRET),
    };
  },
);

export const createRazorpayOrder = createServerFn({ method: "POST" })
  .validator((input: { amountPaise: number; receipt: string; notes: Record<string, string> }) => input)
  .handler(async ({ data }) => {
    const keyId =
      process.env.RAZORPAY_KEY_ID ||
      process.env.VITE_RAZORPAY_KEY_ID ||
      PUBLIC_TEST_KEY;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return {
        ok: true as const,
        usedOrdersApi: false,
        keyId,
        orderId: null as string | null,
        amount: data.amountPaise,
        currency: "INR",
        note: "No RAZORPAY_KEY_SECRET in this environment. Checkout still opens on Razorpay test-mode with key_id (real Checkout.js). Orders API is skipped.",
      };
    }

    const auth = Buffer.from(`${keyId}:${secret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: data.amountPaise,
        currency: "INR",
        receipt: data.receipt.slice(0, 40),
        notes: data.notes,
        payment_capture: 1,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false as const,
        error: `Razorpay Orders API ${res.status}: ${text.slice(0, 240)}`,
      };
    }
    const body = (await res.json()) as { id: string; amount: number; currency: string };
    return {
      ok: true as const,
      usedOrdersApi: true,
      keyId,
      orderId: body.id,
      amount: body.amount,
      currency: body.currency,
      note: "Live Razorpay test-mode Orders API.",
    };
  });

export const fetchRazorpayPayment = createServerFn({ method: "POST" })
  .validator((input: { paymentId: string }) => input)
  .handler(async ({ data }) => {
    const keyId = process.env.RAZORPAY_KEY_ID || PUBLIC_TEST_KEY;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return {
        ok: true as const,
        status: "unknown" as const,
        note: "No secret — cannot fetch payment. Client handler is source of truth in this demo.",
      };
    }
    const auth = Buffer.from(`${keyId}:${secret}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/payments/${data.paymentId}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) {
      return { ok: false as const, error: `Fetch payment ${res.status}` };
    }
    const body = (await res.json()) as { status: string; id: string };
    return { ok: true as const, status: body.status, note: "Fetched from Razorpay." };
  });

export const parseIntentWithGrok = createServerFn({ method: "POST" })
  .validator((input: { text: string }) => input)
  .handler(async ({ data }) => {
    const fallback = parseIntentDeterministic(data.text);
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return { ok: true as const, source: "deterministic" as const, intent: fallback };
    }

    try {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-4.5",
          max_tokens: 400,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "Extract a grocery purchase intent as JSON only. Fields: maxAmountPaise (number|null, rupees*100), categories (subset of grains,pulses,spices,oil,dairy,snacks,beverages,household), brandsAllow string[], brandsDeny string[], maxQuantityPerItem number|null, priceCeilingPerItemPaise number|null. No markdown.",
            },
            { role: "user", content: data.text },
          ],
        }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        return { ok: true as const, source: "deterministic" as const, intent: fallback };
      }
      const body = (await res.json()) as {
        choices: { message: { content: string } }[];
      };
      const text = body.choices[0]?.message.content ?? "";
      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}");
      if (jsonStart < 0) {
        return { ok: true as const, source: "deterministic" as const, intent: fallback };
      }
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as unknown;
      return {
        ok: true as const,
        source: "grok" as const,
        intent: coerceIntent(parsed, data.text),
      };
    } catch {
      return { ok: true as const, source: "deterministic" as const, intent: fallback };
    }
  });
