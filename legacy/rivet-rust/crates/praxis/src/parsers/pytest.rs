//! # praxis::parsers::pytest
//!
//! Python `pytest` output parser with production ANSI sequence stripping.

use super::ParsedTestReport;

pub struct PytestParser;

impl PytestParser {
    pub fn parse(stdout: &str, stderr: &str) -> ParsedTestReport {
        let mut passed = 0;
        let mut failed = 0;
        let mut skipped = 0;

        let combined = format!("{}\n{}", stdout, stderr);
        for line in combined.lines() {
            let clean_bytes = strip_ansi_escapes::strip(line.as_bytes());
            let line_stripped = String::from_utf8_lossy(&clean_bytes);
            let line_trimmed = line_stripped.trim();

            // Example summary: "==== 12 passed, 2 failed, 1 skipped in 0.45s ===="
            if (line_trimmed.contains(" passed")
                || line_trimmed.contains(" failed")
                || line_trimmed.contains(" error")
                || line_trimmed.contains(" skipped"))
                && line_trimmed.contains("===")
            {
                let parts: Vec<&str> = line_trimmed.split(',').collect();
                for part in parts {
                    let part = part.trim_matches(|c: char| c == '=' || c.is_whitespace());
                    if part.contains("passed")
                        && let Some(n) = extract_first_num(part)
                    {
                        passed += n;
                    } else if (part.contains("failed") || part.contains("error"))
                        && let Some(n) = extract_first_num(part)
                    {
                        failed += n;
                    } else if part.contains("skipped")
                        && let Some(n) = extract_first_num(part)
                    {
                        skipped += n;
                    }
                }
            }
        }

        let total = passed + failed + skipped;

        let clean_stdout =
            String::from_utf8_lossy(&strip_ansi_escapes::strip(stdout.as_bytes())).into_owned();
        let clean_stderr =
            String::from_utf8_lossy(&strip_ansi_escapes::strip(stderr.as_bytes())).into_owned();

        ParsedTestReport {
            framework: "pytest".into(),
            passed_count: passed,
            failed_count: failed,
            skipped_count: skipped,
            total_count: total,
            duration_ms: None,
            raw_stdout: clean_stdout,
            raw_stderr: clean_stderr,
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

    #[test]
    fn test_parse_pytest_all_skipped_and_ansi() {
        let stdout = "\x1b[33m================ 5 skipped in 0.12s ================\x1b[0m";
        let report = PytestParser::parse(stdout, "");
        assert_eq!(report.passed_count, 0);
        assert_eq!(report.failed_count, 0);
        assert_eq!(report.skipped_count, 5);
    }
}
