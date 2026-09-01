//! # rivet-repository::ast_parser
//!
//! Multi-language AST and Symbol Extractor for Rust, TypeScript/JavaScript, Python, and Go
//! backed by production-grade `tree-sitter` concrete syntax trees.
//! Extracts structured definitions, imports, test targets, and symbol call relations to
//! populate the authoritative Project Graph.

use crate::project_graph::{EdgeKind, EdgeProvenance, NodeKind, ProjectGraph};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tree_sitter::{Node, Parser};

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

pub type FileAst = ExtractedFileAst;

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

    /// Alias for parse_file for compatibility
    pub fn parse_source(file_path: &str, content: &str) -> ExtractedFileAst {
        Self::parse_file(file_path, content)
    }

    /// Parse a source file into an ExtractedFileAst using tree-sitter
    pub fn parse_file(file_path: &str, content: &str) -> ExtractedFileAst {
        let path = Path::new(file_path);
        let language = Self::detect_language(path).unwrap_or("unknown");
        let file_uri = format!("file://{file_path}");

        let mut symbols = Vec::new();
        let mut imports = Vec::new();
        let mut test_targets = Vec::new();

        let mut parser = Parser::new();
        let lang = match language {
            "rust" => Some(tree_sitter_rust::LANGUAGE.into()),
            "python" => Some(tree_sitter_python::LANGUAGE.into()),
            "typescript" | "javascript" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
            "go" => Some(tree_sitter_go::LANGUAGE.into()),
            _ => None,
        };

        if let Some(lang) = lang
            && parser.set_language(&lang).is_ok()
            && let Some(tree) = parser.parse(content, None)
        {
            let root_node = tree.root_node();
            let bytes = content.as_bytes();
            match language {
                "rust" => Self::extract_rust(
                    root_node,
                    bytes,
                    &file_uri,
                    &mut symbols,
                    &mut imports,
                    &mut test_targets,
                ),
                "python" => Self::extract_python(
                    root_node,
                    bytes,
                    &file_uri,
                    &mut symbols,
                    &mut imports,
                    &mut test_targets,
                ),
                "typescript" | "javascript" => Self::extract_ts_js(
                    root_node,
                    bytes,
                    &file_uri,
                    &mut symbols,
                    &mut imports,
                    &mut test_targets,
                ),
                "go" => Self::extract_go(
                    root_node,
                    bytes,
                    &file_uri,
                    &mut symbols,
                    &mut imports,
                    &mut test_targets,
                ),
                _ => {}
            }
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

    /// Walk AST and populate a ProjectGraph with File, Symbol, and Test nodes & edges
    pub fn populate_project_graph(graph: &mut ProjectGraph, ast: &ExtractedFileAst) {
        let file_node_id = ast.file_uri.clone();
        graph.add_node(&file_node_id, NodeKind::SourceFile, &ast.file_path);

        for sym in &ast.symbols {
            let (kind, sym_uri) = match sym.kind {
                SymbolKind::TestFunction => (
                    NodeKind::TestTarget,
                    format!("test://{}/{}", ast.file_path, sym.name),
                ),
                _ => (
                    NodeKind::Symbol,
                    format!("symbol://{}/{}", ast.file_path, sym.name),
                ),
            };
            graph.add_node(&sym_uri, kind, &sym.name);

            graph.add_edge(
                &file_node_id,
                &sym_uri,
                EdgeKind::Defines,
                EdgeProvenance::default(),
            );

            if sym.kind == SymbolKind::TestFunction {
                graph.add_edge(
                    &file_node_id,
                    &sym_uri,
                    EdgeKind::TestedBy,
                    EdgeProvenance::default(),
                );
            }
        }

        for imp in &ast.imports {
            let imp_uri = format!("import://{imp}");
            graph.add_node(&imp_uri, NodeKind::ExternalDependency, imp);
            graph.add_edge(
                &file_node_id,
                &imp_uri,
                EdgeKind::Imports,
                EdgeProvenance::default(),
            );
        }
    }

    /// Build a complete multi-file ProjectGraph for a repository
    pub fn build_project_graph(files: &[(String, String)], repo_name: &str) -> ProjectGraph {
        let mut graph = ProjectGraph::new();
        let repo_id = format!("repo://{repo_name}");
        graph.add_node(&repo_id, NodeKind::Repository, repo_name);

        for (path, content) in files {
            let ast = Self::parse_file(path, content);
            Self::populate_project_graph(&mut graph, &ast);
            graph.add_edge(
                &repo_id,
                &ast.file_uri,
                EdgeKind::Defines,
                EdgeProvenance::default(),
            );
        }

        graph
    }

    fn extract_rust(
        node: Node,
        bytes: &[u8],
        file_uri: &str,
        symbols: &mut Vec<ExtractedSymbol>,
        imports: &mut Vec<String>,
        test_targets: &mut Vec<String>,
    ) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            match child.kind() {
                "function_item" => {
                    let is_test = Self::rust_node_has_test_attr(child, bytes);
                    let name = child
                        .child_by_field_name("name")
                        .and_then(|n| n.utf8_text(bytes).ok())
                        .unwrap_or("anonymous")
                        .to_string();
                    let kind = if is_test {
                        test_targets.push(name.clone());
                        SymbolKind::TestFunction
                    } else {
                        SymbolKind::Function
                    };
                    let sig = Self::node_first_line(child, bytes);
                    symbols.push(ExtractedSymbol {
                        name: name.clone(),
                        symbol_uri: format!("{file_uri}#{name}"),
                        kind,
                        line_number: child.start_position().row + 1,
                        byte_start: child.start_byte(),
                        byte_end: child.end_byte(),
                        signature: sig,
                        docstring: Self::extract_doc_comments(child, bytes),
                    });
                }
                "struct_item" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind: SymbolKind::Struct,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: Self::node_first_line(child, bytes),
                            docstring: Self::extract_doc_comments(child, bytes),
                        });
                    }
                }
                "enum_item" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind: SymbolKind::Enum,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: Self::node_first_line(child, bytes),
                            docstring: Self::extract_doc_comments(child, bytes),
                        });
                    }
                }
                "trait_item" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind: SymbolKind::Trait,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: Self::node_first_line(child, bytes),
                            docstring: Self::extract_doc_comments(child, bytes),
                        });
                    }
                }
                "impl_item" => {
                    if let Some(body) = child.child_by_field_name("body") {
                        let mut impl_cursor = body.walk();
                        for item in body.children(&mut impl_cursor) {
                            if item.kind() == "function_item" {
                                let name = item
                                    .child_by_field_name("name")
                                    .and_then(|n| n.utf8_text(bytes).ok())
                                    .unwrap_or("anonymous")
                                    .to_string();
                                symbols.push(ExtractedSymbol {
                                    name: name.clone(),
                                    symbol_uri: format!("{file_uri}#{name}"),
                                    kind: SymbolKind::Method,
                                    line_number: item.start_position().row + 1,
                                    byte_start: item.start_byte(),
                                    byte_end: item.end_byte(),
                                    signature: Self::node_first_line(item, bytes),
                                    docstring: Self::extract_doc_comments(item, bytes),
                                });
                            }
                        }
                    }
                }
                "mod_item" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind: SymbolKind::Module,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: format!("mod {name};"),
                            docstring: None,
                        });
                    }
                }
                "use_declaration" => {
                    if let Ok(text) = child.utf8_text(bytes) {
                        let clean = text
                            .trim()
                            .trim_start_matches("use ")
                            .trim_end_matches(';')
                            .trim()
                            .to_string();
                        imports.push(clean);
                    }
                }
                _ => {
                    if child.child_count() > 0 {
                        Self::extract_rust(child, bytes, file_uri, symbols, imports, test_targets);
                    }
                }
            }
        }
    }

    fn rust_node_has_test_attr(node: Node, bytes: &[u8]) -> bool {
        let mut prev = node.prev_sibling();
        while let Some(sibling) = prev {
            if sibling.kind() == "attribute_item"
                && let Ok(text) = sibling.utf8_text(bytes)
                && text.contains("test")
            {
                return true;
            } else if sibling.kind() != "line_comment" && sibling.kind() != "block_comment" {
                break;
            }
            prev = sibling.prev_sibling();
        }
        false
    }

    fn extract_python(
        node: Node,
        bytes: &[u8],
        file_uri: &str,
        symbols: &mut Vec<ExtractedSymbol>,
        imports: &mut Vec<String>,
        test_targets: &mut Vec<String>,
    ) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            match child.kind() {
                "function_definition" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        let is_test = name.starts_with("test_") || name.ends_with("_test");
                        let kind = if is_test {
                            test_targets.push(name.to_string());
                            SymbolKind::TestFunction
                        } else {
                            SymbolKind::Function
                        };
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: Self::node_first_line(child, bytes),
                            docstring: None,
                        });
                    }
                }
                "class_definition" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind: SymbolKind::Class,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: Self::node_first_line(child, bytes),
                            docstring: None,
                        });
                    }
                    if let Some(body) = child.child_by_field_name("body") {
                        Self::extract_python(body, bytes, file_uri, symbols, imports, test_targets);
                    }
                }
                "import_statement" => {
                    if let Ok(text) = child.utf8_text(bytes) {
                        let clean = text.trim().trim_start_matches("import ").trim().to_string();
                        imports.push(clean);
                    }
                }
                "import_from_statement" => {
                    if let Ok(text) = child.utf8_text(bytes) {
                        let clean = text
                            .trim()
                            .trim_start_matches("from ")
                            .replace(" import ", ".")
                            .trim()
                            .to_string();
                        imports.push(clean);
                    }
                }
                _ => {
                    if child.child_count() > 0 && child.kind() != "class_definition" {
                        Self::extract_python(
                            child,
                            bytes,
                            file_uri,
                            symbols,
                            imports,
                            test_targets,
                        );
                    }
                }
            }
        }
    }

    fn extract_ts_js(
        node: Node,
        bytes: &[u8],
        file_uri: &str,
        symbols: &mut Vec<ExtractedSymbol>,
        imports: &mut Vec<String>,
        test_targets: &mut Vec<String>,
    ) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            match child.kind() {
                "function_declaration" | "generator_function_declaration" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        let is_test = name.starts_with("test") || name.starts_with("it");
                        let kind = if is_test {
                            test_targets.push(name.to_string());
                            SymbolKind::TestFunction
                        } else {
                            SymbolKind::Function
                        };
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: Self::node_first_line(child, bytes),
                            docstring: None,
                        });
                    }
                }
                "class_declaration" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind: SymbolKind::Class,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: Self::node_first_line(child, bytes),
                            docstring: None,
                        });
                    }
                }
                "interface_declaration" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind: SymbolKind::Interface,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: Self::node_first_line(child, bytes),
                            docstring: None,
                        });
                    }
                }
                "type_alias_declaration" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind: SymbolKind::TypeAlias,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: Self::node_first_line(child, bytes),
                            docstring: None,
                        });
                    }
                }
                "enum_declaration" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind: SymbolKind::Enum,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: Self::node_first_line(child, bytes),
                            docstring: None,
                        });
                    }
                }
                "import_statement" => {
                    if let Ok(text) = child.utf8_text(bytes) {
                        imports.push(text.trim().to_string());
                    }
                }
                "expression_statement" => {
                    // Check for test("name", ...) or it("name", ...) calls
                    if let Some(call) = child.child(0)
                        && call.kind() == "call_expression"
                        && let Some(func) = call.child_by_field_name("function")
                        && let Ok(func_name) = func.utf8_text(bytes)
                        && (func_name == "test" || func_name == "it")
                        && let Some(args) = call.child_by_field_name("arguments")
                        && let Some(first_arg) = args.child(1)
                        && let Ok(target) = first_arg.utf8_text(bytes)
                    {
                        let clean = target.trim_matches(|c| c == '"' || c == '\'' || c == '`');
                        test_targets.push(clean.to_string());
                    }
                }
                "export_statement" => {
                    // Recurse into exported declarations
                    Self::extract_ts_js(child, bytes, file_uri, symbols, imports, test_targets);
                }
                _ => {
                    if child.child_count() > 0 && child.kind() != "class_declaration" {
                        Self::extract_ts_js(child, bytes, file_uri, symbols, imports, test_targets);
                    }
                }
            }
        }
    }

    fn extract_go(
        node: Node,
        bytes: &[u8],
        file_uri: &str,
        symbols: &mut Vec<ExtractedSymbol>,
        imports: &mut Vec<String>,
        test_targets: &mut Vec<String>,
    ) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            match child.kind() {
                "function_declaration" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        let is_test = name.starts_with("Test");
                        let kind = if is_test {
                            test_targets.push(name.to_string());
                            SymbolKind::TestFunction
                        } else {
                            SymbolKind::Function
                        };
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: Self::node_first_line(child, bytes),
                            docstring: None,
                        });
                    }
                }
                "method_declaration" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(bytes)
                    {
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind: SymbolKind::Method,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: Self::node_first_line(child, bytes),
                            docstring: None,
                        });
                    }
                }
                "type_declaration" => {
                    if let Ok(text) = child.utf8_text(bytes) {
                        let first_line = text.lines().next().unwrap_or("").trim();
                        let kind = if first_line.contains("struct") {
                            SymbolKind::Struct
                        } else if first_line.contains("interface") {
                            SymbolKind::Interface
                        } else {
                            SymbolKind::TypeAlias
                        };
                        let mut name = "type";
                        for part in first_line.split_whitespace() {
                            if part != "type"
                                && part != "struct"
                                && part != "interface"
                                && !part.starts_with('{')
                            {
                                name = part;
                                break;
                            }
                        }
                        symbols.push(ExtractedSymbol {
                            name: name.to_string(),
                            symbol_uri: format!("{file_uri}#{name}"),
                            kind,
                            line_number: child.start_position().row + 1,
                            byte_start: child.start_byte(),
                            byte_end: child.end_byte(),
                            signature: first_line.to_string(),
                            docstring: None,
                        });
                    }
                }
                "import_declaration" => {
                    if let Ok(text) = child.utf8_text(bytes) {
                        for line in text.lines() {
                            let clean = line
                                .trim()
                                .trim_start_matches("import ")
                                .trim()
                                .trim_matches(|c| c == '"' || c == '`' || c == '(' || c == ')');
                            if !clean.is_empty() {
                                imports.push(clean.to_string());
                            }
                        }
                    }
                }
                _ => {
                    if child.child_count() > 0 {
                        Self::extract_go(child, bytes, file_uri, symbols, imports, test_targets);
                    }
                }
            }
        }
    }

    fn node_first_line(node: Node, bytes: &[u8]) -> String {
        if let Ok(text) = node.utf8_text(bytes) {
            text.lines().next().unwrap_or("").trim().to_string()
        } else {
            String::new()
        }
    }

    fn extract_doc_comments(node: Node, bytes: &[u8]) -> Option<String> {
        let mut prev = node.prev_sibling();
        let mut comments = Vec::new();
        while let Some(sibling) = prev {
            if sibling.kind() == "line_comment"
                && let Ok(text) = sibling.utf8_text(bytes)
                && (text.starts_with("///") || text.starts_with("//!"))
            {
                comments.push(text.to_string());
            } else {
                break;
            }
            prev = sibling.prev_sibling();
        }
        if comments.is_empty() {
            None
        } else {
            comments.reverse();
            Some(comments.join("\n"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rust_ast_with_tree_sitter() {
        let rust_code = r#"
/// Service authenticator
pub struct Authenticator {
    secret: String,
}

impl Authenticator {
    pub fn new(secret: &str) -> Self {
        Self { secret: secret.into() }
    }
}

pub fn hash_token(token: &str) -> String {
    format!("hash_{token}")
}

#[test]
fn test_authenticator_flow() {
    assert!(true);
}
"#;

        let ast = AstParser::parse_file("src/auth.rs", rust_code);
        assert_eq!(ast.language, "rust");

        let struct_sym = ast
            .symbols
            .iter()
            .find(|s| s.name == "Authenticator")
            .unwrap();
        assert_eq!(struct_sym.kind, SymbolKind::Struct);

        let fn_sym = ast.symbols.iter().find(|s| s.name == "hash_token").unwrap();
        assert_eq!(fn_sym.kind, SymbolKind::Function);

        let test_sym = ast
            .symbols
            .iter()
            .find(|s| s.name == "test_authenticator_flow")
            .unwrap();
        assert_eq!(test_sym.kind, SymbolKind::TestFunction);
        assert!(
            ast.test_targets
                .contains(&"test_authenticator_flow".to_string())
        );
    }

    #[test]
    fn test_parse_python_ast_with_tree_sitter() {
        let py_code = r#"
import os
from pathlib import Path

class ModelRunner:
    def execute(self, prompt: str):
        pass

def test_runner_execution():
    assert True
"#;

        let ast = AstParser::parse_file("tests/test_model.py", py_code);
        assert_eq!(ast.language, "python");
        assert!(
            ast.symbols
                .iter()
                .any(|s| s.name == "ModelRunner" && s.kind == SymbolKind::Class)
        );
        assert!(
            ast.symbols
                .iter()
                .any(|s| s.name == "test_runner_execution" && s.kind == SymbolKind::TestFunction)
        );
        assert_eq!(ast.imports.len(), 2);
    }
}
