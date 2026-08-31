//! # rivet-runtime::semantic_patch
//!
//! Semantic AST / Symbol-Based Structural Patch Engine (`symbol://` URIs).
//! Enforces CAS revision validation (Invariant I-07) and atomic code mutations.

use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PatchOperation {
    ReplaceBody,
    InsertBefore,
    InsertAfter,
    RenameSymbol,
    DeleteSymbol,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchIntent {
    pub target: String,
    pub expected_revision: Revision,
    pub operation: PatchOperation,
    pub proposed_artifact: String,
    pub new_symbol_name: Option<String>,
}

pub struct SemanticPatchEngine;

impl SemanticPatchEngine {
    /// Apply a structural semantic patch intent to a file
    pub async fn apply_patch(
        working_dir: &Path,
        intent: &PatchIntent,
        current_revision: Revision,
    ) -> RivetResult<String> {
        // Enforce Invariant I-07: Stale revision rejection (CAS check)
        if intent.expected_revision != current_revision {
            return Err(RivetError::StaleState {
                expected: intent.expected_revision,
                actual: current_revision,
            });
        }

        let (file_path, symbol_name) = Self::parse_symbol_uri(&intent.target)?;
        let full_path = working_dir.join(&file_path);

        if !tokio::fs::try_exists(&full_path).await.unwrap_or(false) {
            return Err(RivetError::InvalidPath(format!(
                "Target file '{}' does not exist",
                file_path
            )));
        }

        let content = tokio::fs::read_to_string(&full_path)
            .await
            .map_err(|e| RivetError::Runtime(e.to_string()))?;

        let modified_content = Self::apply_structural_operation(
            &content,
            &symbol_name,
            intent.operation,
            &intent.proposed_artifact,
            intent.new_symbol_name.as_deref(),
        )?;

        // Atomic write
        let temp_name = format!(
            ".{}.patch-tmp-{}",
            full_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file"),
            uuid::Uuid::new_v4().simple()
        );
        let temp_path = full_path.parent().unwrap_or(working_dir).join(temp_name);

        tokio::fs::write(&temp_path, &modified_content)
            .await
            .map_err(|e| RivetError::Runtime(e.to_string()))?;

        tokio::fs::rename(&temp_path, &full_path)
            .await
            .map_err(|e| RivetError::Runtime(e.to_string()))?;

        Ok(format!(
            "Successfully applied {:?} to symbol '{}' in '{}'",
            intent.operation, symbol_name, file_path
        ))
    }

    fn parse_symbol_uri(uri: &str) -> RivetResult<(String, String)> {
        let stripped = uri
            .strip_prefix("symbol://")
            .ok_or_else(|| RivetError::InvalidPath(format!("Invalid symbol URI: {}", uri)))?;

        let mut parts = stripped.rsplitn(2, '/');
        let symbol_name = parts
            .next()
            .ok_or_else(|| RivetError::InvalidPath(format!("Missing symbol name: {}", uri)))?;
        let file_path = parts.next().ok_or_else(|| {
            RivetError::InvalidPath(format!("Missing file path in symbol URI: {}", uri))
        })?;

        Ok((file_path.to_string(), symbol_name.to_string()))
    }

    fn apply_structural_operation(
        content: &str,
        symbol_name: &str,
        operation: PatchOperation,
        proposed_content: &str,
        new_name: Option<&str>,
    ) -> RivetResult<String> {
        let fn_header = format!("fn {}", symbol_name);
        let struct_header = format!("struct {}", symbol_name);
        let enum_header = format!("enum {}", symbol_name);

        let symbol_idx = content
            .find(&fn_header)
            .or_else(|| content.find(&struct_header))
            .or_else(|| content.find(&enum_header))
            .or_else(|| content.find(symbol_name))
            .ok_or_else(|| {
                RivetError::Runtime(format!("Symbol '{}' not found in content", symbol_name))
            })?;

        match operation {
            PatchOperation::InsertBefore => {
                let mut out = String::with_capacity(content.len() + proposed_content.len() + 2);
                out.push_str(&content[..symbol_idx]);
                out.push_str(proposed_content);
                out.push('\n');
                out.push_str(&content[symbol_idx..]);
                Ok(out)
            }
            PatchOperation::InsertAfter => {
                // Find closing brace of symbol
                let rest = &content[symbol_idx..];
                let block_end = Self::find_block_end(rest).unwrap_or(rest.len());
                let insert_idx = symbol_idx + block_end;

                let mut out = String::with_capacity(content.len() + proposed_content.len() + 2);
                out.push_str(&content[..insert_idx]);
                out.push('\n');
                out.push_str(proposed_content);
                out.push_str(&content[insert_idx..]);
                Ok(out)
            }
            PatchOperation::ReplaceBody => {
                let rest = &content[symbol_idx..];
                let block_end = Self::find_block_end(rest).unwrap_or(rest.len());
                let replace_end = symbol_idx + block_end;

                let mut out = String::with_capacity(content.len() + proposed_content.len());
                out.push_str(&content[..symbol_idx]);
                out.push_str(proposed_content);
                out.push_str(&content[replace_end..]);
                Ok(out)
            }
            PatchOperation::RenameSymbol => {
                let new_sym = new_name.ok_or_else(|| {
                    RivetError::Runtime("RenameSymbol operation requires new_symbol_name".into())
                })?;
                let mut out = content.to_string();
                out.replace_range(symbol_idx..symbol_idx + symbol_name.len(), new_sym);
                Ok(out)
            }
            PatchOperation::DeleteSymbol => {
                let rest = &content[symbol_idx..];
                let block_end = Self::find_block_end(rest).unwrap_or(rest.len());
                let delete_end = symbol_idx + block_end;

                let mut out = String::with_capacity(content.len());
                out.push_str(&content[..symbol_idx]);
                out.push_str(&content[delete_end..]);
                Ok(out)
            }
        }
    }

    fn find_block_end(slice: &str) -> Option<usize> {
        let mut depth = 0;
        let mut found_open = false;

        for (i, c) in slice.char_indices() {
            if c == '{' {
                depth += 1;
                found_open = true;
            } else if c == '}' {
                depth -= 1;
                if found_open && depth == 0 {
                    return Some(i + 1);
                }
            } else if c == ';' && !found_open {
                return Some(i + 1);
            }
        }

        if found_open { None } else { Some(slice.len()) }
    }
}
