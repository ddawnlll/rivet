//! # praxis::merkle
//!
//! Production-grade RFC 6962-style domain-separated SHA-256 Merkle tree implementation
//! backed by `rs_merkle`. Used for EvidenceBundle.merkleRoot computation and
//! inclusion-proof verification with CVE-2012-2459 collision prevention.

use rs_merkle::{Hasher, MerkleProof as RsMerkleProof, MerkleTree};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MERKLE_LEAF_PREFIX: u8 = 0x00;
pub const MERKLE_NODE_PREFIX: u8 = 0x01;
pub const DOMAIN_PREFIX: &[u8] = b"praxis-merkle/v1\0";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RivetReceiptHasher;

impl Hasher for RivetReceiptHasher {
    type Hash = [u8; 32];

    fn hash(data: &[u8]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(DOMAIN_PREFIX);
        hasher.update([MERKLE_LEAF_PREFIX]);
        hasher.update(data);
        hasher.finalize().into()
    }

    fn concat_and_hash(left: &[u8; 32], right: Option<&[u8; 32]>) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(DOMAIN_PREFIX);
        hasher.update([MERKLE_NODE_PREFIX]);
        hasher.update(left);
        if let Some(right) = right {
            hasher.update(right);
        }
        hasher.finalize().into()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MerkleProofStep {
    pub side: String, // "left" | "right" | "sibling"
    pub hash: String, // hex
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MerkleProof {
    pub leaf_hash: String,
    #[serde(default)]
    pub leaf_index: usize,
    pub steps: Vec<MerkleProofStep>,
    pub root: String,
    #[serde(default)]
    pub tree_size: usize,
}

pub fn hash_leaf(data: &[u8]) -> [u8; 32] {
    RivetReceiptHasher::hash(data)
}

pub fn hash_node(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    RivetReceiptHasher::concat_and_hash(left, Some(right))
}

pub fn root_from_hashes(leaf_hashes: &[[u8; 32]]) -> [u8; 32] {
    if leaf_hashes.is_empty() {
        let mut hasher = Sha256::new();
        hasher.update(b"praxis-merkle/v1\0EMPTY");
        return hasher.finalize().into();
    }
    let tree = MerkleTree::<RivetReceiptHasher>::from_leaves(leaf_hashes);
    tree.root().unwrap_or_else(|| {
        let mut hasher = Sha256::new();
        hasher.update(b"praxis-merkle/v1\0EMPTY");
        hasher.finalize().into()
    })
}

pub fn root_from_records(records: &[&[u8]]) -> [u8; 32] {
    if records.is_empty() {
        return root_from_hashes(&[]);
    }
    let leaf_hashes: Vec<[u8; 32]> = records.iter().map(|r| hash_leaf(r)).collect();
    root_from_hashes(&leaf_hashes)
}

pub fn inclusion_proof(leaf_hashes: &[[u8; 32]], index: usize) -> Result<MerkleProof, String> {
    if leaf_hashes.is_empty() {
        return Err("Cannot prove inclusion in an empty tree".into());
    }
    if index >= leaf_hashes.len() {
        return Err(format!("Leaf index out of range: {}", index));
    }

    let tree = MerkleTree::<RivetReceiptHasher>::from_leaves(leaf_hashes);
    let root = tree
        .root()
        .ok_or_else(|| "Failed to compute root".to_string())?;
    let proof = tree.proof(&[index]);
    let proof_hashes = proof.proof_hashes();

    let mut steps = Vec::new();
    for hash in proof_hashes {
        steps.push(MerkleProofStep {
            side: "sibling".into(),
            hash: hex::encode(hash),
        });
    }

    Ok(MerkleProof {
        leaf_hash: hex::encode(leaf_hashes[index]),
        leaf_index: index,
        steps,
        root: hex::encode(root),
        tree_size: leaf_hashes.len(),
    })
}

pub fn verify_proof(proof: &MerkleProof, root_hex: &str) -> bool {
    if root_hex != proof.root {
        return false;
    }
    let Ok(leaf_bytes) = hex::decode(&proof.leaf_hash) else {
        return false;
    };
    if leaf_bytes.len() != 32 {
        return false;
    }
    let mut leaf_arr = [0u8; 32];
    leaf_arr.copy_from_slice(&leaf_bytes);

    let Ok(root_bytes) = hex::decode(root_hex) else {
        return false;
    };
    if root_bytes.len() != 32 {
        return false;
    }
    let mut root_arr = [0u8; 32];
    root_arr.copy_from_slice(&root_bytes);

    let mut sibling_hashes = Vec::new();
    for step in &proof.steps {
        let Ok(s_bytes) = hex::decode(&step.hash) else {
            return false;
        };
        if s_bytes.len() != 32 {
            return false;
        }
        let mut s_arr = [0u8; 32];
        s_arr.copy_from_slice(&s_bytes);
        sibling_hashes.push(s_arr);
    }

    let rs_proof = RsMerkleProof::<RivetReceiptHasher>::new(sibling_hashes);
    rs_proof.verify(
        root_arr,
        &[proof.leaf_index],
        &[leaf_arr],
        proof.tree_size.max(1),
    )
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
        let records = [
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

    #[test]
    fn test_merkle_collision_resistance_odd_leaves() {
        // CVE-2012-2459 resistance: [A, B, C] must not collide with [A, B, C, C]
        let a = b"item-a".as_slice();
        let b = b"item-b".as_slice();
        let c = b"item-c".as_slice();

        let root_abc = root_from_records(&[a, b, c]);
        let root_abcc = root_from_records(&[a, b, c, c]);

        assert_ne!(
            root_abc, root_abcc,
            "Odd-leaf duplication collision CVE-2012-2459 prevented"
        );
    }
}
