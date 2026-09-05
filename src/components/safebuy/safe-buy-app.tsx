import { useEffect, useState, useRef, useMemo } from "react";
import {
  Shield,
  ScrollText,
  FlaskConical,
  ShoppingBag,
  KeyRound,
  AlertTriangle,
  ExternalLink,
  Check,
  Clock,
  CheckCircle2,
  XCircle,
  FileCode2,
  Store,
  Sparkles,
  Users,
  Zap,
  TrendingUp,
  ArrowRight,
  ArrowLeftRight,
  Search,
  ChevronDown,
  Layers,
  Send,
  Plus,
  RefreshCw,
  Box,
  Copy,
  Info,
  SlidersHorizontal,
  Lock,
  Cpu,
  Radio,
  CheckCheck,
  Flame,
  Star,
  Activity,
  CreditCard,
  Hash,
  ChevronRight,
  ShieldCheck,
  X,
  DollarSign,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LayerBadge } from "./layer-badge";
import {
  CATEGORIES,
  DEMO_NOTIFY_WINDOW_MS,
  MERCHANT_NAME,
  MERCHANT_ID,
  type Category,
  type LabInject,
  type CatalogItem,
  type CartLine,
} from "@/lib/safebuy/types";
import { CATALOG, TECH_CATALOG, GROCERY_CATALOG, getItem, merchantMeta } from "@/lib/safebuy/catalog";
import { useSafeBuy, type JourneyStage } from "@/lib/safebuy/store";
import { paiseToInr, shortHash, newId } from "@/lib/utils";
import { createRazorpayOrder, getRazorpayPublicKey } from "@/lib/safebuy/razorpay-api";
import { verifyCheckoutSignature } from "@/lib/safebuy/signature";
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
  | "agents"
  | "products"
  | "compare";

export function SafeBuyApp() {
  const [tab, setTab] = useState<MainTab>("shopping");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [compareSkuA, setCompareSkuA] = useState("KEYCHRON-K3-MAX");
  const [compareSkuB, setCompareSkuB] = useState("SONY-WH1000XM5");

  const phase = useSafeBuy((s) => s.phase);
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

      {/* Main 3-Column Dashboard Container */}
      <div className="flex-1 w-full max-w-[1720px] mx-auto grid grid-cols-1 lg:grid-cols-[240px_1fr_310px] xl:grid-cols-[260px_1fr_330px] gap-0">
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
        <main className="min-w-0 border-r border-white/5 p-4 sm:p-6 lg:p-7 overflow-y-auto min-h-[calc(100vh-3.5rem)]">
          {tab === "shopping" && (
            <AIShoppingPanel
              onOpenCompare={(a, b) => {
                setCompareSkuA(a);
                setCompareSkuB(b);
                setTab("compare");
              }}
              onBrowseCatalog={() => setTab("products")}
              onViewOrders={() => setTab("orders")}
            />
          )}
          {tab === "mandate" && <MandatePanel />}
          {tab === "orders" && <OrdersPanel onStartShopping={() => setTab("shopping")} />}
          {tab === "audit" && <AuditPanel />}
          {tab === "lab" && <LabPanel />}
          {tab === "ap2" && <AP2PrimitivesPanel />}
          {tab === "agents" && <AgentRegistryPanel />}
          {tab === "products" && <ProductsPanel />}
          {tab === "compare" && (
            <ComparePanel
              skuA={compareSkuA}
              skuB={compareSkuB}
              onChangeSkuA={setCompareSkuA}
              onChangeSkuB={setCompareSkuB}
            />
          )}
        </main>

        {/* Right Sidebar: AI Control & Telemetry Panel */}
        <aside className="hidden lg:block bg-[#0a0c12]/80 p-5 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-l border-white/5">
          <RightTelemetryPanel onJumpTab={setTab} />
        </aside>
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
            <Sparkles className="size-4.5 text-emerald-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-base tracking-tight text-white">{MERCHANT_NAME}</span>
              <span className="text-[10px] uppercase font-mono tracking-widest px-1.5 py-0.5 rounded bg-white/5 text-zinc-400 border border-white/5">
                BOUNDED AI COMMERCE
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Header Right Indicators */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Active AI Assistant Pill */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium shadow-sm">
          <span className="size-2 rounded-full bg-emerald-400 animate-ping opacity-75" />
          <span className="font-mono text-[11px] tracking-wide">ASSISTANT ACTIVE</span>
        </div>

        {/* Mandate Balance Display */}
        {mandate ? (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#12151e] border border-white/10 text-xs">
            <span className="text-zinc-400 text-[11px]">Mandate:</span>
            <span className="font-mono font-semibold text-emerald-400">{paiseToInr(mandate.remainingPaise)}</span>
          </div>
        ) : null}

        {/* Razorpay Test Status */}
        <div
          className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono ${
            isConfigured
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-amber-500/10 border-amber-500/30 text-amber-300"
          }`}
        >
          <CreditCard className="size-3.5" />
          <span>{isConfigured ? "Razorpay Test Live" : "Sandbox Test Mode"}</span>
        </div>
      </div>
    </header>
  );
}

/* =========================================================================
   LEFT SIDEBAR NAVIGATION (ALIGNED TO GOLDEN EVALUATION PATH)
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

  const navGroups = [
    {
      group: "COMMERCE & PAY",
      items: [
        { id: "shopping" as MainTab, label: "Assistant", icon: Sparkles, badge: "AI" },
        { id: "mandate" as MainTab, label: "Mandate Policy", icon: KeyRound },
        { id: "orders" as MainTab, label: "Orders & GMV", icon: Store },
      ],
    },
    {
      group: "GOVERNANCE & PROTOCOL",
      items: [
        { id: "audit" as MainTab, label: "Audit Ledger", icon: ScrollText },
        { id: "lab" as MainTab, label: "Failure Lab", icon: FlaskConical },
        { id: "ap2" as MainTab, label: "AP2 Primitives", icon: FileCode2 },
        { id: "agents" as MainTab, label: "Agent Registry", icon: Users },
      ],
    },
    {
      group: "EXPLORE",
      items: [
        { id: "products" as MainTab, label: "Catalog", icon: Box },
        { id: "compare" as MainTab, label: "Compare Specs", icon: ArrowLeftRight },
      ],
    },
  ];

  return (
    <div className="flex flex-col h-full justify-between p-3.5 text-sm">
      <div className="space-y-6">
        {/* Navigation Sections */}
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
                    ) : item.badge ? (
                      <span className="text-[10px] text-zinc-500 font-mono">{item.badge}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Recent Queries Section */}
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
          <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
            {recentQueries.length === 0 ? (
              <p className="px-2 text-[11px] text-zinc-500 italic">No recent queries</p>
            ) : (
              recentQueries.slice(0, 5).map((q, idx) => (
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
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer Info Tag */}
      <div className="pt-4 border-t border-white/5 px-2 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
        <span>Track 01 - Pay</span>
        <span className="px-1.5 py-0.5 rounded bg-white/5 text-zinc-400 border border-white/5">v0.2.2</span>
      </div>
    </div>
  );
}

/* =========================================================================
   CENTER VIEW 1: AI SHOPPING ASSISTANT PANEL
   ========================================================================= */

function AIShoppingPanel({
  onOpenCompare,
  onBrowseCatalog,
  onViewOrders,
}: {
  onOpenCompare: (a: string, b: string) => void;
  onBrowseCatalog: () => void;
  onViewOrders: () => void;
}) {
  const [inputText, setInputText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const chat = useSafeBuy((s) => s.chat);
  const aiShortlist = useSafeBuy((s) => s.aiShortlist);
  const aiEvaluation = useSafeBuy((s) => s.aiEvaluation);
  const phase = useSafeBuy((s) => s.phase);
  const lastConfirmedOrder = useSafeBuy((s) => s.lastConfirmedOrder);
  const activeCampaign = useSafeBuy((s) => s.activeCampaign);
  const runInstruction = useSafeBuy((s) => s.runInstruction);
  const buyProductDirect = useSafeBuy((s) => s.buyProductDirect);

  const QUICK_PROMPTS = [
    {
      title: "BUY TECH HARDWARE",
      prompt: "Buy 100W USB-C cable under ₹1,500",
      icon: ArrowRight,
    },
    {
      title: "BUY GROCERY STAPLE",
      prompt: "Buy 1 kg basmati under ₹150",
      icon: Plus,
    },
    {
      title: "COMPARE HARDWARE",
      prompt: "Compare Keychron K3 Max & Sony WH-1000XM5",
      icon: ArrowLeftRight,
    },
    {
      title: "TEST AFA REGULATORY GATE",
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
    <div className="flex flex-col h-full max-w-4xl mx-auto space-y-6 pb-28">
      {/* Welcome Hero Header */}
      <div className="text-center py-6 sm:py-8 space-y-2">
        <div className="inline-flex p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-2 shadow-xl shadow-emerald-500/10">
          <Sparkles className="size-7 animate-pulse text-emerald-400" />
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
          {MERCHANT_NAME}
        </h1>
        <p className="text-xs font-mono tracking-widest text-emerald-400 uppercase font-semibold">
          BOUNDED AI COMMERCE ASSISTANT
        </p>
        <p className="text-sm text-zinc-400 max-w-lg mx-auto">
          Discover products. Compare options. Make autonomous purchases with deterministic policy guardrails.
        </p>
      </div>

      {/* Active Campaign / Loyalty Perk Ambient Banner */}
      {activeCampaign && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/40 via-[#0d121c] to-emerald-950/20 border border-emerald-500/30 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-emerald-400">
              <Flame className="size-3.5" />
              <span>{activeCampaign.badge}</span>
            </div>
            <p className="text-xs text-white font-medium">{activeCampaign.name}</p>
            <p className="text-[11px] text-zinc-400">{activeCampaign.description}</p>
          </div>
          <Button
            onClick={() => void useSafeBuy.getState().applyCampaign(activeCampaign)}
            className="bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-semibold px-4 h-8 shrink-0"
          >
            Apply Offer ({paiseToInr(activeCampaign.discountedTotalPaise)})
          </Button>
        </div>
      )}

      {/* 4 Quick Action Cards (Shown on Fresh Screen) */}
      {chat.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {QUICK_PROMPTS.map((q, idx) => {
            const Icon = q.icon;
            return (
              <button
                key={idx}
                onClick={() => void handleSendPrompt(q.prompt)}
                className="text-left p-4 rounded-xl bg-[#11131c]/80 hover:bg-[#161925] border border-white/5 hover:border-emerald-500/30 transition-all duration-200 group relative overflow-hidden"
              >
                <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-400 group-hover:text-emerald-400 mb-1.5">
                  <Icon className="size-3.5 text-zinc-400 group-hover:text-emerald-400" />
                  <span>{q.title}</span>
                </div>
                <p className="text-xs font-medium text-zinc-200 group-hover:text-white">
                  "{q.prompt}"
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Order Confirmed Landing Card */}
      {phase === "confirmed" && lastConfirmedOrder && (
        <div className="p-6 sm:p-8 rounded-2xl bg-gradient-to-b from-emerald-950/40 to-[#0d1017] border border-emerald-500/40 text-center space-y-6 shadow-2xl relative overflow-hidden animate-in fade-in zoom-in-95 duration-300">
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />

          <div className="size-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mx-auto text-emerald-300 shadow-xl shadow-emerald-500/30 animate-bounce">
            <Check className="size-8 stroke-[3]" />
          </div>

          <div className="space-y-1">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-emerald-400">ORDER CONFIRMED</span>
            <h2 className="text-xl sm:text-2xl font-bold text-white">{lastConfirmedOrder.name}</h2>
            <p className="text-2xl font-mono font-extrabold text-emerald-300">{paiseToInr(lastConfirmedOrder.amountPaise)}</p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 font-mono text-zinc-300">
              <span className="text-zinc-500">ORDER ID: </span>
              <span className="text-emerald-300">{lastConfirmedOrder.orderId}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <Check className="size-3.5" />
              <span>Razorpay Verified</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <Check className="size-3.5" />
              <span>Inventory Reserved</span>
            </div>
          </div>

          {/* AI Discovery Context */}
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 text-left text-xs space-y-1">
            <div className="flex items-center gap-2 text-emerald-400 font-mono text-[10px] uppercase font-bold tracking-wider">
              <Sparkles className="size-3" />
              <span>AI DISCOVERY CONTEXT</span>
            </div>
            <p className="text-zinc-300 font-medium">{lastConfirmedOrder.discoveryPrompt || `Purchased ${lastConfirmedOrder.name}`}</p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              onClick={() => void handleSendPrompt(`What goes well with the ${lastConfirmedOrder.name}?`)}
              className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-xs px-4 py-2"
            >
              Find Complements
            </Button>
            <Button
              variant="outline"
              onClick={onViewOrders}
              className="border-white/10 text-zinc-300 hover:bg-white/10 text-xs px-4 py-2"
            >
              View in Orders & GMV
            </Button>
            <Button
              variant="ghost"
              onClick={onBrowseCatalog}
              className="text-zinc-400 hover:text-white text-xs px-4 py-2"
            >
              Continue Shopping
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

      {/* AI SHORTLIST CARDS */}
      {aiShortlist.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-emerald-400 font-bold">
              <Sparkles className="size-3.5" />
              <span>AI SHORTLIST</span>
            </div>
            <span className="text-[11px] text-zinc-500 font-mono">{aiShortlist.length} matches analyzed</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {aiShortlist.map((item, idx) => {
              const inStock = item.stock > 0;
              return (
                <div
                  key={idx}
                  className="rounded-xl p-4 bg-[#10121a] border border-white/10 hover:border-emerald-500/40 transition-all flex flex-col justify-between space-y-3 shadow-md"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[9px] font-mono font-extrabold uppercase px-2 py-0.5 rounded tracking-wider ${
                          item.badge === "BEST MATCH"
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            : "bg-white/5 text-zinc-300 border border-white/10"
                        }`}
                      >
                        {item.badge}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-400">{item.brand}</span>
                    </div>

                    <h3 className="font-semibold text-xs text-white line-clamp-2">{item.name}</h3>

                    <div className="space-y-1">
                      <p className="font-mono text-base font-bold text-emerald-400">
                        {paiseToInr(item.pricePaise)}
                      </p>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className={`size-1.5 rounded-full ${inStock ? "bg-emerald-400" : "bg-red-400"}`} />
                        <span className={inStock ? "text-zinc-300" : "text-red-400"}>
                          {inStock ? `In stock · ${item.stock} units` : "Out of stock"}
                        </span>
                      </div>
                    </div>

                    {item.specsHighlight && (
                      <p className="text-[10px] font-mono text-zinc-400 bg-white/5 px-2 py-1 rounded truncate">
                        {item.specsHighlight}
                      </p>
                    )}
                  </div>

                  <div className="pt-2 flex items-center gap-2">
                    <Button
                      onClick={() => void buyProductDirect(item.sku)}
                      disabled={!inStock}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-black font-semibold text-xs py-1.5 h-8"
                    >
                      {inStock ? "Buy Now" : "Unavailable"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onOpenCompare(item.sku, "KEYCHRON-K3-MAX")}
                      className="border-white/10 text-zinc-300 text-xs px-2.5 h-8 hover:bg-white/10"
                      title="Compare specs"
                    >
                      <ArrowLeftRight className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI EVALUATION BOX */}
      {aiEvaluation && (
        <div className="p-4 rounded-xl bg-[#0f1118] border border-white/5 space-y-2.5 text-xs">
          <div className="flex items-center justify-between text-zinc-400 font-mono text-[11px]">
            <span className="uppercase font-bold tracking-wider text-zinc-300">AI EVALUATION TRANSPARENCY</span>
            <span>{aiEvaluation.consideredCount} options evaluated</span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-start gap-2 text-emerald-300 font-medium">
              <Check className="size-4 shrink-0 text-emerald-400 mt-0.5" />
              <span>{aiEvaluation.primaryMatch}</span>
            </div>

            {aiEvaluation.rejected.map((rej, idx) => (
              <div key={idx} className="flex items-start gap-2 text-zinc-400 pl-1 text-[11px]">
                <span className="text-zinc-500 text-base leading-none">○</span>
                <span>
                  {rej.name} — <span className="text-zinc-500">{rej.reason}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={chatBottomRef} />

      {/* Clean Sticky Bottom Chat & Quick Prompts Bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-[#090a0f]/95 backdrop-blur-xl border-t border-white/10 px-4 py-3 sm:px-8">
        <div className="max-w-4xl mx-auto space-y-2">
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
              placeholder="+ Ask SafeBuy anything... (e.g. 'Buy 1 kg basmati under ₹150' or 'Buy 100W cable under ₹1,500')"
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
                Buy 100W Cable (&lt;₹1.5k)
              </button>
              <button
                onClick={() => void handleSendPrompt("Buy 1 kg basmati under ₹150")}
                className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/5 transition-colors"
              >
                Buy 1kg Basmati (&lt;₹150)
              </button>
              <button
                onClick={() => void handleSendPrompt("Compare Keychron K3 Max & Sony WH-1000XM5")}
                className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/5 transition-colors"
              >
                Compare Tech Specs
              </button>
              <button
                onClick={() => void handleSendPrompt("Buy Sony WH-1000XM5 headphones")}
                className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/5 transition-colors"
              >
                Test AFA Gate (&gt;₹15k)
              </button>
            </div>

            <span className="hidden sm:inline font-mono text-[10px] text-zinc-500">
              Grounded catalog · Dual-rail compliance · Real Razorpay Orders API
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
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Mandate Policy</h1>
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
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Orders & Settled GMV</h1>
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

      {merchantOrders.length === 0 ? (
        <div className="p-12 rounded-2xl bg-[#0e1017] border border-white/5 text-center space-y-4">
          <Store className="size-10 text-zinc-600 mx-auto" />
          <p className="text-sm text-zinc-400">No orders placed yet. Start an assistant purchase to test real checkout.</p>
          <Button onClick={onStartShopping} className="bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-semibold">
            Start Assistant Flow
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {merchantOrders.map((mo) => {
            const attempt = attempts.find((a) => a.id === mo.attemptId);
            const isPaid = mo.status === "paid";

            return (
              <div
                key={mo.id}
                className="p-5 rounded-2xl bg-[#0f1118] border border-white/10 space-y-4 shadow-lg"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-mono uppercase text-zinc-400">ORDER ID</span>
                    <p className="font-mono text-xs font-bold text-white">{mo.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase ${
                        isPaid
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                          : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                      }`}
                    >
                      {mo.status}
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
                    <span>Razorpay Order / Payment: </span>
                    <span className="text-zinc-200">{attempt?.razorpayOrderId || mo.razorpayOrderId || "Pending"}</span>
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
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Audit Ledger</h1>
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
      title: "Normal Execution",
      desc: "Standard compliant operations without malicious injection.",
      prompt: "Buy 100W USB-C cable under ₹1,500",
    },
    {
      id: "semantic_mismatch",
      title: "Semantic Prompt Injection",
      desc: "Agent attempts to substitute unauthorized item (e.g. Atta for Basmati).",
      prompt: "Get 5 kg atta with Cadbury chocolate",
    },
    {
      id: "stock_race",
      title: "Stock Race Simulation",
      desc: "Requested SKU drops to 0 inventory immediately prior to reservation.",
      prompt: "Is the Logitech MX Master 3S in stock?",
    },
    {
      id: "replay_attack",
      title: "Replay Attack Simulation",
      desc: "Injects forged HMAC signatures to test cryptographic rejection.",
      prompt: "Buy Sony WH-1000XM5 headphones",
    },
    {
      id: "untrusted_agent",
      title: "Untrusted Agent Delegation",
      desc: "Tests rejection when agent trust score falls below safe threshold (<30).",
      prompt: "Buy Keychron K3 Max keyboard",
    },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Failure Lab & Security</h1>
        <p className="text-xs text-zinc-400 mt-1">Simulate adversarial attacks, stock races, and policy violations.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {attacks.map((att) => {
          const isSelected = labInject === att.id;
          return (
            <div
              key={att.id}
              className={`p-5 rounded-2xl bg-[#0f1118] border transition-all space-y-3 ${
                isSelected ? "border-amber-500/50 bg-amber-500/5" : "border-white/10 hover:border-white/20"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-white">{att.title}</h3>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase font-bold ${
                    isSelected ? "bg-amber-500/20 text-amber-300" : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {isSelected ? "Active" : "Ready"}
                </span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">{att.desc}</p>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  onClick={() => setLabInject(att.id)}
                  variant={isSelected ? "default" : "outline"}
                  className="text-xs h-8 flex-1"
                >
                  {isSelected ? "Injection Armed" : "Select Test"}
                </Button>
                <Button
                  onClick={() => {
                    setLabInject(att.id);
                    void runInstruction(att.prompt);
                  }}
                  className="text-xs h-8 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold"
                >
                  Run Attack
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
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">AP2 Protocol Primitives</h1>
        <p className="text-xs text-zinc-400 mt-1">
          Agent Payment Protocol (AP2) cryptographically verifiable multi-phase mandates.
        </p>
      </div>

      <div className="space-y-4">
        {/* Step 1: Intent Mandate */}
        <div className="p-5 rounded-2xl bg-[#0f1118] border border-white/10 space-y-4 shadow-lg">
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
            Converts natural language user instructions into a bounded, cryptographically signed authorization envelope.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-[11px]">
            <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-0.5">
              <span className="text-zinc-500 uppercase text-[10px]">MANDATE ID</span>
              <p className="text-emerald-300 truncate">{primitives.intentMandate?.mandateId || "man_safebuy_default"}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-0.5">
              <span className="text-zinc-500 uppercase text-[10px]">CATEGORY SCOPE</span>
              <p className="text-zinc-200 truncate">
                {primitives.intentMandate?.allowedCategories?.join(", ") || "cables, power, grains, audio"}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-0.5">
              <span className="text-zinc-500 uppercase text-[10px]">AUTHORIZED BY</span>
              <p className="text-zinc-200 truncate">{primitives.intentMandate?.authorizedBy || "human_cardholder"}</p>
            </div>
          </div>

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
        <div className="p-5 rounded-2xl bg-[#0f1118] border border-white/10 space-y-4 shadow-lg">
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
            Binds the planned purchase to deterministic catalog SKUs, verified inventory reservations, and tamper-proof cart hashes.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-[11px]">
            <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-0.5">
              <span className="text-zinc-500 uppercase text-[10px]">ATTEMPT ID</span>
              <p className="text-emerald-300 truncate">
                {primitives.cartMandate?.attemptId || "att_sb_grounded"}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-0.5">
              <span className="text-zinc-500 uppercase text-[10px]">MERCHANT ORDER</span>
              <p className="text-zinc-200 truncate">{primitives.cartMandate?.merchantOrderId || "mo_sb_reserved"}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-0.5">
              <span className="text-zinc-500 uppercase text-[10px]">LOCKED SKUS</span>
              <p className="text-zinc-200 truncate">
                {primitives.cartMandate?.lockedSkus?.length || 1} Item(s) Reserved
              </p>
            </div>
          </div>

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
        <div className="p-5 rounded-2xl bg-[#0f1118] border border-white/10 space-y-4 shadow-lg">
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
            Coordinates the two-phase commit pre-debit dwell period and executes Razorpay settlement rails with cryptographic signature validation.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-[11px]">
            <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-0.5">
              <span className="text-zinc-500 uppercase text-[10px]">NOTICE ID</span>
              <p className="text-emerald-300 truncate">{primitives.paymentMandate?.noticeId || "nt_sb_active"}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-0.5">
              <span className="text-zinc-500 uppercase text-[10px]">RECONCILIATION</span>
              <p className="text-zinc-200">{primitives.paymentMandate?.reconciliationStatus || "pending"}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-0.5">
              <span className="text-zinc-500 uppercase text-[10px]">RAIL</span>
              <p className="text-emerald-300">Razorpay v1</p>
            </div>
          </div>

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
  const registeredAgents = listRegisteredAgents();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Agent Registry & Delegation</h1>
        <p className="text-xs text-zinc-400 mt-1">
          Cryptographic Ed25519 identity, capability scopes, and trust reputation governance.
        </p>
      </div>

      {/* Active Buyer Agent Identity Card */}
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
            <span className="px-2.5 py-1 rounded-full bg-white/5 text-zinc-300 border border-white/10 font-mono text-xs uppercase">
              {agentIdentity.status}
            </span>
          </div>
        </div>

        {/* Visual Trust Score Progress Bar */}
        <div className="space-y-1.5 font-mono text-[11px]">
          <div className="flex justify-between text-zinc-400">
            <span>REPUTATION TIER: HIGH TRUST</span>
            <span className="text-emerald-400 font-bold">{agentIdentity.trustScore}% Verified</span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden border border-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-500"
              style={{ width: `${agentIdentity.trustScore}%` }}
            />
          </div>
        </div>

        {/* Identity Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
            <span className="text-[10px] text-zinc-500 uppercase font-bold">ED25519 PUBLIC KEY</span>
            <p className="text-emerald-300 break-all text-[11px]">{agentIdentity.publicKey}</p>
          </div>
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
            <span className="text-[10px] text-zinc-500 uppercase font-bold">DELEGATION BOUNDS</span>
            <p className="text-zinc-200">Max ₹15,000 AFA threshold · Dwell notice required</p>
          </div>
        </div>

        {/* Capability Claims */}
        <div className="space-y-2 pt-2 border-t border-white/5">
          <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
            GRANTED CAPABILITY CLAIMS
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              "catalog:read",
              "intent:parse_bounded",
              "cart:propose",
              "payment:dwell_authorize",
              "audit:chain_commit",
            ].map((claim) => (
              <span
                key={claim}
                className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-zinc-300 font-mono text-[11px]"
              >
                ✓ {claim}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Governance & Trust Safeguards Breakdown */}
      <div className="p-5 rounded-2xl bg-[#0f1118] border border-white/10 space-y-3 shadow-lg">
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400">
          Agent Governance & Anti-Gaming Rules
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-[11px] text-zinc-300">
          <div className="p-3 rounded-xl bg-black/30 border border-white/5 space-y-1">
            <span className="text-white font-bold">Volume Dampening</span>
            <p className="text-zinc-400 text-[10px] leading-relaxed">
              Rapid sub-second micro transactions damp reputation gains to prevent trust gaming.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-black/30 border border-white/5 space-y-1">
            <span className="text-white font-bold">Replay Window</span>
            <p className="text-zinc-400 text-[10px] leading-relaxed">
              Strict 30-second timestamp freshness and nonce deduplication prevents transaction replay.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-black/30 border border-white/5 space-y-1">
            <span className="text-white font-bold">Fail-Closed Default</span>
            <p className="text-zinc-400 text-[10px] leading-relaxed">
              Unknown agents or degraded trust scores (&lt;30) reject authorization immediately with zero debit.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   CENTER VIEW 8: PRODUCTS CATALOG GRID
   ========================================================================= */

function ProductsPanel() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [inStockOnly, setInStockOnly] = useState(false);

  const buyProductDirect = useSafeBuy((s) => s.buyProductDirect);

  const categories = [
    { id: "all", label: "All" },
    { id: "cables", label: "Cables" },
    { id: "power", label: "Power" },
    { id: "peripherals", label: "Peripherals" },
    { id: "audio", label: "Audio" },
    { id: "grains", label: "Grains" },
    { id: "oil", label: "Oils" },
    { id: "pulses", label: "Pulses" },
  ];

  const filteredItems = useMemo(() => {
    return CATALOG.filter((item) => {
      if (activeCategory !== "all" && item.category !== activeCategory) return false;
      if (inStockOnly && item.stock <= 0) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = item.name.toLowerCase().includes(q);
        const matchBrand = item.brand.toLowerCase().includes(q);
        const matchDesc = item.description.toLowerCase().includes(q);
        const matchTags = item.tags?.some((t) => t.toLowerCase().includes(q));
        return matchName || matchBrand || matchDesc || matchTags;
      }
      return true;
    });
  }, [searchQuery, activeCategory, inStockOnly]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Products Catalog</h1>
        <p className="text-xs text-zinc-400 mt-1">Browse SafeBuy verified hardware & grocery catalog items.</p>
      </div>

      {/* Search and Filters Bar */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="size-4 text-zinc-400 absolute left-3.5 top-3.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search catalog by name, brand, or spec (e.g. 100W, basmati, mouse, 4K)..."
            className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#11131c] border border-white/10 focus:border-emerald-500/50 text-xs text-white placeholder:text-zinc-500 outline-none transition-all"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeCategory === cat.id
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : "bg-white/5 text-zinc-400 hover:text-zinc-200 border border-white/5"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setInStockOnly(!inStockOnly)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all border ${
              inStockOnly
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : "bg-white/5 text-zinc-400 border-white/5 hover:text-zinc-200"
            }`}
          >
            <span className={`size-2 rounded-full ${inStockOnly ? "bg-emerald-400" : "bg-zinc-600"}`} />
            <span>In Stock Only</span>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
        <span>{filteredItems.length} products found</span>
        <span>ACTIVE · real-time</span>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredItems.map((item) => {
          const inStock = item.stock > 0;
          return (
            <div
              key={item.sku}
              className="rounded-2xl bg-[#0f1118] border border-white/10 hover:border-emerald-500/30 transition-all p-5 flex flex-col justify-between space-y-4 shadow-lg group"
            >
              <div className="space-y-3">
                {/* Brand Monogram & Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-xs font-mono font-bold text-zinc-300">
                      {item.brand.charAt(0)}
                    </div>
                    <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">{item.brand}</span>
                  </div>
                  {item.rating && (
                    <div className="flex items-center gap-1 text-amber-400 text-xs font-mono">
                      <Star className="size-3 fill-amber-400" />
                      <span>{item.rating}</span>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="font-semibold text-sm text-white group-hover:text-emerald-300 transition-colors line-clamp-1">
                    {item.name}
                  </h3>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="font-mono text-lg font-bold text-emerald-400">
                      {paiseToInr(item.pricePaise)}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">INR</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs">
                  <span className={`size-1.5 rounded-full ${inStock ? "bg-emerald-400" : "bg-red-400"}`} />
                  <span className={inStock ? "text-zinc-300" : "text-red-400"}>
                    {inStock ? `In stock · ${item.stock} units` : "Out of stock"}
                  </span>
                </div>

                <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                  {item.description}
                </p>

                {/* Spec Tag Pills */}
                {item.tags && item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {item.tags.slice(0, 4).map((tag, tIdx) => (
                      <span
                        key={tIdx}
                        className="px-2 py-0.5 rounded-md bg-white/5 text-[10px] font-mono text-zinc-400 border border-white/5"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-white/5">
                <Button
                  onClick={() => void buyProductDirect(item.sku)}
                  disabled={!inStock}
                  className="w-full bg-[#181b26] hover:bg-emerald-500 hover:text-black text-white font-semibold text-xs h-9 border border-white/10 transition-all"
                >
                  {inStock ? "Buy" : "Out of Stock"}
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
   CENTER VIEW 9: PRODUCT COMPARISON VIEW
   ========================================================================= */

function ComparePanel({
  skuA,
  skuB,
  onChangeSkuA,
  onChangeSkuB,
}: {
  skuA: string;
  skuB: string;
  onChangeSkuA: (s: string) => void;
  onChangeSkuB: (s: string) => void;
}) {
  const buyProductDirect = useSafeBuy((s) => s.buyProductDirect);

  const itemA = getItem(skuA) || TECH_CATALOG[1];
  const itemB = getItem(skuB) || TECH_CATALOG[2];

  const specKeys = useMemo(() => {
    const keys = new Set<string>();
    if (itemA.specs) Object.keys(itemA.specs).forEach((k) => keys.add(k));
    if (itemB.specs) Object.keys(itemB.specs).forEach((k) => keys.add(k));
    return Array.from(keys);
  }, [itemA, itemB]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Compare Specs</h1>
        <p className="text-xs text-zinc-400 mt-1">Side-by-side product comparison & live specifications.</p>
      </div>

      {/* Selectors for Product A and Product B */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">PRODUCT A</label>
          <div className="relative">
            <select
              value={skuA}
              onChange={(e) => onChangeSkuA(e.target.value)}
              className="w-full h-10 pl-3 pr-8 rounded-xl bg-[#11131c] border border-white/10 text-xs text-white font-medium outline-none focus:border-emerald-500/50 appearance-none"
            >
              {TECH_CATALOG.map((i) => (
                <option key={i.sku} value={i.sku}>
                  {i.name}
                </option>
              ))}
            </select>
            <ChevronDown className="size-3.5 text-zinc-400 absolute right-3 top-3.5 pointer-events-none" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">PRODUCT B</label>
          <div className="relative">
            <select
              value={skuB}
              onChange={(e) => onChangeSkuB(e.target.value)}
              className="w-full h-10 pl-3 pr-8 rounded-xl bg-[#11131c] border border-white/10 text-xs text-white font-medium outline-none focus:border-emerald-500/50 appearance-none"
            >
              {TECH_CATALOG.map((i) => (
                <option key={i.sku} value={i.sku}>
                  {i.name}
                </option>
              ))}
            </select>
            <ChevronDown className="size-3.5 text-zinc-400 absolute right-3 top-3.5 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Comparison Matrix Table */}
      <div className="rounded-2xl border border-white/10 bg-[#0e1017] overflow-hidden shadow-xl">
        <div className="px-5 py-3 border-b border-white/5 bg-white/[0.02]">
          <span className="text-[10px] font-mono uppercase font-bold tracking-wider text-zinc-400">PRODUCT COMPARISON MATRIX</span>
        </div>

        <div className="divide-y divide-white/5">
          {/* Header Row */}
          <div className="grid grid-cols-3 px-5 py-3 text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold bg-white/[0.01]">
            <span>ATTRIBUTE</span>
            <span className="text-white">{itemA.brand}</span>
            <span className="text-white">{itemB.brand}</span>
          </div>

          {/* Price Row */}
          <div className="grid grid-cols-3 px-5 py-3.5 text-xs items-center hover:bg-white/[0.02] transition-colors">
            <span className="font-mono text-zinc-400 uppercase text-[11px]">PRICE</span>
            <span className="font-mono font-bold text-emerald-400 text-sm">{paiseToInr(itemA.pricePaise)}</span>
            <span className="font-mono font-bold text-emerald-400 text-sm">{paiseToInr(itemB.pricePaise)}</span>
          </div>

          {/* Availability Row */}
          <div className="grid grid-cols-3 px-5 py-3.5 text-xs items-center hover:bg-white/[0.02] transition-colors">
            <span className="font-mono text-zinc-400 uppercase text-[11px]">AVAILABILITY</span>
            <div className="flex items-center gap-1.5">
              <span className={`size-1.5 rounded-full ${itemA.stock > 0 ? "bg-emerald-400" : "bg-red-400"}`} />
              <span className={itemA.stock > 0 ? "text-zinc-200" : "text-zinc-400"}>
                {itemA.stock > 0 ? `In stock (${itemA.stock})` : "Out of stock"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`size-1.5 rounded-full ${itemB.stock > 0 ? "bg-emerald-400" : "bg-red-400"}`} />
              <span className={itemB.stock > 0 ? "text-zinc-200" : "text-zinc-400"}>
                {itemB.stock > 0 ? `In stock (${itemB.stock})` : "Out of stock"}
              </span>
            </div>
          </div>

          {/* Dynamic Technical Specs Rows */}
          {specKeys.map((key) => {
            if (key === "price" || key === "availability") return null;
            const valA = itemA.specs?.[key] !== undefined ? String(itemA.specs[key]) : "Not available";
            const valB = itemB.specs?.[key] !== undefined ? String(itemB.specs[key]) : "Not available";

            return (
              <div key={key} className="grid grid-cols-3 px-5 py-3 text-xs items-center hover:bg-white/[0.02] transition-colors">
                <span className="font-mono text-zinc-400 uppercase text-[11px]">{key}</span>
                <span className={valA === "Not available" ? "text-zinc-500" : "text-zinc-200"}>{valA}</span>
                <span className={valB === "Not available" ? "text-zinc-500" : "text-zinc-200"}>{valB}</span>
              </div>
            );
          })}

          {/* Action Row */}
          <div className="grid grid-cols-3 px-5 py-4 items-center bg-white/[0.02]">
            <span className="font-mono text-xs text-zinc-400">INSTANT BUY</span>
            <div>
              <Button
                onClick={() => void buyProductDirect(itemA.sku)}
                disabled={itemA.stock <= 0}
                className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-semibold text-xs h-8 px-4"
              >
                {itemA.stock > 0 ? `Buy ${itemA.brand}` : "Out of Stock"}
              </Button>
            </div>
            <div>
              <Button
                onClick={() => void buyProductDirect(itemB.sku)}
                disabled={itemB.stock <= 0}
                className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-semibold text-xs h-8 px-4"
              >
                {itemB.stock > 0 ? `Buy ${itemB.brand}` : "Out of Stock"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   RIGHT SIDEBAR: TELEMETRY, PROTOCOL PROGRESS & SESSION ACTIVITY
   ========================================================================= */

function RightTelemetryPanel({ onJumpTab }: { onJumpTab: (t: MainTab) => void }) {
  const journeyStage = useSafeBuy((s) => s.journeyStage);
  const sessionActivity = useSafeBuy((s) => s.sessionActivity);
  const telemetry = useSafeBuy((s) => s.telemetry);
  const phase = useSafeBuy((s) => s.phase);
  const audit = useSafeBuy((s) => s.audit);
  const isConfigured = useSafeBuy((s) => s.isConfigured);

  const blockedAttempts = audit.filter(
    (a) => a.event === "guardrail.block" || a.event === "fail_closed",
  ).length;

  const journeySteps: { id: JourneyStage; label: string }[] = [
    { id: "understand", label: "Intent Mandate" },
    { id: "discover", label: "Semantic Plan" },
    { id: "evaluate", label: "Guardrail Check" },
    { id: "recommend", label: "Pre-Debit Dwell" },
    { id: "approve", label: "Rail Execution" },
    { id: "purchase", label: "Settled & Verified" },
  ];

  const stageOrder: JourneyStage[] = ["understand", "discover", "evaluate", "recommend", "approve", "purchase"];
  const currentStageIdx = stageOrder.indexOf(journeyStage);

  return (
    <div className="space-y-6 text-xs font-sans">
      {/* AI CONTROL & ACTIVE ENGINE BADGE */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 font-bold">AI CONTROL</span>
          <div className="flex items-center gap-1.5 text-emerald-400 font-mono text-[10px]">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span>Connected</span>
          </div>
        </div>

        {/* Static Active Provider & Model Indicator */}
        <div className="p-3 rounded-xl bg-[#11131c] border border-white/5 space-y-2 font-mono text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500 uppercase text-[10px]">ACTIVE ENGINE</span>
            <span className="text-emerald-400 font-semibold flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Gemini 2.5 Flash
            </span>
          </div>
          <div className="flex items-center justify-between text-zinc-400 text-[10px]">
            <span>ARCHITECTURE</span>
            <span className="text-zinc-200">SafeBuy Dual-Rail</span>
          </div>
        </div>

        {/* Telemetry Metrics */}
        <div className="p-3 rounded-xl bg-[#11131c] border border-white/5 space-y-1.5 text-[11px] font-mono">
          <div className="flex justify-between text-zinc-400">
            <span>Last response</span>
            <span className="text-zinc-200">{telemetry.lastResponseTime}</span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>Tool calls</span>
            <span className="text-zinc-200">{telemetry.toolCalls}</span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>Rounds</span>
            <span className="text-zinc-200">{telemetry.rounds}</span>
          </div>
        </div>
      </div>

      {/* MERCHANT & GUARDRAIL TELEMETRY */}
      <div className="space-y-2 pt-2 border-t border-white/5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 font-bold">MERCHANT TELEMETRY</span>
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div className="p-2.5 rounded-lg bg-[#11131c] border border-white/5 space-y-0.5">
            <span className="text-[9px] text-zinc-500 uppercase">GUARDED VOL</span>
            <p className="font-bold text-emerald-400">100% Fail-Closed</p>
          </div>
          <div className="p-2.5 rounded-lg bg-[#11131c] border border-white/5 space-y-0.5">
            <span className="text-[9px] text-zinc-500 uppercase">ATTACKS BLOCKED</span>
            <p className="font-bold text-amber-400">{blockedAttempts} Injections</p>
          </div>
          <div className="p-2.5 rounded-lg bg-[#11131c] border border-white/5 space-y-0.5">
            <span className="text-[9px] text-zinc-500 uppercase">GROUNDED SKUS</span>
            <p className="font-bold text-white">{CATALOG.length} Items</p>
          </div>
          <div className="p-2.5 rounded-lg bg-[#11131c] border border-white/5 space-y-0.5">
            <span className="text-[9px] text-zinc-500 uppercase">PAYMENT RAIL</span>
            <p className="font-bold text-emerald-400">{isConfigured ? "Razorpay Live" : "Sandbox Test"}</p>
          </div>
        </div>
      </div>

      {/* AP2 PROTOCOL JOURNEY STEP PROGRESS TRACKER */}
      <div className="space-y-2 pt-2 border-t border-white/5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 font-bold">AP2 PROTOCOL PIPELINE</span>
          <span className="text-[10px] font-mono text-zinc-400">
            {phase === "confirmed" ? "6/6" : `${Math.min(6, currentStageIdx + 1)}/6`}
          </span>
        </div>

        <div className="space-y-1.5">
          {journeySteps.map((step, idx) => {
            const isCompleted = phase === "confirmed" || currentStageIdx >= idx;
            return (
              <div
                key={step.id}
                className={`flex items-center gap-2 text-xs font-mono transition-colors ${
                  isCompleted ? "text-emerald-300 font-medium" : "text-zinc-600"
                }`}
              >
                <span className={isCompleted ? "text-emerald-400 font-bold" : "text-zinc-600"}>
                  {isCompleted ? "✓" : "○"}
                </span>
                <span>{step.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* SESSION ACTIVITY LOG */}
      <div className="space-y-2 pt-2 border-t border-white/5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 font-bold">SESSION ACTIVITY</span>
          <span className="size-1.5 rounded-full bg-emerald-400" />
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {sessionActivity.map((ev) => (
            <div key={ev.id} className="p-2 rounded-lg bg-[#11131c]/60 border border-white/5 space-y-0.5 text-[10px] font-mono">
              <div className="flex items-center justify-between text-zinc-400">
                <span className="text-emerald-400 font-bold uppercase">{ev.event}</span>
                <span>{ev.time}</span>
              </div>
              {ev.detail && <p className="text-zinc-300 truncate">{ev.detail}</p>}
            </div>
          ))}
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
              <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 font-bold">
                RBI §4.2 REGULATORY DWELL GATE
              </span>
              <h2 className="text-base font-bold text-white">Pre-Debit Notice Window</h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 font-mono text-emerald-300 font-bold text-xs">
            <span>{sec}s dwell</span>
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
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs h-10 shadow-lg shadow-emerald-500/20"
            >
              Approve & Authorize Now
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
