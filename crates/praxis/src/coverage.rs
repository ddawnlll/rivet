//! # praxis::coverage
//!
//! Parses Istanbul/c8 JSON and LCOV coverage reports and extracts per-file and total metrics.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Metric {
    pub total: usize,
    pub covered: usize,
    pub pct: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoverageTotals {
    pub lines: Metric,
    pub branches: Metric,
    pub functions: Metric,
    pub statements: Metric,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileCoverage {
    pub path: String,
    pub lines: Metric,
    pub branches: Metric,
    pub functions: Metric,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoverageResult {
    pub total: CoverageTotals,
    pub files: Vec<FileCoverage>,
    pub parse_success: bool,
    pub raw_path: Option<String>,
}

impl Default for CoverageResult {
    fn default() -> Self {
        Self {
            total: CoverageTotals {
                lines: Metric { total: 0, covered: 0, pct: 0.0 },
                branches: Metric { total: 0, covered: 0, pct: 0.0 },
                functions: Metric { total: 0, covered: 0, pct: 0.0 },
                statements: Metric { total: 0, covered: 0, pct: 0.0 },
            },
            files: Vec::new(),
            parse_success: false,
            raw_path: None,
        }
    }
}

pub struct CoverageParser;

impl CoverageParser {
    pub fn parse_file(path: impl AsRef<Path>) -> CoverageResult {
        let p = path.as_ref();
        if !p.exists() {
            let mut res = CoverageResult::default();
            res.raw_path = Some(p.to_string_lossy().to_string());
            return res;
        }

        let Ok(content) = fs::read_to_string(p) else {
            let mut res = CoverageResult::default();
            res.raw_path = Some(p.to_string_lossy().to_string());
            return res;
        };

        if p.extension().map_or(false, |ext| ext == "info") || content.starts_with("TN:") || content.starts_with("SF:") {
            Self::parse_lcov(&content)
        } else {
            Self::parse_istanbul_json(&content)
        }
    }

    /// Parse Istanbul / c8 coverage JSON
    pub fn parse_istanbul_json(raw: &str) -> CoverageResult {
        let Ok(data) = serde_json::from_str::<HashMap<String, serde_json::Value>>(raw) else {
            return CoverageResult::default();
        };

        let mut files = Vec::new();
        let mut t_lines = 0;
        let mut c_lines = 0;
        let mut t_branches = 0;
        let mut c_branches = 0;
        let mut t_funcs = 0;
        let mut c_funcs = 0;
        let mut t_stmts = 0;
        let mut c_stmts = 0;

        for (file_path, file_data) in data {
            let path = file_data.get("path").and_then(|v| v.as_str()).unwrap_or(&file_path).to_string();

            // Lines
            let (tot_l, cov_l) = count_map(file_data.get("l"));
            // Branches
            let (tot_b, cov_b) = count_branch_map(file_data.get("b"));
            // Functions
            let (tot_f, cov_f) = count_map(file_data.get("f"));
            // Statements
            let (tot_s, cov_s) = count_map(file_data.get("s"));

            let pct_l = if tot_l > 0 { round((cov_l as f64 / tot_l as f64) * 100.0) } else { 0.0 };
            let pct_b = if tot_b > 0 { round((cov_b as f64 / tot_b as f64) * 100.0) } else { 0.0 };
            let pct_f = if tot_f > 0 { round((cov_f as f64 / tot_f as f64) * 100.0) } else { 0.0 };

            files.push(FileCoverage {
                path,
                lines: Metric { total: tot_l, covered: cov_l, pct: pct_l },
                branches: Metric { total: tot_b, covered: cov_b, pct: pct_b },
                functions: Metric { total: tot_f, covered: cov_f, pct: pct_f },
            });

            t_lines += tot_l; c_lines += cov_l;
            t_branches += tot_b; c_branches += cov_b;
            t_funcs += tot_f; c_funcs += cov_f;
            t_stmts += tot_s; c_stmts += cov_s;
        }

        CoverageResult {
            total: CoverageTotals {
                lines: Metric { total: t_lines, covered: c_lines, pct: calc_pct(c_lines, t_lines) },
                branches: Metric { total: t_branches, covered: c_branches, pct: calc_pct(c_branches, t_branches) },
                functions: Metric { total: t_funcs, covered: c_funcs, pct: calc_pct(c_funcs, t_funcs) },
                statements: Metric { total: t_stmts, covered: c_stmts, pct: calc_pct(c_stmts, t_stmts) },
            },
            files,
            parse_success: true,
            raw_path: None,
        }
    }

    /// Parse standard LCOV tracefile format
    pub fn parse_lcov(raw: &str) -> CoverageResult {
        let mut files = Vec::new();
        let mut current_file = String::new();
        let mut cur_lines_found = 0;
        let mut cur_lines_hit = 0;
        let mut cur_funcs_found = 0;
        let mut cur_funcs_hit = 0;
        let mut cur_branches_found = 0;
        let mut cur_branches_hit = 0;

        let mut t_lines = 0;
        let mut c_lines = 0;
        let mut t_branches = 0;
        let mut c_branches = 0;
        let mut t_funcs = 0;
        let mut c_funcs = 0;

        for line in raw.lines() {
            let line = line.trim();
            if let Some(path) = line.strip_prefix("SF:") {
                current_file = path.to_string();
                cur_lines_found = 0; cur_lines_hit = 0;
                cur_funcs_found = 0; cur_funcs_hit = 0;
                cur_branches_found = 0; cur_branches_hit = 0;
            } else if let Some(val) = line.strip_prefix("LF:") {
                cur_lines_found = val.parse().unwrap_or(0);
            } else if let Some(val) = line.strip_prefix("LH:") {
                cur_lines_hit = val.parse().unwrap_or(0);
            } else if let Some(val) = line.strip_prefix("FNF:") {
                cur_funcs_found = val.parse().unwrap_or(0);
            } else if let Some(val) = line.strip_prefix("FNH:") {
                cur_funcs_hit = val.parse().unwrap_or(0);
            } else if let Some(val) = line.strip_prefix("BRF:") {
                cur_branches_found = val.parse().unwrap_or(0);
            } else if let Some(val) = line.strip_prefix("BRH:") {
                cur_branches_hit = val.parse().unwrap_or(0);
            } else if line == "end_of_record" {
                let pct_l = calc_pct(cur_lines_hit, cur_lines_found);
                let pct_b = calc_pct(cur_branches_hit, cur_branches_found);
                let pct_f = calc_pct(cur_funcs_hit, cur_funcs_found);

                files.push(FileCoverage {
                    path: current_file.clone(),
                    lines: Metric { total: cur_lines_found, covered: cur_lines_hit, pct: pct_l },
                    branches: Metric { total: cur_branches_found, covered: cur_branches_hit, pct: pct_b },
                    functions: Metric { total: cur_funcs_found, covered: cur_funcs_hit, pct: pct_f },
                });

                t_lines += cur_lines_found; c_lines += cur_lines_hit;
                t_branches += cur_branches_found; c_branches += cur_branches_hit;
                t_funcs += cur_funcs_found; c_funcs += cur_funcs_hit;
            }
        }

        CoverageResult {
            total: CoverageTotals {
                lines: Metric { total: t_lines, covered: c_lines, pct: calc_pct(c_lines, t_lines) },
                branches: Metric { total: t_branches, covered: c_branches, pct: calc_pct(c_branches, t_branches) },
                functions: Metric { total: t_funcs, covered: c_funcs, pct: calc_pct(c_funcs, t_funcs) },
                statements: Metric { total: t_lines, covered: c_lines, pct: calc_pct(c_lines, t_lines) },
            },
            files,
            parse_success: true,
            raw_path: None,
        }
    }
}

fn count_map(val: Option<&serde_json::Value>) -> (usize, usize) {
    let Some(obj) = val.and_then(|v| v.as_object()) else {
        return (0, 0);
    };
    let total = obj.len();
    let covered = obj.values().filter(|v| v.as_u64().unwrap_or(0) > 0).count();
    (total, covered)
}

fn count_branch_map(val: Option<&serde_json::Value>) -> (usize, usize) {
    let Some(obj) = val.and_then(|v| v.as_object()) else {
        return (0, 0);
    };
    let mut total = 0;
    let mut covered = 0;
    for arr in obj.values() {
        if let Some(a) = arr.as_array() {
            total += a.len();
            covered += a.iter().filter(|v| v.as_u64().unwrap_or(0) > 0).count();
        }
    }
    (total, covered)
}

fn round(n: f64) -> f64 {
    (n * 10.0).round() / 10.0
}

fn calc_pct(covered: usize, total: usize) -> f64 {
    if total == 0 {
        0.0
    } else {
        round((covered as f64 / total as f64) * 100.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_lcov() {
        let sample = "\
SF:src/auth.rs
FNF:2
FNH:2
LF:10
LH:8
BRF:4
BRH:2
end_of_record
";
        let res = CoverageParser::parse_lcov(sample);
        assert!(res.parse_success);
        assert_eq!(res.total.lines.total, 10);
        assert_eq!(res.total.lines.covered, 8);
        assert_eq!(res.total.lines.pct, 80.0);
    }
}
