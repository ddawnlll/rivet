//! # praxis::gates::exec_gate
//!
//! Gate 5: ExecGate
//! Validates allowed commands, executes them with timeouts and sandbox constraints,
//! and records stdout/stderr evidence.

use crate::types::*;
use chrono::Utc;
use std::io;
use std::path::Path;
use std::time::Instant;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};

pub const DEFAULT_MAX_COMMAND_OUTPUT_BYTES: usize = 1024 * 1024;
const OUTPUT_TRUNCATION_MARKER: &str = "\n[output truncated]";

#[derive(Debug, Clone)]
pub struct CommandRunResult {
    pub command_id: String,
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timed_out: bool,
    pub passed: bool,
    pub reason_codes: Vec<String>,
}

pub struct ExecGate;

impl ExecGate {
    pub async fn execute_all(
        plan: &PlanSpec,
        repo_root: impl AsRef<Path>,
        attempt_id: &str,
    ) -> (GateResult, Vec<CommandRunResult>) {
        Self::execute_all_with_output_limit(
            plan,
            repo_root,
            attempt_id,
            DEFAULT_MAX_COMMAND_OUTPUT_BYTES,
        )
        .await
    }

    pub async fn execute_all_with_output_limit(
        plan: &PlanSpec,
        repo_root: impl AsRef<Path>,
        attempt_id: &str,
        output_limit: usize,
    ) -> (GateResult, Vec<CommandRunResult>) {
        let repo_root = repo_root.as_ref();
        let output_limit = output_limit.max(1);
        let mut reason_codes = Vec::new();
        let mut diagnostics = Vec::new();
        let failed_criteria_ids = Vec::new();
        let mut evidence_refs = Vec::new();
        let mut run_results = Vec::new();

        // 1. Validate commands against policy before running
        for cmd in &plan.commands.exact_allowed_commands {
            // Check hard denied
            let is_denied = plan
                .commands
                .hard_denied_commands
                .iter()
                .any(|d| cmd.command.contains(d));
            if is_denied {
                reason_codes.push(reason_codes::COMMAND_DENIED.to_string());
                diagnostics.push(Diagnostic::error(
                    "COMMAND_DENIED",
                    format!(
                        "Command '{}' matches hardDeniedCommands policy",
                        cmd.command
                    ),
                ));
                run_results.push(CommandRunResult {
                    command_id: cmd.id.clone(),
                    command: cmd.command.clone(),
                    exit_code: None,
                    stdout: String::new(),
                    stderr: "Command denied by policy".into(),
                    duration_ms: 0,
                    timed_out: false,
                    passed: false,
                    reason_codes: vec![reason_codes::COMMAND_DENIED.to_string()],
                });
                continue;
            }

            // Check watch mode flags
            let parts_vec = shlex_split(&cmd.command);
            if parts_vec.iter().any(|arg| arg == "--watch" || arg == "-w") {
                reason_codes.push(reason_codes::WATCH_MODE_DETECTED.to_string());
                diagnostics.push(Diagnostic::error(
                    "WATCH_MODE_DETECTED",
                    format!("Command '{}' contains watch-mode flags", cmd.command),
                ));
            }

            let cwd = if let Some(ref sub) = cmd.cwd {
                match safe_cwd(repo_root, sub) {
                    Ok(path) => path,
                    Err(reason) => {
                        reason_codes.push(reason_codes::COMMAND_NOT_ALLOWED.to_string());
                        diagnostics.push(Diagnostic::error(
                            "COMMAND_NOT_ALLOWED",
                            format!("Command '{}' has an unsafe cwd: {reason}", cmd.command),
                        ));
                        run_results.push(CommandRunResult {
                            command_id: cmd.id.clone(),
                            command: cmd.command.clone(),
                            exit_code: None,
                            stdout: String::new(),
                            stderr: reason,
                            duration_ms: 0,
                            timed_out: false,
                            passed: false,
                            reason_codes: vec![reason_codes::COMMAND_NOT_ALLOWED.to_string()],
                        });
                        continue;
                    }
                }
            } else {
                repo_root.to_path_buf()
            };

            // Execute command
            let timeout_secs = cmd.timeout_seconds.unwrap_or(300);

            let start = Instant::now();
            let program = parts_vec.first().map(|s| s.as_str()).unwrap_or("");
            let args: Vec<&str> = if parts_vec.len() > 1 {
                parts_vec[1..].iter().map(|s| s.as_str()).collect()
            } else {
                Vec::new()
            };

            let mut command = Command::new(program);
            command
                .args(&args)
                .current_dir(&cwd)
                .kill_on_drop(true)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            let mut child = match ManagedChild::spawn(command) {
                Ok(child) => child,
                Err(error) => {
                    let duration_ms = start.elapsed().as_millis() as u64;
                    let error = error.to_string();
                    run_results.push(CommandRunResult {
                        command_id: cmd.id.clone(),
                        command: cmd.command.clone(),
                        exit_code: Some(-1),
                        stdout: String::new(),
                        stderr: error,
                        duration_ms,
                        timed_out: false,
                        passed: false,
                        reason_codes: vec![reason_codes::COMMAND_CRASHED.to_string()],
                    });
                    reason_codes.push(reason_codes::COMMAND_CRASHED.to_string());
                    continue;
                }
            };
            let stdout = match child.child.stdout.take() {
                Some(stdout) => stdout,
                None => {
                    run_results.push(CommandRunResult {
                        command_id: cmd.id.clone(),
                        command: cmd.command.clone(),
                        exit_code: Some(-1),
                        stdout: String::new(),
                        stderr: "command stdout was not piped".into(),
                        duration_ms: start.elapsed().as_millis() as u64,
                        timed_out: false,
                        passed: false,
                        reason_codes: vec![reason_codes::COMMAND_CRASHED.to_string()],
                    });
                    reason_codes.push(reason_codes::COMMAND_CRASHED.to_string());
                    continue;
                }
            };
            let stderr = match child.child.stderr.take() {
                Some(stderr) => stderr,
                None => {
                    run_results.push(CommandRunResult {
                        command_id: cmd.id.clone(),
                        command: cmd.command.clone(),
                        exit_code: Some(-1),
                        stdout: String::new(),
                        stderr: "command stderr was not piped".into(),
                        duration_ms: start.elapsed().as_millis() as u64,
                        timed_out: false,
                        passed: false,
                        reason_codes: vec![reason_codes::COMMAND_CRASHED.to_string()],
                    });
                    reason_codes.push(reason_codes::COMMAND_CRASHED.to_string());
                    continue;
                }
            };

            let res = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), async {
                let (status, stdout, stderr) = tokio::join!(
                    child.wait(),
                    read_bounded(stdout, output_limit),
                    read_bounded(stderr, output_limit),
                );
                (status.map_err(|error| error.to_string()), stdout, stderr)
            })
            .await;

            let duration_ms = start.elapsed().as_millis() as u64;

            let (exit_code, stdout, stderr, timed_out) = match res {
                Ok((Ok(status), (stdout, stdout_truncated), (stderr, stderr_truncated))) => {
                    let code = status.code();
                    let out = bounded_string(&stdout, stdout_truncated, output_limit);
                    let err = bounded_string(&stderr, stderr_truncated, output_limit);
                    (code, out, err, false)
                }
                Ok((Err(error), _, _)) => (Some(-1), String::new(), error, false),
                Err(_) => {
                    child.terminate().await;
                    (Some(-1), String::new(), "Command timed out".into(), true)
                }
            };

            let mut cmd_reasons = Vec::new();
            let mut passed = true;

            if timed_out {
                passed = false;
                cmd_reasons.push(reason_codes::COMMAND_TIMEOUT.to_string());
                reason_codes.push(reason_codes::COMMAND_TIMEOUT.to_string());
                diagnostics.push(Diagnostic::error(
                    "COMMAND_TIMEOUT",
                    format!(
                        "Command '{}' timed out after {}s",
                        cmd.command, timeout_secs
                    ),
                ));
            } else if let Some(code) = exit_code {
                let expected = cmd.expected_exit_code.unwrap_or(0);
                if code != expected {
                    passed = false;
                    cmd_reasons.push(reason_codes::EXIT_CODE_NONZERO.to_string());
                    reason_codes.push(reason_codes::EXIT_CODE_NONZERO.to_string());
                    diagnostics.push(Diagnostic::error(
                        "EXIT_CODE_NONZERO",
                        format!(
                            "Command '{}' exited with code {} (expected {})",
                            cmd.command, code, expected
                        ),
                    ));
                }
            } else {
                passed = false;
                cmd_reasons.push(reason_codes::COMMAND_CRASHED.to_string());
                reason_codes.push(reason_codes::COMMAND_CRASHED.to_string());
                diagnostics.push(Diagnostic::error(
                    "COMMAND_CRASHED",
                    format!(
                        "Command '{}' terminated abnormally without exit code",
                        cmd.command
                    ),
                ));
            }

            // Expected patterns check
            for pattern in &cmd.expected_output_patterns {
                if !stdout.contains(pattern) && !stderr.contains(pattern) {
                    passed = false;
                    cmd_reasons.push(reason_codes::EXPECTED_OUTPUT_MISSING.to_string());
                    diagnostics.push(Diagnostic::warning(
                        "EXPECTED_OUTPUT_MISSING",
                        format!("Command output missing expected pattern '{}'", pattern),
                    ));
                }
            }

            if passed {
                cmd_reasons.push(reason_codes::COMMAND_SUCCEEDED.to_string());
            }

            evidence_refs.push(format!("cmd-{}", cmd.id));

            run_results.push(CommandRunResult {
                command_id: cmd.id.clone(),
                command: cmd.command.clone(),
                exit_code,
                stdout,
                stderr,
                duration_ms,
                timed_out,
                passed,
                reason_codes: cmd_reasons,
            });
        }

        let has_fails = run_results.iter().any(|r| !r.passed);
        let verdict = if has_fails {
            GateVerdict::Fail
        } else {
            reason_codes.push(reason_codes::EXEC_PASS.to_string());
            GateVerdict::Pass
        };

        let result = GateResult {
            gate_name: "ExecGate".into(),
            verdict,
            reason_codes,
            diagnostics,
            failed_criteria_ids,
            evidence_refs,
            attempt_id: attempt_id.to_string(),
            timestamp: Utc::now(),
            repair_hint: if verdict == GateVerdict::Fail {
                Some("Fix failing command execution, syntax, or exit code mismatches".into())
            } else {
                None
            },
        };

        (result, run_results)
    }
}

async fn read_bounded<R: AsyncRead + Unpin>(mut reader: R, limit: usize) -> (Vec<u8>, bool) {
    let mut retained = Vec::with_capacity(limit);
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;

    loop {
        let read = match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => read,
            Err(_) => break,
        };
        let remaining = limit.saturating_sub(retained.len());
        let retained_now = remaining.min(read);
        retained.extend_from_slice(&buffer[..retained_now]);
        if retained_now < read {
            truncated = true;
        }
    }

    (retained, truncated)
}

fn bounded_string(bytes: &[u8], truncated: bool, limit: usize) -> String {
    let text_limit = if truncated {
        limit.saturating_sub(OUTPUT_TRUNCATION_MARKER.len())
    } else {
        limit
    };
    let mut text = String::from_utf8_lossy(bytes).into_owned();
    if text.len() > text_limit {
        let mut end = text_limit;
        while end > 0 && !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    if truncated {
        let remaining = limit.saturating_sub(text.len());
        let marker_end = OUTPUT_TRUNCATION_MARKER
            .char_indices()
            .map(|(index, _)| index)
            .chain(std::iter::once(OUTPUT_TRUNCATION_MARKER.len()))
            .rfind(|&index| index <= remaining)
            .unwrap_or(0);
        text.push_str(&OUTPUT_TRUNCATION_MARKER[..marker_end]);
    }
    text
}

struct ManagedChild {
    child: Child,
    #[cfg(unix)]
    pid: u32,
    #[cfg(windows)]
    job: usize,
    completed: bool,
}

impl ManagedChild {
    fn spawn(mut command: Command) -> io::Result<Self> {
        #[cfg(unix)]
        {
            unsafe {
                command.pre_exec(|| {
                    if setpgid(0, 0) == -1 {
                        Err(io::Error::last_os_error())
                    } else {
                        Ok(())
                    }
                });
            }
        }

        let child = command.spawn()?;
        #[cfg(unix)]
        let pid = child
            .id()
            .ok_or_else(|| io::Error::other("spawned process has no pid"))?;
        #[cfg(windows)]
        let job = create_job_for_child(&child)?;

        Ok(Self {
            child,
            #[cfg(unix)]
            pid,
            #[cfg(windows)]
            job,
            completed: false,
        })
    }

    async fn wait(&mut self) -> io::Result<std::process::ExitStatus> {
        let result = self.child.wait().await;
        if result.is_ok() {
            self.completed = true;
        }
        result
    }

    async fn terminate(&mut self) {
        #[cfg(unix)]
        unsafe {
            let _ = kill(-(self.pid as i32), 9);
        }
        #[cfg(windows)]
        terminate_job(self.job);
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
        self.completed = true;
    }
}

impl Drop for ManagedChild {
    fn drop(&mut self) {
        if !self.completed {
            #[cfg(unix)]
            unsafe {
                let _ = kill(-(self.pid as i32), 9);
            }
            #[cfg(windows)]
            terminate_job(self.job);
        }
        #[cfg(windows)]
        close_job(self.job);
    }
}

#[cfg(unix)]
unsafe extern "C" {
    fn setpgid(pid: i32, pgid: i32) -> i32;
    fn kill(pid: i32, signal: i32) -> i32;
}

#[cfg(windows)]
#[repr(C)]
struct JobObjectBasicLimitInformation {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: u32,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: u32,
    affinity: usize,
    priority_class: u32,
    scheduling_class: u32,
}

#[cfg(windows)]
#[repr(C)]
struct IoCounters {
    read_operations: u64,
    write_operations: u64,
    other_operations: u64,
    read_bytes: u64,
    write_bytes: u64,
    other_bytes: u64,
}

#[cfg(windows)]
#[repr(C)]
struct JobObjectExtendedLimitInformation {
    basic_limit_information: JobObjectBasicLimitInformation,
    io_info: IoCounters,
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

#[cfg(windows)]
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;
#[cfg(windows)]
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;

#[cfg(windows)]
unsafe extern "system" {
    fn CreateJobObjectW(attributes: *mut std::ffi::c_void, name: *const u16) -> usize;
    fn SetInformationJobObject(
        job: usize,
        information_class: u32,
        information: *mut std::ffi::c_void,
        information_length: u32,
    ) -> i32;
    fn AssignProcessToJobObject(job: usize, process: usize) -> i32;
    fn TerminateJobObject(job: usize, exit_code: u32) -> i32;
    fn CloseHandle(handle: usize) -> i32;
}

#[cfg(windows)]
fn create_job_for_child(child: &Child) -> io::Result<usize> {
    let job = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
    if job == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut limits = JobObjectExtendedLimitInformation {
        basic_limit_information: JobObjectBasicLimitInformation {
            per_process_user_time_limit: 0,
            per_job_user_time_limit: 0,
            limit_flags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            minimum_working_set_size: 0,
            maximum_working_set_size: 0,
            active_process_limit: 0,
            affinity: 0,
            priority_class: 0,
            scheduling_class: 0,
        },
        io_info: IoCounters {
            read_operations: 0,
            write_operations: 0,
            other_operations: 0,
            read_bytes: 0,
            write_bytes: 0,
            other_bytes: 0,
        },
        process_memory_limit: 0,
        job_memory_limit: 0,
        peak_process_memory_used: 0,
        peak_job_memory_used: 0,
    };
    let Some(process_handle) = child.raw_handle() else {
        unsafe {
            CloseHandle(job);
        }
        return Err(io::Error::other("spawned process has no process handle"));
    };
    let configured = unsafe {
        SetInformationJobObject(
            job,
            JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
            (&mut limits as *mut JobObjectExtendedLimitInformation).cast(),
            std::mem::size_of::<JobObjectExtendedLimitInformation>() as u32,
        )
    } != 0;
    let assigned =
        configured && unsafe { AssignProcessToJobObject(job, process_handle as usize) != 0 };
    if !assigned {
        unsafe {
            CloseHandle(job);
        }
        return Err(io::Error::last_os_error());
    }
    Ok(job)
}

#[cfg(windows)]
fn terminate_job(job: usize) {
    unsafe {
        let _ = TerminateJobObject(job, 1);
    }
}

#[cfg(windows)]
fn close_job(job: usize) {
    unsafe {
        let _ = CloseHandle(job);
    }
}

fn shlex_split(cmd: &str) -> Vec<String> {
    rivet_types::shlex_split(cmd)
}

fn safe_cwd(repo_root: &Path, subdirectory: &str) -> Result<std::path::PathBuf, String> {
    if !rivet_types::is_safe_relative_path(subdirectory) {
        return Err("cwd must be a relative path within the repository".into());
    }
    let norm = subdirectory.replace('\\', "/");
    Ok(repo_root.join(norm))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn safe_cwd_rejects_parent_and_absolute_paths() {
        let root = PathBuf::from("repo");
        assert!(safe_cwd(&root, "crates/praxis").is_ok());
        assert!(safe_cwd(&root, "../outside").is_err());
        assert!(safe_cwd(&root, "..\\outside").is_err());
        assert!(safe_cwd(&root, "/outside").is_err());
    }

    #[test]
    fn test_shlex_split_handles_quotes() {
        let args = shlex_split("cargo test -- \"my complex test name\" -k 'single'");
        assert_eq!(
            args,
            vec![
                "cargo",
                "test",
                "--",
                "my complex test name",
                "-k",
                "single"
            ]
        );
    }
}
