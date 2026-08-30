//! # praxis::parsers::pytest
//!
//! Python `pytest` output parser.

use super::ParsedTestReport;

pub struct PytestParser;

impl PytestParser {
    pub fn parse(stdout: &str, stderr: &str) -> ParsedTestReport {
        let mut passed = 0;
        let mut failed = 0;
        let mut skipped = 0;

        for line in stdout.lines() {
            let line_trimmed = line.trim();
            // Example summary: "==== 12 passed, 2 failed, 1 skipped in 0.45s ===="
            if (line_trimmed.contains(" passed")
                || line_trimmed.contains(" failed")
                || line_trimmed.contains(" error"))
                && line_trimmed.starts_with("===")
                && line_trimmed.ends_with("===")
            {
                let parts: Vec<&str> = line_trimmed.split(',').collect();
                for part in parts {
                    let part = part.trim_matches(|c: char| c == '=' || c.is_whitespace());
                    if part.contains("passed") {
                        if let Some(n) = extract_first_num(part) {
                            passed = n;
                        }
                    } else if part.contains("failed") || part.contains("error") {
                        if let Some(n) = extract_first_num(part) {
                            failed += n;
                        }
                    } else if part.contains("skipped")
                        && let Some(n) = extract_first_num(part)
                    {
                        skipped = n;
                    }
                }
            }
        }

        let total = passed + failed + skipped;

        ParsedTestReport {
            framework: "pytest".into(),
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

fn extract_first_num(s: &str) -> Option<usize> {
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
    fn test_parse_pytest_summary() {
        let stdout = "\
test_api.py ..F.
================ 3 passed, 1 failed, 2 skipped in 1.23s ================";
        let report = PytestParser::parse(stdout, "");
        assert_eq!(report.passed_count, 3);
        assert_eq!(report.failed_count, 1);
        assert_eq!(report.skipped_count, 2);
        assert!(!report.is_success());
    }
}
