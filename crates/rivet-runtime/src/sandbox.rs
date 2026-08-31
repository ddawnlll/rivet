//! # rivet-runtime::sandbox
//!
//! OS-Level Resource Governance & Sandbox Enforcement.
//! Defines CPU, Memory ceilings, PID quotas, disk limits, and network isolation policies.

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
}
