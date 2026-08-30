//! # praxis::parsers::cargo
//!
//! Rust `cargo test` output parser.

use super::ParsedTestReport;

pub struct CargoTestParser;

impl CargoTestParser {
    pub fn parse(stdout: &str, stderr: &str) -> ParsedTestReport {
        let mut passed = 0;
        let mut failed = 0;
        let mut skipped = 0;

        for line in stdout.lines() {
            let line_trimmed = line.trim();
            if line_trimmed.starts_with("test result:") {
                // "test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s"
                if let Some(p) = extract_num_before(line_trimmed, "passed") {
                    passed += p;
                }
                if let Some(f) = extract_num_before(line_trimmed, "failed") {
                    failed += f;
                }
                if let Some(s) = extract_num_before(line_trimmed, "ignored") {
                    skipped += s;
                }
            } else if line_trimmed.starts_with("test ") && line_trimmed.ends_with("... ok") {
                // Single test line fallback
                if passed == 0 && failed == 0 {
                    // Only count individual if summary line hasn't been hit yet
                }
            }
        }

        let total = passed + failed + skipped;

        ParsedTestReport {
            framework: "cargo test".into(),
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

fn extract_num_before(line: &str, marker: &str) -> Option<usize> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    for (i, &word) in parts.iter().enumerate() {
        if word.starts_with(marker) && i > 0 {
            let num_str = parts[i - 1].trim_matches(|c: char| !c.is_numeric());
            return num_str.parse().ok();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cargo_summary() {
        let stdout = "\
running 3 tests
test tests::test_one ... ok
test tests::test_two ... ok
test tests::test_three ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
";
        let report = CargoTestParser::parse(stdout, "");
        assert_eq!(report.passed_count, 3);
        assert_eq!(report.failed_count, 0);
        assert_eq!(report.skipped_count, 0);
        assert!(report.is_success());
    }
}
