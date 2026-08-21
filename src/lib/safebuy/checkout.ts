export type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export function loadRazorpayScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-rzp="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Razorpay script failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.dataset.rzp = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Razorpay Checkout"));
    document.body.appendChild(s);
  });
}

export async function openRazorpayCheckout(opts: {
  key: string;
  amountPaise: number;
  orderId: string;
  name: string;
  description: string;
  notes: Record<string, string>;
  onSuccess: (p: RazorpaySuccess) => void;
  onDismiss: () => void;
}) {
  if (!opts.orderId) {
    throw new Error("Razorpay Order ID is required. Bounded AI buyer will not execute payments without a pre-created Order.");
  }
  await loadRazorpayScript();
  if (!window.Razorpay) throw new Error("Razorpay Checkout is not available");
  const rzp = new window.Razorpay({
    key: opts.key,
    amount: opts.amountPaise,
    currency: "INR",
    name: opts.name,
    description: opts.description,
    order_id: opts.orderId,
    notes: opts.notes,
    theme: { color: "#1a1c18" },
    modal: { ondismiss: opts.onDismiss },
    handler: opts.onSuccess,
  });
  rzp.open();
}
