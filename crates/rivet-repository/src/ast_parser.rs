//! # rivet-repository::ast_parser
//!
//! Multi-language AST and Symbol Extractor for Rust, TypeScript/JavaScript, Python, and Go.
//! Extracts structured definitions, imports, test targets, and symbol call relations to
//! populate the authoritative Project Graph.

use crate::project_graph::{EdgeKind, EdgeProvenance, NodeKind, ProjectGraph};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SymbolKind {
    Function,
    Method,
    Struct,
    Class,
    Interface,
    Trait,
    Enum,
    TypeAlias,
    Constant,
    Module,
    TestFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedSymbol {
    pub name: String,
    pub symbol_uri: String,
    pub kind: SymbolKind,
    pub line_number: usize,
    pub byte_start: usize,
    pub byte_end: usize,
    pub signature: String,
    pub docstring: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedFileAst {
    pub file_path: String,
    pub file_uri: String,
    pub language: String,
    pub symbols: Vec<ExtractedSymbol>,
    pub imports: Vec<String>,
    pub test_targets: Vec<String>,
}

pub struct AstParser;

impl AstParser {
    /// Detect programming language from file extension
    pub fn detect_language(path: &Path) -> Option<&'static str> {
        let ext = path.extension()?.to_str()?.to_lowercase();
        match ext.as_str() {
            "rs" => Some("rust"),
            "ts" | "tsx" => Some("typescript"),
            "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
            "py" => Some("python"),
            "go" => Some("go"),
            _ => None,
        }
    }

    /// Parse source code content into structured AST symbols
    pub fn parse_source(file_path: &str, content: &str) -> ExtractedFileAst {
        let path = Path::new(file_path);
        let language = Self::detect_language(path).unwrap_or("generic");
        let file_uri = format!("file://{}", file_path);

        let mut symbols = Vec::new();
        let mut imports = Vec::new();
        let mut test_targets = Vec::new();

        match language {
            "rust" => Self::parse_rust(
                file_path,
                content,
                &mut symbols,
                &mut imports,
                &mut test_targets,
            ),
            "typescript" | "javascript" => Self::parse_js_ts(
                file_path,
                content,
                &mut symbols,
                &mut imports,
                &mut test_targets,
            ),
            "python" => Self::parse_python(
                file_path,
                content,
                &mut symbols,
                &mut imports,
                &mut test_targets,
            ),
            "go" => Self::parse_go(
                file_path,
                content,
                &mut symbols,
                &mut imports,
                &mut test_targets,
            ),
            _ => Self::parse_generic(file_path, content, &mut symbols),
        }

        ExtractedFileAst {
            file_path: file_path.to_string(),
            file_uri,
            language: language.to_string(),
            symbols,
            imports,
            test_targets,
        }
    }

    fn parse_rust(
        file_path: &str,
        content: &str,
        symbols: &mut Vec<ExtractedSymbol>,
        imports: &mut Vec<String>,
        test_targets: &mut Vec<String>,
    ) {
        let lines: Vec<&str> = content.lines().collect();
        let mut current_byte = 0;
        let mut is_test_next = false;

        for (idx, line) in lines.iter().enumerate() {
            let line_len = line.len() + 1; // +1 for newline
            let trimmed = line.trim();

            if trimmed.contains("#[test]") || trimmed.contains("#[tokio::test]") {
                is_test_next = true;
                current_byte += line_len;
                continue;
            }

            if trimmed.starts_with("use ") {
                let imp = trimmed
                    .trim_start_matches("use ")
                    .trim_end_matches(';')
                    .trim();
                imports.push(imp.to_string());
            } else if trimmed.starts_with("pub fn ")
                || trimmed.starts_with("fn ")
                || trimmed.starts_with("pub async fn ")
                || trimmed.starts_with("async fn ")
            {
                if let Some(name) = Self::extract_identifier(trimmed, "fn") {
                    let kind = if is_test_next {
                        test_targets.push(name.clone());
                        SymbolKind::TestFunction
                    } else {
                        SymbolKind::Function
                    };
                    symbols.push(ExtractedSymbol {
                        symbol_uri: format!("symbol://{}/{}", file_path, name),
                        name,
                        kind,
                        line_number: idx + 1,
                        byte_start: current_byte,
                        byte_end: current_byte + line.len(),
                        signature: trimmed.to_string(),
                        docstring: None,
                    });
                }
                is_test_next = false;
            } else if (trimmed.starts_with("pub struct ") || trimmed.starts_with("struct "))
                && let Some(name) = Self::extract_identifier(trimmed, "struct")
            {
                symbols.push(ExtractedSymbol {
                    symbol_uri: format!("symbol://{}/{}", file_path, name),
                    name,
                    kind: SymbolKind::Struct,
                    line_number: idx + 1,
                    byte_start: current_byte,
                    byte_end: current_byte + line.len(),
                    signature: trimmed.to_string(),
                    docstring: None,
                });
            } else if (trimmed.starts_with("pub enum ") || trimmed.starts_with("enum "))
                && let Some(name) = Self::extract_identifier(trimmed, "enum")
            {
                symbols.push(ExtractedSymbol {
                    symbol_uri: format!("symbol://{}/{}", file_path, name),
                    name,
                    kind: SymbolKind::Enum,
                    line_number: idx + 1,
                    byte_start: current_byte,
                    byte_end: current_byte + line.len(),
                    signature: trimmed.to_string(),
                    docstring: None,
                });
            } else if (trimmed.starts_with("pub trait ") || trimmed.starts_with("trait "))
                && let Some(name) = Self::extract_identifier(trimmed, "trait")
            {
                symbols.push(ExtractedSymbol {
                    symbol_uri: format!("symbol://{}/{}", file_path, name),
                    name,
                    kind: SymbolKind::Trait,
                    line_number: idx + 1,
                    byte_start: current_byte,
                    byte_end: current_byte + line.len(),
                    signature: trimmed.to_string(),
                    docstring: None,
                });
            }

            current_byte += line_len;
        }
    }

    fn parse_js_ts(
        file_path: &str,
        content: &str,
        symbols: &mut Vec<ExtractedSymbol>,
        imports: &mut Vec<String>,
        test_targets: &mut Vec<String>,
    ) {
        let lines: Vec<&str> = content.lines().collect();
        let mut current_byte = 0;

        for (idx, line) in lines.iter().enumerate() {
            let line_len = line.len() + 1;
            let trimmed = line.trim();

            if trimmed.starts_with("import ") {
                imports.push(trimmed.to_string());
            } else if trimmed.starts_with("function ")
                || trimmed.starts_with("export function ")
                || trimmed.starts_with("export async function ")
            {
                if let Some(name) = Self::extract_identifier(trimmed, "function") {
                    symbols.push(ExtractedSymbol {
                        symbol_uri: format!("symbol://{}/{}", file_path, name),
                        name,
                        kind: SymbolKind::Function,
                        line_number: idx + 1,
                        byte_start: current_byte,
                        byte_end: current_byte + line.len(),
                        signature: trimmed.to_string(),
                        docstring: None,
                    });
                }
            } else if trimmed.starts_with("class ") || trimmed.starts_with("export class ") {
                if let Some(name) = Self::extract_identifier(trimmed, "class") {
                    symbols.push(ExtractedSymbol {
                        symbol_uri: format!("symbol://{}/{}", file_path, name),
                        name,
                        kind: SymbolKind::Class,
                        line_number: idx + 1,
                        byte_start: current_byte,
                        byte_end: current_byte + line.len(),
                        signature: trimmed.to_string(),
                        docstring: None,
                    });
                }
            } else if trimmed.starts_with("interface ") || trimmed.starts_with("export interface ")
            {
                if let Some(name) = Self::extract_identifier(trimmed, "interface") {
                    symbols.push(ExtractedSymbol {
                        symbol_uri: format!("symbol://{}/{}", file_path, name),
                        name,
                        kind: SymbolKind::Interface,
                        line_number: idx + 1,
                        byte_start: current_byte,
                        byte_end: current_byte + line.len(),
                        signature: trimmed.to_string(),
                        docstring: None,
                    });
                }
            } else if trimmed.starts_with("it(") || trimmed.starts_with("test(") {
                if let Some(start) = trimmed.find('"').or_else(|| trimmed.find('\'')) {
                    if let Some(end) = trimmed[start + 1..]
                        .find('"')
                        .or_else(|| trimmed[start + 1..].find('\''))
                    {
                        let test_name = &trimmed[start + 1..start + 1 + end];
                        test_targets.push(test_name.to_string());
                        symbols.push(ExtractedSymbol {
                            symbol_uri: format!("symbol://{}/{}", file_path, test_name),
                            name: test_name.to_string(),
                            kind: SymbolKind::TestFunction,
                            line_number: idx + 1,
                            byte_start: current_byte,
                            byte_end: current_byte + line.len(),
                            signature: trimmed.to_string(),
                            docstring: None,
                        });
                    }
                }
            }

            current_byte += line_len;
        }
    }

    fn parse_python(
        file_path: &str,
        content: &str,
        symbols: &mut Vec<ExtractedSymbol>,
        imports: &mut Vec<String>,
        test_targets: &mut Vec<String>,
    ) {
        let lines: Vec<&str> = content.lines().collect();
        let mut current_byte = 0;

        for (idx, line) in lines.iter().enumerate() {
            let line_len = line.len() + 1;
            let trimmed = line.trim();

            if trimmed.starts_with("import ") || trimmed.starts_with("from ") {
                imports.push(trimmed.to_string());
            } else if trimmed.starts_with("def ") || trimmed.starts_with("async def ") {
                if let Some(name) = Self::extract_identifier(trimmed, "def") {
                    let kind = if name.starts_with("test_") {
                        test_targets.push(name.clone());
                        SymbolKind::TestFunction
                    } else {
                        SymbolKind::Function
                    };
                    symbols.push(ExtractedSymbol {
                        symbol_uri: format!("symbol://{}/{}", file_path, name),
                        name,
                        kind,
                        line_number: idx + 1,
                        byte_start: current_byte,
                        byte_end: current_byte + line.len(),
                        signature: trimmed.to_string(),
                        docstring: None,
                    });
                }
            } else if trimmed.starts_with("class ") {
                if let Some(name) = Self::extract_identifier(trimmed, "class") {
                    symbols.push(ExtractedSymbol {
                        symbol_uri: format!("symbol://{}/{}", file_path, name),
                        name,
                        kind: SymbolKind::Class,
                        line_number: idx + 1,
                        byte_start: current_byte,
                        byte_end: current_byte + line.len(),
                        signature: trimmed.to_string(),
                        docstring: None,
                    });
                }
            }

            current_byte += line_len;
        }
    }

    fn parse_go(
        file_path: &str,
        content: &str,
        symbols: &mut Vec<ExtractedSymbol>,
        imports: &mut Vec<String>,
        test_targets: &mut Vec<String>,
    ) {
        let lines: Vec<&str> = content.lines().collect();
        let mut current_byte = 0;

        for (idx, line) in lines.iter().enumerate() {
            let line_len = line.len() + 1;
            let trimmed = line.trim();

            if trimmed.starts_with("import ") {
                imports.push(trimmed.to_string());
            } else if trimmed.starts_with("func ") {
                if let Some(name) = Self::extract_identifier(trimmed, "func") {
                    let kind = if name.starts_with("Test") {
                        test_targets.push(name.clone());
                        SymbolKind::TestFunction
                    } else {
                        SymbolKind::Function
                    };
                    symbols.push(ExtractedSymbol {
                        symbol_uri: format!("symbol://{}/{}", file_path, name),
                        name,
                        kind,
                        line_number: idx + 1,
                        byte_start: current_byte,
                        byte_end: current_byte + line.len(),
                        signature: trimmed.to_string(),
                        docstring: None,
                    });
                }
            } else if trimmed.starts_with("type ") && trimmed.contains("struct") {
                if let Some(name) = Self::extract_identifier(trimmed, "type") {
                    symbols.push(ExtractedSymbol {
                        symbol_uri: format!("symbol://{}/{}", file_path, name),
                        name,
                        kind: SymbolKind::Struct,
                        line_number: idx + 1,
                        byte_start: current_byte,
                        byte_end: current_byte + line.len(),
                        signature: trimmed.to_string(),
                        docstring: None,
                    });
                }
            } else if trimmed.starts_with("type ") && trimmed.contains("interface") {
                if let Some(name) = Self::extract_identifier(trimmed, "type") {
                    symbols.push(ExtractedSymbol {
                        symbol_uri: format!("symbol://{}/{}", file_path, name),
                        name,
                        kind: SymbolKind::Interface,
                        line_number: idx + 1,
                        byte_start: current_byte,
                        byte_end: current_byte + line.len(),
                        signature: trimmed.to_string(),
                        docstring: None,
                    });
                }
            }

            current_byte += line_len;
        }
    }

    fn parse_generic(file_path: &str, content: &str, symbols: &mut Vec<ExtractedSymbol>) {
        // Fallback for unrecognized files
        symbols.push(ExtractedSymbol {
            name: file_path.to_string(),
            symbol_uri: format!("symbol://{}/root", file_path),
            kind: SymbolKind::Module,
            line_number: 1,
            byte_start: 0,
            byte_end: content.len(),
            signature: file_path.to_string(),
            docstring: None,
        });
    }

    fn extract_identifier(line: &str, keyword: &str) -> Option<String> {
        let after_keyword = line.split(keyword).nth(1)?.trim();
        let name: String = after_keyword
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if name.is_empty() { None } else { Some(name) }
    }

    /// Build a populated ProjectGraph by scanning a directory
    pub fn build_project_graph(files: &[(String, String)], repo_id: &str) -> ProjectGraph {
        let mut graph = ProjectGraph::new();
        graph.add_node(format!("repo://{}", repo_id), NodeKind::Repository, repo_id);

        let prov = EdgeProvenance {
            provider: "ast_parser".into(),
            repo_snapshot: "r0".into(),
            confidence: "authoritative".into(),
            evidence_refs: vec![],
        };

        for (rel_path, content) in files {
            let ast = Self::parse_source(rel_path, content);
            let file_node_id = format!("file://{}", rel_path);

            graph.add_node_with_metadata(
                file_node_id.clone(),
                NodeKind::SourceFile,
                rel_path.clone(),
                serde_json::json!({
                    "language": ast.language,
                    "symbols_count": ast.symbols.len(),
                    "imports_count": ast.imports.len(),
                }),
            );

            graph.add_edge(
                format!("repo://{}", repo_id),
                file_node_id.clone(),
                EdgeKind::Defines,
                prov.clone(),
            );

            for sym in &ast.symbols {
                graph.add_node_with_metadata(
                    sym.symbol_uri.clone(),
                    NodeKind::Symbol,
                    sym.name.clone(),
                    serde_json::json!({
                        "kind": format!("{:?}", sym.kind),
                        "line": sym.line_number,
                        "signature": sym.signature,
                    }),
                );

                graph.add_edge(
                    file_node_id.clone(),
                    sym.symbol_uri.clone(),
                    EdgeKind::Defines,
                    prov.clone(),
                );
            }

            for test in &ast.test_targets {
                let test_uri = format!("test://{}/{}", rel_path, test);
                graph.add_node(test_uri.clone(), NodeKind::TestTarget, test.clone());
                graph.add_edge(
                    test_uri,
                    file_node_id.clone(),
                    EdgeKind::TestedBy,
                    prov.clone(),
                );
            }
        }

        graph
    }
}
