//! # praxis::circuit_breaker
//!
//! Circuit breaker and failure rate tracker for execution and gate pipelines.

use std::collections::VecDeque;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CircuitBreakerState {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug, Clone)]
pub struct CircuitBreakerConfig {
    pub failure_rate_threshold: f64, // e.g. 0.5 (50%)
    pub minimum_requests: usize,      // e.g. 5
    pub window_size: usize,           // e.g. 10
    pub reset_timeout: Duration,      // e.g. 30s
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_rate_threshold: 0.5,
            minimum_requests: 5,
            window_size: 10,
            reset_timeout: Duration::from_secs(30),
        }
    }
}

pub struct CircuitBreaker {
    config: CircuitBreakerConfig,
    state: CircuitBreakerState,
    history: VecDeque<bool>, // true = success, false = failure
    last_state_change: Instant,
}

impl CircuitBreaker {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            config,
            state: CircuitBreakerState::Closed,
            history: VecDeque::new(),
            last_state_change: Instant::now(),
        }
    }

    pub fn state(&self) -> CircuitBreakerState {
        self.state
    }

    /// Check if execution is permitted under current circuit breaker state
    pub fn can_execute(&mut self) -> bool {
        match self.state {
            CircuitBreakerState::Closed => true,
            CircuitBreakerState::Open => {
                if self.last_state_change.elapsed() >= self.config.reset_timeout {
                    self.state = CircuitBreakerState::HalfOpen;
                    self.last_state_change = Instant::now();
                    true
                } else {
                    false
                }
            }
            CircuitBreakerState::HalfOpen => true,
        }
    }

    /// Record an execution result (success = true, failure = false)
    pub fn record_result(&mut self, success: bool) {
        self.history.push_back(success);
        if self.history.len() > self.config.window_size {
            self.history.pop_front();
        }

        match self.state {
            CircuitBreakerState::Closed => {
                if self.history.len() >= self.config.minimum_requests {
                    let failures = self.history.iter().filter(|&&s| !s).count();
                    let rate = failures as f64 / self.history.len() as f64;
                    if rate >= self.config.failure_rate_threshold {
                        self.state = CircuitBreakerState::Open;
                        self.last_state_change = Instant::now();
                    }
                }
            }
            CircuitBreakerState::HalfOpen => {
                if success {
                    self.state = CircuitBreakerState::Closed;
                    self.history.clear();
                    self.last_state_change = Instant::now();
                } else {
                    self.state = CircuitBreakerState::Open;
                    self.last_state_change = Instant::now();
                }
            }
            CircuitBreakerState::Open => {}
        }
    }

    pub fn reset(&mut self) {
        self.state = CircuitBreakerState::Closed;
        self.history.clear();
        self.last_state_change = Instant::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_circuit_breaker_tripping() {
        let mut cb = CircuitBreaker::new(CircuitBreakerConfig {
            failure_rate_threshold: 0.5,
            minimum_requests: 3,
            window_size: 4,
            reset_timeout: Duration::from_millis(50),
        });

        assert_eq!(cb.state(), CircuitBreakerState::Closed);
        assert!(cb.can_execute());

        cb.record_result(false);
        cb.record_result(false);
        cb.record_result(false);

        // Tripped
        assert_eq!(cb.state(), CircuitBreakerState::Open);
        assert!(!cb.can_execute());

        // Wait for reset timeout
        std::thread::sleep(Duration::from_millis(60));
        assert!(cb.can_execute());
        assert_eq!(cb.state(), CircuitBreakerState::HalfOpen);

        // Successful execution closes circuit
        cb.record_result(true);
        assert_eq!(cb.state(), CircuitBreakerState::Closed);
    }
}
