/**
 * Standalone Third-Party Agent Discovery Script
 *
 * Demonstrates an external AI buyer discovering and querying merchant SKUs
 * through the machine-readable discovery endpoint (/.well-known/agent-catalog.json).
 *
 * Usage:
 *   npx tsx scripts/external-agent-demo.ts
 */

interface AgentSku {
  sku: string;
  name: string;
  category: string;
  brand: string;
  unitPricePaise: number;
  unitPriceRupees: number;
  stock: number;
  packTokens: string[];
}

interface AgentManifest {
  merchant: { id: string; name: string; currency: string; catalogVersion: string };
  discoveryProtocol: string;
  skus: AgentSku[];
  endpoints: Record<string, string>;
}

async function runExternalAgentDemo() {
  const BASE_URL = process.env.BASE_URL || "http://localhost:8080";
  console.log(`🤖 [External Agent] Connecting to Merchant Discovery at ${BASE_URL}...`);

  try {
    const res = await fetch(`${BASE_URL}/.well-known/agent-catalog.json`);
    if (!res.ok) {
      throw new Error(`Failed to fetch catalog: ${res.status} ${res.statusText}`);
    }

    const manifest = (await res.json()) as AgentManifest;
    console.log(`\n✅ [External Agent] Discovered Merchant: "${manifest.merchant.name}" (ID: ${manifest.merchant.id})`);
    console.log(`📡 Discovery Protocol: ${manifest.discoveryProtocol}`);
    console.log(`📦 Available SKUs in Catalog: ${manifest.skus.length} items\n`);

    // Target query: Find "basmati"
    const targetToken = "basmati";
    console.log(`🔍 [External Agent] Querying for token: "${targetToken}"...`);

    const matchingSkus = manifest.skus.filter((sku) =>
      sku.packTokens.some((t) => t.includes(targetToken)) || sku.name.toLowerCase().includes(targetToken),
    );

    console.log(`Found ${matchingSkus.length} candidate SKU(s):`);
    matchingSkus.forEach((sku, idx) => {
      console.log(
        `  ${idx + 1}. [${sku.sku}] ${sku.name} - ₹${sku.unitPriceRupees} (${sku.stock} in stock) [Brand: ${sku.brand}]`,
      );
    });

    // Pick best match under ₹150 budget
    const budgetRupees = 150;
    const selected = matchingSkus
      .filter((s) => s.unitPriceRupees <= budgetRupees && s.stock > 0)
      .sort((a, b) => a.unitPriceRupees - b.unitPriceRupees)[0];

    if (selected) {
      console.log(`\n🎯 [External Agent] Selected compliant item: [${selected.sku}] ${selected.name} for ₹${selected.unitPriceRupees}`);
      console.log(`🛡️ Guardrail Token Match: packTokens matched "${targetToken}"`);
      console.log(`✅ Machine discovery successful! Merchant is fully transactable by third-party agents.`);
    } else {
      console.log(`\n⚠️ No item matched within budget of ₹${budgetRupees}`);
    }
  } catch (err) {
    console.error(`❌ [External Agent] Error during discovery:`, err instanceof Error ? err.message : err);
  }
}

runExternalAgentDemo();
