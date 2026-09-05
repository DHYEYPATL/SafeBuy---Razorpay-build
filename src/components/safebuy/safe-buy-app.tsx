import { useEffect, useState, useRef, useMemo } from "react";
import {
  Shield,
  ScrollText,
  FlaskConical,
  KeyRound,
  Check,
  Clock,
  FileCode2,
  Store,
  Sparkles,
  Users,
  ArrowRight,
  Send,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  CreditCard,
  ShieldCheck,
  RotateCcw,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LayerBadge } from "./layer-badge";
import {
  CATEGORIES,
  DEMO_NOTIFY_WINDOW_MS,
  MERCHANT_NAME,
  MERCHANT_ID,
  type LabInject,
} from "@/lib/safebuy/types";
import { CATALOG, TECH_CATALOG, getItem } from "@/lib/safebuy/catalog";
import { useSafeBuy } from "@/lib/safebuy/store";
import { paiseToInr } from "@/lib/utils";
import { createRazorpayOrder, getRazorpayPublicKey } from "@/lib/safebuy/razorpay-api";
import { openRazorpayCheckout } from "@/lib/safebuy/checkout";
import { verifyAuditChain, type ChainVerificationResult } from "@/lib/safebuy/hash";
import { listRegisteredAgents } from "@/lib/safebuy/identity";

export type MainTab =
  | "shopping"
  | "mandate"
  | "orders"
  | "audit"
  | "lab"
  | "ap2"
  | "agents";

export function SafeBuyApp() {
  const [tab, setTab] = useState<MainTab>("shopping");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const phase = useSafeBuy((s) => s.phase);
  const checkoutOpenedRef = useRef(false);

  useEffect(() => {
    void getRazorpayPublicKey().then((k) => {
      useSafeBuy.getState().setRazorpayKeyDetails({
        keyId: k.keyId,
        hasSecret: k.hasSecret,
        configured: k.configured,
      });
    });
    useSafeBuy.getState().ensureDefaultMandate();
  }, []);

  useEffect(() => {
    if (phase !== "window") return;
    const t = setInterval(() => useSafeBuy.getState().tickWindow(), 250);
    return () => clearInterval(t);
  }, [phase]);

  // Once-guarded execute effect for Razorpay checkout
  useEffect(() => {
    if (phase === "execute" && !checkoutOpenedRef.current) {
      checkoutOpenedRef.current = true;
      void openLiveCheckout().finally(() => {
        checkoutOpenedRef.current = false;
      });
    }
  }, [phase]);

  return (
    <div className="min-h-screen bg-[#090a0f] text-[#f1f5f9] flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Top Header */}
      <Header onToggleMobileNav={() => setMobileMenuOpen(!mobileMenuOpen)} onSelectTab={setTab} />

      {/* Main 2-Column Dashboard Container */}
      <div className="flex-1 w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[230px_1fr] gap-0">
        {/* Left Navigation Sidebar */}
        <aside
          className={`border-r border-white/5 bg-[#0b0d13]/90 lg:block ${
            mobileMenuOpen ? "block fixed inset-y-0 left-0 z-50 w-72 bg-[#0c0e14] shadow-2xl" : "hidden"
          } lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] overflow-y-auto`}
        >
          <LeftSidebar
            activeTab={tab}
            onSelectTab={(t) => {
              setTab(t);
              setMobileMenuOpen(false);
            }}
          />
        </aside>

        {/* Center Main Stage Panel */}
        <main className="min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto min-h-[calc(100vh-3.5rem)]">
          {tab === "shopping" && (
            <AIShoppingPanel
              onViewOrders={() => setTab("orders")}
              onViewAudit={() => setTab("audit")}
            />
          )}
          {tab === "mandate" && <MandatePanel />}
          {tab === "orders" && <OrdersPanel onStartShopping={() => setTab("shopping")} />}
          {tab === "audit" && <AuditPanel />}
          {tab === "lab" && <LabPanel />}
          {tab === "ap2" && <AP2PrimitivesPanel />}
          {tab === "agents" && <AgentRegistryPanel />}
        </main>
      </div>

      {/* Prominent Regulatory Pre-Debit Gate Modal */}
      <GateOverlay />
    </div>
  );
}

/* =========================================================================
   TOP HEADER COMPONENT
   ========================================================================= */

function Header({
  onToggleMobileNav,
  onSelectTab,
}: {
  onToggleMobileNav: () => void;
  onSelectTab: (t: MainTab) => void;
}) {
  const mandate = useSafeBuy((s) => s.mandate);
  const isConfigured = useSafeBuy((s) => s.isConfigured);
  const resetDemo = useSafeBuy((s) => s.resetDemo);

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-white/5 bg-[#090a0f]/90 backdrop-blur-xl px-4 sm:px-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleMobileNav}
          className="lg:hidden p-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-white"
          aria-label="Toggle Navigation"
        >
          <SlidersHorizontal className="size-4" />
        </button>

        <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => onSelectTab("shopping")}>
          <div className="size-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold shadow-lg shadow-emerald-500/10">
            <Sparkles className="size-4.5 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-base tracking-tight text-white">{MERCHANT_NAME}</span>
              <span className="text-[10px] uppercase font-mono tracking-widest px-1.5 py-0.5 rounded bg-white/5 text-zinc-400 border border-white/5">
                BOUNDED AI BUYER
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Header Right Indicators */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Mandate Remaining Display */}
        {mandate ? (
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[#12151e] border border-white/10 text-xs">
            <span className="text-zinc-400 text-[11px]">Mandate:</span>
            <span className="font-mono font-semibold text-emerald-400">{paiseToInr(mandate.remainingPaise)}</span>
            <LayerBadge layer="live" />
          </div>
        ) : null}

        {/* Razorpay Test Status */}
        <div
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono ${
            isConfigured
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-amber-500/10 border-amber-500/30 text-amber-300"
          }`}
        >
          <CreditCard className="size-3.5" />
          <span>{isConfigured ? "Razorpay Test Live" : "Razorpay Test Mode"}</span>
        </div>

        {/* Reset Demo Button */}
        <button
          onClick={resetDemo}
          title="Reset demo data to initial state"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-400 hover:text-white text-[11px] font-mono transition-colors"
        >
          <RotateCcw className="size-3" />
          <span className="hidden md:inline">Reset State</span>
        </button>
      </div>
    </header>
  );
}

/* =========================================================================
   LEFT SIDEBAR NAVIGATION (FOCUSED 4-TAB PRIMARY IA + ADVANCED OVERFLOW)
   ========================================================================= */

function LeftSidebar({
  activeTab,
  onSelectTab,
}: {
  activeTab: MainTab;
  onSelectTab: (t: MainTab) => void;
}) {
  const recentQueries = useSafeBuy((s) => s.recentQueries);
  const clearRecentQueries = useSafeBuy((s) => s.clearRecentQueries);
  const runInstruction = useSafeBuy((s) => s.runInstruction);
  const resetDemo = useSafeBuy((s) => s.resetDemo);

  const navGroups = [
    {
      group: "PRIMARY RAIL",
      items: [
        { id: "shopping" as MainTab, label: "Buy / Assistant", icon: Sparkles },
        { id: "mandate" as MainTab, label: "Mandate Policy", icon: KeyRound },
        { id: "orders" as MainTab, label: "Orders & GMV", icon: Store },
        { id: "audit" as MainTab, label: "Audit Ledger", icon: ScrollText },
      ],
    },
    {
      group: "ADVANCED TOOLS",
      items: [
        { id: "lab" as MainTab, label: "Failure Lab", icon: FlaskConical },
        { id: "ap2" as MainTab, label: "AP2 Primitives", icon: FileCode2 },
        { id: "agents" as MainTab, label: "Agent Pattern", icon: Users },
      ],
    },
  ];

  return (
    <div className="flex flex-col h-full justify-between p-3.5 text-sm">
      <div className="space-y-5">
        {navGroups.map((g) => (
          <div key={g.group} className="space-y-1">
            <p className="px-2 text-[10px] font-mono uppercase tracking-widest text-zinc-500 font-semibold">{g.group}</p>
            <div className="space-y-0.5 pt-1">
              {g.items.map((item) => {
                const isActive = activeTab === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectTab(item.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`size-3.5 ${isActive ? "text-emerald-400" : "text-zinc-400"}`} />
                      <span>{item.label}</span>
                    </div>
                    {isActive ? (
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Quick queries */}
        <div className="space-y-2 pt-2 border-t border-white/5">
          <div className="flex items-center justify-between px-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 font-semibold">RECENT</span>
            {recentQueries.length > 0 && (
              <button
                onClick={clearRecentQueries}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
            {recentQueries.slice(0, 4).map((q, idx) => (
              <button
                key={idx}
                onClick={() => {
                  onSelectTab("shopping");
                  void runInstruction(q);
                }}
                className="w-full text-left px-2 py-1.5 rounded text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-white/5 truncate transition-colors flex items-center gap-1.5"
                title={q}
              >
                <span className="text-zinc-500">⚬</span>
                <span className="truncate">{q}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer Reset & Version */}
      <div className="pt-3 border-t border-white/5 space-y-2">
        <button
          onClick={resetDemo}
          className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-[11px] font-mono transition-colors"
        >
          <RotateCcw className="size-3" />
          <span>Reset Demo State</span>
        </button>
        <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono px-1">
          <span>Track 01 · Option B</span>
          <span>Razorpay Bounded AI</span>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   CENTER VIEW 1: AI SHOPPING ASSISTANT & ORDER ENVELOPE PANEL
   ========================================================================= */

function AIShoppingPanel({
  onViewOrders,
  onViewAudit,
}: {
  onViewOrders: () => void;
  onViewAudit: () => void;
}) {
  const [inputText, setInputText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const chat = useSafeBuy((s) => s.chat);
  const pendingCart = useSafeBuy((s) => s.pendingCart);
  const mandate = useSafeBuy((s) => s.mandate);
  const phase = useSafeBuy((s) => s.phase);
  const lastConfirmedOrder = useSafeBuy((s) => s.lastConfirmedOrder);
  const runInstruction = useSafeBuy((s) => s.runInstruction);

  const QUICK_PROMPTS = [
    {
      title: "BUY UNDER MANDATE (₹1,490)",
      prompt: "Buy 100W USB-C cable under ₹1,500",
      icon: ArrowRight,
    },
    {
      title: "BUY ACCESSORY (₹4,990)",
      prompt: "Buy Anker 7-in-1 USB-C Hub",
      icon: Plus,
    },
    {
      title: "TEST AFA THRESHOLD (>₹15k)",
      prompt: "Buy Sony WH-1000XM5 headphones",
      icon: Shield,
    },
  ];

  async function handleSendPrompt(promptStr?: string) {
    const textToSend = promptStr || inputText;
    if (!textToSend.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setInputText("");
    try {
      await runInstruction(textToSend);
    } finally {
      setIsSubmitting(false);
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto space-y-6 pb-28">
      {/* Welcome Hero Header */}
      <div className="text-center py-6 space-y-2">
        <div className="inline-flex p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-2 shadow-xl shadow-emerald-500/10">
          <Sparkles className="size-6 text-emerald-400" />
        </div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">
          {MERCHANT_NAME}
        </h1>
        <p className="text-xs font-mono tracking-widest text-emerald-400 uppercase font-semibold">
          BOUNDED AI COMMERCE ASSISTANT · TRACK 01
        </p>
        <p className="text-sm text-zinc-400 max-w-md mx-auto">
          Instruct the AI buyer under strict spending policies and deterministic guardrails.
        </p>
      </div>

      {/* 3 Clean Quick Action Cards (Shown on Fresh Screen) */}
      {chat.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {QUICK_PROMPTS.map((q, idx) => {
            const Icon = q.icon;
            return (
              <button
                key={idx}
                onClick={() => void handleSendPrompt(q.prompt)}
                className="text-left p-4 rounded-xl bg-[#11131c]/80 hover:bg-[#161925] border border-white/5 hover:border-emerald-500/30 transition-all group"
              >
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-zinc-400 group-hover:text-emerald-400 mb-1.5">
                  <Icon className="size-3 text-zinc-400 group-hover:text-emerald-400" />
                  <span>{q.title}</span>
                </div>
                <p className="text-xs font-medium text-zinc-200 group-hover:text-white line-clamp-2">
                  "{q.prompt}"
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Order Confirmed Landing Card */}
      {phase === "confirmed" && lastConfirmedOrder && (
        <div className="p-6 rounded-2xl bg-gradient-to-b from-emerald-950/40 to-[#0d1017] border border-emerald-500/40 text-center space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
          <div className="size-14 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mx-auto text-emerald-300 shadow-xl shadow-emerald-500/30">
            <Check className="size-7 stroke-[3]" />
          </div>

          <div className="space-y-1">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-emerald-400">ORDER CONFIRMED & SETTLED</span>
            <h2 className="text-xl font-bold text-white">{lastConfirmedOrder.name}</h2>
            <p className="text-2xl font-mono font-extrabold text-emerald-300">{paiseToInr(lastConfirmedOrder.amountPaise)}</p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 font-mono text-zinc-300">
              <span className="text-zinc-500">ORDER ID: </span>
              <span className="text-emerald-300">{lastConfirmedOrder.orderId}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <Check className="size-3.5" />
              <span>Razorpay Captured</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              onClick={onViewOrders}
              className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-xs px-4 py-2"
            >
              View in Orders & GMV
            </Button>
            <Button
              variant="outline"
              onClick={onViewAudit}
              className="border-white/10 text-zinc-300 hover:bg-white/10 text-xs px-4 py-2"
            >
              Verify Audit Chain
            </Button>
          </div>
        </div>
      )}

      {/* Chat Messages Thread */}
      {chat.length > 0 && (
        <div className="space-y-4">
          {chat.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-100"
                    : msg.role === "system"
                    ? "bg-[#141722] border border-white/10 text-zinc-300 font-mono text-xs"
                    : "bg-[#11131c] border border-white/10 text-zinc-200"
                }`}
              >
                {msg.role === "agent" && (
                  <div className="flex items-center gap-1.5 text-emerald-400 font-mono text-[10px] uppercase font-bold tracking-wider mb-1.5">
                    <Sparkles className="size-3" />
                    <span>SafeBuy Assistant</span>
                  </div>
                )}
                <div className="whitespace-pre-wrap">{msg.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PROPOSED ORDER ENVELOPE (SINGLE CANDIDATE CART WITH ONE AUTHORIZE CTA) */}
      {pendingCart && phase !== "confirmed" && (
        <div className="p-5 rounded-2xl bg-[#0f121d] border border-emerald-500/40 space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <ShieldCheck className="size-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono uppercase font-bold text-emerald-400">PROPOSED ORDER ENVELOPE</span>
                  <LayerBadge layer="live" />
                </div>
                <p className="text-[11px] text-zinc-400">Deterministic Guardrail Checked</p>
              </div>
            </div>
            <span className="font-mono text-lg font-bold text-emerald-300">
              {paiseToInr(pendingCart.totalPaise)}
            </span>
          </div>

          <div className="divide-y divide-white/5 border-y border-white/5 py-1">
            {pendingCart.lines.map((line, idx) => (
              <div key={idx} className="flex items-center justify-between py-2 text-xs">
                <div className="space-y-0.5">
                  <p className="font-semibold text-white">{line.name}</p>
                  <p className="text-[11px] font-mono text-zinc-400">SKU: {line.sku} · Qty: {line.quantity}</p>
                </div>
                <span className="font-mono font-bold text-white">{paiseToInr(line.linePaise)}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              <span>Mandate Cap: {mandate ? paiseToInr(mandate.remainingPaise) : "₹1,500"}</span>
            </div>

            <Button
              onClick={() => void useSafeBuy.getState().proceedCandidateCart()}
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs h-9 px-5 shadow-lg shadow-emerald-500/20 flex items-center gap-2"
            >
              <span>Authorize under Mandate</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div ref={chatBottomRef} />

      {/* Clean Sticky Bottom Chat & Quick Prompts Bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-[#090a0f]/95 backdrop-blur-xl border-t border-white/10 px-4 py-3 sm:px-8">
        <div className="max-w-3xl mx-auto space-y-2">
          {/* Main Chat Prompt Input Field */}
          <div className="relative flex items-center">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendPrompt();
                }
              }}
              placeholder="+ Ask SafeBuy anything... (e.g. 'Buy 100W USB-C cable under ₹1,500')"
              className="w-full h-11 pl-4 pr-20 rounded-xl bg-[#121520] border border-white/10 focus:border-emerald-500/50 text-xs text-white placeholder:text-zinc-500 outline-none shadow-inner transition-all"
            />

            <div className="absolute right-1.5 flex items-center">
              <Button
                onClick={() => void handleSendPrompt()}
                disabled={!inputText.trim() || isSubmitting}
                className="h-8 px-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-semibold text-xs transition-all flex items-center gap-1.5"
              >
                <span>Send</span>
                <Send className="size-3" />
              </Button>
            </div>
          </div>

          {/* Quick Prompt Chips */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => void handleSendPrompt("Buy 100W USB-C cable under ₹1,500")}
                className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/5 transition-colors"
              >
                Buy 100W Cable (&lt;₹1,500)
              </button>
              <button
                onClick={() => void handleSendPrompt("Buy Anker 7-in-1 USB-C Hub")}
                className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/5 transition-colors"
              >
                Buy Anker Hub (₹4,990)
              </button>
              <button
                onClick={() => void handleSendPrompt("Buy Sony WH-1000XM5 headphones")}
                className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/5 transition-colors"
              >
                Test AFA Gate (&gt;₹15k)
              </button>
            </div>

            <span className="hidden sm:inline font-mono text-[10px] text-zinc-500">
              Deterministic Guardrail · Real Razorpay Orders API
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   CENTER VIEW 2: SPENDING POLICY MANDATE PANEL
   ========================================================================= */

function MandatePanel() {
  const mandate = useSafeBuy((s) => s.mandate);
  const [maxRupees, setMaxRupees] = useState(mandate ? Math.round(mandate.maxAmountPaise / 100) : 1500);
  const [ceilingRupees, setCeilingRupees] = useState(
    mandate ? Math.round(mandate.priceCeilingPerItemPaise / 100) : 1500,
  );
  const [deny, setDeny] = useState(mandate?.brandsDeny?.join(", ") || "");
  const [authorized, setAuthorized] = useState(true);

  // Sync state if mandate is re-hydrated or reset
  useEffect(() => {
    if (mandate) {
      setMaxRupees(Math.round(mandate.maxAmountPaise / 100));
      setCeilingRupees(Math.round(mandate.priceCeilingPerItemPaise / 100));
      setDeny(mandate.brandsDeny?.join(", ") || "");
    }
  }, [mandate]);

  async function updateMandate() {
    await useSafeBuy.getState().createMandate({
      maxAmountPaise: maxRupees * 100,
      categories: [...CATEGORIES],
      brandsAllow: [],
      brandsDeny: deny.split(",").map((s) => s.trim()).filter(Boolean),
      maxQuantityPerItem: 5,
      priceCeilingPerItemPaise: ceilingRupees * 100,
      validityDays: 30,
    });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Mandate Policy</h1>
          <LayerBadge layer="live" />
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Configure financial limits and brand constraints for autonomous agent transactions (Demo default: ₹1,500 budget).
        </p>
      </div>

      <div className="p-6 rounded-2xl bg-[#0f1118] border border-white/10 space-y-5 shadow-lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Total Spend Budget (₹)</label>
            <input
              type="number"
              value={maxRupees}
              onChange={(e) => setMaxRupees(Number(e.target.value))}
              className="w-full h-10 px-3 rounded-xl bg-[#12141e] border border-white/10 text-xs text-white outline-none focus:border-emerald-500/50 font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Per-Item Ceiling (₹)</label>
            <input
              type="number"
              value={ceilingRupees}
              onChange={(e) => setCeilingRupees(Number(e.target.value))}
              className="w-full h-10 px-3 rounded-xl bg-[#12141e] border border-white/10 text-xs text-white outline-none focus:border-emerald-500/50 font-mono"
            />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <label className="text-xs text-zinc-400">Denied Brands (Comma-separated)</label>
            <input
              type="text"
              value={deny}
              onChange={(e) => setDeny(e.target.value)}
              placeholder="e.g. DeniedBrandName"
              className="w-full h-10 px-3 rounded-xl bg-[#12141e] border border-white/10 text-xs text-white outline-none focus:border-emerald-500/50 font-mono"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/5">
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
              id="auth-mandate"
              className="accent-emerald-500 size-4"
            />
            <label htmlFor="auth-mandate">Acknowledge simulated registration authorization</label>
            <LayerBadge layer="synthetic" />
          </div>
          <Button
            onClick={() => void updateMandate()}
            className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-xs px-5 h-9"
          >
            Save Mandate Policy
          </Button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   CENTER VIEW 3: ORDERS & SETTLED GMV GROWTH PANEL
   ========================================================================= */

function OrdersPanel({ onStartShopping }: { onStartShopping: () => void }) {
  const merchantOrders = useSafeBuy((s) => s.merchantOrders);
  const attempts = useSafeBuy((s) => s.attempts);

  const paidOrders = useMemo(() => merchantOrders.filter((mo) => mo.status === "paid"), [merchantOrders]);
  const releasedOrders = useMemo(() => merchantOrders.filter((mo) => mo.status === "released"), [merchantOrders]);

  const totalGmvPaise = useMemo(
    () => paidOrders.reduce((sum, mo) => sum + mo.totalPaise, 0),
    [paidOrders],
  );
  const aovPaise = useMemo(
    () => (paidOrders.length > 0 ? Math.round(totalGmvPaise / paidOrders.length) : 0),
    [paidOrders, totalGmvPaise],
  );
  const verifiedCaptures = useMemo(
    () => attempts.filter((a) => a.razorpayStatus === "captured" || a.phase === "confirmed").length,
    [attempts],
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Orders & Settled GMV</h1>
          <LayerBadge layer="live" />
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Live financial reconciliation, captured GMV velocity, and verified Razorpay payment receipts.
        </p>
      </div>

      {/* Settled GMV & Growth Header Metric Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-[#0f1118] border border-white/10 space-y-1">
          <p className="text-[10px] font-mono uppercase text-zinc-500 font-semibold">SETTLED GMV</p>
          <p className="font-mono text-xl font-bold text-emerald-400">{paiseToInr(totalGmvPaise)}</p>
          <span className="text-[10px] text-zinc-500">Verified captured volume</span>
        </div>
        <div className="p-4 rounded-xl bg-[#0f1118] border border-white/10 space-y-1">
          <p className="text-[10px] font-mono uppercase text-zinc-500 font-semibold">ORDERS SETTLED</p>
          <p className="font-mono text-xl font-bold text-white">{paidOrders.length}</p>
          <span className="text-[10px] text-zinc-500">100% fail-closed safety</span>
        </div>
        <div className="p-4 rounded-xl bg-[#0f1118] border border-white/10 space-y-1">
          <p className="text-[10px] font-mono uppercase text-zinc-500 font-semibold">AVERAGE ORDER (AOV)</p>
          <p className="font-mono text-xl font-bold text-emerald-300">{paiseToInr(aovPaise)}</p>
          <span className="text-[10px] text-zinc-500">Bounded by policy cap</span>
        </div>
        <div className="p-4 rounded-xl bg-[#0f1118] border border-white/10 space-y-1">
          <p className="text-[10px] font-mono uppercase text-zinc-500 font-semibold">RAZORPAY CAPTURES</p>
          <p className="font-mono text-xl font-bold text-emerald-400">{verifiedCaptures}</p>
          <span className="text-[10px] text-zinc-500">Orders API v1</span>
        </div>
      </div>

      {paidOrders.length === 0 && releasedOrders.length === 0 ? (
        <div className="p-12 rounded-2xl bg-[#0e1017] border border-white/5 text-center space-y-4">
          <Store className="size-10 text-zinc-600 mx-auto" />
          <p className="text-sm text-zinc-400">No transactions recorded yet. Start an assistant purchase to test real checkout.</p>
          <Button onClick={onStartShopping} className="bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-semibold">
            Start Assistant Flow
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Paid Settled Orders Section */}
          {paidOrders.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-400 font-mono px-1">
                <span className="text-emerald-400 font-bold">SETTLED ORDERS ({paidOrders.length})</span>
                <span className="text-zinc-500 font-mono">100% Verified</span>
              </div>
              {paidOrders.map((mo) => {
                const attempt = attempts.find((a) => a.id === mo.attemptId);
                return (
                  <div key={mo.id} className="p-5 rounded-2xl bg-[#0f1118] border border-emerald-500/30 space-y-4 shadow-lg">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-mono uppercase text-zinc-400">ORDER ID</span>
                        <p className="font-mono text-xs font-bold text-white">{mo.id}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          PAID & SETTLED
                        </span>
                        <span className="font-mono font-bold text-sm text-emerald-400">{paiseToInr(mo.totalPaise)}</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {mo.lines.map((l, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs text-zinc-300">
                          <span>
                            {l.name} × {l.quantity}
                          </span>
                          <span className="font-mono text-zinc-400">{paiseToInr(l.linePaise)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-white/5 text-[11px] font-mono text-zinc-400">
                      <div>
                        <span>Razorpay Order: </span>
                        <span className="text-emerald-300">{attempt?.razorpayOrderId || mo.razorpayOrderId || "Pending"}</span>
                      </div>
                      <div>
                        <span>Settled At: </span>
                        <span className="text-zinc-200">{mo.paidAt ? new Date(mo.paidAt).toLocaleTimeString() : "Pending"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Released Stock Reservations Section */}
          {releasedOrders.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between text-xs text-zinc-400 font-mono px-1">
                <span className="text-amber-400 font-bold">RELEASED STOCK RESERVATIONS (FAIL-CLOSED: ₹0 DEBIT)</span>
                <span className="text-zinc-500">{releasedOrders.length} released</span>
              </div>
              {releasedOrders.map((mo) => (
                <div key={mo.id} className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-white font-bold">{mo.id}</span>
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 uppercase font-bold text-[10px]">
                      Stock Released · ₹0 Debited
                    </span>
                  </div>
                  <p className="text-zinc-300 font-sans">{mo.lines.map((l) => `${l.name} × ${l.quantity}`).join(", ")}</p>
                  <div className="flex items-center justify-between text-zinc-500 text-[11px]">
                    <span>Amount held: {paiseToInr(mo.totalPaise)}</span>
                    <span>Reverted: {mo.releasedAt ? new Date(mo.releasedAt).toLocaleTimeString() : "Immediate"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   CENTER VIEW 4: AUDIT TRAIL PANEL
   ========================================================================= */

function AuditPanel() {
  const audit = useSafeBuy((s) => s.audit);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<ChainVerificationResult | null>(null);

  async function verifyChain() {
    setVerifying(true);
    try {
      const res = await verifyAuditChain(audit);
      setResult(res);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Audit Ledger</h1>
            <LayerBadge layer="live" />
          </div>
          <p className="text-xs text-zinc-400 mt-1">Cryptographic SHA-256 hash-chained log of every state transition.</p>
        </div>
        <Button
          onClick={() => void verifyChain()}
          disabled={verifying}
          className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-xs h-9 px-4"
        >
          {verifying ? "Verifying..." : "Verify Hash Chain"}
        </Button>
      </div>

      {result && (
        <div
          className={`p-4 rounded-xl border text-xs font-mono ${
            result.valid
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-red-500/10 border-red-500/30 text-red-300"
          }`}
        >
          {result.valid
            ? `✓ Hash chain unbroken across all ${result.totalRecords} recorded blocks.`
            : `✗ Integrity failure: ${result.error}`}
        </div>
      )}

      <div className="space-y-2 max-h-[600px] overflow-y-auto">
        {audit.length === 0 ? (
          <p className="text-xs text-zinc-400 italic">No audit records recorded yet.</p>
        ) : (
          audit
            .slice()
            .reverse()
            .map((rec) => (
              <div key={rec.id} className="p-3.5 rounded-xl bg-[#0f1118] border border-white/5 space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-emerald-400 font-bold">
                    #{rec.seq} {rec.event}
                  </span>
                  <span className="text-zinc-500">{new Date(rec.ts).toLocaleTimeString()}</span>
                </div>
                <p className="text-zinc-300 font-sans text-xs">{rec.explain}</p>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500 truncate">
                  <span>Hash: {rec.hash.slice(0, 16)}...</span>
                  <span>Prev: {rec.prevHash.slice(0, 16)}...</span>
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   CENTER VIEW 5: FAILURE LAB & SECURITY INJECTION PANEL
   ========================================================================= */

function LabPanel() {
  const labInject = useSafeBuy((s) => s.labInject);
  const setLabInject = useSafeBuy((s) => s.setLabInject);
  const runInstruction = useSafeBuy((s) => s.runInstruction);

  const attacks: { id: LabInject; title: string; desc: string; prompt: string }[] = [
    {
      id: "none",
      title: "Compliant Baseline Execution",
      desc: "Standard bounded execution within mandate cap and category rules.",
      prompt: "Buy 100W USB-C cable under ₹1,500",
    },
    {
      id: "semantic_mismatch",
      title: "Semantic Prompt Injection",
      desc: "Agent attempts unauthorized SKU substitution blocked by deterministic guardrail.",
      prompt: "Get unauthorized luxury headphones with gaming mouse",
    },
    {
      id: "stock_race",
      title: "Stock Race Simulation",
      desc: "Requested SKU drops to 0 inventory immediately prior to reservation.",
      prompt: "Is the Logitech MX Master 3S in stock?",
    },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Failure Lab & Security</h1>
          <LayerBadge layer="live" />
        </div>
        <p className="text-xs text-zinc-400 mt-1">Test deterministic guardrails, stock race failover, and prompt injection defense.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {attacks.map((att) => {
          const isSelected = labInject === att.id;
          return (
            <div
              key={att.id}
              className={`p-4 rounded-xl bg-[#0f1118] border transition-all space-y-3 ${
                isSelected ? "border-amber-500/50 bg-amber-500/5" : "border-white/10 hover:border-white/20"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-xs text-white">{att.title}</h3>
                <span
                  className={`text-[9px] font-mono px-2 py-0.5 rounded uppercase font-bold ${
                    isSelected ? "bg-amber-500/20 text-amber-300" : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {att.id === "none" ? "Baseline" : isSelected ? "Armed" : "Ready"}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">{att.desc}</p>
              <div className="pt-1">
                <Button
                  onClick={() => {
                    setLabInject(att.id);
                    void runInstruction(att.prompt);
                  }}
                  className="w-full text-xs h-8 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold"
                >
                  Run Test
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =========================================================================
   CENTER VIEW 6: AP2 PRIMITIVES PROTOCOL FLOW
   ========================================================================= */

function AP2PrimitivesPanel() {
  const getAP2Primitives = useSafeBuy((s) => s.getAP2Primitives);
  const primitives = getAP2Primitives();

  const [showJson1, setShowJson1] = useState(false);
  const [showJson2, setShowJson2] = useState(false);
  const [showJson3, setShowJson3] = useState(false);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">AP2 Protocol Primitives</h1>
          <LayerBadge layer="live" />
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Agent Payment Protocol (AP2) cryptographically verifiable multi-phase mandates.
        </p>
      </div>

      <div className="space-y-4">
        {/* Step 1: Intent Mandate */}
        <div className="p-5 rounded-2xl bg-[#0f1118] border border-white/10 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="size-6 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-mono text-xs font-bold">
                1
              </span>
              <h3 className="font-bold text-sm text-white">Intent Mandate</h3>
            </div>
            <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold uppercase">
              Intent Captured
            </span>
          </div>

          <p className="text-xs text-zinc-300 leading-relaxed">
            Converts natural language user instructions into a bounded authorization envelope.
          </p>

          <div className="pt-1">
            <button
              onClick={() => setShowJson1(!showJson1)}
              className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
            >
              <span>{showJson1 ? "▾ Hide" : "▸ Show"} Raw Protocol Envelope</span>
            </button>
            {showJson1 && (
              <pre className="mt-2 p-3 rounded-xl bg-black/60 border border-white/10 text-[11px] font-mono text-zinc-300 overflow-x-auto">
                {JSON.stringify(primitives.intentMandate, null, 2)}
              </pre>
            )}
          </div>
        </div>

        {/* Step 2: Cart Mandate */}
        <div className="p-5 rounded-2xl bg-[#0f1118] border border-white/10 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="size-6 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-mono text-xs font-bold">
                2
              </span>
              <h3 className="font-bold text-sm text-white">Cart Mandate</h3>
            </div>
            <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold uppercase">
              SKU Grounded
            </span>
          </div>

          <p className="text-xs text-zinc-300 leading-relaxed">
            Binds the planned purchase to deterministic catalog SKUs, verified inventory reservations, and cart hashes.
          </p>

          <div className="pt-1">
            <button
              onClick={() => setShowJson2(!showJson2)}
              className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
            >
              <span>{showJson2 ? "▾ Hide" : "▸ Show"} Raw Protocol Envelope</span>
            </button>
            {showJson2 && (
              <pre className="mt-2 p-3 rounded-xl bg-black/60 border border-white/10 text-[11px] font-mono text-zinc-300 overflow-x-auto">
                {JSON.stringify(primitives.cartMandate, null, 2)}
              </pre>
            )}
          </div>
        </div>

        {/* Step 3: Payment Mandate */}
        <div className="p-5 rounded-2xl bg-[#0f1118] border border-white/10 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="size-6 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-mono text-xs font-bold">
                3
              </span>
              <h3 className="font-bold text-sm text-white">Payment Mandate</h3>
            </div>
            <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold uppercase">
              Settlement Rail
            </span>
          </div>

          <p className="text-xs text-zinc-300 leading-relaxed">
            Coordinates the two-phase commit pre-debit dwell period and executes Razorpay settlement rails with signature validation.
          </p>

          <div className="pt-1">
            <button
              onClick={() => setShowJson3(!showJson3)}
              className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
            >
              <span>{showJson3 ? "▾ Hide" : "▸ Show"} Raw Protocol Envelope</span>
            </button>
            {showJson3 && (
              <pre className="mt-2 p-3 rounded-xl bg-black/60 border border-white/10 text-[11px] font-mono text-zinc-300 overflow-x-auto">
                {JSON.stringify(primitives.paymentMandate, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   CENTER VIEW 7: AGENT REGISTRY & DELEGATED IDENTITY PANEL
   ========================================================================= */

function AgentRegistryPanel() {
  const agentIdentity = useSafeBuy((s) => s.agentIdentity);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Agent Identity & Delegation</h1>
          <Badge tone="neutral">Reference Pattern</Badge>
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Cryptographic agent identity, capability scopes, and trust reputation governance (Reference pattern, not TAP/UAP directory).
        </p>
      </div>

      <div className="p-6 rounded-2xl bg-[#0f1118] border border-white/10 space-y-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-sm">
              <Users className="size-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">{agentIdentity.operatorName}</h2>
              <p className="font-mono text-xs text-zinc-400">{agentIdentity.agentId}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-xs font-bold">
              Trust Score: {agentIdentity.trustScore}/100
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
            <span className="text-[10px] text-zinc-500 uppercase font-bold">PUBLIC SIGNING KEY</span>
            <p className="text-emerald-300 break-all text-[11px]">{agentIdentity.publicKey}</p>
          </div>
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
            <span className="text-[10px] text-zinc-500 uppercase font-bold">DELEGATION BOUNDS</span>
            <p className="text-zinc-200">Max ₹15,000 AFA threshold · Dwell notice required</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   PROMINENT REGULATORY PRE-DEBIT GATE MODAL (RBI §4.2 COMPLIANT)
   ========================================================================= */

function GateOverlay() {
  const phase = useSafeBuy((s) => s.phase);
  const windowMsLeft = useSafeBuy((s) => s.windowMsLeft);
  const pendingCart = useSafeBuy((s) => s.pendingCart);
  const mandate = useSafeBuy((s) => s.mandate);
  const agentIdentity = useSafeBuy((s) => s.agentIdentity);

  if (phase !== "window") return null;

  const sec = Math.ceil(windowMsLeft / 1000);
  const totalPaise = pendingCart?.totalPaise || 0;
  const currentRemaining = mandate?.remainingPaise || 0;
  const projectedRemaining = Math.max(0, currentRemaining - totalPaise);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl border border-emerald-500/50 bg-[#0c0e15] p-6 shadow-2xl space-y-5 text-xs relative overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Glow accent */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />

        {/* Modal Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300">
              <Clock className="size-4 animate-spin" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 font-bold">
                  RBI §4.2 REGULATORY DWELL GATE
                </span>
                <LayerBadge layer="live" />
              </div>
              <h2 className="text-base font-bold text-white">Pre-Debit Notice Window</h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 font-mono text-emerald-300 font-bold text-xs">
              <span>{sec}s dwell</span>
            </div>
            <LayerBadge layer="synthetic" />
          </div>
        </div>

        {/* Line Items Breakdown */}
        <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
            TRANSACTION LINE ITEMS
          </span>
          <div className="space-y-1.5">
            {pendingCart?.lines.map((l, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs text-zinc-200">
                <span>
                  {l.name} <span className="text-zinc-500 font-mono">× {l.quantity}</span>
                </span>
                <span className="font-mono font-bold text-emerald-400">{paiseToInr(l.linePaise)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Mandate Balance Utilization Breakdown */}
        <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
          <div className="p-2.5 rounded-lg bg-[#11131c] border border-white/5 space-y-0.5">
            <span className="text-[9px] text-zinc-500 uppercase">MANDATE CAP</span>
            <p className="text-zinc-300">{mandate ? paiseToInr(mandate.maxAmountPaise) : "₹1,500"}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-[#11131c] border border-white/5 space-y-0.5">
            <span className="text-[9px] text-zinc-500 uppercase">THIS DEBIT</span>
            <p className="font-bold text-emerald-400">{paiseToInr(totalPaise)}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-[#11131c] border border-white/5 space-y-0.5">
            <span className="text-[9px] text-zinc-500 uppercase">BALANCE AFTER</span>
            <p className="text-zinc-300">{paiseToInr(projectedRemaining)}</p>
          </div>
        </div>

        {/* Identity & Merchant Context */}
        <div className="p-3 rounded-xl bg-[#11131c]/60 border border-white/5 space-y-1 font-mono text-[11px] text-zinc-400">
          <div className="flex justify-between">
            <span>Signer:</span>
            <span className="text-zinc-200">{agentIdentity.operatorName} (Trust {agentIdentity.trustScore}/100)</span>
          </div>
          <div className="flex justify-between">
            <span>Merchant:</span>
            <span className="text-emerald-400 font-semibold">{MERCHANT_NAME} Store · Razorpay Settlement Rail</span>
          </div>
        </div>

        {/* Modal Action Controls */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void useSafeBuy.getState().proceedNow()}
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs h-10 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
            >
              <span>Proceed → Razorpay Checkout</span>
              <LayerBadge layer="live" />
            </Button>
            <Button
              variant="outline"
              onClick={() => useSafeBuy.getState().extendWindow(10000)}
              className="border-white/10 hover:bg-white/10 text-zinc-300 text-xs h-10 px-4"
              title="Demo control: extend pre-debit dwell period by 10 seconds"
            >
              +10s (Demo)
            </Button>
          </div>

          <Button
            variant="ghost"
            onClick={() => void useSafeBuy.getState().failClosed("User cancelled authorization in dwell period.")}
            className="w-full text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs h-8"
          >
            Cancel / Revoke Authorization
          </Button>
        </div>
      </div>
    </div>
  );
}

/* Helper to trigger Razorpay checkout strictly with server Order, failing closed honestly without simulation */
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
      await st.failClosed(order.error ?? "Razorpay Order creation failed. Live or test keys required.");
      return;
    }

    await st.appendAudit({
      correlationId: st.correlationId ?? "",
      phase: "execute",
      event: "razorpay.order_created",
      layer: "live",
      explain: `Razorpay Order ${order.orderId} created for ₹${cart.totalPaise / 100}. Initiating Checkout.`,
      payload: { orderId: order.orderId, amountPaise: cart.totalPaise },
    });

    openRazorpayCheckout({
      orderId: order.orderId,
      amountPaise: cart.totalPaise,
      merchantName: MERCHANT_NAME,
      description: `SafeBuy Order (${cart.lines.map((l) => l.name).join(", ")})`,
      keyId: st.razorpayKeyId,
      onSuccess: async (response) => {
        await st.handleHandlerReceived(
          response.razorpay_payment_id,
          response.razorpay_order_id,
          response.razorpay_signature,
        );
      },
      onDismiss: async () => {
        await st.failClosed("User dismissed or cancelled Razorpay checkout modal.");
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await st.failClosed(`Checkout initialization error: ${msg}`);
  }
}
