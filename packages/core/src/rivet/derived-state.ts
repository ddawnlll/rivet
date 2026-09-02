import type { ClaimRecord } from "./noesis"
import { Scope, Revision, type ClaimId } from "./types"

export interface DerivedFact {
  readonly property: string
  readonly value: string
  readonly source: string
  readonly derivedAtRevision: Revision
}

export interface LiveEnvironmentCensus {
  readonly primaryLanguages: readonly string[]
  readonly manifestFiles: readonly string[]
  readonly buildSystems: readonly string[]
  readonly sourceExtensions: readonly string[]
  readonly totalTrackedFiles: number
}

/**
 * DerivedStateProjector generates cheap, deterministically derivable facts
 * from live repository filesystem signals without fossilizing them into durable Hard State.
 */
export class DerivedStateProjector {
  /**
   * Derives live repository census from a list of relative file paths in the workspace.
   */
  static projectFromFiles(files: readonly string[], revision: Revision = Revision.ZERO): LiveEnvironmentCensus {
    const manifests: string[] = []
    const buildSystems: string[] = []
    const extCounts = new Map<string, number>()

    for (const file of files) {
      const lower = file.toLowerCase()
      const base = lower.split("/").pop() ?? lower

      if (base === "cargo.toml") {
        manifests.push("Cargo.toml")
        if (!buildSystems.includes("cargo")) buildSystems.push("cargo")
      } else if (base === "package.json") {
        manifests.push("package.json")
        if (!buildSystems.includes("bun") && !buildSystems.includes("node")) buildSystems.push("bun")
      } else if (base === "pyproject.toml" || base === "requirements.txt" || base === "setup.py") {
        manifests.push(base)
        if (!buildSystems.includes("pytest")) buildSystems.push("pytest")
      } else if (base === "go.mod") {
        manifests.push("go.mod")
        if (!buildSystems.includes("go")) buildSystems.push("go")
      }

      const dotIdx = base.lastIndexOf(".")
      if (dotIdx > 0) {
        const ext = base.slice(dotIdx + 1)
        extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1)
      }
    }

    const primaryLanguages: string[] = []
    if (extCounts.get("rs") || manifests.includes("Cargo.toml")) primaryLanguages.push("Rust")
    if (extCounts.get("ts") || extCounts.get("js") || manifests.includes("package.json")) primaryLanguages.push("TypeScript")
    if (extCounts.get("py") || manifests.includes("pyproject.toml")) primaryLanguages.push("Python")
    if (extCounts.get("go") || manifests.includes("go.mod")) primaryLanguages.push("Go")

    return {
      primaryLanguages,
      manifestFiles: manifests,
      buildSystems,
      sourceExtensions: Array.from(extCounts.keys()),
      totalTrackedFiles: files.length,
    }
  }

  /**
   * Generates dynamic DerivedFact projections from live census data.
   */
  static generateDerivedFacts(census: LiveEnvironmentCensus, revision: Revision = Revision.ZERO): readonly DerivedFact[] {
    const facts: DerivedFact[] = []

    if (census.primaryLanguages.length > 0) {
      facts.push({
        property: "primary_language",
        value: census.primaryLanguages.join(", "),
        source: "live_filesystem_census",
        derivedAtRevision: revision,
      })
    }

    if (census.manifestFiles.length > 0) {
      facts.push({
        property: "detected_manifests",
        value: census.manifestFiles.join(", "),
        source: "live_manifest_detection",
        derivedAtRevision: revision,
      })
    }

    if (census.buildSystems.length > 0) {
      facts.push({
        property: "build_systems",
        value: census.buildSystems.join(", "),
        source: "live_build_detection",
        derivedAtRevision: revision,
      })
    }

    return facts
  }

  /**
   * Validates whether a claim with DERIVED_STATE policy matches the live environment.
   * If live facts disagree with the claim, it must be marked stale/invalid.
   */
  static validateDerivedClaim(claim: ClaimRecord, census: LiveEnvironmentCensus): { readonly isValid: boolean; readonly reason?: string } {
    if (claim.validityPolicy !== "DERIVED_STATE") {
      return { isValid: true }
    }

    const lower = claim.proposition.toLowerCase()
    // If claim asserts Python as primary language but Python is not in primary languages
    if (lower.includes("primary implementation language is python") || lower.includes("project language is python")) {
      if (!census.primaryLanguages.includes("Python") && (census.primaryLanguages.includes("Rust") || census.primaryLanguages.includes("TypeScript"))) {
        return {
          isValid: false,
          reason: `Derived state mismatch: Live census shows ${census.primaryLanguages.join(", ")} but claim asserts Python`,
        }
      }
    }

    // If claim asserts a manifest that no longer exists
    for (const dep of claim.dependencies) {
      if (dep.type === "manifest" && !census.manifestFiles.some((m) => m.toLowerCase() === dep.name.toLowerCase())) {
        return {
          isValid: false,
          reason: `Derived manifest dependency '${dep.name}' is missing in live environment`,
        }
      }
    }

    return { isValid: true }
  }
}
