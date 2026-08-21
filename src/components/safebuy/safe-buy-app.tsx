import { useEffect, useState, useRef } from "react";
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
  CheckCircle2,
  XCircle,
  FileCode2,
  Store,
  Sparkles,
  PlusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LayerBadge } from "./layer-badge";
import {
  CATEGORIES,
  DEMO_NOTIFY_WINDOW_MS,
  MERCHANT_NAME,
  type Category,
  type LabInject,
} from "@/lib/safebuy/types";
import { CATALOG, merchantMeta } from "@/lib/safebuy/catalog";
import { useSafeBuy, liveStock } from "@/lib/safebuy/store";
import { paiseToInr, shortHash } from "@/lib/utils";
import { createRazorpayOrder, getRazorpayPublicKey } from "@/lib/safebuy/razorpay-api";
import { verifyCheckoutSignature } from "@/lib/safebuy/signature";
import { openRazorpayCheckout } from "@/lib/safebuy/checkout";
import { verifyAuditChain, type ChainVerificationResult } from "@/lib/safebuy/hash";

type Tab = "buy" | "mandate" | "orders" | "ap2" | "audit" | "lab" | "spec";

const LABELS: { id: Tab; label: string; icon: typeof Shield }[] = [
  { id: "buy", label: "Buy", icon: ShoppingBag },
  { id: "mandate", label: "Policy", icon: KeyRound },
  { id: "orders", label: "Orders", icon: Store },
  { id: "ap2", label: "AP2 Primitives", icon: FileCode2 },
  { id: "audit", label: "Audit", icon: ScrollText },
  { id: "lab", label: "Lab", icon: FlaskConical },
  { id: "spec", label: "USP", icon: Shield },
];

const GOLDEN_UTTERANCES = [
  { label: "Basmati Under ₹150", text: "Buy 1 kg basmati under ₹150", desc: "Happy path" },
  { label: "1 kg Toor Dal", text: "Get 1 kg toor dal", desc: "SKU & Category match" },
  { label: "Low Budget (< ₹50)", text: "Buy 1 kg basmati under ₹50", desc: "Triggers agent ask-back" },
  { label: "Atta + Cadbury", text: "Get 5 kg atta with Cadbury chocolate", desc: "Deny brand block" },
  { label: "Organic Moong 500g", text: "Buy organic moong dal 500g", desc: "Pack size & brand match" },
];

export function SafeBuyApp() {
  const [tab, setTab] = useState<Tab>("mandate");
  const phase = useSafeBuy((s) => s.phase);
  const mandate = useSafeBuy((s) => s.mandate);
  const isConfigured = useSafeBuy((s) => s.isConfigured);
  const checkoutOpenedRef = useRef(false);

  useEffect(() => {
    void getRazorpayPublicKey().then((k) => {
      useSafeBuy.getState().setRazorpayKeyDetails({
        keyId: k.keyId,
        hasSecret: k.hasSecret,
        configured: k.configured,
      });
    });
  }, []);

  useEffect(() => {
    if (phase !== "window") return;
    const t = setInterval(() => useSafeBuy.getState().tickWindow(), 250);
    return () => clearInterval(t);
  }, [phase]);

  // Once-guarded execute effect
  useEffect(() => {
    if (phase === "execute" && !checkoutOpenedRef.current) {
      checkoutOpenedRef.current = true;
      void openLiveCheckout().finally(() => {
        checkoutOpenedRef.current = false;
      });
    }
  }, [phase]);

  useEffect(() => {
    if (mandate && tab === "mandate") setTab("buy");
  }, [mandate]);

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pb-10">
      <Header />

      {!isConfigured ? (
        <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-md)] border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertTriangle className="size-4 shrink-0 text-amber-400" />
          <span>
            <strong>Razorpay test credentials missing:</strong> Set <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> in <code>.env</code>. Live Orders & money path require valid test API keys.
          </span>
        </div>
      ) : null}

      <nav className="mt-6 hidden gap-1 sm:flex">
        {LABELS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex h-11 items-center gap-2 rounded-[var(--radius-sm)] px-3 text-sm ${
              tab === t.id ? "bg-primary text-primary-foreground font-medium" : "text-muted hover:bg-surface"
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
        {tab === "orders" && <OrdersPanel />}
        {tab === "ap2" && <AP2PrimitivesPanel />}
        {tab === "audit" && <AuditPanel />}
        {tab === "lab" && <LabPanel />}
        {tab === "spec" && <SpecPanel />}
      </div>

      <GateOverlay />

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 p-2 backdrop-blur sm:hidden">
        <div className="grid grid-cols-6 gap-1">
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
  const isConfigured = useSafeBuy((s) => s.isConfigured);

  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Track 01 · Agentic commerce</p>
        <h1 className="font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">SafeBuy</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">
          A bounded AI buyer. Policy guardrails and pre-debit notice gate money movement. Merchant catalog and bank SMS are synthetic. Razorpay test-mode is the real debit.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={mandate?.status === "active" ? "ok" : "neutral"}>
          {mandate ? `Policy ${mandate.status}` : "No policy"}
        </Badge>
        <Badge tone={phase === "pending" ? "warn" : phase === "confirmed" ? "ok" : phase === "failed" ? "bad" : "neutral"}>
          {phase === "pending" ? "PENDING · verifying status" : phase}
        </Badge>
        <Badge tone={isConfigured ? "ok" : "warn"}>
          {isConfigured ? "Razorpay Test Live" : "Keys Missing"}
        </Badge>
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
  const [days, setDays] = useState(7);
  const [authorized, setAuthorized] = useState(true);
  const [err, setErr] = useState("");

  const toggle = (c: Category) =>
    setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  async function submit() {
    setErr("");
    if (cats.length === 0) {
      setErr("Pick at least one allowed category.");
      return;
    }
    if (!authorized) {
      setErr("Please acknowledge policy authorization.");
      return;
    }
    await useSafeBuy.getState().createMandate({
      maxAmountPaise: maxRupees * 100,
      categories: cats,
      brandsAllow: [],
      brandsDeny: deny
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      maxQuantityPerItem: qty,
      priceCeilingPerItemPaise: ceiling * 100,
      validityDays: days,
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-[var(--radius-xl)] border border-border bg-surface p-5 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-2xl">Structured spending policy</h2>
          <LayerBadge layer="live" />
        </div>
        <p className="mt-2 text-sm text-muted">
          This policy is the source of truth. The deterministic guardrail strictly validates cart proposals against this schema before any payment rail is contacted.
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
          <Field label="Policy validity (days)">
            <input
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="field"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Deny brands (comma-separated)">
              <input value={deny} onChange={(e) => setDeny(e.target.value)} placeholder="Cadbury" className="field" />
            </Field>
          </div>
        </div>

        <p className="mt-4 text-xs uppercase tracking-wider text-subtle">Permitted Categories</p>
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
            <p className="text-sm font-medium">Policy Registration Authentication</p>
            <LayerBadge layer="synthetic" />
          </div>
          <p className="mt-1 text-xs text-muted">
            Stands in for initial registration-time authentication (e-mandate / AFA registration).
          </p>
          <label className="mt-3 flex cursor-pointer items-start gap-3 text-xs text-foreground">
            <input
              type="checkbox"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              I authorize this autonomous spending policy for Nila Kirana within stated limits. Future debits require pre-debit notices.
            </span>
          </label>
        </div>

        {err ? <p className="mt-3 text-sm text-danger">{err}</p> : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => void submit()}>Establish spending policy</Button>
          {mandate?.status === "active" ? (
            <Button variant="outline" onClick={() => void useSafeBuy.getState().revokeMandate()}>
              Revoke policy (future-only)
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
        No active spending policy. The autonomous buyer cannot purchase without policy limits.
      </aside>
    );
  }
  return (
    <aside className="rounded-[var(--radius-xl)] border border-border bg-surface p-6">
      <h3 className="font-display text-xl">Active Policy Schema</h3>
      <dl className="mt-4 space-y-2 font-mono text-xs">
        <Row k="policy_id" v={mandate.id} />
        <Row k="status" v={mandate.status} />
        <Row k="max_cap" v={paiseToInr(mandate.maxAmountPaise)} />
        <Row k="remaining" v={paiseToInr(mandate.remainingPaise)} />
        <Row k="categories" v={mandate.categories.join(", ")} />
        <Row k="denied_brands" v={mandate.brandsDeny.join(", ") || "—"} />
        <Row k="valid_until" v={new Date(mandate.validUntil).toLocaleDateString()} />
        <Row k="auth_method" v={mandate.authorizationMethod} />
      </dl>
    </aside>
  );
}

function BuyPanel({ onNeedMandate }: { onNeedMandate: () => void }) {
  const mandate = useSafeBuy((s) => s.mandate);
  const phase = useSafeBuy((s) => s.phase);
  const chat = useSafeBuy((s) => s.chat);
  const pending = useSafeBuy((s) => s.pendingCart);
  const intent = useSafeBuy((s) => s.pendingIntent);
  const stockOverride = useSafeBuy((s) => s.stockOverride);
  const [text, setText] = useState("Buy 1 kg basmati under ₹150");
  const [busy, setBusy] = useState(false);
  const meta = merchantMeta();

  const isExecuting = ["planning", "window", "execute", "pending"].includes(phase);

  async function send(customText?: string) {
    if (!mandate) {
      onNeedMandate();
      return;
    }
    const query = customText ?? text;
    setBusy(true);
    try {
      await useSafeBuy.getState().runInstruction(query);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section className="flex min-h-[30rem] flex-col rounded-[var(--radius-xl)] border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-display text-xl">Autonomous Buyer</h2>
            <p className="text-xs text-muted">Instruction → structured intent → plan → guardrail → pre-debit notice → Razorpay</p>
          </div>
          <LayerBadge layer="live" />
        </div>

        {/* Golden Utterance Chips */}
        <div className="border-b border-border bg-elevated/40 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">
            <Sparkles className="size-3 text-primary" /> Test Utterances
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {GOLDEN_UTTERANCES.map((u) => (
              <button
                key={u.label}
                onClick={() => {
                  setText(u.text);
                  void send(u.text);
                }}
                disabled={busy || isExecuting}
                className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                title={u.desc}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {chat.length === 0 ? (
            <p className="text-sm text-muted">Establish a policy, then send a purchase instruction.</p>
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
              <p className="text-xs uppercase tracking-wider text-subtle">Candidate Cart</p>
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
            disabled={busy || isExecuting}
          />
          <Button type="submit" disabled={busy || isExecuting}>
            {busy ? "Planning" : isExecuting ? phase : "Send"}
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
          {CATALOG.map((i) => {
            const stock = liveStock(i.sku, stockOverride);
            return (
              <li key={i.sku} className={`rounded-[var(--radius-sm)] border p-3 ${stock === 0 ? "border-danger/30 bg-danger/5 opacity-60" : "border-border"}`}>
                <div className="flex justify-between gap-2 text-sm font-medium">
                  <span>{i.name}</span>
                  <span className="font-mono tabular-nums">{paiseToInr(i.pricePaise)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-subtle">
                  <span>{i.brand} · {i.category} · {i.unit}</span>
                  <span className={stock === 0 ? "text-danger font-semibold" : ""}>
                    {stock === 0 ? "Out of Stock" : `${stock} in stock`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}

function OrdersPanel() {
  const merchantOrders = useSafeBuy((s) => s.merchantOrders);
  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl">Merchant Orders & Stock Reservations</h2>
        <LayerBadge layer="live" />
      </div>
      <p className="mt-1 text-sm text-muted">
        Every purchase proposal creates a durable Merchant Order that reserves stock before notify and settles upon payment capture.
      </p>
      <div className="mt-5 space-y-3">
        {merchantOrders.length === 0 ? (
          <p className="text-sm text-muted">No merchant orders created yet.</p>
        ) : (
          [...merchantOrders].reverse().map((mo) => (
            <div key={mo.id} className="rounded-[var(--radius-md)] border border-border bg-elevated p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">#{mo.id}</span>
                  <Badge tone={mo.status === "paid" ? "ok" : mo.status === "reserved" ? "warn" : "bad"}>
                    {mo.status.toUpperCase()}
                  </Badge>
                </div>
                <span className="font-mono font-medium">{paiseToInr(mo.totalPaise)}</span>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-muted">
                {mo.lines.map((l) => (
                  <li key={l.sku} className="flex justify-between">
                    <span>{l.name} × {l.quantity}</span>
                    <span>{paiseToInr(l.linePaise)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-border/50 pt-2 text-[10px] font-mono text-subtle">
                <span>Reserved: {new Date(mo.reservedAt).toLocaleTimeString()}</span>
                {mo.paidAt ? <span>Paid: {new Date(mo.paidAt).toLocaleTimeString()}</span> : null}
                {mo.razorpayOrderId ? <span>RZP Order: {mo.razorpayOrderId}</span> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function AP2PrimitivesPanel() {
  const getAP2 = useSafeBuy((s) => s.getAP2Primitives);
  const ap2 = getAP2();

  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl">AP2 Primitive Documents</h2>
        <LayerBadge layer="live" />
      </div>
      <p className="mt-1 text-sm text-muted">
        Modelled after Google / Visa Agentic Payment Protocol (AP2) primitives: Intent Mandate, Cart Mandate, and Payment Mandate.
      </p>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="rounded-[var(--radius-md)] border border-border bg-elevated p-4">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h3 className="font-mono text-xs font-semibold">1. AP2 Intent Mandate</h3>
            <Badge tone="ok">Policy</Badge>
          </div>
          <pre className="mt-3 overflow-x-auto text-[11px] font-mono text-muted">
            {ap2.intentMandate ? JSON.stringify(ap2.intentMandate, null, 2) : "// No active intent mandate"}
          </pre>
        </div>

        <div className="rounded-[var(--radius-md)] border border-border bg-elevated p-4">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h3 className="font-mono text-xs font-semibold">2. AP2 Cart Mandate</h3>
            <Badge tone="warn">Locked Cart</Badge>
          </div>
          <pre className="mt-3 overflow-x-auto text-[11px] font-mono text-muted">
            {ap2.cartMandate ? JSON.stringify(ap2.cartMandate, null, 2) : "// No active cart mandate"}
          </pre>
        </div>

        <div className="rounded-[var(--radius-md)] border border-border bg-elevated p-4">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h3 className="font-mono text-xs font-semibold">3. AP2 Payment Mandate</h3>
            <Badge tone="neutral">Settlement</Badge>
          </div>
          <pre className="mt-3 overflow-x-auto text-[11px] font-mono text-muted">
            {ap2.paymentMandate ? JSON.stringify(ap2.paymentMandate, null, 2) : "// No active payment mandate"}
          </pre>
        </div>
      </div>
    </section>
  );
}

function AuditPanel() {
  const audit = useSafeBuy((s) => s.audit);
  const [verifyState, setVerifyState] = useState<ChainVerificationResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  async function checkChain() {
    setIsVerifying(true);
    try {
      const res = await verifyAuditChain(audit);
      setVerifyState(res);
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-2xl">Hash-chained audit</h2>
            <LayerBadge layer="live" />
          </div>
          <p className="mt-1 text-sm text-muted">
            Append-only. Each record hashes the previous hash plus canonical JSON. Cryptographically verifiable.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void checkChain()} disabled={isVerifying || audit.length === 0}>
          {isVerifying ? "Verifying..." : "Verify Audit Chain"}
        </Button>
      </div>

      {verifyState ? (
        <div
          className={`mt-4 flex items-center gap-3 rounded-[var(--radius-md)] border p-3 text-xs ${
            verifyState.valid
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          {verifyState.valid ? (
            <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
          ) : (
            <XCircle className="size-4 shrink-0 text-rose-400" />
          )}
          <span>
            {verifyState.valid
              ? `Cryptographic Chain Verified: All ${verifyState.totalRecords} records form an unbroken, untampered SHA-256 hash sequence from genesis.`
              : `Audit Verification Failed: ${verifyState.error}`}
          </span>
        </div>
      ) : null}

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
    { id: "none", title: "Happy path", detail: "Real Razorpay Orders + Checkout + status fetch reconciliation." },
    { id: "soft_decline", title: "Soft decline", detail: "Fetch status before retry. Stops safely at 1 retry. Test card: 4000 0000 0000 1003." },
    { id: "stock_race", title: "Stock race", detail: "SKU drops to 0 after discovery. Automatically seeks next-best in-mandate item." },
    { id: "semantic_mismatch", title: "LLM mismatch", detail: "Proposes chocolate for rice instruction. Guardrail halts for human confirm." },
    { id: "afa_threshold", title: "Above ₹15k", detail: "Requires explicit human re-confirm. No silent debit above RBI threshold." },
    { id: "revoke_in_window", title: "Revoke in window", detail: "Future blocked; in-flight still completes under previously valid policy." },
  ];
  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-surface p-5">
      <h2 className="font-display text-2xl">Failure lab & Rail Simulation</h2>
      <p className="mt-1 text-sm text-muted">Inject an edge case scenario, then send a purchase instruction in the Buy panel.</p>

      <div className="mt-4 rounded-[var(--radius-md)] border border-border bg-elevated/50 p-3">
        <p className="text-xs font-medium uppercase tracking-wider text-subtle">Razorpay Test Cards</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-mono">
          <span className="rounded bg-surface px-2.5 py-1 text-emerald-400 border border-emerald-500/30">
            Success: 4111 1111 1111 1111 (Exp: 12/30, CVV: 123)
          </span>
          <span className="rounded bg-surface px-2.5 py-1 text-amber-400 border border-amber-500/30">
            Soft Decline: 4000 0000 0000 1003 (Exp: 12/30, CVV: 123)
          </span>
        </div>
      </div>

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
          These cannot be a fake payment screen. They are the safety protocol around an AI buyer.
        </p>
        <ul className="mt-4 space-y-3 text-sm">
          {[
            ["Structured Intent Mandate", "Human sets hard caps. Schema is the source of truth."],
            ["Deterministic semantic guardrail", "Diffs cart vs mandate + pack tokens before money."],
            ["Pre-Debit Notice Record & Window", "Durable notice record with dwell timer. Solves UAP/AP2 gap."],
            ["Real Razorpay test-mode debit", "Orders API + Checkout.js + status fetch/webhook reconciliation."],
            ["Merchant Order & Stock Reservation", "Durable merchant orders with reserved stock released on abort."],
            ["Hash-chained audit", "Append-only, signed with canonical JSON + SHA-256 prevHash."],
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
            ["Bank SMS notice", "Razorpay test-mode will not send RBI pre-debit SMS. We simulate the notice."],
            ["Registration AFA", "Simulated policy authorization standing in for bank e-mandate registration."],
            ["Compressed window (8s)", "8s dwell standing in for 24h RBI pre-debit window."],
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
            <h3 className="font-display text-xl">Pre-Debit Notice Active</h3>
            <LayerBadge layer="live" />
          </div>
          <p className="mt-2 text-xs font-mono text-subtle">
            Notice #{attempt?.noticeId ?? "not_active"} · Order #{attempt?.merchantOrderId ?? "mord_active"}
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {MERCHANT_NAME} · {cart.lines.map((l) => l.name).join(", ")} · {paiseToInr(cart.totalPaise)}
          </p>
          <p className="mt-2 text-xs text-subtle">
            Pre-debit dwell window standing in for RBI notify-then-execute. After this window, Razorpay test Order executes.
          </p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-elevated">
            <div className="h-full bg-primary transition-all duration-200" style={{ width: `${pct * 100}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-mono tabular-nums text-foreground">
              <Clock className="size-3.5" /> {(left / 1000).toFixed(1)}s remaining
            </span>
            <button
              onClick={() => useSafeBuy.getState().extendWindow(5000)}
              className="text-xs text-primary hover:underline"
            >
              +5s Hold/Extend
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => void useSafeBuy.getState().proceedNow()}>
              Proceed Now
            </Button>
            <Button variant="outline" size="sm" onClick={() => void useSafeBuy.getState().abortPending("User aborted during pre-debit window.")}>
              Abort
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "needs_confirm" && cart) {
    const isAfa = attempt?.failure === "afa_threshold";
    return (
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-bg/70 p-4 sm:items-center">
        <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-border bg-surface p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-warn" />
            <h3 className="font-display text-xl">
              {isAfa ? "AFA Confirmation Required" : "Intent Mismatch Detected"}
            </h3>
          </div>
          <p className="mt-2 text-sm text-muted">
            {isAfa
              ? "Amount is above the ₹15,000 AFA-exempt threshold. Extra human confirmation is required."
              : `The proposed cart (${cart.lines.map((l) => l.name).join(", ")}) does not match your specific search keywords. Confirm override to proceed.`}
          </p>
          <p className="mt-2 font-mono text-lg font-semibold">{paiseToInr(cart.totalPaise)}</p>
          <div className="mt-4 flex gap-2">
            <Button
              onClick={() => {
                if (isAfa) {
                  void useSafeBuy.getState().confirmAfaOverride();
                } else {
                  void useSafeBuy.getState().confirmSemanticOverride();
                }
              }}
            >
              Confirm & Proceed
            </Button>
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

  if (phase === "pending") {
    return (
      <div className="fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-[var(--radius-md)] border border-amber-500/30 bg-surface px-3 py-2 text-xs text-amber-200 shadow-lg sm:bottom-6">
        <Clock className="size-4 animate-spin text-amber-400" />
        <span>Verifying payment status with Razorpay (reconciliation loop)...</span>
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

    if (!order.ok || !order.orderId) {
      await st.failClosed(order.error || "Order creation failed. Live Checkout requires a valid Razorpay Order ID.");
      return;
    }

    await st.appendAudit({
      correlationId: st.correlationId ?? "",
      phase: "execute",
      event: "razorpay.order_created",
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
      onSuccess: async (p) => {
        if (p.razorpay_signature) {
          const sigRes = await verifyCheckoutSignature({
            data: {
              orderId: p.razorpay_order_id ?? order.orderId,
              paymentId: p.razorpay_payment_id,
              signature: p.razorpay_signature,
            },
          });
          if (!sigRes.ok) {
            await st.failClosed("HMAC signature verification failed on Checkout response.");
            return;
          }
        }
        await st.handleHandlerReceived(p.razorpay_payment_id, p.razorpay_order_id ?? order.orderId, p.razorpay_signature);
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
1. Structured Spending Policy Mandate (schema: maxAmountPaise, categories, brandsAllow/Deny, maxQuantityPerItem, priceCeilingPerItemPaise, validity period).
2. Deterministic semantic guardrail that diffs the proposed cart against schema & pack tokens.
3. Pre-Debit Notice record + Dwell Window gate. No silent debit.
4. Actual Razorpay test-mode money movement: Checkout.js and Orders API when key_secret exists. Backend fetch status / webhook is source of truth for "completed".
5. Merchant Order & stock reservation lifecycle.
6. Hash-chained append-only audit of every money action (canonical JSON + SHA-256 prevHash).
7. Fail-closed on timeout/dismiss/ambiguous status.

B. MAY BE SYNTHETIC (stage props so A can be demonstrated):
1. Merchant catalog (Nila Kirana) — agent-readable SKUs, not a live store.
2. Bank pre-debit SMS — simulated notice standing in for 24h RBI window.
3. Policy registration authentication — simulated registration auth standing in for bank e-mandate registration.
4. Lab injections of failures.

UI: dark editorial, no purple, no emoji in chrome, LIVE vs SYNTHETIC badges on every relevant surface.`;
