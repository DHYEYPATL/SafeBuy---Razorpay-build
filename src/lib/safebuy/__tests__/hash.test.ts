import test from "node:test";
import assert from "node:assert/strict";
import { hashRecord, verifyAuditChain, GENESIS_HASH } from "../hash";

test("Hash Chain: creates deterministic SHA-256 hashes", async () => {
  const body1 = {
    seq: 1,
    id: "aud_1",
    ts: "2026-08-21T12:00:00.000Z",
    correlationId: "cor_1",
    phase: "idle",
    event: "mandate.created",
    explain: "Initial mandate created",
    layer: "live",
    payload: { amount: 1500 },
  };

  const hash1 = await hashRecord(GENESIS_HASH, body1);
  assert.equal(typeof hash1, "string");
  assert.equal(hash1.length, 64);

  const hash1Repeat = await hashRecord(GENESIS_HASH, body1);
  assert.equal(hash1, hash1Repeat);
});

test("Hash Chain: validates sequential unbroken chain", async () => {
  const body1 = {
    seq: 1,
    id: "aud_1",
    ts: "2026-08-21T12:00:00.000Z",
    correlationId: "cor_1",
    phase: "idle",
    event: "mandate.created",
    explain: "Record 1",
    layer: "live",
    payload: { amount: 1500 },
  };
  const hash1 = await hashRecord(GENESIS_HASH, body1);
  const rec1 = { ...body1, prevHash: GENESIS_HASH, hash: hash1 };

  const body2 = {
    seq: 2,
    id: "aud_2",
    ts: "2026-08-21T12:01:00.000Z",
    correlationId: "cor_1",
    phase: "planning",
    event: "intent.parsed",
    explain: "Record 2",
    layer: "live",
    payload: { intent: "rice" },
  };
  const hash2 = await hashRecord(hash1, body2);
  const rec2 = { ...body2, prevHash: hash1, hash: hash2 };

  const result = await verifyAuditChain([rec1, rec2]);
  assert.equal(result.valid, true);
  assert.equal(result.totalRecords, 2);
});

test("Hash Chain: detects tampering and invalid prevHash", async () => {
  const body1 = {
    seq: 1,
    id: "aud_1",
    ts: "2026-08-21T12:00:00.000Z",
    correlationId: "cor_1",
    phase: "idle",
    event: "mandate.created",
    explain: "Record 1",
    layer: "live",
    payload: { amount: 1500 },
  };
  const hash1 = await hashRecord(GENESIS_HASH, body1);
  const rec1 = { ...body1, prevHash: GENESIS_HASH, hash: hash1 };

  // Tamper payload in rec2 without updating hash
  const body2 = {
    seq: 2,
    id: "aud_2",
    ts: "2026-08-21T12:01:00.000Z",
    correlationId: "cor_1",
    phase: "planning",
    event: "intent.parsed",
    explain: "Record 2",
    layer: "live",
    payload: { intent: "rice" },
  };
  const hash2 = await hashRecord(hash1, body2);
  const tamperedRec2 = {
    ...body2,
    prevHash: hash1,
    hash: hash2,
    payload: { intent: "tampered_data" },
  };

  const result = await verifyAuditChain([rec1, tamperedRec2]);
  assert.equal(result.valid, false);
  assert.equal(result.brokenSeq, 2);
});
