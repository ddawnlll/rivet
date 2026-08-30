//! # praxis::merkle
//!
//! Domain-separated SHA-256 Merkle tree with deterministic odd-leaf handling
//! (RFC 6962-style). Used for EvidenceBundle.merkleRoot computation and
//! inclusion-proof verification.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MERKLE_LEAF_PREFIX: u8 = 0x00;
pub const MERKLE_NODE_PREFIX: u8 = 0x01;
const DOMAIN_PREFIX: &[u8] = b"praxis-merkle/v1\0";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MerkleProofStep {
    pub side: String, // "left" | "right"
    pub hash: String, // hex
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MerkleProof {
    pub leaf_hash: String,
    pub steps: Vec<MerkleProofStep>,
    pub root: String,
}

pub fn hash_leaf(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(DOMAIN_PREFIX);
    hasher.update([MERKLE_LEAF_PREFIX]);
    hasher.update(data);
    hasher.finalize().into()
}

pub fn hash_node(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(DOMAIN_PREFIX);
    hasher.update([MERKLE_NODE_PREFIX]);
    hasher.update(left);
    hasher.update(right);
    hasher.finalize().into()
}

/// Compute the Merkle root for a list of leaf hashes (already computed).
/// Duplicates the last leaf when a level has an odd number of nodes (RFC 6962).
pub fn root_from_hashes(leaf_hashes: &[[u8; 32]]) -> [u8; 32] {
    if leaf_hashes.is_empty() {
        let mut hasher = Sha256::new();
        hasher.update(b"praxis-merkle/v1\0EMPTY");
        return hasher.finalize().into();
    }

    let mut level = leaf_hashes.to_vec();
    while level.len() > 1 {
        let mut next = Vec::new();
        let mut i = 0;
        while i < level.len() {
            if i + 1 >= level.len() {
                next.push(hash_node(&level[i], &level[i]));
            } else {
                next.push(hash_node(&level[i], &level[i + 1]));
            }
            i += 2;
        }
        level = next;
    }
    level[0]
}

/// Build root from raw record byte arrays
pub fn root_from_records(records: &[&[u8]]) -> [u8; 32] {
    if records.is_empty() {
        return root_from_hashes(&[]);
    }
    let leaf_hashes: Vec<[u8; 32]> = records.iter().map(|r| hash_leaf(r)).collect();
    root_from_hashes(&leaf_hashes)
}

/// Compute inclusion proof for the leaf at `index`
pub fn inclusion_proof(leaf_hashes: &[[u8; 32]], index: usize) -> Result<MerkleProof, String> {
    if leaf_hashes.is_empty() {
        return Err("Cannot prove inclusion in an empty tree".into());
    }
    if index >= leaf_hashes.len() {
        return Err(format!("Leaf index out of range: {}", index));
    }

    let mut steps = Vec::new();
    let mut level = leaf_hashes.to_vec();
    let mut i = index;

    while level.len() > 1 {
        let is_last_odd = level.len() % 2 == 1 && i == level.len() - 1;
        let sibling = if is_last_odd { level[i] } else { level[i ^ 1] };

        steps.push(MerkleProofStep {
            side: if (i & 1) == 0 {
                "right".into()
            } else {
                "left".into()
            },
            hash: hex::encode(sibling),
        });

        let mut next = Vec::new();
        let mut j = 0;
        while j < level.len() {
            if j + 1 >= level.len() {
                next.push(hash_node(&level[j], &level[j]));
            } else {
                next.push(hash_node(&level[j], &level[j + 1]));
            }
            j += 2;
        }
        level = next;
        i /= 2;
    }

    Ok(MerkleProof {
        leaf_hash: hex::encode(leaf_hashes[index]),
        steps,
        root: hex::encode(level[0]),
    })
}

/// Verify an inclusion proof against an expected root hex string
pub fn verify_proof(proof: &MerkleProof, root_hex: &str) -> bool {
    let Ok(current) = hex::decode(&proof.leaf_hash) else {
        return false;
    };
    if current.len() != 32 {
        return false;
    }

    let mut curr_arr = [0u8; 32];
    curr_arr.copy_from_slice(&current);

    for step in &proof.steps {
        let Ok(sib_bytes) = hex::decode(&step.hash) else {
            return false;
        };
        if sib_bytes.len() != 32 {
            return false;
        }
        let mut sib_arr = [0u8; 32];
        sib_arr.copy_from_slice(&sib_bytes);

        if step.side == "left" {
            curr_arr = hash_node(&sib_arr, &curr_arr);
        } else {
            curr_arr = hash_node(&curr_arr, &sib_arr);
        }
    }

    let computed_hex = hex::encode(curr_arr);
    computed_hex == root_hex && root_hex == proof.root
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merkle_empty_root() {
        let root = root_from_records(&[]);
        assert_eq!(hex::encode(root).len(), 64);
    }

    #[test]
    fn test_merkle_tree_and_proofs() {
        let records = vec![
            b"record-1".as_slice(),
            b"record-2".as_slice(),
            b"record-3".as_slice(),
            b"record-4".as_slice(),
            b"record-5".as_slice(),
        ];

        let leaves: Vec<[u8; 32]> = records.iter().map(|r| hash_leaf(r)).collect();
        let root = root_from_hashes(&leaves);
        let root_hex = hex::encode(root);

        for i in 0..records.len() {
            let proof = inclusion_proof(&leaves, i).unwrap();
            assert!(verify_proof(&proof, &root_hex));
        }
    }
}
