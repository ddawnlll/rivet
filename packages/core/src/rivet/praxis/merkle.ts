import { createHash } from "crypto"

export const MERKLE_LEAF_PREFIX = 0x00
export const MERKLE_NODE_PREFIX = 0x01
export const DOMAIN_PREFIX = Buffer.from("praxis-merkle/v1\0", "utf8")

export interface MerkleProofStep {
  readonly side: "left" | "right" | "sibling"
  readonly hash: string // hex
}

export interface MerkleProof {
  readonly leafHash: string
  readonly leafIndex: number
  readonly steps: readonly MerkleProofStep[]
  readonly root: string
  readonly treeSize: number
}

export function hashLeaf(data: Uint8Array | string): Buffer {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)
  const hasher = createHash("sha256")
  hasher.update(DOMAIN_PREFIX)
  hasher.update(Buffer.from([MERKLE_LEAF_PREFIX]))
  hasher.update(bytes)
  return hasher.digest()
}

export function hashNode(left: Buffer, right?: Buffer): Buffer {
  const hasher = createHash("sha256")
  hasher.update(DOMAIN_PREFIX)
  hasher.update(Buffer.from([MERKLE_NODE_PREFIX]))
  hasher.update(left)
  if (right) {
    hasher.update(right)
  }
  return hasher.digest()
}

export function rootFromHashes(leafHashes: readonly Buffer[]): Buffer {
  if (leafHashes.length === 0) {
    const hasher = createHash("sha256")
    hasher.update(Buffer.from("praxis-merkle/v1\0EMPTY", "utf8"))
    return hasher.digest()
  }

  if (leafHashes.length === 1) {
    return leafHashes[0]
  }

  let currentLevel = [...leafHashes]
  while (currentLevel.length > 1) {
    const nextLevel: Buffer[] = []
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(hashNode(currentLevel[i], currentLevel[i + 1]))
      } else {
        // CVE-2012-2459 collision prevention: domain-separated single-child hashing
        nextLevel.push(hashNode(currentLevel[i]))
      }
    }
    currentLevel = nextLevel
  }

  return currentLevel[0]
}

export function rootFromRecords(records: readonly (Uint8Array | string)[]): Buffer {
  if (records.length === 0) {
    return rootFromHashes([])
  }
  const leaves = records.map((r) => hashLeaf(r))
  return rootFromHashes(leaves)
}

export function inclusionProof(
  leafHashes: readonly Buffer[],
  index: number
): MerkleProof {
  if (leafHashes.length === 0) {
    throw new Error("Cannot prove inclusion in an empty tree")
  }
  if (index < 0 || index >= leafHashes.length) {
    throw new Error(`Leaf index out of range: ${index}`)
  }

  const steps: MerkleProofStep[] = []
  let currentLevel = [...leafHashes]
  let currentIndex = index

  while (currentLevel.length > 1) {
    const nextLevel: Buffer[] = []
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        if (i === currentIndex) {
          steps.push({
            side: "right",
            hash: currentLevel[i + 1].toString("hex"),
          })
        } else if (i + 1 === currentIndex) {
          steps.push({
            side: "left",
            hash: currentLevel[i].toString("hex"),
          })
        }
        nextLevel.push(hashNode(currentLevel[i], currentLevel[i + 1]))
      } else {
        if (i === currentIndex) {
          steps.push({
            side: "sibling",
            hash: "", // lone node
          })
        }
        nextLevel.push(hashNode(currentLevel[i]))
      }
    }
    currentIndex = Math.floor(currentIndex / 2)
    currentLevel = nextLevel
  }

  const root = currentLevel[0].toString("hex")
  return {
    leafHash: leafHashes[index].toString("hex"),
    leafIndex: index,
    steps,
    root,
    treeSize: leafHashes.length,
  }
}

export function verifyProof(proof: MerkleProof, rootHex: string): boolean {
  if (rootHex !== proof.root) {
    return false
  }

  let currentHash: Buffer = Buffer.from(proof.leafHash, "hex")

  for (const step of proof.steps) {
    if (!step.hash) {
      // Lone node hashed alone
      currentHash = hashNode(currentHash)
    } else {
      const siblingHash = Buffer.from(step.hash, "hex")
      if (step.side === "right") {
        currentHash = hashNode(currentHash, siblingHash)
      } else if (step.side === "left") {
        currentHash = hashNode(siblingHash, currentHash)
      } else {
        currentHash = hashNode(currentHash, siblingHash)
      }
    }
  }

  return currentHash.toString("hex") === rootHex
}
