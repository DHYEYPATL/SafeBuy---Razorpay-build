import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
// @ts-expect-error JS plugin alongside the TS vite config
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";
// @ts-expect-error JS plugin alongside the TS vite config
import { appEnvPlugin } from "./scripts/app-env-plugin.mjs";
import { isMigrationFile } from "./scripts/migration-plan.mjs";

/** The files `src/lib/db.ts` globs — same directory, same non-recursive scope. */
function hasGlobbedMigrations(root: string): boolean {
  try {
    return readdirSync(join(root, "migrations")).some(isMigrationFile);
  } catch {
    return false;
  }
}

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 *
 * Vite awaiting the hook puts this on time-to-first-render, so an app with no
 * migrations — no schema to apply — skips it entirely rather than paying for a
 * PGLite instance it never queries.
 */
function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "app-builder:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      if (!hasGlobbedMigrations(server.config.root)) return;
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[app-builder] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

/**
 * Live-preview OAuth popup — handled HERE so the agent never has to create a
 * `/auth/popup` route (and cannot break it by scaffolding a React page that
 * paints the full app shell in the popup).
 *
 * `signIn` (client.ts) opens `/auth/popup?providerId=…` in a top-level window.
 * This middleware runs before TanStack Start, calls `handleAuthPopupRequest`,
 * and returns the 302 / completion HTML. Deployed apps do not use the popup
 * (full-page OAuth redirect), so `apply: "serve"` is enough.
 */
function authPopupPlugin(): Plugin {
  return {
    name: "app-builder:auth-popup",
    apply: "serve",
    configureServer(server) {
      // Register immediately (not in a returned post-hook) so we run BEFORE
      // TanStack Start / the SPA HTML fallback. A model-authored
      // `src/routes/auth/popup.tsx` React page must never win this path.
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/auth/popup") {
            next();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "GET") {
            res.statusCode = 405;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Method Not Allowed");
            return;
          }

          const host = String(
            req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:8080",
          );
          const proto = String(
            req.headers["x-forwarded-proto"] ??
              ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https" : "http"),
          );
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) requestHeaders.append(key, v);
            } else {
              requestHeaders.set(key, value);
            }
          }
          // Ensure Host is the public preview host so Better Auth's dynamic
          // baseURL / redirect_uri match the popup origin.
          if (!requestHeaders.has("host")) requestHeaders.set("host", host);

          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method: "GET",
            headers: requestHeaders,
          });

          const mod = (await server.ssrLoadModule("/src/lib/auth/popup.server.ts")) as {
            handleAuthPopupRequest: (req: Request) => Promise<Response>;
          };
          const response = await mod.handleAuthPopupRequest(request);

          res.statusCode = response.status;
          // Preserve multiple Set-Cookie headers (OAuth state + session).
          const setCookies =
            typeof response.headers.getSetCookie === "function"
              ? response.headers.getSetCookie()
              : [];
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            res.setHeader(key, value);
          });
          for (const cookie of setCookies) {
            res.appendHeader("set-cookie", cookie);
          }
          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        } catch (err) {
          console.error("[app-builder] /auth/popup handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("auth popup failed");
          }
        }
      });
    },
  };
}

function razorpayWebhookPlugin(): Plugin {
  return {
    name: "app-builder:razorpay-webhook",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/api/razorpay/webhook") {
            next();
            return;
          }

          if ((req.method ?? "GET").toUpperCase() === "GET") {
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                ok: true,
                endpoint: "/api/razorpay/webhook",
                method: "POST",
                description: "Live Razorpay Webhook Ingress with raw body HMAC SHA-256 validation.",
              }),
            );
            return;
          }

          if ((req.method ?? "GET").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
            return;
          }

          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          }
          const rawBody = Buffer.concat(chunks).toString("utf8");
          const signature = (req.headers["x-razorpay-signature"] as string) || null;

          const mod = (await server.ssrLoadModule("/src/lib/safebuy/razorpay-webhook.ts")) as typeof import("./src/lib/safebuy/razorpay-webhook");
          const result = mod.handleRazorpayWebhookPayload({ rawBody, signature });

          if (!result.ok || result.action === "rejected") {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: false, error: result.error }));
            return;
          }

          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              ok: true,
              received: true,
              action: result.action,
              event: result.event,
              paymentId: result.paymentId,
              orderId: result.orderId,
            }),
          );
        } catch (err) {
          console.error("[app-builder] /api/razorpay/webhook error:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        }
      });
    },
  };
}

function agentCatalogPlugin(): Plugin {
  return {
    name: "app-builder:agent-catalog",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";

          // 1. Discovery Manifest: /.well-known/agent-catalog.json
          if (pathOnly === "/.well-known/agent-catalog.json") {
            const mod = (await server.ssrLoadModule("/src/lib/safebuy/catalog.ts")) as typeof import("./src/lib/safebuy/catalog");
            const catalog = mod.CATALOG;

            const manifest = {
              merchant: {
                id: "nila-kirana",
                name: "Nila Kirana Store",
                currency: "INR",
                catalogVersion: "2026.08-v1",
                supportedCurrencies: ["INR"],
                settlementMethods: ["razorpay_orders_v1", "pre_debit_notice_v1"],
              },
              discoveryProtocol: "safebuy-acp-compatible-v1",
              standardCompliance: ["AP2-Product-Discovery-Draft", "NPCI-UAP-Modelled"],
              skus: catalog.map((item) => ({
                sku: item.sku,
                name: item.name,
                category: item.category,
                brand: item.brand,
                unit: item.unit,
                unitPricePaise: item.pricePaise,
                unitPriceRupees: item.pricePaise / 100,
                stock: item.stock,
                packTokens: item.name.toLowerCase().split(/[\s,]+/).filter((t) => t.length > 2),
                brandTags: [item.brand.toLowerCase()],
                lastUpdated: new Date().toISOString(),
              })),
              endpoints: {
                catalogManifest: "/.well-known/agent-catalog.json",
                skus: "/api/catalog/skus",
                webhook: "/api/razorpay/webhook",
              },
              rateLimit: {
                maxRequestsPerMinute: 60,
                policy: "no_pii_exposed_public_catalog",
              },
            };

            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.setHeader("access-control-allow-origin", "*");
            res.end(JSON.stringify(manifest, null, 2));
            return;
          }

          // 2. Structured SKUs endpoint: /api/catalog/skus
          if (pathOnly === "/api/catalog/skus") {
            const mod = (await server.ssrLoadModule("/src/lib/safebuy/catalog.ts")) as typeof import("./src/lib/safebuy/catalog");
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.setHeader("access-control-allow-origin", "*");
            res.end(JSON.stringify({ ok: true, count: mod.CATALOG.length, items: mod.CATALOG }));
            return;
          }

          next();
        } catch (err) {
          console.error("[app-builder] agent-catalog error:", err);
          next();
        }
      });
    },
  };
}

// `0.0.0.0:8080` is the live-preview contract — don't change host/port.
// The dev server starts once `src/router.tsx` and `src/routes/` exist — see
// AGENTS.md § "First scaffold".
export default defineConfig(({ command, isPreview }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    pgliteBootstrapPlugin(),
    // Before tanstackStart so /auth/popup never falls through to the SPA.
    authPopupPlugin(),
    // Real HTTP Webhook route for Razorpay events
    razorpayWebhookPlugin(),
    // Machine-readable agent catalog discovery plugin
    agentCatalogPlugin(),
    // Dev-only /__app-env, read by scripts/check-auth-invariant.mjs.
    appEnvPlugin(),
    // PWA head + ?install=1 tutorial page; runs before Start/Nitro.
    grokPwaPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            preset: "vercel",
            // Auto-registers server/middleware/* (the PWA install page +
            // manifest + head-tag middleware). Nitro v3 defaults serverDir to
            // false, so removing this silently unwires /?install=1 on deploys.
            serverDir: "./server",
          }),
        ]
      : []),
    viteReact(),
  ],
}));
