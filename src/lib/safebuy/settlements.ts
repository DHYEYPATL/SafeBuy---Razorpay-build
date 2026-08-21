export interface ServerSettlement {
  paymentId: string;
  orderId: string | null;
  amountPaise: number;
  status: string;
  source: "webhook" | "fetch";
  settledAt: string;
}

// In-memory server-side settlement authority map
const serverSettlements = new Map<string, ServerSettlement>();

export function recordServerSettlement(settlement: ServerSettlement): void {
  serverSettlements.set(settlement.paymentId, settlement);
}

export function getServerSettlement(paymentId: string): ServerSettlement | undefined {
  return serverSettlements.get(paymentId);
}

export function getAllServerSettlements(): ServerSettlement[] {
  return Array.from(serverSettlements.values());
}
