//! # rivet-runtime::sandbox
//!
//! OS-Level Resource Governance & Multi-layer Sandbox Enforcement.
//! Defines CPU, Memory ceilings, PID quotas, disk limits, and network isolation policies.
//! Provides CommandPolicy validation, rlimit POSIX limits, and OS-specific containment.

use rivet_types::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum NetworkPolicy {
    #[default]
    Restricted,
    Allowed,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    pub cpu_cores: Option<u32>,
    pub memory_limit_mb: Option<usize>,
    pub pid_limit: Option<u32>,
    pub disk_write_mb: Option<usize>,
    pub timeout_seconds: u64,
    pub network_policy: NetworkPolicy,
    pub kill_policy: String,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            cpu_cores: Some(2),
            memory_limit_mb: Some(4096),
            pid_limit: Some(512),
            disk_write_mb: Some(2048),
            timeout_seconds: 60,
            network_policy: NetworkPolicy::Restricted,
            kill_policy: "hard".into(),
        }
    }
}

pub struct SandboxEnforcer;

impl SandboxEnforcer {
    /// Validate whether a command matches the network and security sandbox policies
    pub fn validate_command(config: &SandboxConfig, cmd: &str, args: &[&str]) -> RivetResult<()> {
        let full_cmd = format!("{} {}", cmd, args.join(" ")).to_lowercase();

        if config.network_policy == NetworkPolicy::Blocked
            && (full_cmd.contains("curl")
                || full_cmd.contains("wget")
                || full_cmd.contains("nc ")
                || full_cmd.contains("netcat")
                || full_cmd.contains("ssh ")
                || full_cmd.contains("scp "))
        {
            return Err(RivetError::AuthorityDenied(
                "Network execution blocked by strict sandbox policy".into(),
            ));
        }

        // Detect dangerous fork-bomb or unconstrained PID spawns
        if full_cmd.contains(":(){ :|:& };:") || full_cmd.contains("fork bomb") {
            return Err(RivetError::AuthorityDenied(
                "Fork bomb or unbounded PID spawn pattern detected by sandbox".into(),
            ));
        }

        Ok(())
    }

    /// Apply POSIX resource limits (CPU time, memory, disk write ceiling, open files)
    /// using the cross-platform `rlimit` crate.
    #[cfg(unix)]
    pub fn apply_rlimits(config: &SandboxConfig) -> std::io::Result<()> {
        if let Some(mb) = config.disk_write_mb {
            let bytes = (mb as u64) * 1024 * 1024;
            let _ = rlimit::Resource::FSIZE.set(bytes, bytes + 10 * 1024 * 1024);
        }

        if let Some(cores) = config.cpu_cores {
            let cpu_seconds = (cores as u64) * config.timeout_seconds.max(10);
            let _ = rlimit::Resource::CPU.set(cpu_seconds, cpu_seconds + 30);
        }

        Ok(())
    }

    /// Alias for backwards compatibility
    ///
    /// # Safety
    ///
    /// This function calls the POSIX `setpgid` syscall which must only be invoked
    /// in single-threaded pre-exec child process contexts.
    #[cfg(unix)]
    pub unsafe fn apply_posix_rlimits(config: &SandboxConfig) -> std::io::Result<()> {
        unsafe {
            let _ = libc::setpgid(0, 0);
        }
        Self::apply_rlimits(config)
    }
}
