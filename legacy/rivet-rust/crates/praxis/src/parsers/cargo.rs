//! # praxis::parsers::cargo
//!
//! Rust `cargo test` output parser with ANSI stripping.

use super::ParsedTestReport;

pub struct CargoTestParser;

impl CargoTestParser {
    pub fn parse(stdout: &str, stderr: &str) -> ParsedTestReport {
        let clean_bytes = strip_ansi_escapes::strip(stdout.as_bytes());
        let clean_stdout = String::from_utf8_lossy(&clean_bytes);

        let mut passed = 0;
        let mut failed = 0;
        let mut skipped = 0;

        for line in clean_stdout.lines() {
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
            }
        }

        let total = passed + failed + skipped;

        let clean_stderr =
            String::from_utf8_lossy(&strip_ansi_escapes::strip(stderr.as_bytes())).into_owned();

        ParsedTestReport {
            framework: "cargo test".into(),
            passed_count: passed,
            failed_count: failed,
            skipped_count: skipped,
            total_count: total,
            duration_ms: None,
            raw_stdout: clean_stdout.into_owned(),
            raw_stderr: clean_stderr,
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
