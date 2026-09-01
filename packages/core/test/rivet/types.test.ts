import { describe, expect, test } from "bun:test"
import {
  Revision,
  Scope,
  isSafeRelativePath,
  shlexSplit,
  createSessionId,
  createClaimId,
} from "../../src/rivet/types"

describe("Rivet Types", () => {
  test("Revision ordering and formatting", () => {
    const r0 = Revision.ZERO
    const r1 = r0.next()
    const r2 = Revision.from(2)

    expect(r0.toString()).toBe("r0")
    expect(r1.toString()).toBe("r1")
    expect(r2.toString()).toBe("r2")
    expect(r1.equals(Revision.from(1))).toBe(true)
    expect(r1.equals(r2)).toBe(false)
  })

  test("Scope matching is revision and path bound", () => {
    const scope = Scope.path("repo", "src/**", Revision.from(3))
    expect(scope.allowsPath("repo", "src", Revision.from(3))).toBe(true)
    expect(scope.allowsPath("repo", "src/lib.ts", Revision.from(3))).toBe(true)
    expect(scope.allowsPath("repo", "src/nested/mod.ts", Revision.from(3))).toBe(true)
    expect(scope.allowsPath("repo", "tests/lib.ts", Revision.from(3))).toBe(false)
    expect(scope.allowsPath("repo", "src/lib.ts", Revision.from(4))).toBe(false)
    expect(scope.allowsPath("other", "src/lib.ts", Revision.from(3))).toBe(false)

    const shallow = Scope.path("repo", "src/*", Revision.from(3))
    expect(shallow.allowsPath("repo", "src/lib.ts", Revision.from(3))).toBe(true)
    expect(shallow.allowsPath("repo", "src/private/lib.ts", Revision.from(3))).toBe(false)
  })

  test("Scope containment", () => {
    const globalScope = Scope.global("repo", Revision.from(1))
    const subScope = Scope.path("repo", "src/**", Revision.from(1))
    const fileScope = Scope.path("repo", "src/file.ts", Revision.from(1))

    expect(globalScope.containsScope(subScope)).toBe(true)
    expect(subScope.containsScope(fileScope)).toBe(true)
    expect(subScope.containsScope(globalScope)).toBe(false)
  })

  test("Safe relative path check", () => {
    expect(isSafeRelativePath("src/lib.ts")).toBe(true)
    expect(isSafeRelativePath("../secrets.env")).toBe(false)
    expect(isSafeRelativePath("..\\secrets.env")).toBe(false)
    expect(isSafeRelativePath("foo/../../secrets.env")).toBe(false)
    expect(isSafeRelativePath("/etc/passwd")).toBe(false)
    expect(isSafeRelativePath("C:\\secrets.env")).toBe(false)
  })

  test("shlexSplit parses quotes and escapes", () => {
    const args = shlexSplit("bun test -- 'my test name' \"another arg\" test\\ with\\ space")
    expect(args).toEqual([
      "bun",
      "test",
      "--",
      "my test name",
      "another arg",
      "test with space",
    ])
  })

  test("Type-safe branded IDs", () => {
    const sId = createSessionId()
    const cId = createClaimId()
    expect(sId.startsWith("sess_")).toBe(true)
    expect(cId.startsWith("claim_")).toBe(true)
  })
})
