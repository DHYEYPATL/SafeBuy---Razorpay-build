import { useEffect, useState } from "react";
import {
  Shield,
  ScrollText,
  FlaskConical,
  ShoppingBag,
  KeyRound,
  Radio,
  AlertTriangle,
  Check,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LayerBadge } from "./layer-badge";
import { CATEGORIES, DEMO_NOTIFY_WINDOW_MS, MERCHANT_NAME, type Category, type LabInject } from "@/lib/safebuy/types";
import { CATALOG, merchantMeta } from "@/lib/safebuy/catalog";
import { useSafeBuy } from "@/lib/safebuy/store";
import { paiseToInr, shortHash } from "@/lib/utils";
import { createRazorpayOrder, getRazorpayPublicKey } from "@/lib/safebuy/razorpay-api";
import { openRazorpayCheckout } from "@/lib/safebuy/checkout";

type Tab = "buy" | "mandate" | "audit" | "lab" | "spec";

const LABELS: { id: Tab; label: string; icon: typeof Shield }[] = [
  { id: "buy", label: "Buy", icon: ShoppingBag },
  { id: "mandate", label: "Mandate", icon: KeyRound },
  { id: "audit", label: "Audit", icon: ScrollText },
  { id: "lab", label: "Lab", icon: FlaskConical },
  { id: "spec", label: "USP", icon: Shield },
];

export function SafeBuyApp() {
  const [tab, setTab] = useState<Tab>("mandate");
  const phase = useSafeBuy((s) => s.phase);
  const mandate = useSafeBuy((s) => s.mandate);

  useEffect(() => {
    void getRazorpayPublicKey().then((k) => useSafeBuy.getState().setRazorpayKey(k.keyId));
  }, []);

  useEffect(() => {
    if (phase !== "window") return;
    const t = setInterval(() => useSafeBuy.getState().tickWindow(), 250);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase === "execute") void openLiveCheckout();
  }, [phase]);

  useEffect(() => {
    if (mandate && tab === "mandate") setTab("buy");
  }, [mandate]);

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pb-10">
      <Header />
      <nav className="mt-6 hidden gap-1 sm:flex">
        {LABELS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex h-11 items-center gap-2 rounded-[var(--radius-sm)] px-3 text-sm ${
              tab === t.id ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface"
            }`}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "buy" && <BuyPanel onNeedMandate={() => setTab("mandate")} />}
        {tab === "mandate" && <MandatePanel />}
        {tab === "audit" && <AuditPanel />}
        {tab === "lab" && <LabPanel />}
        {tab === "spec" && <SpecPanel />}
      </div>

      <GateOverlay />

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 p-2 backdrop-blur sm:hidden">
        <div className="grid grid-cols-5 gap-1">
          {LABELS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] text-[10px] ${
                tab === t.id ? "bg-surface text-foreground" : "text-muted"
              }`}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Header() {
  const mandate = useSafeBuy((s) => s.mandate);
  const phase = useSafeBuy((s) => s.phase);
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Track 01 · Agentic commerce</p>
        <h1 className="font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">SafeBuy</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">
          A bounded AI buyer. Unique safety layer is live. Merchant catalog and bank SMS are synthetic. Razorpay
          test-mode is the real debit.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={mandate?.status === "active" ? "ok" : "neutral"}>
          {mandate ? `Mandate ${mandate.status}` : "No mandate"}
        </Badge>
        <Badge tone="neutral">{phase}</Badge>
        {mandate ? <span className="font-mono text-sm tabular-nums">{paiseToInr(mandate.remainingPaise)} left</span> : null}
      </div>
    </header>
  );
}

function MandatePanel() {
  const mandate = useSafeBuy((s) => s.mandate);
  const [maxRupees, setMaxRupees] = useState(1500);
  const [cats, setCats] = useState<Category[]>(["grains", "pulses", "oil", "dairy", "spices"]);
  const [deny, setDeny] = useState("");
  const [qty, setQty] = useState(2);
  const [ceiling, setCeiling] = useState(500);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  const toggle = (c: Category) =>
    setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  async function submit() {
    setErr("");
    if (cats.length === 0) {
      setErr("Pick at least one category.");
      return;
    }
    if (pin !== "1234") {
      setErr("Simulated AFA failed. Use PIN 1234 (labelled synthetic).");
      return;
    }
    await useSafeBuy.getState().createMandate({
      merchantId: "nila-kirana",
      maxAmountPaise: maxRupees * 100,
      categories: cats,
      brandsAllow: [],
      brandsDeny: deny
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      maxQuantityPerItem: qty,
      priceCeilingPerItemPaise: ceiling * 100,
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-[var(--radius-xl)] border border-border bg-surface p-5 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-2xl">Structured intent mandate</h2>
          <LayerBadge layer="live" />
        </div>
        <p className="mt-2 text-sm text-muted">
          This object is the source of truth. The guardrail diffs carts against it — not against raw chat text.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Max spend (₹)">
            <input
              type="number"
              min={100}
              max={14999}
              value={maxRupees}
              onChange={(e) => setMaxRupees(Number(e.target.value))}
              className="field"
            />
          </Field>
          <Field label="Per-item ceiling (₹)">
            <input
              type="number"
              min={50}
              value={ceiling}
              onChange={(e) => setCeiling(Number(e.target.value))}
              className="field"
            />
          </Field>
          <Field label="Max qty / SKU">
            <input
              type="number"
              min={1}
              max={10}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="field"
            />
          </Field>
          <Field label="Deny brands (comma)">
            <input value={deny} onChange={(e) => setDeny(e.target.value)} placeholder="Cadbury" className="field" />
          </Field>
        </div>
        <p className="mt-4 text-xs uppercase tracking-wider text-subtle">Categories</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => toggle(c)}
              className={`h-10 rounded-full border px-3 text-sm ${
                cats.includes(c) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="mt-5 rounded-[var(--radius-md)] border border-border bg-elevated p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Simulated AFA (UPI PIN)</p>
            <LayerBadge layer="synthetic" />
          </div>
          <p className="mt-1 text-xs text-muted">
            Sandbox cannot run bank AFA. Enter 1234 to stand in for registration-time authentication.
          </p>
          <input
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="1234"
            className="field mt-3 max-w-[10rem] tracking-[0.4em]"
          />
        </div>
        {err ? <p className="mt-3 text-sm text-danger">{err}</p> : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => void submit()}>Create mandate</Button>
          {mandate?.status === "active" ? (
            <Button variant="outline" onClick={() => void useSafeBuy.getState().revokeMandate()}>
              Revoke (future-only)
            </Button>
          ) : null}
        </div>
      </section>
      <MandatePreview />
    </div>
  );
}

function MandatePreview() {
  const mandate = useSafeBuy((s) => s.mandate);
  if (!mandate) {
    return (
      <aside className="rounded-[var(--radius-xl)] border border-dashed border-border p-6 text-sm text-muted">
        No mandate yet. Until this exists, the agent cannot spend.
      </aside>
    );
  }
  return (
    <aside className="rounded-[var(--radius-xl)] border border-border bg-surface p-6">
      <h3 className="font-display text-xl">Active mandate</h3>
      <dl className="mt-4 space-y-2 font-mono text-xs">
        <Row k="id" v={mandate.id} />
        <Row k="status" v={mandate.status} />
        <Row k="cap" v={paiseToInr(mandate.maxAmountPaise)} />
        <Row k="remaining" v={paiseToInr(mandate.remainingPaise)} />
        <Row k="categories" v={mandate.categories.join(", ")} />
        <Row k="deny" v={mandate.brandsDeny.join(", ") || "—"} />
        <Row k="afa" v="simulated_upi_pin" />
      </dl>
    </aside>
  );
}

function BuyPanel({ onNeedMandate }: { onNeedMandate: () => void }) {
  const mandate = useSafeBuy((s) => s.mandate);
  const chat = useSafeBuy((s) => s.chat);
  const pending = useSafeBuy((s) => s.pendingCart);
  const intent = useSafeBuy((s) => s.pendingIntent);
  const [text, setText] = useState("Buy 1 kg basmati under ₹150");
  const [busy, setBusy] = useState(false);
  const meta = merchantMeta();

  async function send() {
    if (!mandate) {
      onNeedMandate();
      return;
    }
    setBusy(true);
    try {
      await useSafeBuy.getState().runInstruction(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section className="flex min-h-[28rem] flex-col rounded-[var(--radius-xl)] border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-display text-xl">Agent</h2>
            <p className="text-xs text-muted">Instruction → structured intent → plan → guardrail → notify → Razorpay</p>
          </div>
          <LayerBadge layer="live" />
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {chat.length === 0 ? (
            <p className="text-sm text-muted">Create a mandate, then tell the agent what to buy.</p>
          ) : (
            chat.map((m) => (
              <div key={m.id} className={m.role === "user" ? "ml-8 text-right" : "mr-8"}>
                <p className="text-[11px] uppercase tracking-wider text-subtle">{m.role}</p>
                <p
                  className={`mt-1 inline-block rounded-[var(--radius-md)] px-3 py-2 text-sm ${
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-elevated text-foreground"
                  }`}
                >
                  {m.text}
                </p>
              </div>
            ))
          )}
          {pending && pending.lines.length > 0 ? (
            <div className="rounded-[var(--radius-md)] border border-border bg-elevated p-3 text-sm">
              <p className="text-xs uppercase tracking-wider text-subtle">Proposed cart</p>
              {pending.lines.map((l) => (
                <div key={l.sku} className="mt-1 flex justify-between gap-2">
                  <span>
                    {l.name} × {l.quantity}
                  </span>
                  <span className="font-mono tabular-nums">{paiseToInr(l.linePaise)}</span>
                </div>
              ))}
              <p className="mt-2 text-xs text-muted">{pending.reason}</p>
            </div>
          ) : null}
          {intent ? (
            <pre className="overflow-x-auto rounded-[var(--radius-sm)] bg-bg p-3 font-mono text-[11px] text-muted">
              {JSON.stringify(intent, null, 2)}
            </pre>
          ) : null}
        </div>
        <form
          className="flex gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            className="field flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Buy 1 kg basmati under ₹150"
          />
          <Button type="submit" disabled={busy}>
            {busy ? "Planning" : "Send"}
          </Button>
        </form>
      </section>
      <aside className="rounded-[var(--radius-xl)] border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg">{meta.name}</h3>
            <p className="text-xs text-muted">{meta.note}</p>
          </div>
          <LayerBadge layer="synthetic" />
        </div>
        <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto">
          {CATALOG.map((i) => (
            <li key={i.sku} className="rounded-[var(--radius-sm)] border border-border px-3 py-2">
              <div className="flex justify-between gap-2 text-sm">
                <span>{i.name}</span>
                <span className="font-mono tabular-nums">{paiseToInr(i.pricePaise)}</span>
              </div>
              <p className="text-[11px] text-subtle">
                {i.brand} · {i.category} · {i.sku}
              </p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function AuditPanel() {
  const audit = useSafeBuy((s) => s.audit);
  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl">Hash-chained audit</h2>
        <LayerBadge layer="live" />
      </div>
      <p className="mt-1 text-sm text-muted">
        Append-only. Each record hashes the previous hash plus canonical JSON. No updates.
      </p>
      <ol className="mt-4 space-y-3">
        {audit.length === 0 ? <p className="text-sm text-muted">No events yet.</p> : null}
        {[...audit].reverse().map((r) => (
          <li key={r.id} className="rounded-[var(--radius-md)] border border-border bg-elevated p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-subtle">#{r.seq}</span>
              <span className="text-sm font-medium">{r.event}</span>
              <LayerBadge layer={r.layer} />
              <Badge tone="neutral">{r.phase}</Badge>
            </div>
            <p className="mt-2 text-sm">{r.explain}</p>
            <p className="mt-2 break-all font-mono text-[10px] text-subtle">
              hash {shortHash(r.hash, 16)} · prev {shortHash(r.prevHash, 10)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LabPanel() {
  const lab = useSafeBuy((s) => s.labInject);
  const setLab = useSafeBuy((s) => s.setLabInject);
  const items: { id: LabInject; title: string; detail: string }[] = [
    { id: "none", title: "Happy path", detail: "No injection. Real Razorpay checkout after notify window." },
    { id: "soft_decline", title: "Soft decline", detail: "Fetch status before retry. Stop. No double charge." },
    { id: "stock_race", title: "Stock race", detail: "SKU hits 0 after discovery. Abort before debit." },
    { id: "semantic_mismatch", title: "LLM mismatch", detail: "Agent picks chocolate vs rice. Guardrail blocks." },
    { id: "afa_threshold", title: "Above ₹15k", detail: "Requires human re-confirm. No silent debit." },
    { id: "revoke_in_window", title: "Revoke in window", detail: "Future blocked; in-flight still completes." },
  ];
  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-surface p-5">
      <h2 className="font-display text-2xl">Failure lab</h2>
      <p className="mt-1 text-sm text-muted">Inject one edge case, then send an instruction on Buy.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setLab(it.id)}
            className={`rounded-[var(--radius-lg)] border p-4 text-left ${
              lab === it.id ? "border-primary bg-elevated" : "border-border"
            }`}
          >
            <p className="font-medium">{it.title}</p>
            <p className="mt-1 text-sm text-muted">{it.detail}</p>
          </button>
        ))}
      </div>
      <Button className="mt-5" variant="outline" onClick={() => useSafeBuy.getState().resetDemo()}>
        Reset demo data
      </Button>
    </section>
  );
}

function SpecPanel() {
  return (
    <div className="space-y-4">
      <section className="rounded-[var(--radius-xl)] border border-border bg-surface p-5">
        <h2 className="font-display text-2xl">What we uniquely built</h2>
        <p className="mt-2 text-sm text-muted">
          These cannot be a fake payment screen. They are the product: the safety protocol around an AI buyer.
        </p>
        <ul className="mt-4 space-y-3 text-sm">
          {[
            ["Structured Intent Mandate", "Human sets hard caps. Schema is the source of truth."],
            ["Deterministic semantic guardrail", "Diffs cart vs mandate + parsed intent before money."],
            ["Notify → window → execute", "No silent debit. Gate is part of the product."],
            ["Real Razorpay test-mode debit", "Checkout.js / Orders after the window. Actual money API."],
            ["Hash-chained audit", "Append-only, every money action explained."],
            ["Fail-closed + future-only revoke", "Ambiguity is failure. In-flight payments are not unsent."],
          ].map(([t, d]) => (
            <li key={t} className="flex gap-3">
              <Check className="mt-0.5 size-4 shrink-0 text-live" />
              <span>
                <strong>{t}.</strong> {d}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-[var(--radius-xl)] border border-border bg-surface p-5">
        <h2 className="font-display text-2xl">What is synthetic (on purpose)</h2>
        <ul className="mt-4 space-y-3 text-sm">
          {[
            ["Nila Kirana catalog", "A stand-in merchant so the agent has SKUs. Not a live store."],
            ["Bank SMS / 24h notice", "Razorpay test-mode will not send RBI pre-debit SMS. We simulate the notice and compress the wait."],
            ["AFA PIN 1234", "Sandbox cannot run real bank AFA at mandate registration."],
            ["Lab injections", "Forced declines, stock races, and mismatches so the unique layer can be shown."],
          ].map(([t, d]) => (
            <li key={t} className="flex gap-3">
              <Radio className="mt-0.5 size-4 shrink-0 text-synth" />
              <span>
                <strong>{t}.</strong> {d}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-[var(--radius-xl)] border border-border bg-elevated p-5">
        <h2 className="font-display text-xl">System prompt (for a builder)</h2>
        <pre className="mt-3 max-h-[22rem] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted">
          {SYSTEM_PROMPT}
        </pre>
      </section>
    </div>
  );
}

function GateOverlay() {
  const phase = useSafeBuy((s) => s.phase);
  const cart = useSafeBuy((s) => s.pendingCart);
  const left = useSafeBuy((s) => s.windowMsLeft);
  const attempts = useSafeBuy((s) => s.attempts);
  const pendingId = useSafeBuy((s) => s.pendingAttemptId);
  const attempt = attempts.find((a) => a.id === pendingId);

  if (phase === "window" && cart) {
    const pct = Math.max(0, left / DEMO_NOTIFY_WINDOW_MS);
    return (
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
        <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-xl">Pre-debit notice</h3>
            <LayerBadge layer="synthetic" />
          </div>
          <p className="mt-2 text-sm text-muted">
            {MERCHANT_NAME} · {cart.lines.map((l) => l.name).join(", ")} · {paiseToInr(cart.totalPaise)}
          </p>
          <p className="mt-2 text-xs text-subtle">
            Compressed {DEMO_NOTIFY_WINDOW_MS / 1000}s window standing in for RBI notify-then-execute. After this, a
            real Razorpay test checkout opens.
          </p>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-elevated">
            <div className="h-full bg-primary" style={{ width: `${pct * 100}%` }} />
          </div>
          <p className="mt-2 flex items-center gap-2 font-mono text-sm tabular-nums">
            <Clock className="size-4" /> {(left / 1000).toFixed(1)}s
          </p>
          <Button variant="outline" className="mt-4" onClick={() => void useSafeBuy.getState().abortPending("User aborted during window.")}>
            Abort
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "needs_confirm" && cart) {
    return (
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
        <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-border bg-surface p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-warn" />
            <h3 className="font-display text-xl">Human confirmation required</h3>
          </div>
          <p className="mt-2 text-sm text-muted">
            Amount is above the ₹15,000 AFA-exempt threshold (or a semantic mismatch needs your OK).
          </p>
          <p className="mt-2 font-mono text-lg">{paiseToInr(cart.totalPaise)}</p>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => void useSafeBuy.getState().confirmAfaOverride()}>Confirm</Button>
            <Button variant="outline" onClick={() => void useSafeBuy.getState().abortPending("Human declined extra confirmation.")}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "execute") {
    return (
      <div className="pointer-events-none fixed bottom-20 right-4 z-40 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-xs text-muted sm:bottom-6">
        Opening Razorpay test checkout…
        {attempt?.razorpayOrderId ? ` order ${attempt.razorpayOrderId}` : ""}
      </div>
    );
  }
  return null;
}

async function openLiveCheckout() {
  const st = useSafeBuy.getState();
  const cart = st.pendingCart;
  if (!cart || !cart.totalPaise) {
    await st.failClosed("No cart at execute time.");
    return;
  }
  try {
    const order = await createRazorpayOrder({
      data: {
        amountPaise: cart.totalPaise,
        receipt: st.pendingAttemptId ?? "safebuy",
        notes: {
          merchant: cart.merchantId,
          correlation: st.correlationId ?? "",
          attempt: st.pendingAttemptId ?? "",
        },
      },
    });
    if (!order.ok) {
      await st.failClosed(order.error);
      return;
    }
    await st.appendAudit({
      correlationId: st.correlationId ?? "",
      phase: "execute",
      event: order.usedOrdersApi ? "razorpay.order_created" : "razorpay.checkout_without_order",
      layer: "live",
      explain: order.note,
      payload: { orderId: order.orderId, amount: order.amount },
    });
    await openRazorpayCheckout({
      key: order.keyId,
      amountPaise: cart.totalPaise,
      orderId: order.orderId,
      name: MERCHANT_NAME,
      description: cart.lines.map((l) => l.name).join(", "),
      notes: { safebuy: "1" },
      onSuccess: (p) => {
        void st.confirmPayment(p.razorpay_payment_id, p.razorpay_order_id ?? order.orderId);
      },
      onDismiss: () => {
        void st.failClosed("Checkout dismissed. Treated as failed (fail-closed).");
      },
    });
  } catch (e) {
    await st.failClosed(e instanceof Error ? e.message : "Checkout error");
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-subtle">{k}</dt>
      <dd className="text-right text-foreground">{v}</dd>
    </div>
  );
}

const SYSTEM_PROMPT = `You are building SafeBuy, a Track 01 Razorpay AI Buildathon demo: a bounded AI buyer that makes a merchant transactable end-to-end using Razorpay TEST-MODE APIs.

HARD SPLIT — do not blur these.

A. MUST BE REAL (unique product — cannot be a fake overlay):
1. Structured Intent Mandate (schema: maxAmountPaise, categories, brandsAllow/Deny, maxQuantityPerItem, priceCeilingPerItemPaise). Human-created. Source of truth.
2. Deterministic semantic guardrail that diffs the proposed cart against THAT schema (not raw LLM text).
3. Notify → short window → execute gate. No silent debit.
4. Actual Razorpay test-mode money movement: Checkout.js and Orders API when key_secret exists. Handler/webhook (or poll) is source of truth for "completed".
5. Hash-chained append-only audit of every money action (canonical JSON + prevHash).
6. Fail-closed on timeout/dismiss/ambiguous status.
7. Future-only mandate revocation (in-flight completes, logged as previously-valid mandate).
8. AFA threshold: demo under ₹15,000; above requires human confirm.
9. Edge pipelines: soft decline (reconcile before retry), stock race, semantic mismatch, AFA threshold, revoke-in-window.

B. MAY BE SYNTHETIC (stage props so A can be demonstrated):
1. Merchant catalog (Nila Kirana) — agent-readable SKUs, not a live store.
2. Bank pre-debit SMS and 24h wait — sandbox cannot send RBI SMS; simulate notice and compress window; LABEL it.
3. Bank AFA at mandate registration — simulate PIN 1234; LABEL it.
4. Lab injections of failures.
5. LLM ranking is optional; deterministic planner is the fallback. If LLM is used, its output is coerced into the structured schema before the guardrail.

TRACK BAR:
- Every money action explainable, bounded, gated.
- Show audit trail.
- Handle at least one failure gracefully.
- Use Razorpay test-mode APIs for the actual debit — never mock the charge itself.
- Position as Option B (merchant transactable by AI buyer). Upsell is bonus only.

DO NOT claim silent instant debit is legal on current Indian rails. Name that gap (NPCI UAP / AP2) and show notify-then-execute as the answer.

UI: dark editorial, no purple, no emoji in chrome, LIVE vs SYNTHETIC badges on every relevant surface.`;
