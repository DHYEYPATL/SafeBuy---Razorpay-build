async function sha256Hex(text: string) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export async function hashRecord(
  prevHash: string,
  body: Record<string, unknown>,
) {
  return sha256Hex(`${prevHash}|${canonicalJson(body)}`);
}

export const GENESIS_HASH = "0".repeat(64);

export interface ChainVerificationResult {
  valid: boolean;
  totalRecords: number;
  brokenSeq?: number;
  expectedHash?: string;
  actualHash?: string;
  error?: string;
}

export async function verifyAuditChain(records: Array<{
  seq: number;
  id: string;
  correlationId: string;
  ts: string;
  phase: string;
  event: string;
  explain: string;
  layer: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}>): Promise<ChainVerificationResult> {
  if (!records || records.length === 0) {
    return { valid: true, totalRecords: 0 };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        totalRecords: records.length,
        brokenSeq: r.seq,
        expectedHash: expectedPrevHash,
        actualHash: r.prevHash,
        error: `PrevHash mismatch at record #${r.seq}. Chain broken.`,
      };
    }

    const body = {
      seq: r.seq,
      id: r.id,
      ts: r.ts,
      correlationId: r.correlationId,
      phase: r.phase,
      event: r.event,
      explain: r.explain,
      layer: r.layer,
      payload: r.payload,
    };

    const calculatedHash = await hashRecord(expectedPrevHash, body);
    if (calculatedHash !== r.hash) {
      return {
        valid: false,
        totalRecords: records.length,
        brokenSeq: r.seq,
        expectedHash: calculatedHash,
        actualHash: r.hash,
        error: `Hash mismatch at record #${r.seq}. Record payload was tampered or corrupted.`,
      };
    }

    expectedPrevHash = r.hash;
  }

  return { valid: true, totalRecords: records.length };
}
