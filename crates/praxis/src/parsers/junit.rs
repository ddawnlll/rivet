//! # praxis::parsers::junit
//!
//! Structured JUnit XML test report parser backed by `junit-parser`.

use super::ParsedTestReport;
use std::io::Cursor;

pub struct JunitTestParser;

impl JunitTestParser {
    pub fn parse(
        xml_content: &str,
        raw_stdout: &str,
        raw_stderr: &str,
    ) -> Result<ParsedTestReport, String> {
        let cursor = Cursor::new(xml_content.as_bytes());
        let suites = junit_parser::from_reader(cursor)
            .map_err(|e| format!("Failed to parse JUnit XML: {e}"))?;

        let mut passed = 0;
        let mut failed = 0;
        let mut skipped = 0;
        let mut total_duration_ms: u64 = 0;

        for suite in suites.suites {
            for test in suite.cases {
                let status = test.status;
                if status.is_success() {
                    passed += 1;
                } else if status.is_failure() || status.is_error() {
                    failed += 1;
                } else {
                    skipped += 1;
                }
            }
            total_duration_ms += (suite.time * 1000.0) as u64;
        }

        let total = passed + failed + skipped;
        let clean_stdout =
            String::from_utf8_lossy(&strip_ansi_escapes::strip(raw_stdout.as_bytes())).into_owned();
        let clean_stderr =
            String::from_utf8_lossy(&strip_ansi_escapes::strip(raw_stderr.as_bytes())).into_owned();

        Ok(ParsedTestReport {
            framework: "junit".into(),
            passed_count: passed,
            failed_count: failed,
            skipped_count: skipped,
            total_count: total,
            duration_ms: Some(total_duration_ms),
            raw_stdout: clean_stdout,
            raw_stderr: clean_stderr,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_junit_xml() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<testsuites time="1.5">
  <testsuite name="TestSuite1" tests="3" failures="1" errors="0" skipped="1" time="1.5">
    <testcase name="test_one" classname="MyClass" time="0.5"/>
    <testcase name="test_two" classname="MyClass" time="0.5">
      <failure message="assertion failed">Expected true, got false</failure>
    </testcase>
    <testcase name="test_three" classname="MyClass" time="0.5">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>"#;

        let report = JunitTestParser::parse(xml, "raw logs", "").unwrap();
        assert_eq!(report.passed_count, 1);
        assert_eq!(report.failed_count, 1);
        assert_eq!(report.skipped_count, 1);
        assert_eq!(report.total_count, 3);
        assert!(!report.is_success());
    }
}
