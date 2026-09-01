import { describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  hashLeaf,
  hashNode,
  inclusionProof,
  rootFromHashes,
  rootFromRecords,
  verifyProof,
} from "../../../src/rivet/praxis/merkle"
import { Ledger, LEDGER_SCHEMA } from "../../../src/rivet/praxis/ledger"

describe("Praxis Merkle Tree & NDJSON Cryptographic Ledger", () => {
  test("Merkle empty root is deterministic and distinct", () => {
    const root = rootFromRecords([])
    expect(root.toString("hex").length).toBe(64)
  })

  test("Merkle inclusion proof generation and verification across leaf indices", () => {
    const records = ["record-1", "record-2", "record-3", "record-4", "record-5"]
    const leaves = records.map((r) => hashLeaf(r))
    const root = rootFromHashes(leaves)
    const rootHex = root.toString("hex")

    for (let i = 0; i < records.length; i++) {
      const proof = inclusionProof(leaves, i)
      expect(verifyProof(proof, rootHex)).toBe(true)
    }
  })

  test("CVE-2012-2459 collision resistance: odd leaf duplication produces distinct roots", () => {
    const a = "item-a"
    const b = "item-b"
    const c = "item-c"

    const rootAbc = rootFromRecords([a, b, c]).toString("hex")
    const rootAbcc = rootFromRecords([a, b, c, c]).toString("hex")

    expect(rootAbc).not.toBe(rootAbcc)
  })

  test("Ledger append, Merkle root tracking, and atomic persistence", () => {
    const tempLedgerPath = join(tmpdir(), `praxis-ledger-test-${Date.now()}.jsonl`)
    try {
      const ledger = Ledger.open(tempLedgerPath, "cand-001")
      expect(ledger.current().records.length).toBe(0)
      expect(ledger.current().header.schema).toBe(LEDGER_SCHEMA)

      const rec1 = {
        recordId: "rec-1",
        capturedAt: new Date().toISOString(),
        payload: { type: "test_output", passed: true },
      }

      const { index, merkleRoot } = ledger.append(rec1)
      expect(index).toBe(0)
      expect(merkleRoot.length).toBe(64)
      expect(ledger.verifyIntegrity()).toBe(true)

      // Re-open in read-only mode and verify
      const reopened = Ledger.openReadOnly(tempLedgerPath, "cand-001")
      expect(reopened.current().records.length).toBe(1)
      expect(reopened.current().records[0].recordId).toBe("rec-1")
      expect(reopened.verifyIntegrity()).toBe(true)
    } finally {
      if (existsSync(tempLedgerPath)) {
        rmSync(tempLedgerPath)
      }
    }
  })
})
