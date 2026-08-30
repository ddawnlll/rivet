//! # praxis::parsers::go
//!
//! Go `go test` output parser.

use super::ParsedTestReport;

pub struct GoTestParser;

impl GoTestParser {
    pub fn parse(stdout: &str, stderr: &str) -> ParsedTestReport {
        let mut passed = 0;
        let mut failed = 0;
        let mut skipped = 0;

        for line in stdout.lines() {
            let line_trimmed = line.trim();
            if line_trimmed.starts_with("--- PASS:") {
                passed += 1;
            } else if line_trimmed.starts_with("--- FAIL:") {
                failed += 1;
            } else if line_trimmed.starts_with("--- SKIP:") {
                skipped += 1;
            }
        }

        let total = passed + failed + skipped;

        ParsedTestReport {
            framework: "go test".into(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_go_test_output() {
        let stdout = "\
=== RUN   TestMerkleRoot
--- PASS: TestMerkleRoot (0.00s)
=== RUN   TestLedgerAppend
--- PASS: TestLedgerAppend (0.01s)
PASS
ok  	command-line-arguments	0.012s
";
        let report = GoTestParser::parse(stdout, "");
        assert_eq!(report.passed_count, 2);
        assert_eq!(report.failed_count, 0);
        assert!(report.is_success());
    }
}
