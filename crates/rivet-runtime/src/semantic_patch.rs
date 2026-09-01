//! # rivet-runtime::semantic_patch
//!
//! Production AST / Symbol-Based Structural Patch Engine (`symbol://` URIs)
//! powered by `tree-sitter` concrete syntax trees and `similar` diff rendering.
//! Enforces CAS revision validation (Invariant I-07) and atomic code mutations.

use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tree_sitter::{Node, Parser};

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
            &file_path,
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

    pub fn parse_symbol_uri(uri: &str) -> RivetResult<(String, String)> {
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

    pub fn apply_structural_operation(
        file_path: &str,
        content: &str,
        symbol_name: &str,
        operation: PatchOperation,
        proposed_content: &str,
        new_name: Option<&str>,
    ) -> RivetResult<String> {
        let ext = Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        let mut parser = Parser::new();
        let lang = match ext {
            "rs" => Some(tree_sitter_rust::LANGUAGE.into()),
            "py" => Some(tree_sitter_python::LANGUAGE.into()),
            "ts" | "tsx" | "js" | "jsx" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
            "go" => Some(tree_sitter_go::LANGUAGE.into()),
            _ => None,
        };

        if let Some(lang) = lang
            && parser.set_language(&lang).is_ok()
            && let Some(tree) = parser.parse(content, None)
        {
            let root = tree.root_node();
            let bytes = content.as_bytes();
            if let Some((start_byte, end_byte)) = Self::find_symbol_span(root, bytes, symbol_name) {
                return Self::execute_byte_mutation(
                    content,
                    start_byte,
                    end_byte,
                    symbol_name,
                    operation,
                    proposed_content,
                    new_name,
                );
            }
        }

        // Fallback for languages without loaded tree-sitter grammars or non-CST files
        Self::fallback_string_mutation(content, symbol_name, operation, proposed_content, new_name)
    }

    fn find_symbol_span(node: Node, bytes: &[u8], target_name: &str) -> Option<(usize, usize)> {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if let Some(name_node) = child.child_by_field_name("name")
                && let Ok(name) = name_node.utf8_text(bytes)
                && name == target_name
            {
                return Some((child.start_byte(), child.end_byte()));
            }
            if let Some(span) = Self::find_symbol_span(child, bytes, target_name) {
                return Some(span);
            }
        }
        None
    }

    fn execute_byte_mutation(
        content: &str,
        start_byte: usize,
        end_byte: usize,
        symbol_name: &str,
        operation: PatchOperation,
        proposed_content: &str,
        new_name: Option<&str>,
    ) -> RivetResult<String> {
        match operation {
            PatchOperation::InsertBefore => {
                let mut out = String::with_capacity(content.len() + proposed_content.len() + 2);
                out.push_str(&content[..start_byte]);
                out.push_str(proposed_content);
                out.push('\n');
                out.push_str(&content[start_byte..]);
                Ok(out)
            }
            PatchOperation::InsertAfter => {
                let mut out = String::with_capacity(content.len() + proposed_content.len() + 2);
                out.push_str(&content[..end_byte]);
                out.push('\n');
                out.push_str(proposed_content);
                out.push_str(&content[end_byte..]);
                Ok(out)
            }
            PatchOperation::ReplaceBody => {
                let mut out = String::with_capacity(content.len() + proposed_content.len());
                out.push_str(&content[..start_byte]);
                out.push_str(proposed_content);
                out.push_str(&content[end_byte..]);
                Ok(out)
            }
            PatchOperation::RenameSymbol => {
                let new_sym = new_name.ok_or_else(|| {
                    RivetError::Runtime("RenameSymbol operation requires new_symbol_name".into())
                })?;
                let node_slice = &content[start_byte..end_byte];
                let replaced_slice = node_slice.replacen(symbol_name, new_sym, 1);
                let mut out = String::with_capacity(content.len() + new_sym.len());
                out.push_str(&content[..start_byte]);
                out.push_str(&replaced_slice);
                out.push_str(&content[end_byte..]);
                Ok(out)
            }
            PatchOperation::DeleteSymbol => {
                let mut out = String::with_capacity(content.len());
                out.push_str(&content[..start_byte]);
                out.push_str(&content[end_byte..]);
                Ok(out)
            }
        }
    }

    fn fallback_string_mutation(
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

        let rest = &content[symbol_idx..];
        let block_end = Self::find_block_end(rest).unwrap_or(rest.len());
        let end_idx = symbol_idx + block_end;

        Self::execute_byte_mutation(
            content,
            symbol_idx,
            end_idx,
            symbol_name,
            operation,
            proposed_content,
            new_name,
        )
    }

    fn find_block_end(slice: &str) -> Option<usize> {
        let mut depth = 0;
        let mut found_open = false;
        let mut in_string = false;
        let mut in_char = false;
        let mut escape = false;
        let mut in_line_comment = false;
        let mut in_block_comment = false;
        let mut prev_char = '\0';

        for (i, c) in slice.char_indices() {
            if in_line_comment {
                if c == '\n' {
                    in_line_comment = false;
                }
                prev_char = c;
                continue;
            }
            if in_block_comment {
                if prev_char == '*' && c == '/' {
                    in_block_comment = false;
                }
                prev_char = c;
                continue;
            }
            if in_string {
                if escape {
                    escape = false;
                } else if c == '\\' {
                    escape = true;
                } else if c == '"' {
                    in_string = false;
                }
                prev_char = c;
                continue;
            }
            if in_char {
                if escape {
                    escape = false;
                } else if c == '\\' {
                    escape = true;
                } else if c == '\'' {
                    in_char = false;
                }
                prev_char = c;
                continue;
            }

            if prev_char == '/' && c == '/' {
                in_line_comment = true;
                prev_char = c;
                continue;
            }
            if prev_char == '/' && c == '*' {
                in_block_comment = true;
                prev_char = c;
                continue;
            }

            match c {
                '"' => in_string = true,
                '\'' => in_char = true,
                '{' => {
                    depth += 1;
                    found_open = true;
                }
                '}' => {
                    depth -= 1;
                    if found_open && depth == 0 {
                        return Some(i + 1);
                    }
                }
                ';' if !found_open => {
                    return Some(i + 1);
                }
                _ => {}
            }
            prev_char = c;
        }

        if found_open { None } else { Some(slice.len()) }
    }
}
