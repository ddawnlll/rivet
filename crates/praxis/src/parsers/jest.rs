//! # praxis::parsers::jest
//!
//! JavaScript/TypeScript `Jest` / `Vitest` output parser.

use super::ParsedTestReport;

pub struct JestParser;

impl JestParser {
    pub fn parse(stdout: &str, stderr: &str) -> ParsedTestReport {
        let mut passed = 0;
        let mut failed = 0;
        let mut skipped = 0;

        let combined = format!("{}\n{}", stdout, stderr);
        for line in combined.lines() {
            let line_trimmed = line.trim();
            // Example: "Tests:       4 passed, 1 failed, 5 total"
            if line_trimmed.starts_with("Tests:") {
                let parts: Vec<&str> = line_trimmed["Tests:".len()..].split(',').collect();
                for part in parts {
                    let part = part.trim();
                    if part.contains("passed") {
                        if let Some(n) = extract_num(part) {
                            passed = n;
                        }
                    } else if part.contains("failed") {
                        if let Some(n) = extract_num(part) {
                            failed = n;
                        }
                    } else if part.contains("skipped") || part.contains("todo") {
                        if let Some(n) = extract_num(part) {
                            skipped += n;
                        }
                    }
                }
            }
        }

        let total = passed + failed + skipped;

        ParsedTestReport {
            framework: "jest".into(),
            passed_count: passed,
            failed_count: failed,
            skipped_count: skipped,
            total_count: total,
            duration_ms: None,
            raw_stdout: stdout.to_string(),
            raw_stderr: stderr.to_string(),
        }
    }
}

fn extract_num(s: &str) -> Option<usize> {
    for word in s.split_whitespace() {
        let clean = word.trim_matches(|c: char| !c.is_numeric());
        if let Ok(n) = clean.parse::<usize>() {
            return Some(n);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_jest_summary() {
        let stdout = "\
PASS src/index.spec.ts
PASS src/merkle.spec.ts

Test Suites: 2 passed, 2 total
Tests:       15 passed, 0 failed, 15 total
Snapshots:   0 total
Time:        1.25s
";
        let report = JestParser::parse(stdout, "");
        assert_eq!(report.passed_count, 15);
        assert_eq!(report.failed_count, 0);
        assert!(report.is_success());
    }
}
