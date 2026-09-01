import { describe, expect, test } from "bun:test"
import {
  PraxisEngine,
  CargoTestParser,
  BunTestParser,
  PytestParser,
  GoTestParser,
  MerkleTree,
} from "../../src/rivet/praxis"
import {
  Revision,
  Scope,
  createObligationId,
} from "../../src/rivet/types"
import type { VerificationRequest } from "../../src/rivet/accp"

describe("Praxis Mechanical Verification Engine", () => {
  test("Cargo test output parser", () => {
    const stdout = `
running 2 tests
test tests::test_one ... ok
test tests::test_two ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
`
    const report = CargoTestParser.parse(stdout)
    expect(report.passedCount).toBe(2)
    expect(report.failedCount).toBe(0)
    expect(report.skippedCount).toBe(0)
  })

  test("Bun test output parser", () => {
    const stdout = `
bun test v1.3.14 (0d9b296a)

test/rivet/accp.test.ts:
(pass) ACCP 3.0 Protocol > Producer matrix validation [1.68ms]
(pass) ACCP 3.0 Protocol > Claim proposal validation [0.57ms]

 2 pass
 0 fail
 2 expect() calls
Ran 2 tests across 1 file. [10.00ms]
`
    const report = BunTestParser.parse(stdout)
    expect(report.passedCount).toBe(2)
    expect(report.failedCount).toBe(0)
  })

  test("Pytest output parser", () => {
    const stdout = `
========================= 5 passed, 1 skipped in 0.12s =========================
`
    const report = PytestParser.parse(stdout)
    expect(report.passedCount).toBe(5)
    expect(report.failedCount).toBe(0)
    expect(report.skippedCount).toBe(1)
  })

  test("Go test output parser", () => {
    const stdout = `
=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestSubtract
--- PASS: TestSubtract (0.00s)
PASS
ok      example.com/math    0.002s
`
    const report = GoTestParser.parse(stdout)
    expect(report.passedCount).toBe(2)
    expect(report.failedCount).toBe(0)
  })

  test("Praxis evaluates test results and issues signed VerificationReceipt", () => {
    const req: VerificationRequest = {
      obligationId: createObligationId(),
      predicate: "bun test",
      targetScope: Scope.global("rivet", Revision.ZERO),
      timeoutSeconds: 30,
      timestamp: new Date().toISOString(),
    }

    const report = {
      passedCount: 3,
      failedCount: 0,
      skippedCount: 0,
      rawStdout: "3 pass",
      rawStderr: "",
    }

    const receipt = PraxisEngine.evaluateTestResult(req, report)
    expect(receipt.passed).toBe(true)
    expect(receipt.obligationId).toBe(req.obligationId)
    expect(receipt.verifiedScope.repository).toBe("rivet")
    expect(receipt.diagnostics).toBeNull()

    const failedReport = {
      passedCount: 2,
      failedCount: 1,
      skippedCount: 0,
      rawStdout: "2 pass 1 fail",
      rawStderr: "Error: assertion failed",
    }

    const failedReceipt = PraxisEngine.evaluateTestResult(req, failedReport)
    expect(failedReceipt.passed).toBe(false)
    expect(failedReceipt.diagnostics).toContain("failed")
  })

  test("Merkle Tree computes deterministic root hash", () => {
    const h1 = MerkleTree.hashLeaf("evidence_1")
    const h2 = MerkleTree.hashLeaf("evidence_2")
    const root = MerkleTree.rootFromHashes([h1, h2])

    expect(typeof root).toBe("string")
    expect(root.length).toBe(64) // SHA-256 hex
    expect(MerkleTree.rootFromHashes([h1, h2])).toBe(root) // Determinism
  })

  test("Praxis 8-gate evaluation", () => {
    const results = PraxisEngine.evaluateGates({
      schemaValid: true,
      locksValid: true,
      evidenceReferenced: true,
      executionSuccess: true,
      testsPassed: true,
    })

    expect(results.length).toBe(5)
    expect(results.every((g) => g.passed)).toBe(true)
  })
})
