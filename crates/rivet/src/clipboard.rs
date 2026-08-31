//! Production-Grade Multi-Tier TUI Clipboard Subsystem
//!
//! Architecture:
//! ```text
//! TuiClipboard
//!   ├── Native Backend (hjkl-clipboard / arboard + Win32/WSL fallback with lock retry)
//!   ├── Terminal Backend (OSC 52 with tmux and screen passthrough)
//!   └── Internal Register (TUI-local in-memory fallback register)
//! ```
//!
//! # Copy Strategy:
//! 1. Write to Internal Register (instant in-memory fallback)
//! 2. Write to Native Clipboard (OS clipboard)
//! 3. Emit OSC 52 sequence to stdout (syncs client clipboard across SSH / tmux / remote sessions)
//!
//! # Paste Strategy:
//! 1. Try Native Clipboard
//! 2. If Native fails or is unavailable (e.g. headless SSH), fallback to Internal Register

use base64::Engine;
use std::io::{Write, stdout};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ClipboardError {
    #[error("Native clipboard unavailable: {0}")]
    NativeError(String),
    #[error("Terminal OSC 52 write failed: {0}")]
    Osc52Error(String),
    #[error("Clipboard is empty")]
    Empty,
}

/// Core abstraction for clipboard operations in Ratatui / TUI.
pub trait Clipboard: Send + Sync {
    fn copy(&mut self, text: &str) -> Result<(), ClipboardError>;
    fn paste(&mut self) -> Result<String, ClipboardError>;
}

/// TUI-local in-memory register for instant fallback (inspired by Vim's internal registers)
#[derive(Debug, Clone, Default)]
pub struct InternalRegister {
    content: Arc<Mutex<String>>,
}

impl InternalRegister {
    pub fn new() -> Self {
        Self {
            content: Arc::new(Mutex::new(String::new())),
        }
    }

    pub fn set(&self, text: &str) {
        if let Ok(mut lock) = self.content.lock() {
            *lock = text.to_string();
        }
    }

    pub fn get(&self) -> Option<String> {
        if let Ok(lock) = self.content.lock()
            && !lock.is_empty()
        {
            return Some(lock.clone());
        }
        None
    }

    pub fn clear(&self) {
        if let Ok(mut lock) = self.content.lock() {
            lock.clear();
        }
    }
}

/// Terminal OSC 52 sequence emitter for SSH, tmux, and remote terminal clipboard synchronization
pub struct Osc52Backend;

impl Osc52Backend {
    /// Formats the OSC 52 escape sequence with tmux and screen passthrough detection
    pub fn format_sequence(text: &str) -> String {
        let encoded = base64::engine::general_purpose::STANDARD.encode(text);

        let in_tmux = std::env::var_os("TMUX").is_some();
        let in_screen = std::env::var("TERM")
            .map(|t| t.starts_with("screen"))
            .unwrap_or(false);

        if in_tmux {
            format!("\x1bPtmux;\x1b\x1b]52;c;{}\x07\x1b\\", encoded)
        } else if in_screen {
            format!("\x1bP\x1b]52;c;{}\x07\x1b\\", encoded)
        } else {
            format!("\x1b]52;c;{}\x07", encoded)
        }
    }

    /// Emits OSC 52 escape sequence directly to stdout
    pub fn write_clipboard(text: &str) -> Result<(), ClipboardError> {
        let seq = Self::format_sequence(text);
        let mut out = stdout();
        out.write_all(seq.as_bytes())
            .map_err(|e| ClipboardError::Osc52Error(e.to_string()))?;
        out.flush()
            .map_err(|e| ClipboardError::Osc52Error(e.to_string()))?;
        Ok(())
    }
}

/// Native OS clipboard backend with lock retry backoff & Win32/PowerShell fallback
pub struct NativeBackend;

impl NativeBackend {
    pub fn copy(text: &str) -> Result<(), ClipboardError> {
        // 1. Try with retry loop to handle transient OS mutex locks (e.g. CLIPBRD_E_CANT_OPEN)
        for attempt in 0..5 {
            if let Ok(mut cb) = arboard::Clipboard::new()
                && cb.set_text(text.to_string()).is_ok()
            {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(10 * (attempt + 1) as u64));
        }

        // 2. Windows-specific fallback (PowerShell Set-Clipboard with hidden window)
        #[cfg(windows)]
        {
            use std::io::Write;
            use std::os::windows::process::CommandExt;
            if let Ok(mut child) = std::process::Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "$input | Set-Clipboard",
                ])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .stdin(std::process::Stdio::piped())
                .spawn()
            {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(text.as_bytes());
                }
                if let Ok(status) = child.wait()
                    && status.success()
                {
                    return Ok(());
                }
            }
        }

        Err(ClipboardError::NativeError(
            "Failed to write to native clipboard after retries and fallback".into(),
        ))
    }

    pub fn paste() -> Result<String, ClipboardError> {
        // 1. Try with retry loop
        for attempt in 0..5 {
            if let Ok(mut cb) = arboard::Clipboard::new()
                && let Ok(text) = cb.get_text()
            {
                let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
                return Ok(normalized);
            }
            std::thread::sleep(Duration::from_millis(10 * (attempt + 1) as u64));
        }

        // 2. Windows-specific fallback (PowerShell Get-Clipboard with hidden window)
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            if let Ok(output) = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
                && output.status.success()
            {
                let s = String::from_utf8_lossy(&output.stdout).to_string();
                let trimmed = s.trim_end_matches("\r\n").trim_end_matches('\n');
                if !trimmed.is_empty() {
                    return Ok(trimmed.replace("\r\n", "\n").replace('\r', "\n"));
                }
            }
        }

        Err(ClipboardError::NativeError(
            "Failed to read from native clipboard after retries and fallback".into(),
        ))
    }
}

/// The unified TuiClipboard manager orchestrating Native + OSC 52 + Internal Register
#[derive(Clone)]
pub struct TuiClipboard {
    pub register: InternalRegister,
    pub enable_osc52: bool,
}

impl TuiClipboard {
    pub fn new() -> Self {
        Self {
            register: InternalRegister::new(),
            enable_osc52: true,
        }
    }

    pub fn global() -> &'static Mutex<TuiClipboard> {
        static INSTANCE: OnceLock<Mutex<TuiClipboard>> = OnceLock::new();
        INSTANCE.get_or_init(|| Mutex::new(TuiClipboard::new()))
    }

    /// High-level static helper: copies text to all clipboard tiers (register + native + OSC 52)
    pub fn copy_text(text: &str) -> bool {
        if let Ok(mut guard) = Self::global().lock() {
            guard.copy(text).is_ok()
        } else {
            false
        }
    }

    /// High-level static helper: pastes text with native priority and register fallback
    pub fn paste_text() -> Option<String> {
        if let Ok(mut guard) = Self::global().lock() {
            guard.paste().ok()
        } else {
            None
        }
    }
}

impl Default for TuiClipboard {
    fn default() -> Self {
        Self::new()
    }
}

impl Clipboard for TuiClipboard {
    fn copy(&mut self, text: &str) -> Result<(), ClipboardError> {
        // 1. TUI internal register (instant in-memory fallback)
        self.register.set(text);

        // 2. Native OS clipboard
        let native_res = NativeBackend::copy(text);

        // 3. Terminal OSC 52 sequence (for SSH / remote sessions)
        if self.enable_osc52 {
            let _ = Osc52Backend::write_clipboard(text);
        }

        native_res
    }

    fn paste(&mut self) -> Result<String, ClipboardError> {
        // 1. Try Native OS clipboard
        if let Ok(text) = NativeBackend::paste()
            && !text.is_empty()
        {
            self.register.set(&text);
            return Ok(text);
        }

        // 2. Fallback to Internal Register (handles headless SSH or restrictive OS environments)
        if let Some(text) = self.register.get() {
            return Ok(text);
        }

        Err(ClipboardError::Empty)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_internal_register_lifecycle() {
        let register = InternalRegister::new();
        assert_eq!(register.get(), None);

        register.set("Hello Register");
        assert_eq!(register.get().as_deref(), Some("Hello Register"));

        register.clear();
        assert_eq!(register.get(), None);
    }

    #[test]
    fn test_osc52_sequence_generation() {
        let text = "test osc52 copy";
        let seq = Osc52Backend::format_sequence(text);
        assert!(seq.starts_with("\x1b]52;c;") || seq.starts_with("\x1bPtmux;"));
        assert!(seq.contains(&base64::engine::general_purpose::STANDARD.encode(text)));
    }

    static TEST_CLIPBOARD_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn test_tui_clipboard_cascading() {
        let _guard = TEST_CLIPBOARD_MUTEX.lock().unwrap();
        let mut clipboard = TuiClipboard::new();
        let sample = "Cascading Clipboard Data 🚀";

        // Test copy
        let res = clipboard.copy(sample);
        assert!(res.is_ok() || clipboard.register.get().is_some());

        // Internal register must always have the data
        assert_eq!(clipboard.register.get().as_deref(), Some(sample));

        // Test paste
        let pasted = clipboard.paste();
        assert!(pasted.is_ok());
    }
}
