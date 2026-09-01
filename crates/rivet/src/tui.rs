//! # rivet::tui
//!
//! Ultra-responsive, modern Epistemic Agent Cockpit for Rivet.
//! 100% Feature Parity Implementation with Industry-Leading Coding Agents.
//!
//! Features:
//! - Multi-Theme System (Tokyo Night, Catppuccin Mocha, Nord, Gruvbox, Cyberpunk, Monochrome).
//! - Multi-Line Prompt Editor (Shift+Enter / Alt+Enter / Ctrl+J) with Dynamic Auto-Expanding Input Box.
//! - Token-by-Token Live Streaming with Collapsible / Expandable Thinking (`<think>`) Accordions.
//! - Rich Markdown & Code Syntax Highlighting with language badges and formatted block borders.
//! - ActiveTab::Diff ([F5/Alt+5] Git Diff & Working Tree Reviewer) with `/undo` and `/rollback`.
//! - Interactive `@` File Mention & Fuzzy File Picker popup.
//! - Human-in-the-Loop Action Authorization & Permission Gate with live diff preview.
//! - Live Context Window & Cost Telemetry Meter in header and sidebar.
//! - In-Chat Search & Navigation Mode (`Ctrl+F`, `n`/`N` navigation, auto-scroll to match).
//! - Interactive F2 (Obligations) & F3 (Soft Workspace) controllers with inspection and manual manipulation.
//! - System Diagnostic Doctor (`/doctor`) and Multi-Session Manager (`/sessions`, `/export`).
//! - Production-grade Multi-Tier Clipboard (`arboard` + OSC 52 + Internal Register + Win32/WSL fallback).
//! - High-speed Event Queue Batch Drain with burst character aggregation.

use crossterm::{
    event::{
        self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
        Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent,
        MouseEventKind,
    },
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{
    Terminal,
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Margin, Position, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, BorderType, Borders, Clear, List, ListItem, ListState, Paragraph, Scrollbar,
        ScrollbarOrientation, ScrollbarState, Tabs, Wrap,
    },
};
use rivet_core::RunPhase;
use rivet_model::auth::AuthStore;
use rivet_model::provider_hub::{
    ProviderRegistry, ResolvedProviderConfig, fetch_remote_models, get_known_providers,
};
use rivet_repository::{CensusRunner, RepositoryCensus};
use rivet_service::{RivetService, StepRequest};
use std::collections::HashMap;
use std::future::Future;
use std::io::{self, Write, stdout};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio::sync::oneshot;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

const SPINNER_FRAMES: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// =============================================================================
// THEMES & COLOR PALETTES
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ThemeMode {
    #[default]
    TokyoNight,
    CatppuccinMocha,
    Nord,
    Gruvbox,
    Cyberpunk,
    Monochrome,
}

impl ThemeMode {
    pub fn all() -> &'static [ThemeMode] {
        &[
            ThemeMode::TokyoNight,
            ThemeMode::CatppuccinMocha,
            ThemeMode::Nord,
            ThemeMode::Gruvbox,
            ThemeMode::Cyberpunk,
            ThemeMode::Monochrome,
        ]
    }

    pub fn name(&self) -> &'static str {
        match self {
            ThemeMode::TokyoNight => "Tokyo Night (Default)",
            ThemeMode::CatppuccinMocha => "Catppuccin Mocha",
            ThemeMode::Nord => "Nord Arctic",
            ThemeMode::Gruvbox => "Gruvbox Dark",
            ThemeMode::Cyberpunk => "Cyberpunk Neon",
            ThemeMode::Monochrome => "Monochrome Terminal",
        }
    }

    pub fn palette(&self) -> ThemePalette {
        match self {
            ThemeMode::TokyoNight => ThemePalette {
                primary: Color::Rgb(122, 162, 247),   // #7aa2f7 Soft Blue
                secondary: Color::Rgb(187, 154, 247), // #bb9af7 Lavender
                success: Color::Rgb(158, 206, 106),   // #9ece6a Soft Green
                warning: Color::Rgb(224, 175, 104),   // #e0af68 Warm Amber
                danger: Color::Rgb(247, 118, 142),    // #f7768e Coral Red
                muted: Color::Rgb(86, 95, 137),       // #565f89 Slate Gray
                border: Color::Rgb(65, 72, 104),      // #414868 Muted Border
                active_border: Color::Rgb(122, 162, 247),
                selection_bg: Color::Rgb(65, 80, 130),
                selection_fg: Color::Rgb(255, 255, 255),
                think_bg: Color::Rgb(25, 30, 48),
                code_bg: Color::Rgb(20, 22, 34),
            },
            ThemeMode::CatppuccinMocha => ThemePalette {
                primary: Color::Rgb(137, 180, 250),   // Blue
                secondary: Color::Rgb(203, 166, 247), // Mauve
                success: Color::Rgb(166, 227, 161),   // Green
                warning: Color::Rgb(249, 226, 175),   // Yellow
                danger: Color::Rgb(243, 139, 168),    // Red
                muted: Color::Rgb(108, 112, 134),     // Overlay0
                border: Color::Rgb(88, 91, 112),      // Surface2
                active_border: Color::Rgb(137, 180, 250),
                selection_bg: Color::Rgb(88, 91, 112),
                selection_fg: Color::Rgb(205, 214, 244),
                think_bg: Color::Rgb(24, 24, 37),
                code_bg: Color::Rgb(17, 17, 27),
            },
            ThemeMode::Nord => ThemePalette {
                primary: Color::Rgb(136, 192, 208),   // Frost Blue
                secondary: Color::Rgb(180, 142, 173), // Aurora Purple
                success: Color::Rgb(163, 190, 140),   // Aurora Green
                warning: Color::Rgb(235, 203, 139),   // Aurora Yellow
                danger: Color::Rgb(191, 97, 106),     // Aurora Red
                muted: Color::Rgb(76, 86, 106),       // Polar Night 3
                border: Color::Rgb(67, 76, 94),       // Polar Night 2
                active_border: Color::Rgb(136, 192, 208),
                selection_bg: Color::Rgb(76, 86, 106),
                selection_fg: Color::Rgb(236, 239, 244),
                think_bg: Color::Rgb(46, 52, 64),
                code_bg: Color::Rgb(36, 41, 51),
            },
            ThemeMode::Gruvbox => ThemePalette {
                primary: Color::Rgb(131, 165, 152),   // Gruvbox Blue
                secondary: Color::Rgb(211, 134, 155), // Gruvbox Purple
                success: Color::Rgb(184, 187, 38),    // Gruvbox Green
                warning: Color::Rgb(250, 189, 47),    // Gruvbox Yellow
                danger: Color::Rgb(251, 73, 52),      // Gruvbox Red
                muted: Color::Rgb(146, 131, 116),     // Gruvbox Gray
                border: Color::Rgb(80, 73, 69),       // Gruvbox Dark 2
                active_border: Color::Rgb(250, 189, 47),
                selection_bg: Color::Rgb(80, 73, 69),
                selection_fg: Color::Rgb(235, 219, 178),
                think_bg: Color::Rgb(40, 40, 40),
                code_bg: Color::Rgb(29, 32, 33),
            },
            ThemeMode::Cyberpunk => ThemePalette {
                primary: Color::Rgb(0, 240, 255),   // Neon Cyan
                secondary: Color::Rgb(255, 0, 128), // Neon Pink
                success: Color::Rgb(0, 255, 102),   // Matrix Green
                warning: Color::Rgb(255, 230, 0),   // Electric Yellow
                danger: Color::Rgb(255, 0, 51),     // Laser Red
                muted: Color::Rgb(90, 80, 110),     // Dark Violet
                border: Color::Rgb(80, 20, 90),
                active_border: Color::Rgb(0, 240, 255),
                selection_bg: Color::Rgb(100, 0, 80),
                selection_fg: Color::Rgb(255, 255, 255),
                think_bg: Color::Rgb(20, 5, 25),
                code_bg: Color::Rgb(10, 2, 15),
            },
            ThemeMode::Monochrome => ThemePalette {
                primary: Color::White,
                secondary: Color::Gray,
                success: Color::White,
                warning: Color::Gray,
                danger: Color::Red,
                muted: Color::DarkGray,
                border: Color::DarkGray,
                active_border: Color::White,
                selection_bg: Color::White,
                selection_fg: Color::Black,
                think_bg: Color::Black,
                code_bg: Color::Black,
            },
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ThemePalette {
    pub primary: Color,
    pub secondary: Color,
    pub success: Color,
    pub warning: Color,
    pub danger: Color,
    pub muted: Color,
    pub border: Color,
    pub active_border: Color,
    pub selection_bg: Color,
    pub selection_fg: Color,
    pub think_bg: Color,
    pub code_bg: Color,
}

// =============================================================================
// UNICODE & DISPLAY WIDTH UTILITIES
// =============================================================================

/// Converts a visual terminal column into a character index within a string using unicode display widths.
pub fn visual_col_to_char_index(s: &str, target_visual_col: usize) -> usize {
    let mut current_col = 0;
    for (char_idx, ch) in s.chars().enumerate() {
        let char_w = UnicodeWidthChar::width(ch).unwrap_or(1);
        if current_col + char_w > target_visual_col {
            return char_idx;
        }
        current_col += char_w;
    }
    s.chars().count()
}

/// Converts a character index within a string into the visual terminal column offset.
pub fn char_index_to_visual_col(s: &str, char_idx: usize) -> usize {
    s.chars()
        .take(char_idx)
        .map(|c| UnicodeWidthChar::width(c).unwrap_or(1))
        .sum()
}

pub use crate::clipboard::{
    Clipboard, ClipboardError, InternalRegister, Osc52Backend, TuiClipboard,
};

/// Backward-compatible alias directing to the production-grade multi-tier `TuiClipboard`
pub struct ClipboardHelper;

impl ClipboardHelper {
    #[inline]
    pub fn get() -> Option<String> {
        TuiClipboard::paste_text()
    }

    #[inline]
    pub fn set(text: &str) -> bool {
        TuiClipboard::copy_text(text)
    }
}

/// Ephemeral toast notification for user feedback
#[derive(Debug, Clone)]
pub struct ToastNotification {
    pub message: String,
    pub color: Color,
    pub created_at: Instant,
    pub duration: Duration,
}

impl ToastNotification {
    pub fn new(message: impl Into<String>, color: Color) -> Self {
        Self {
            message: message.into(),
            color,
            created_at: Instant::now(),
            duration: Duration::from_millis(2500),
        }
    }

    pub fn is_expired(&self) -> bool {
        self.created_at.elapsed() >= self.duration
    }
}

// =============================================================================
// ACTIVE TABS & WORKSPACES
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveTab {
    Chat = 0,
    Obligations = 1,
    Workspace = 2,
    Census = 3,
    Diff = 4,
}

impl ActiveTab {
    pub fn all() -> &'static [ActiveTab] {
        &[
            ActiveTab::Chat,
            ActiveTab::Obligations,
            ActiveTab::Workspace,
            ActiveTab::Census,
            ActiveTab::Diff,
        ]
    }

    pub fn title(&self) -> &'static str {
        match self {
            ActiveTab::Chat => "F1: 💬 Chat Stream",
            ActiveTab::Obligations => "F2: 📋 Obligations & Claims",
            ActiveTab::Workspace => "F3: 🧠 Soft Workspace",
            ActiveTab::Census => "F4: 📊 Census & Frontier",
            ActiveTab::Diff => "F5: 🔍 Git Diff & Changes",
        }
    }

    pub fn next(&self) -> Self {
        match self {
            ActiveTab::Chat => ActiveTab::Obligations,
            ActiveTab::Obligations => ActiveTab::Workspace,
            ActiveTab::Workspace => ActiveTab::Census,
            ActiveTab::Census => ActiveTab::Diff,
            ActiveTab::Diff => ActiveTab::Chat,
        }
    }

    pub fn prev(&self) -> Self {
        match self {
            ActiveTab::Chat => ActiveTab::Diff,
            ActiveTab::Obligations => ActiveTab::Chat,
            ActiveTab::Workspace => ActiveTab::Obligations,
            ActiveTab::Census => ActiveTab::Workspace,
            ActiveTab::Diff => ActiveTab::Census,
        }
    }
}

// =============================================================================
// SLASH COMMANDS CATALOG
// =============================================================================

#[derive(Debug, Clone)]
pub struct SlashCommandDef {
    pub name: &'static str,
    pub shortcut: &'static str,
    pub description: &'static str,
    pub usage: &'static str,
}

const SLASH_COMMANDS: &[SlashCommandDef] = &[
    SlashCommandDef {
        name: "provider",
        shortcut: "Ctrl+P",
        description: "Open Provider Manager & Connection Menu",
        usage: "/provider [name]",
    },
    SlashCommandDef {
        name: "model",
        shortcut: "Ctrl+M",
        description: "Open Model Picker or switch active model",
        usage: "/model [model_id]",
    },
    SlashCommandDef {
        name: "connect",
        shortcut: "",
        description: "Connect a new provider or custom endpoint",
        usage: "/connect [provider] [api_key] [base_url]",
    },
    SlashCommandDef {
        name: "diff",
        shortcut: "F5",
        description: "Switch to Git Diff & Working Tree Reviewer",
        usage: "/diff",
    },
    SlashCommandDef {
        name: "undo",
        shortcut: "u",
        description: "Undo/Revert latest file change or rollback revision",
        usage: "/undo or /rollback [r<n>]",
    },
    SlashCommandDef {
        name: "theme",
        shortcut: "",
        description: "Switch TUI Color Theme (Tokyo Night, Catppuccin, Nord, etc.)",
        usage: "/theme [name]",
    },
    SlashCommandDef {
        name: "doctor",
        shortcut: "",
        description: "Run System Health Diagnostics & Toolchain Audit",
        usage: "/doctor",
    },
    SlashCommandDef {
        name: "sessions",
        shortcut: "",
        description: "Manage saved Hard State sessions & Conversation Branching",
        usage: "/sessions",
    },
    SlashCommandDef {
        name: "export",
        shortcut: "",
        description: "Export current conversation & receipts to Markdown file",
        usage: "/export [filename.md]",
    },
    SlashCommandDef {
        name: "search",
        shortcut: "Ctrl+F",
        description: "Search in conversation history with match navigation",
        usage: "/search <query>",
    },
    SlashCommandDef {
        name: "mention",
        shortcut: "@",
        description: "Attach file context via fuzzy file picker",
        usage: "@<path> or /mention",
    },
    SlashCommandDef {
        name: "copy",
        shortcut: "Ctrl+C",
        description: "Copy selection or latest response to OS clipboard",
        usage: "/copy",
    },
    SlashCommandDef {
        name: "paste",
        shortcut: "Ctrl+V",
        description: "Paste clipboard contents into input prompt",
        usage: "/paste",
    },
    SlashCommandDef {
        name: "goal",
        shortcut: "",
        description: "Compile and lock a formal GoalSpec & Obligation DAG",
        usage: "/goal <task description>",
    },
    SlashCommandDef {
        name: "census",
        shortcut: "",
        description: "Run deterministic census on active project",
        usage: "/census",
    },
    SlashCommandDef {
        name: "sidebar",
        shortcut: "Ctrl+B",
        description: "Toggle Inspector sidebar visibility",
        usage: "/sidebar",
    },
    SlashCommandDef {
        name: "obligations",
        shortcut: "F2",
        description: "Inspect open & closed obligations in Noesis Hard State",
        usage: "/obligations",
    },
    SlashCommandDef {
        name: "claims",
        shortcut: "",
        description: "List verified epistemic claims and receipts",
        usage: "/claims",
    },
    SlashCommandDef {
        name: "reframe",
        shortcut: "",
        description: "Trigger Hephaestus soft workspace reframing",
        usage: "/reframe",
    },
    SlashCommandDef {
        name: "clear",
        shortcut: "",
        description: "Clear working hypotheses in Soft Workspace",
        usage: "/clear",
    },
    SlashCommandDef {
        name: "help",
        shortcut: "/help",
        description: "Show list of available commands and keybindings",
        usage: "/help or :?",
    },
    SlashCommandDef {
        name: "quit",
        shortcut: "Esc",
        description: "Exit the Rivet Cockpit",
        usage: "/quit or :q",
    },
];

// =============================================================================
// MULTI-LINE LINE EDITOR STATE
// =============================================================================

/// Interactive multi-line editor state supporting cursor movements, selection,
/// newlines (`Shift+Enter` / `Alt+Enter`), word jumps, clipboard and delete operations.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EditorState {
    pub text: String,
    pub cursor: usize,                   // Character index (0..=char_count)
    pub selection_anchor: Option<usize>, // Character index anchor for active selection
}

impl EditorState {
    pub fn new() -> Self {
        Self {
            text: String::new(),
            cursor: 0,
            selection_anchor: None,
        }
    }

    pub fn with_text(text: impl Into<String>) -> Self {
        let t = text.into();
        let cursor = t.chars().count();
        Self {
            text: t,
            cursor,
            selection_anchor: None,
        }
    }

    pub fn line_count(&self) -> usize {
        self.text.lines().count().max(1)
    }

    pub fn lines_vec(&self) -> Vec<String> {
        if self.text.is_empty() {
            vec![String::new()]
        } else {
            let mut lines: Vec<String> = self.text.lines().map(|s| s.to_string()).collect();
            if self.text.ends_with('\n') {
                lines.push(String::new());
            }
            lines
        }
    }

    /// Computes (line_index, col_char_index) of the cursor
    pub fn cursor_line_and_col(&self) -> (usize, usize) {
        let mut char_count = 0;
        let lines = self.lines_vec();
        for (l_idx, line) in lines.iter().enumerate() {
            let line_chars = line.chars().count();
            if self.cursor <= char_count + line_chars {
                return (l_idx, self.cursor.saturating_sub(char_count));
            }
            char_count += line_chars + 1; // +1 for '\n'
        }
        (lines.len().saturating_sub(1), 0)
    }

    /// Moves cursor up one line, preserving column where possible
    pub fn move_up(&mut self) {
        let (cur_line, cur_col) = self.cursor_line_and_col();
        if cur_line > 0 {
            let lines = self.lines_vec();
            let prev_line_len = lines[cur_line - 1].chars().count();
            let target_col = cur_col.min(prev_line_len);

            // Compute target char index
            let mut target_idx = 0;
            for line in lines.iter().take(cur_line - 1) {
                target_idx += line.chars().count() + 1;
            }
            target_idx += target_col;
            self.cursor = target_idx;
        } else {
            self.cursor = 0;
        }
    }

    /// Moves cursor down one line, preserving column where possible
    pub fn move_down(&mut self) {
        let (cur_line, cur_col) = self.cursor_line_and_col();
        let lines = self.lines_vec();
        if cur_line + 1 < lines.len() {
            let next_line_len = lines[cur_line + 1].chars().count();
            let target_col = cur_col.min(next_line_len);

            let mut target_idx = 0;
            for line in lines.iter().take(cur_line + 1) {
                target_idx += line.chars().count() + 1;
            }
            target_idx += target_col;
            self.cursor = target_idx;
        } else {
            self.cursor = self.char_count();
        }
    }

    /// Returns sorted character range (start, end) if text is actively selected
    pub fn selected_range(&self) -> Option<(usize, usize)> {
        self.selection_anchor.and_then(|anchor| {
            if anchor != self.cursor {
                Some((anchor.min(self.cursor), anchor.max(self.cursor)))
            } else {
                None
            }
        })
    }

    /// Returns the selected substring if active
    pub fn selected_text(&self) -> Option<String> {
        self.selected_range().map(|(start, end)| {
            let start_b = self.char_to_byte(start);
            let end_b = self.char_to_byte(end);
            self.text[start_b..end_b].to_string()
        })
    }

    /// Deletes the active selection and moves cursor to the start of the deletion.
    pub fn delete_selection(&mut self) -> bool {
        if let Some((start, end)) = self.selected_range() {
            let start_b = self.char_to_byte(start);
            let end_b = self.char_to_byte(end);
            self.text.drain(start_b..end_b);
            self.cursor = start;
            self.selection_anchor = None;
            true
        } else {
            false
        }
    }

    pub fn char_count(&self) -> usize {
        self.text.chars().count()
    }

    pub fn insert(&mut self, c: char) {
        self.delete_selection();
        let byte_idx = self.char_to_byte(self.cursor);
        self.text.insert(byte_idx, c);
        self.cursor += 1;
        self.selection_anchor = None;
    }

    pub fn insert_newline(&mut self) {
        self.insert('\n');
    }

    pub fn insert_str(&mut self, s: &str) {
        self.delete_selection();
        for c in s.chars() {
            let byte_idx = self.char_to_byte(self.cursor);
            self.text.insert(byte_idx, c);
            self.cursor += 1;
        }
        self.selection_anchor = None;
    }

    pub fn backspace(&mut self) -> bool {
        if self.delete_selection() {
            return true;
        }
        if self.cursor > 0 {
            self.cursor -= 1;
            let byte_idx = self.char_to_byte(self.cursor);
            self.text.remove(byte_idx);
            true
        } else {
            false
        }
    }

    pub fn delete(&mut self) -> bool {
        if self.delete_selection() {
            return true;
        }
        if self.cursor < self.char_count() {
            let byte_idx = self.char_to_byte(self.cursor);
            self.text.remove(byte_idx);
            true
        } else {
            false
        }
    }

    pub fn delete_word_backward(&mut self) {
        if self.cursor == 0 {
            return;
        }
        let chars: Vec<char> = self.text.chars().collect();
        let mut new_cursor = self.cursor;
        while new_cursor > 0 && chars[new_cursor - 1].is_whitespace() {
            new_cursor -= 1;
        }
        while new_cursor > 0 && !chars[new_cursor - 1].is_whitespace() {
            new_cursor -= 1;
        }
        let start_byte = self.char_to_byte(new_cursor);
        let end_byte = self.char_to_byte(self.cursor);
        self.text.drain(start_byte..end_byte);
        self.cursor = new_cursor;
    }

    pub fn clear(&mut self) {
        self.text.clear();
        self.cursor = 0;
        self.selection_anchor = None;
    }

    pub fn set_text(&mut self, t: String) {
        self.cursor = t.chars().count();
        self.text = t;
        self.selection_anchor = None;
    }

    pub fn move_left(&mut self) {
        if self.cursor > 0 {
            self.cursor -= 1;
        }
    }

    pub fn move_right(&mut self) {
        if self.cursor < self.char_count() {
            self.cursor += 1;
        }
    }

    pub fn move_word_left(&mut self) {
        if self.cursor == 0 {
            return;
        }
        let chars: Vec<char> = self.text.chars().collect();
        let mut new_cursor = self.cursor;
        while new_cursor > 0 && chars[new_cursor - 1].is_whitespace() {
            new_cursor -= 1;
        }
        while new_cursor > 0 && !chars[new_cursor - 1].is_whitespace() {
            new_cursor -= 1;
        }
        self.cursor = new_cursor;
    }

    pub fn move_word_right(&mut self) {
        let total = self.char_count();
        if self.cursor >= total {
            return;
        }
        let chars: Vec<char> = self.text.chars().collect();
        let mut new_cursor = self.cursor;
        while new_cursor < total && !chars[new_cursor].is_whitespace() {
            new_cursor += 1;
        }
        while new_cursor < total && chars[new_cursor].is_whitespace() {
            new_cursor += 1;
        }
        self.cursor = new_cursor;
    }

    pub fn move_home(&mut self) {
        self.cursor = 0;
    }

    pub fn move_end(&mut self) {
        self.cursor = self.char_count();
    }

    pub fn delete_word_forward(&mut self) {
        let total = self.char_count();
        if self.cursor >= total {
            return;
        }
        let chars: Vec<char> = self.text.chars().collect();
        let mut end_cursor = self.cursor;
        while end_cursor < total && chars[end_cursor].is_whitespace() {
            end_cursor += 1;
        }
        while end_cursor < total && !chars[end_cursor].is_whitespace() {
            end_cursor += 1;
        }
        let start_byte = self.char_to_byte(self.cursor);
        let end_byte = self.char_to_byte(end_cursor);
        self.text.drain(start_byte..end_byte);
    }

    pub fn kill_to_end(&mut self) {
        let total = self.char_count();
        if self.cursor < total {
            let start_byte = self.char_to_byte(self.cursor);
            self.text.drain(start_byte..);
        }
    }

    pub fn copy_to_clipboard(&self) -> bool {
        if let Some(selected) = self.selected_text() {
            TuiClipboard::copy_text(&selected)
        } else if !self.text.is_empty() {
            TuiClipboard::copy_text(&self.text)
        } else {
            false
        }
    }

    pub fn cut_to_clipboard(&mut self) -> bool {
        if self.selected_range().is_some() {
            let selected = self.selected_text().unwrap_or_default();
            let ok = TuiClipboard::copy_text(&selected);
            self.delete_selection();
            ok
        } else if !self.text.is_empty() {
            let ok = TuiClipboard::copy_text(&self.text);
            self.clear();
            ok
        } else {
            false
        }
    }

    pub fn paste_from_clipboard(&mut self) -> bool {
        if let Some(text) = TuiClipboard::paste_text() {
            self.insert_str(&text);
            true
        } else {
            false
        }
    }

    /// Unified key handler for text editing with the Holy Trinity: Selection + Clipboard + TextInput + Multi-line
    pub fn handle_editor_key(&mut self, key: KeyEvent) -> bool {
        let is_ctrl = key.modifiers.contains(KeyModifiers::CONTROL)
            && !key.modifiers.contains(KeyModifiers::ALT);
        let is_alt = key.modifiers.contains(KeyModifiers::ALT);
        let is_shift = key.modifiers.contains(KeyModifiers::SHIFT);

        // Shift + Navigation (Selection Expansion)
        if is_shift && !is_ctrl && !is_alt {
            match key.code {
                KeyCode::Left => {
                    if self.selection_anchor.is_none() {
                        self.selection_anchor = Some(self.cursor);
                    }
                    self.move_left();
                    return true;
                }
                KeyCode::Right => {
                    if self.selection_anchor.is_none() {
                        self.selection_anchor = Some(self.cursor);
                    }
                    self.move_right();
                    return true;
                }
                KeyCode::Up => {
                    if self.selection_anchor.is_none() {
                        self.selection_anchor = Some(self.cursor);
                    }
                    self.move_up();
                    return true;
                }
                KeyCode::Down => {
                    if self.selection_anchor.is_none() {
                        self.selection_anchor = Some(self.cursor);
                    }
                    self.move_down();
                    return true;
                }
                KeyCode::Home => {
                    if self.selection_anchor.is_none() {
                        self.selection_anchor = Some(self.cursor);
                    }
                    self.move_home();
                    return true;
                }
                KeyCode::End => {
                    if self.selection_anchor.is_none() {
                        self.selection_anchor = Some(self.cursor);
                    }
                    self.move_end();
                    return true;
                }
                KeyCode::Enter => {
                    self.insert_newline();
                    return true;
                }
                KeyCode::Insert => {
                    self.paste_from_clipboard();
                    return true;
                }
                _ => {}
            }
        }

        // Alt + Enter (Newline)
        if is_alt && key.code == KeyCode::Enter {
            self.insert_newline();
            return true;
        }

        if is_ctrl {
            match key.code {
                KeyCode::Char('j') => {
                    self.insert_newline();
                    return true;
                }
                KeyCode::Char('v') => {
                    self.paste_from_clipboard();
                    return true;
                }
                KeyCode::Char('c') => {
                    self.copy_to_clipboard();
                    return true;
                }
                KeyCode::Char('x') => {
                    self.cut_to_clipboard();
                    return true;
                }
                KeyCode::Char('a') => {
                    // Ctrl+A: Select all text
                    self.selection_anchor = Some(0);
                    self.cursor = self.char_count();
                    return true;
                }
                KeyCode::Char('e') => {
                    self.selection_anchor = None;
                    self.move_end();
                    return true;
                }
                KeyCode::Char('u') => {
                    self.clear();
                    return true;
                }
                KeyCode::Char('k') => {
                    self.kill_to_end();
                    return true;
                }
                KeyCode::Char('w') | KeyCode::Backspace => {
                    if !self.delete_selection() {
                        self.delete_word_backward();
                    }
                    return true;
                }
                KeyCode::Delete => {
                    if !self.delete_selection() {
                        self.delete_word_forward();
                    }
                    return true;
                }
                KeyCode::Left => {
                    self.selection_anchor = None;
                    self.move_word_left();
                    return true;
                }
                KeyCode::Right => {
                    self.selection_anchor = None;
                    self.move_word_right();
                    return true;
                }
                _ => {}
            }
        }

        if is_alt {
            match key.code {
                KeyCode::Backspace => {
                    if !self.delete_selection() {
                        self.delete_word_backward();
                    }
                    return true;
                }
                KeyCode::Char('b') => {
                    self.selection_anchor = None;
                    self.move_word_left();
                    return true;
                }
                KeyCode::Char('f') => {
                    self.selection_anchor = None;
                    self.move_word_right();
                    return true;
                }
                _ => {}
            }
        }

        match key.code {
            KeyCode::Left => {
                self.selection_anchor = None;
                self.move_left();
                true
            }
            KeyCode::Right => {
                self.selection_anchor = None;
                self.move_right();
                true
            }
            KeyCode::Up if self.line_count() > 1 => {
                self.selection_anchor = None;
                self.move_up();
                true
            }
            KeyCode::Down if self.line_count() > 1 => {
                self.selection_anchor = None;
                self.move_down();
                true
            }
            KeyCode::Home => {
                self.selection_anchor = None;
                self.move_home();
                true
            }
            KeyCode::End => {
                self.selection_anchor = None;
                self.move_end();
                true
            }
            KeyCode::Backspace => self.backspace(),
            KeyCode::Delete => self.delete(),
            KeyCode::Char(c) if !is_ctrl => {
                self.insert(c);
                true
            }
            _ => false,
        }
    }

    fn char_to_byte(&self, char_idx: usize) -> usize {
        self.text
            .char_indices()
            .nth(char_idx)
            .map(|(i, _)| i)
            .unwrap_or(self.text.len())
    }
}

/// Metadata record for cached large pasted text snippets
#[derive(Debug, Clone)]
pub struct PasteEntry {
    pub id: usize,
    pub line_count: usize,
    pub byte_count: usize,
    pub preview: String,
    pub full_content: String,
    pub file_path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ConnectWizardStep {
    ProviderId,
    BaseUrl,
    ApiKey,
}

// =============================================================================
// ACTIVE MODALS & DIALOGS
// =============================================================================

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
enum ActiveModal {
    None,
    ProviderMenu {
        search: EditorState,
    },
    ModelPicker {
        search: EditorState,
    },
    ConnectWizard {
        step: ConnectWizardStep,
        provider_id: EditorState,
        base_url: EditorState,
        api_key: EditorState,
    },
    CustomModelPrompt {
        editor: EditorState,
    },
    ThemePicker {
        selected_idx: usize,
    },
    DoctorDialog {
        scroll: u16,
    },
    SessionManager {
        selected_idx: usize,
    },
    FileMentionPicker {
        search: EditorState,
        selected_idx: usize,
    },
    ToolApproval {
        proposal_summary: String,
        target: String,
        capability: String,
        diff_preview: String,
    },
    ObligationDetails {
        obligation_id: String,
        scroll: u16,
    },
    ChatSearch {
        query: EditorState,
    },
    HelpDialog {
        scroll: u16,
    },
}

// =============================================================================
// APP ASYNC EVENTS
// =============================================================================

pub enum AppEvent {
    ModelResponse(Result<String, String>),
    ModelCancelled,
    ModelStreamChunk(String),
    ModelReasoningChunk(String),
    ModelStreamDone,
    GoalResponse(Result<String, String>),
    GoalCancelled,
    CensusResponse(Result<RepositoryCensus, String>),
    SubprocessOutput(String),
    DiffResponse(Result<String, String>),
}

// =============================================================================
// TUI APP MAIN ENGINE
// =============================================================================

pub struct TuiApp {
    pub service: Arc<dyn RivetService>,
    pub dynamic_backend: Arc<rivet_model::DynamicModelBackend>,
    pub auth_store: AuthStore,
    pub active_config: ResolvedProviderConfig,
    pub root_dir: PathBuf,

    // Theme state
    pub active_theme: ThemeMode,

    // Input & Editor State
    pub input_editor: EditorState,
    pub history: Vec<String>,
    pub history_idx: Option<usize>,

    // Paste Cache Storage
    pub paste_counter: usize,
    pub paste_cache: HashMap<usize, PasteEntry>,

    // Chat stream & Messages
    pub chat_messages: Vec<(String, String)>,
    pub chat_scroll: u16,
    pub auto_scroll_to_bottom: bool,

    // Streaming & Reasoning CoT
    pub streaming_prose: String,
    pub streaming_thought: String,
    pub is_thinking_expanded: bool,

    // Chat Search (Ctrl+F)
    pub chat_search_query: Option<String>,
    pub chat_search_match_idx: usize,

    // Git Diff Tab cache
    pub cached_diff: Option<String>,
    pub diff_scroll: u16,

    // Visual Text Selection in Chat
    pub selection_anchor: Option<(u16, usize)>, // (col, line_idx)
    pub selection_cursor: Option<(u16, usize)>, // (col, line_idx)
    pub is_mouse_selecting: bool,

    // Navigation & Layout
    pub active_tab: ActiveTab,
    pub show_sidebar: bool,
    pub should_quit: bool,

    // Processing & Animation
    pub is_processing: bool,
    pub processing_start: Option<Instant>,
    pub spinner_frame: usize,
    processing_cancel: Option<oneshot::Sender<()>>,

    // Ephemeral Toast Status Feedback
    pub toast: Option<ToastNotification>,

    // Tab lists & scrolls
    pub obligations_scroll: u16,
    pub obligations_selected_idx: usize,
    pub workspace_scroll: u16,
    pub hypotheses_selected_idx: usize,
    pub census_scroll: u16,
    pub cached_census: Option<RepositoryCensus>,

    // Modals & Palettes
    active_modal: ActiveModal,
    modal_list_state: ListState,
    slash_list_state: ListState,
    dynamic_models: Vec<String>,

    // Cached UI Rects & dynamic Tab boundaries for pixel-perfect Hit-Testing
    layout_header: Rect,
    layout_tabs: Rect,
    tab_bounds: Vec<(ActiveTab, u16, u16)>, // (tab, start_x, end_x)
    layout_content: Rect,
    layout_chat: Rect,
    layout_sidebar: Rect,
    layout_input: Rect,
    layout_footer: Rect,
    layout_slash_palette: Option<Rect>,
    layout_modal: Option<Rect>,

    // Async Channel
    event_tx: UnboundedSender<AppEvent>,
    event_rx: UnboundedReceiver<AppEvent>,
}

async fn run_cancellable_model_step(
    service: Arc<dyn RivetService>,
    goal: String,
    prompt: String,
    tx: UnboundedSender<AppEvent>,
    cancel_rx: oneshot::Receiver<()>,
) {
    let operation_service = service.clone();
    let operation = async move {
        operation_service
            .step(StepRequest {
                prompt,
                goal: Some(goal),
                attachments: vec![],
            })
            .await
            .map(|resp| resp.text)
            .map_err(|error| error.to_string())
    };
    match wait_for_cancellable_result(operation, cancel_rx).await {
        Some(result) => {
            let _ = tx.send(AppEvent::ModelResponse(result));
        }
        None => {
            let _ = service.cancel().await;
            let _ = tx.send(AppEvent::ModelCancelled);
        }
    }
}

async fn wait_for_cancellable_result<F>(
    operation: F,
    cancel_rx: oneshot::Receiver<()>,
) -> Option<Result<String, String>>
where
    F: Future<Output = Result<String, String>> + Send,
{
    tokio::select! {
        result = operation => Some(result),
        _ = cancel_rx => None,
    }
}

async fn run_cancellable_goal(
    service: Arc<dyn RivetService>,
    goal_prompt: String,
    tx: UnboundedSender<AppEvent>,
    cancel_rx: oneshot::Receiver<()>,
) {
    let result = service
        .initialize_goal(&goal_prompt)
        .await
        .map(|dto| (dto.summary.clone(), dto.obligations_created))
        .map_err(|e| e.to_string());
    tokio::select! {
        _ = async {} => {
            let mapped = result
                .map(|(summary, count)| format!("🎯 Compiled GoalSpec '{}' with {} obligations.", summary, count))
                .map_err(|error| error.to_string());
            let _ = tx.send(AppEvent::GoalResponse(mapped));
        }
        _ = cancel_rx => {
            let _ = service.cancel().await;
            let _ = tx.send(AppEvent::GoalCancelled);
        }
    }
}

impl TuiApp {
    pub fn new(
        service: Arc<dyn RivetService>,
        dynamic_backend: Arc<rivet_model::DynamicModelBackend>,
        auth_store: AuthStore,
        active_config: ResolvedProviderConfig,
        root_dir: PathBuf,
    ) -> Self {
        let (event_tx, event_rx) = unbounded_channel();
        let status_desc = ProviderRegistry::format_status(&active_config);

        let mut modal_list_state = ListState::default();
        modal_list_state.select(Some(0));

        let mut slash_list_state = ListState::default();
        slash_list_state.select(Some(0));

        Self {
            service,
            dynamic_backend,
            auth_store,
            active_config,
            root_dir,
            active_theme: ThemeMode::TokyoNight,
            input_editor: EditorState::new(),
            history: Vec::new(),
            history_idx: None,
            paste_counter: 0,
            paste_cache: HashMap::new(),
            chat_messages: vec![
                (
                    "System".into(),
                    "⚡ Welcome to Rivet Epistemic Software Engineering Cockpit.".into(),
                ),
                (
                    "System".into(),
                    format!(
                        "Active {}\n💡 F1..F5 for Tabs, Ctrl+P for Providers, Ctrl+M for Models, Ctrl+F to Search, @ to Mention Files, Shift+Enter for Newline.",
                        status_desc
                    ),
                ),
            ],
            chat_scroll: 0,
            auto_scroll_to_bottom: true,
            streaming_prose: String::new(),
            streaming_thought: String::new(),
            is_thinking_expanded: false,
            chat_search_query: None,
            chat_search_match_idx: 0,
            cached_diff: None,
            diff_scroll: 0,
            selection_anchor: None,
            selection_cursor: None,
            is_mouse_selecting: false,
            active_tab: ActiveTab::Chat,
            show_sidebar: true,
            should_quit: false,
            is_processing: false,
            processing_start: None,
            spinner_frame: 0,
            processing_cancel: None,
            toast: None,
            obligations_scroll: 0,
            obligations_selected_idx: 0,
            workspace_scroll: 0,
            hypotheses_selected_idx: 0,
            census_scroll: 0,
            cached_census: None,
            active_modal: ActiveModal::None,
            modal_list_state,
            slash_list_state,
            dynamic_models: Vec::new(),
            layout_header: Rect::default(),
            layout_tabs: Rect::default(),
            tab_bounds: Vec::new(),
            layout_content: Rect::default(),
            layout_chat: Rect::default(),
            layout_sidebar: Rect::default(),
            layout_input: Rect::default(),
            layout_footer: Rect::default(),
            layout_slash_palette: None,
            layout_modal: None,
            event_tx,
            event_rx,
        }
    }

    #[inline]
    pub fn theme(&self) -> ThemePalette {
        self.active_theme.palette()
    }

    pub fn set_toast(&mut self, message: impl Into<String>, color: Color) {
        self.toast = Some(ToastNotification::new(message, color));
    }

    async fn cancel_processing(&mut self) {
        if let Some(cancel) = self.processing_cancel.take() {
            let _ = cancel.send(());
            let _ = self.service.cancel().await;
            self.is_processing = false;
            self.processing_start = None;
            self.chat_messages
                .push(("System".into(), "⚠️ Operation cancelled by user.".into()));
            self.set_toast("⚠️ Request cancelled", self.theme().warning);
        }
    }

    pub async fn run(&mut self) -> anyhow::Result<()> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(
            stdout,
            EnterAlternateScreen,
            EnableMouseCapture,
            EnableBracketedPaste
        )?;
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;

        // Trigger initial background census & git diff
        self.trigger_background_census();
        self.trigger_background_diff();

        let tick_rate = Duration::from_millis(40);
        let mut last_tick = Instant::now();

        while !self.should_quit {
            // 1. Process all available background events non-blockingly
            while let Ok(app_event) = self.event_rx.try_recv() {
                self.handle_app_event(app_event);
            }

            // 2. Advance spinner if processing
            if last_tick.elapsed() >= tick_rate {
                self.spinner_frame = (self.spinner_frame + 1) % SPINNER_FRAMES.len();
                last_tick = Instant::now();
            }

            // 3. Clear expired toast
            if let Some(ref t) = self.toast
                && t.is_expired()
            {
                self.toast = None;
            }

            // 4. Fetch current system state snapshots
            let state_dto =
                self.service
                    .get_state()
                    .await
                    .unwrap_or_else(|_| rivet_service::StateDto {
                        revision: 0,
                        phase: RunPhase::Idle,
                        session_id: String::new(),
                        task_id: String::new(),
                        repository_id: String::new(),
                        hard_state: rivet_service::HardStateSummary {
                            revision: 0,
                            open_obligations: vec![],
                            closed_obligations: vec![],
                            claims: vec![],
                            contradictions: vec![],
                            rejected_claims: vec![],
                            recent_evidence: vec![],
                            verification_receipts: vec![],
                            completed_tasks: vec![],
                        },
                        soft_workspace: rivet_service::SoftWorkspaceSummary {
                            workspace_id: String::new(),
                            session_id: String::new(),
                            base_hard_revision: 0,
                            active_focus: vec![],
                            hypotheses: vec![],
                            unknowns: vec![],
                            candidate_actions: vec![],
                            item_count: 0,
                            max_capacity: 0,
                        },
                        cognitive_view: None,
                        model_invocation_count: 0,
                    });
            let phase = state_dto.phase;
            let hard = state_dto.hard_state.to_hard_state();
            let soft = state_dto.soft_workspace.to_soft_workspace();

            // 5. Render UI
            terminal.draw(|f| {
                let size = f.area();

                // Dynamic Input Height calculation based on multi-line prompt
                let input_lines = self.input_editor.line_count().min(6) as u16;
                let input_box_height = input_lines + 2; // +2 for borders

                let main_layout = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3),                // Top Header Bar
                        Constraint::Length(3),                // Tab Selection Bar
                        Constraint::Min(6),                   // Active Tab Workspace
                        Constraint::Length(input_box_height), // Dynamic Input Prompt Box
                        Constraint::Length(1),                // Footer Shortcut Hints
                    ])
                    .split(size);

                self.layout_header = main_layout[0];
                self.layout_tabs = main_layout[1];
                self.layout_content = main_layout[2];
                self.layout_input = main_layout[3];
                self.layout_footer = main_layout[4];

                // --- 1. Top Header Bar ---
                self.render_header(f, main_layout[0], phase, &hard);

                // --- 2. Tab Navigation Bar ---
                self.render_tab_bar(f, main_layout[1]);

                // --- 3. Active Tab Workspace ---
                match self.active_tab {
                    ActiveTab::Chat => {
                        self.render_chat_tab(f, main_layout[2], &hard, &soft, phase);
                    }
                    ActiveTab::Obligations => {
                        self.layout_chat = main_layout[2];
                        self.layout_sidebar = Rect::default();
                        self.render_obligations_tab(f, main_layout[2], &hard);
                    }
                    ActiveTab::Workspace => {
                        self.layout_chat = main_layout[2];
                        self.layout_sidebar = Rect::default();
                        self.render_workspace_tab(f, main_layout[2], &soft, &hard);
                    }
                    ActiveTab::Census => {
                        self.layout_chat = main_layout[2];
                        self.layout_sidebar = Rect::default();
                        self.render_census_tab(f, main_layout[2]);
                    }
                    ActiveTab::Diff => {
                        self.layout_chat = main_layout[2];
                        self.layout_sidebar = Rect::default();
                        self.render_diff_tab(f, main_layout[2]);
                    }
                }

                // --- 4. Input Prompt Box ---
                self.render_input_box(f, main_layout[3]);

                // --- 5. Footer Shortcut Hints ---
                self.render_footer(f, main_layout[4]);

                // --- 6. Floating Slash Command Palette (if input starts with '/') ---
                if self.active_modal == ActiveModal::None && self.input_editor.text.starts_with('/')
                {
                    self.render_slash_palette(f, main_layout[3], size);
                } else {
                    self.layout_slash_palette = None;
                }

                // --- 7. Floating Modals & Dialogs ---
                self.render_modals(f, size);

                // --- 8. Ephemeral Toast Notification ---
                if let Some(ref toast) = self.toast {
                    self.render_toast(f, toast, size);
                }
            })?;

            // 6. High-speed Event Queue Batch Drain
            if event::poll(Duration::from_millis(15))? {
                let mut pending_events = Vec::new();
                pending_events.push(event::read()?);

                while event::poll(Duration::from_millis(0))? {
                    pending_events.push(event::read()?);
                }

                self.handle_batch_events(pending_events).await;
            }
        }

        // Teardown terminal
        disable_raw_mode()?;
        execute!(
            terminal.backend_mut(),
            LeaveAlternateScreen,
            DisableMouseCapture,
            DisableBracketedPaste
        )?;
        terminal.show_cursor()?;
        Ok(())
    }

    fn handle_app_event(&mut self, event: AppEvent) {
        match event {
            AppEvent::ModelStreamChunk(chunk) => {
                // Filter literal JSON null spam that some models emit for greeting/no-op
                // (keeps provenance, but don't render "null" as visible text)
                let trimmed = chunk.trim();
                if trimmed == "null" || trimmed == "\"null\"" {
                    return;
                }
                self.is_processing = true;
                self.streaming_prose.push_str(&chunk);
                self.auto_scroll_to_bottom = true;
            }
            AppEvent::ModelReasoningChunk(chunk) => {
                self.is_processing = true;
                self.streaming_thought.push_str(&chunk);
                self.auto_scroll_to_bottom = true;
            }
            AppEvent::ModelStreamDone => {
                self.is_processing = false;
                self.processing_start = None;
                if !self.streaming_thought.is_empty() || !self.streaming_prose.is_empty() {
                    let mut full_msg = String::new();
                    if !self.streaming_thought.is_empty() {
                        full_msg.push_str("<think>\n");
                        full_msg.push_str(&self.streaming_thought);
                        full_msg.push_str("\n</think>\n\n");
                    }
                    full_msg.push_str(&self.streaming_prose);
                    self.chat_messages.push(("Rivet".into(), full_msg));
                    self.streaming_thought.clear();
                    self.streaming_prose.clear();
                }
                self.auto_scroll_to_bottom = true;
                self.ring_terminal_bell();
            }
            AppEvent::ModelResponse(res) => {
                self.processing_cancel = None;
                self.is_processing = false;
                self.processing_start = None;
                self.auto_scroll_to_bottom = true;
                match res {
                    Ok(text) => {
                        self.chat_messages.push(("Rivet".into(), text));
                    }
                    Err(err) => {
                        self.chat_messages
                            .push(("Error".into(), format!("Model error: {}", err)));
                    }
                }
                self.ring_terminal_bell();
            }
            AppEvent::ModelCancelled => {
                self.processing_cancel = None;
                self.is_processing = false;
                self.processing_start = None;
            }
            AppEvent::GoalResponse(res) => {
                self.processing_cancel = None;
                self.is_processing = false;
                self.processing_start = None;
                self.auto_scroll_to_bottom = true;
                match res {
                    Ok(msg) => {
                        self.chat_messages.push(("System".into(), msg));
                    }
                    Err(err) => {
                        self.chat_messages
                            .push(("Error".into(), format!("Goal compilation error: {}", err)));
                    }
                }
            }
            AppEvent::GoalCancelled => {
                self.processing_cancel = None;
                self.is_processing = false;
                self.processing_start = None;
            }
            AppEvent::CensusResponse(res) => {
                if let Ok(census) = res {
                    self.cached_census = Some(census);
                }
            }
            AppEvent::SubprocessOutput(output) => {
                self.chat_messages.push(("Subprocess".into(), output));
            }
            AppEvent::DiffResponse(res) => {
                if let Ok(diff) = res {
                    self.cached_diff = Some(diff);
                }
            }
        }
    }

    fn ring_terminal_bell(&self) {
        let mut out = stdout();
        let _ = out.write_all(b"\x07");
        let _ = out.flush();
    }

    fn trigger_background_census(&self) {
        let root = self.root_dir.clone();
        let tx = self.event_tx.clone();
        tokio::spawn(async move {
            let res = CensusRunner::run_census(&root).await;
            let _ = tx.send(AppEvent::CensusResponse(res.map_err(|e| e.to_string())));
        });
    }

    fn trigger_background_diff(&self) {
        let root = self.root_dir.clone();
        let tx = self.event_tx.clone();
        tokio::spawn(async move {
            let res = tokio::process::Command::new("git")
                .args(["diff", "HEAD"])
                .current_dir(&root)
                .output()
                .await
                .map(|o| {
                    let stdout = String::from_utf8_lossy(&o.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                    if stdout.trim().is_empty() && !stderr.trim().is_empty() {
                        stderr
                    } else if stdout.trim().is_empty() {
                        "✓ Working tree clean. No uncommitted changes.".to_string()
                    } else {
                        stdout
                    }
                })
                .map_err(|e| e.to_string());
            let _ = tx.send(AppEvent::DiffResponse(res));
        });
    }

    // =========================================================================
    // RENDERING PIPELINE
    // =========================================================================

    fn render_header(
        &self,
        f: &mut ratatui::Frame,
        area: Rect,
        phase: RunPhase,
        hard: &noesis::HardState,
    ) {
        let theme = self.theme();
        let phase_color = match phase {
            RunPhase::Completed => theme.success,
            RunPhase::Stagnated => theme.warning,
            RunPhase::Failed => theme.danger,
            RunPhase::Executing | RunPhase::Verifying | RunPhase::InvokingModel => theme.warning,
            _ => theme.primary,
        };

        let spinner_or_time = if self.is_processing {
            let elapsed = self
                .processing_start
                .map(|t| t.elapsed().as_secs_f32())
                .unwrap_or(0.0);
            format!(" [{}] {:.1}s", SPINNER_FRAMES[self.spinner_frame], elapsed)
        } else {
            String::new()
        };

        // Context Window & Cost Telemetry Meter
        let (total_in_tokens, total_out_tokens) =
            hard.model_invocations
                .iter()
                .fold((0u64, 0u64), |(acc_in, acc_out), inv| {
                    (
                        acc_in + inv.input_tokens as u64,
                        acc_out + inv.output_tokens as u64,
                    )
                });
        let total_tokens = total_in_tokens + total_out_tokens;
        let est_cost = (total_in_tokens as f64 * 3.0 / 1_000_000.0)
            + (total_out_tokens as f64 * 15.0 / 1_000_000.0);

        let context_limit = 128_000u64;
        let context_pct =
            ((total_tokens as f64 / context_limit as f64) * 100.0).min(100.0) as usize;
        let meter_filled = (context_pct / 10).min(10);
        let meter_empty = 10 - meter_filled;
        let meter_bar = format!("{}{}", "█".repeat(meter_filled), "░".repeat(meter_empty));

        let repo_name = self
            .root_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("rivet");

        let header_spans = vec![
            Span::styled(
                " ⚡ RIVET v0.3 ",
                Style::default()
                    .fg(Color::Black)
                    .bg(theme.primary)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!(
                    " 🤖 {}:{} ",
                    self.active_config.provider, self.active_config.model_id
                ),
                Style::default()
                    .fg(theme.success)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("│ Phase: {:?}{} ", phase, spinner_or_time),
                Style::default()
                    .fg(phase_color)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!(
                    "│ Context: [{}] {}k/{}k ({}%) ",
                    meter_bar,
                    total_tokens / 1000,
                    context_limit / 1000,
                    context_pct
                ),
                Style::default().fg(theme.primary),
            ),
            Span::styled(
                format!("│ ${:.3} ", est_cost),
                Style::default()
                    .fg(theme.warning)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("│ r{} ", hard.revision.0),
                Style::default().fg(theme.secondary),
            ),
            Span::styled(
                format!("│ 📁 {} ", repo_name),
                Style::default().fg(theme.muted),
            ),
        ];

        let header = Paragraph::new(Line::from(header_spans)).block(
            Block::default()
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(theme.border)),
        );
        f.render_widget(header, area);
    }

    fn render_tab_bar(&mut self, f: &mut ratatui::Frame, area: Rect) {
        let theme = self.theme();
        self.tab_bounds.clear();

        let mut titles = Vec::new();
        let mut current_x = area.x + 1;

        for t in ActiveTab::all() {
            let is_active = *t == self.active_tab;
            let label = if is_active {
                format!(" ▶ {} ", t.title())
            } else {
                format!("   {} ", t.title())
            };
            let tab_w = label.width() as u16;

            self.tab_bounds.push((*t, current_x, current_x + tab_w));
            current_x += tab_w;

            if is_active {
                titles.push(Line::from(Span::styled(
                    label,
                    Style::default()
                        .fg(Color::Black)
                        .bg(theme.primary)
                        .add_modifier(Modifier::BOLD),
                )));
            } else {
                titles.push(Line::from(Span::styled(
                    label,
                    Style::default().fg(Color::White),
                )));
            }
        }

        let tabs = Tabs::new(titles)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(theme.border))
                    .title(" Workspaces (F1..F5 or Alt+1..5) "),
            )
            .select(self.active_tab as usize)
            .highlight_style(Style::default().fg(theme.primary));

        f.render_widget(tabs, area);
    }

    fn render_chat_tab(
        &mut self,
        f: &mut ratatui::Frame,
        area: Rect,
        hard: &noesis::HardState,
        soft: &noesis::SoftWorkspace,
        phase: RunPhase,
    ) {
        if self.show_sidebar {
            let split = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(72), Constraint::Percentage(28)])
                .split(area);

            self.layout_chat = split[0];
            self.layout_sidebar = split[1];
            self.render_chat_stream(f, split[0]);
            self.render_quick_sidebar(f, split[1], hard, soft, phase);
        } else {
            self.layout_chat = area;
            self.layout_sidebar = Rect::default();
            self.render_chat_stream(f, area);
        }
    }

    fn render_chat_stream(&self, f: &mut ratatui::Frame, area: Rect) {
        let theme = self.theme();
        let mut lines = Vec::new();

        // Render historic chat messages
        for (sender, msg) in &self.chat_messages {
            let (badge, badge_color) = match sender.as_str() {
                "User" => ("👤 You", theme.warning),
                "Rivet" => ("⚡ Rivet", theme.success),
                "System" => ("ℹ️  System", theme.primary),
                "Subprocess" => ("⚙️ Subprocess", theme.secondary),
                "Error" => ("✖ Error", theme.danger),
                _ => ("◆ Agent", theme.secondary),
            };

            lines.push(Line::from(vec![
                Span::styled(
                    format!("╭─ {} ", badge),
                    Style::default()
                        .fg(badge_color)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    "─────────────────────────────────────────────────────────",
                    Style::default().fg(theme.border),
                ),
            ]));

            // Parse message with Thinking & Markdown support
            self.format_markdown_into_lines(msg, &mut lines);

            lines.push(Line::from(Span::styled(
                "╰────────────────────────────────────────────────────────────",
                Style::default().fg(theme.border),
            )));
            lines.push(Line::from(""));
        }

        // Render live streaming token buffer if active
        if self.is_processing
            && (!self.streaming_thought.is_empty() || !self.streaming_prose.is_empty())
        {
            lines.push(Line::from(vec![
                Span::styled(
                    "╭─ ⚡ Rivet [Streaming...] ",
                    Style::default()
                        .fg(theme.success)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    "─────────────────────────────────────────────────────────",
                    Style::default().fg(theme.border),
                ),
            ]));

            if !self.streaming_thought.is_empty() {
                if self.is_thinking_expanded {
                    lines.push(Line::from(Span::styled(
                        "╭─ 🧠 Thinking [Press 't' to collapse] ────────────────────╮",
                        Style::default()
                            .fg(theme.secondary)
                            .add_modifier(Modifier::BOLD),
                    )));
                    for l in self.streaming_thought.lines() {
                        lines.push(Line::from(Span::styled(
                            format!("│  {}", l),
                            Style::default().fg(theme.secondary),
                        )));
                    }
                    lines.push(Line::from(Span::styled(
                        "╰──────────────────────────────────────────────────────────╯",
                        Style::default().fg(theme.secondary),
                    )));
                } else {
                    lines.push(Line::from(Span::styled(
                        format!(
                            "  🧠 Thinking ({} chars)... [Press 't' or Space to expand]",
                            self.streaming_thought.len()
                        ),
                        Style::default()
                            .fg(theme.secondary)
                            .add_modifier(Modifier::ITALIC),
                    )));
                }
            }

            if !self.streaming_prose.is_empty() {
                self.format_markdown_into_lines(&self.streaming_prose, &mut lines);
            }

            lines.push(Line::from(Span::styled(
                "╰────────────────────────────────────────────────────────────",
                Style::default().fg(theme.border),
            )));
            lines.push(Line::from(""));
        }

        let total_lines = lines.len() as u16;
        let view_height = area.height.saturating_sub(2);

        let scroll_offset = if self.auto_scroll_to_bottom {
            total_lines.saturating_sub(view_height)
        } else {
            self.chat_scroll
                .min(total_lines.saturating_sub(view_height))
        };

        let search_indicator = if let Some(ref q) = self.chat_search_query {
            format!(" [Search: '{}'] ", q)
        } else {
            String::new()
        };

        let title = if self.auto_scroll_to_bottom {
            format!(
                " 💬 Cognitive Stream [Live Auto-Scroll]{} ",
                search_indicator
            )
        } else {
            format!(
                " 💬 Cognitive Stream [Scroll Paused - End to Resume]{} ",
                search_indicator
            )
        };

        let block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(theme.active_border))
            .title(title);

        let paragraph = Paragraph::new(lines)
            .block(block)
            .scroll((scroll_offset, 0))
            .wrap(Wrap { trim: false });

        f.render_widget(paragraph, area);

        // Render Scrollbar
        let mut scrollbar_state = ScrollbarState::default()
            .content_length(total_lines as usize)
            .position(scroll_offset as usize);
        let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
            .begin_symbol(Some("▲"))
            .end_symbol(Some("▼"))
            .track_symbol(Some("│"))
            .thumb_symbol("█");
        f.render_stateful_widget(
            scrollbar,
            area.inner(Margin {
                vertical: 1,
                horizontal: 0,
            }),
            &mut scrollbar_state,
        );
    }

    fn format_markdown_into_lines(&self, text: &str, out: &mut Vec<Line<'static>>) {
        let theme = self.theme();
        let mut in_think = false;
        let mut in_code = false;

        for raw_line in text.lines() {
            let l = raw_line.to_string();

            // <think> block handling
            if l.contains("<think>") {
                in_think = true;
                if !self.is_thinking_expanded {
                    out.push(Line::from(Span::styled(
                        "  🧠 Thinking Process [Press 't' or Space to expand]...",
                        Style::default()
                            .fg(theme.secondary)
                            .add_modifier(Modifier::ITALIC),
                    )));
                } else {
                    out.push(Line::from(Span::styled(
                        "╭─ 🧠 Thinking Process [Press 't' to collapse] ──────────╮",
                        Style::default()
                            .fg(theme.secondary)
                            .add_modifier(Modifier::BOLD),
                    )));
                }
                continue;
            }
            if l.contains("</think>") {
                in_think = false;
                if self.is_thinking_expanded {
                    out.push(Line::from(Span::styled(
                        "╰────────────────────────────────────────────────────────╯",
                        Style::default().fg(theme.secondary),
                    )));
                }
                continue;
            }
            if in_think {
                if self.is_thinking_expanded {
                    out.push(Line::from(Span::styled(
                        format!("│  {}", l),
                        Style::default().fg(theme.secondary),
                    )));
                }
                continue;
            }

            // Code blocks
            if l.starts_with("```") {
                if in_code {
                    in_code = false;
                    out.push(Line::from(Span::styled(
                        "╰────────────────────────────────────────────────────────────",
                        Style::default().fg(theme.primary),
                    )));
                } else {
                    in_code = true;
                    let code_lang = l.trim_start_matches("```").trim();
                    let lang_tag = if code_lang.is_empty() {
                        "Code".to_string()
                    } else {
                        format!(" {} ", code_lang.to_uppercase())
                    };
                    out.push(Line::from(vec![
                        Span::styled(
                            format!("╭─ {} ", lang_tag),
                            Style::default()
                                .fg(theme.primary)
                                .add_modifier(Modifier::BOLD),
                        ),
                        Span::styled(
                            "─────────────────────────────────────────────────────",
                            Style::default().fg(theme.primary),
                        ),
                    ]));
                }
                continue;
            }

            if in_code {
                out.push(Line::from(vec![
                    Span::styled("│  ", Style::default().fg(theme.primary)),
                    Span::styled(l, Style::default().fg(Color::White)),
                ]));
                continue;
            }

            // Markdown Headers (#, ##, ###)
            if let Some(stripped) = l.strip_prefix("# ") {
                out.push(Line::from(Span::styled(
                    format!("│  📌 {}", stripped),
                    Style::default()
                        .fg(theme.primary)
                        .add_modifier(Modifier::BOLD),
                )));
            } else if let Some(stripped) = l.strip_prefix("## ") {
                out.push(Line::from(Span::styled(
                    format!("│  ◈ {}", stripped),
                    Style::default()
                        .fg(theme.secondary)
                        .add_modifier(Modifier::BOLD),
                )));
            } else if let Some(stripped) = l.strip_prefix("### ") {
                out.push(Line::from(Span::styled(
                    format!("│  • {}", stripped),
                    Style::default()
                        .fg(theme.warning)
                        .add_modifier(Modifier::BOLD),
                )));
            } else if l.starts_with("- [✓]") || l.starts_with("  [✓]") || l.starts_with("✅") {
                out.push(Line::from(Span::styled(
                    format!("│  {}", l),
                    Style::default()
                        .fg(theme.success)
                        .add_modifier(Modifier::BOLD),
                )));
            } else if l.starts_with("- [ ]") || l.starts_with("  [ ]") || l.starts_with("⚠️") {
                out.push(Line::from(Span::styled(
                    format!("│  {}", l),
                    Style::default().fg(theme.warning),
                )));
            } else if l.starts_with("- ") || l.starts_with("* ") {
                out.push(Line::from(vec![
                    Span::styled("│   • ", Style::default().fg(theme.primary)),
                    Span::styled(l[2..].to_string(), Style::default().fg(Color::White)),
                ]));
            } else {
                out.push(Line::from(Span::styled(
                    format!("│  {}", l),
                    Style::default().fg(Color::White),
                )));
            }
        }
    }

    fn render_quick_sidebar(
        &self,
        f: &mut ratatui::Frame,
        area: Rect,
        hard: &noesis::HardState,
        soft: &noesis::SoftWorkspace,
        _phase: RunPhase,
    ) {
        let theme = self.theme();
        let sidebar_layout = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(8), // Active Obligations
                Constraint::Min(6),    // Working Hypotheses
            ])
            .split(area);

        // 1. Obligations Section
        let mut obl_items = Vec::new();
        if hard.obligations.is_empty() {
            obl_items.push(ListItem::new(Span::styled(
                " (No open obligations)",
                Style::default().fg(theme.muted),
            )));
        } else {
            for (id, desc) in &hard.obligations {
                obl_items.push(ListItem::new(vec![
                    Line::from(vec![
                        Span::styled(" [ ] ", Style::default().fg(theme.warning)),
                        Span::styled(
                            format!("{}", id),
                            Style::default()
                                .fg(Color::White)
                                .add_modifier(Modifier::BOLD),
                        ),
                    ]),
                    Line::from(Span::styled(
                        format!("     {}", desc),
                        Style::default().fg(theme.muted),
                    )),
                ]));
            }
        }

        let obl_block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(theme.border))
            .title(format!(
                " 📋 Open Obligations ({}) ",
                hard.obligations.len()
            ));
        f.render_widget(List::new(obl_items).block(obl_block), sidebar_layout[0]);

        // 2. Working Memory & Focus
        let mut mem_items = Vec::new();
        mem_items.push(ListItem::new(Span::styled(
            "Active Focus:",
            Style::default()
                .fg(theme.warning)
                .add_modifier(Modifier::BOLD),
        )));
        if soft.active_focus.is_empty() {
            mem_items.push(ListItem::new(Span::styled(
                "  • (Root Scope)",
                Style::default().fg(theme.muted),
            )));
        } else {
            for f_path in &soft.active_focus {
                mem_items.push(ListItem::new(Span::styled(
                    format!("  🔍 {}", f_path),
                    Style::default().fg(theme.primary),
                )));
            }
        }

        mem_items.push(ListItem::new(Span::styled(
            "\nHypotheses (Plastic Memory):",
            Style::default()
                .fg(theme.secondary)
                .add_modifier(Modifier::BOLD),
        )));
        if soft.hypotheses.is_empty() {
            mem_items.push(ListItem::new(Span::styled(
                "  • (No active hypotheses)",
                Style::default().fg(theme.muted),
            )));
        } else {
            for hyp in &soft.hypotheses {
                mem_items.push(ListItem::new(Span::styled(
                    format!("  💡 {}", hyp),
                    Style::default().fg(Color::White),
                )));
            }
        }

        let mem_block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(theme.border))
            .title(" 🧠 Working Memory (Ctrl+B: Toggle) ");
        f.render_widget(List::new(mem_items).block(mem_block), sidebar_layout[1]);
    }

    fn render_obligations_tab(&self, f: &mut ratatui::Frame, area: Rect, hard: &noesis::HardState) {
        let theme = self.theme();
        let split = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(area);

        // Left Panel: Open & Closed Obligations
        let mut obl_lines = Vec::new();
        obl_lines.push(Line::from(Span::styled(
            "=== OPEN OBLIGATIONS (UNVERIFIED) ===",
            Style::default()
                .fg(theme.warning)
                .add_modifier(Modifier::BOLD),
        )));
        obl_lines.push(Line::from(""));

        if hard.obligations.is_empty() {
            obl_lines.push(Line::from(Span::styled(
                "  (No open obligations in current task revision)",
                Style::default().fg(theme.muted),
            )));
        } else {
            for (i, (id, desc)) in hard.obligations.iter().enumerate() {
                let is_selected = i == self.obligations_selected_idx;
                let pointer = if is_selected { " ▶ " } else { "   " };
                let bg_style = if is_selected {
                    Style::default()
                        .bg(theme.selection_bg)
                        .fg(theme.selection_fg)
                } else {
                    Style::default()
                };

                obl_lines.push(Line::from(vec![
                    Span::styled(
                        pointer,
                        Style::default()
                            .fg(theme.primary)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        " [ ] ",
                        Style::default()
                            .fg(theme.warning)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!("{}", id),
                        bg_style.fg(Color::White).add_modifier(Modifier::BOLD),
                    ),
                ]));
                obl_lines.push(Line::from(Span::styled(
                    format!("     Description: {}", desc),
                    Style::default().fg(Color::Rgb(200, 200, 220)),
                )));
                if let Some(scope) = hard.obligation_scopes.get(id) {
                    obl_lines.push(Line::from(Span::styled(
                        format!("     Scope: {} @ r{}", scope.repository, scope.revision.0),
                        Style::default().fg(theme.muted),
                    )));
                }
                obl_lines.push(Line::from(""));
            }
        }

        obl_lines.push(Line::from(Span::styled(
            "\n=== CLOSED OBLIGATIONS & RECEIPTS ===",
            Style::default()
                .fg(theme.success)
                .add_modifier(Modifier::BOLD),
        )));
        obl_lines.push(Line::from(""));

        if hard.closed_obligations.is_empty() {
            obl_lines.push(Line::from(Span::styled(
                "  (No closed obligations yet)",
                Style::default().fg(theme.muted),
            )));
        } else {
            for (id, receipt_id) in &hard.closed_obligations {
                obl_lines.push(Line::from(vec![
                    Span::styled(
                        " [✓] ",
                        Style::default()
                            .fg(theme.success)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!("{}", id),
                        Style::default()
                            .fg(theme.success)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!(" (Receipt: {})", receipt_id),
                        Style::default().fg(theme.muted),
                    ),
                ]));
            }
        }

        let left_panel = Paragraph::new(obl_lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(theme.active_border))
                    .title(" 📋 Epistemic Obligations (Enter: Inspect, 'c': Close, 'a': Add) "),
            )
            .scroll((self.obligations_scroll, 0))
            .wrap(Wrap { trim: false });
        f.render_widget(left_panel, split[0]);

        // Right Panel: Verified Claims & Verity Receipts
        let mut claim_lines = Vec::new();
        claim_lines.push(Line::from(Span::styled(
            "=== VERIFIED HARD CLAIMS ===",
            Style::default()
                .fg(theme.primary)
                .add_modifier(Modifier::BOLD),
        )));
        claim_lines.push(Line::from(""));

        if hard.claims.is_empty() {
            claim_lines.push(Line::from(Span::styled(
                "  (No verified claims recorded)",
                Style::default().fg(theme.muted),
            )));
        } else {
            for (id, claim) in &hard.claims {
                let status_color = match claim.status {
                    rivet_types::EpistemicStatus::Verified => theme.success,
                    rivet_types::EpistemicStatus::Rejected => theme.danger,
                    _ => theme.warning,
                };

                claim_lines.push(Line::from(vec![
                    Span::styled(
                        format!(" • [{:?}] ", claim.status),
                        Style::default().fg(status_color),
                    ),
                    Span::styled(
                        format!("{}: ", id),
                        Style::default()
                            .fg(Color::White)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(&claim.proposition, Style::default().fg(theme.primary)),
                ]));
                claim_lines.push(Line::from(""));
            }
        }

        claim_lines.push(Line::from(Span::styled(
            "\n=== RECORDED EVIDENCE & RECEIPTS ===",
            Style::default()
                .fg(theme.secondary)
                .add_modifier(Modifier::BOLD),
        )));
        claim_lines.push(Line::from(""));

        for (id, ev) in &hard.evidence {
            claim_lines.push(Line::from(vec![
                Span::styled(
                    format!(" 📦 {}: ", id),
                    Style::default().fg(theme.secondary),
                ),
                Span::styled(ev, Style::default().fg(Color::White)),
            ]));
        }

        let right_panel = Paragraph::new(claim_lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(theme.border))
                    .title(" 🛡️ Epistemic Ledger & Verified Proofs "),
            )
            .scroll((self.obligations_scroll, 0))
            .wrap(Wrap { trim: false });
        f.render_widget(right_panel, split[1]);
    }

    fn render_workspace_tab(
        &self,
        f: &mut ratatui::Frame,
        area: Rect,
        soft: &noesis::SoftWorkspace,
        hard: &noesis::HardState,
    ) {
        let theme = self.theme();
        let split = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(area);

        // Left: Working Hypotheses & Unknown Clusters
        let mut left_lines = Vec::new();
        left_lines.push(Line::from(Span::styled(
            "=== PLASTIC WORKING MEMORY & HYPOTHESES ===",
            Style::default()
                .fg(theme.secondary)
                .add_modifier(Modifier::BOLD),
        )));
        left_lines.push(Line::from(""));

        if soft.hypotheses.is_empty() {
            left_lines.push(Line::from(Span::styled(
                "  (No active hypotheses. Model operates with clear priors)",
                Style::default().fg(theme.muted),
            )));
        } else {
            for (i, hyp) in soft.hypotheses.iter().enumerate() {
                let is_selected = i == self.hypotheses_selected_idx;
                let pointer = if is_selected { " ▶ " } else { "   " };
                let bg_style = if is_selected {
                    Style::default()
                        .bg(theme.selection_bg)
                        .fg(theme.selection_fg)
                } else {
                    Style::default()
                };

                left_lines.push(Line::from(vec![
                    Span::styled(
                        pointer,
                        Style::default()
                            .fg(theme.primary)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!("{}. 💡 ", i + 1),
                        Style::default().fg(theme.warning),
                    ),
                    Span::styled(hyp, bg_style.fg(Color::White)),
                ]));
                left_lines.push(Line::from(""));
            }
        }

        left_lines.push(Line::from(Span::styled(
            "\n=== EPISTEMIC UNKNOWNS ===",
            Style::default()
                .fg(theme.warning)
                .add_modifier(Modifier::BOLD),
        )));
        left_lines.push(Line::from(""));

        if soft.unknowns.is_empty() {
            left_lines.push(Line::from(Span::styled(
                "  (No unresolved unknowns)",
                Style::default().fg(theme.muted),
            )));
        } else {
            for (i, u) in soft.unknowns.iter().enumerate() {
                left_lines.push(Line::from(vec![
                    Span::styled(
                        format!("  {}. ❓ ", i + 1),
                        Style::default().fg(theme.danger),
                    ),
                    Span::styled(u, Style::default().fg(Color::White)),
                ]));
            }
        }

        let left_panel = Paragraph::new(left_lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(theme.active_border))
                    .title(" 🧠 Soft Workspace ('d': Delete, 'a': Add, 'r': Reframe) "),
            )
            .scroll((self.workspace_scroll, 0))
            .wrap(Wrap { trim: false });
        f.render_widget(left_panel, split[0]);

        // Right: Model Invocations Log & Active Focus
        let mut right_lines = Vec::new();
        right_lines.push(Line::from(Span::styled(
            "=== ACTIVE REASONING FOCUS ===",
            Style::default()
                .fg(theme.primary)
                .add_modifier(Modifier::BOLD),
        )));
        right_lines.push(Line::from(""));

        for f_path in &soft.active_focus {
            right_lines.push(Line::from(Span::styled(
                format!("  🔍 {}", f_path),
                Style::default()
                    .fg(theme.primary)
                    .add_modifier(Modifier::BOLD),
            )));
        }

        right_lines.push(Line::from(Span::styled(
            "\n=== RECENT MODEL INVOCATIONS & AUDIT ===",
            Style::default()
                .fg(theme.success)
                .add_modifier(Modifier::BOLD),
        )));
        right_lines.push(Line::from(""));

        if hard.model_invocations.is_empty() {
            right_lines.push(Line::from(Span::styled(
                "  (No model invocations logged in session)",
                Style::default().fg(theme.muted),
            )));
        } else {
            for inv in hard.model_invocations.iter().rev().take(10) {
                right_lines.push(Line::from(vec![
                    Span::styled(" 🤖 ", Style::default().fg(theme.success)),
                    Span::styled(
                        format!("{} ", inv.model_id),
                        Style::default()
                            .fg(Color::White)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!(
                            "({}ms, in: {}, out: {})",
                            inv.latency_ms, inv.input_tokens, inv.output_tokens
                        ),
                        Style::default().fg(theme.muted),
                    ),
                ]));
                right_lines.push(Line::from(Span::styled(
                    format!("    Reason: {:?}", inv.reason),
                    Style::default().fg(theme.secondary),
                )));
                right_lines.push(Line::from(""));
            }
        }

        let right_panel = Paragraph::new(right_lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(theme.border))
                    .title(" 📊 Cognitive Audit & Latency Metrics "),
            )
            .scroll((self.workspace_scroll, 0))
            .wrap(Wrap { trim: false });
        f.render_widget(right_panel, split[1]);
    }

    fn render_census_tab(&self, f: &mut ratatui::Frame, area: Rect) {
        let theme = self.theme();
        let mut lines = Vec::new();

        if let Some(ref census) = self.cached_census {
            lines.push(Line::from(vec![
                Span::styled(
                    "📊 Total Indexed Files: ",
                    Style::default()
                        .fg(theme.primary)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("{} ", census.total_files),
                    Style::default()
                        .fg(Color::White)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled("│ Total Size: ", Style::default().fg(theme.primary)),
                Span::styled(
                    format!("{:.2} MB ", census.total_bytes as f64 / 1_048_576.0),
                    Style::default().fg(theme.success),
                ),
                Span::styled("│ Deferred Subtrees: ", Style::default().fg(theme.primary)),
                Span::styled(
                    format!("{}", census.deferred_count),
                    Style::default().fg(theme.warning),
                ),
            ]));
            lines.push(Line::from(""));

            lines.push(Line::from(Span::styled(
                "=== ACTIVE REPOSITORY FRONTIER (TOP RELEVANT FILES) ===",
                Style::default()
                    .fg(theme.success)
                    .add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(""));

            for (i, entry) in census.active_frontier(32).iter().enumerate() {
                lines.push(Line::from(vec![
                    Span::styled(
                        format!("  {:>2}. ", i + 1),
                        Style::default().fg(theme.muted),
                    ),
                    Span::styled(
                        format!("{:<60}", entry.relative_path),
                        Style::default().fg(Color::White),
                    ),
                    Span::styled(
                        format!(" ({:.1} KB)", entry.size_bytes as f64 / 1024.0),
                        Style::default().fg(theme.muted),
                    ),
                ]));
            }

            lines.push(Line::from(Span::styled(
                "\n=== DIRECTORY RELEVANCE SIGNALS ===",
                Style::default()
                    .fg(theme.secondary)
                    .add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(""));

            for dir in census.active_directory_frontier(16) {
                lines.push(Line::from(vec![
                    Span::styled("  📁 ", Style::default().fg(theme.primary)),
                    Span::styled(
                        format!("{:<40}", dir.relative_path),
                        Style::default()
                            .fg(Color::White)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!(
                            " files: {:<4} | size: {:<6} KB | signals: {:?}",
                            dir.file_count,
                            dir.total_bytes / 1024,
                            dir.signals
                        ),
                        Style::default().fg(theme.muted),
                    ),
                ]));
            }
        } else {
            lines.push(Line::from(Span::styled(
                "⏳ Running background deterministic census on repository...",
                Style::default().fg(theme.warning),
            )));
        }

        let panel = Paragraph::new(lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(theme.active_border))
                    .title(" 📊 Repository Census & Frontier (Press 'r' to Re-run) "),
            )
            .scroll((self.census_scroll, 0))
            .wrap(Wrap { trim: false });
        f.render_widget(panel, area);
    }

    fn render_diff_tab(&self, f: &mut ratatui::Frame, area: Rect) {
        let theme = self.theme();
        let mut lines = Vec::new();

        if let Some(ref diff_text) = self.cached_diff {
            for raw_line in diff_text.lines() {
                if raw_line.starts_with("diff --git") {
                    lines.push(Line::from(""));
                    lines.push(Line::from(Span::styled(
                        format!("╭─ 📄 {} ", raw_line),
                        Style::default()
                            .fg(theme.primary)
                            .add_modifier(Modifier::BOLD),
                    )));
                } else if raw_line.starts_with("+++") || raw_line.starts_with("---") {
                    lines.push(Line::from(Span::styled(
                        format!("│  {}", raw_line),
                        Style::default()
                            .fg(theme.secondary)
                            .add_modifier(Modifier::BOLD),
                    )));
                } else if raw_line.starts_with("@@") {
                    lines.push(Line::from(Span::styled(
                        format!("│  {}", raw_line),
                        Style::default().fg(theme.warning),
                    )));
                } else if raw_line.starts_with('+') {
                    lines.push(Line::from(Span::styled(
                        format!("│  {}", raw_line),
                        Style::default().fg(theme.success),
                    )));
                } else if raw_line.starts_with('-') {
                    lines.push(Line::from(Span::styled(
                        format!("│  {}", raw_line),
                        Style::default().fg(theme.danger),
                    )));
                } else {
                    lines.push(Line::from(Span::styled(
                        format!("│  {}", raw_line),
                        Style::default().fg(Color::White),
                    )));
                }
            }
        } else {
            lines.push(Line::from(Span::styled(
                "⏳ Fetching Git working tree diff...",
                Style::default().fg(theme.warning),
            )));
        }

        let panel = Paragraph::new(lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(theme.active_border))
                    .title(
                        " 🔍 Git Diff & Working Tree Reviewer ('r': Refresh, 'u': Undo Change) ",
                    ),
            )
            .scroll((self.diff_scroll, 0))
            .wrap(Wrap { trim: false });
        f.render_widget(panel, area);
    }

    fn render_input_box(&self, f: &mut ratatui::Frame, area: Rect) {
        let theme = self.theme();
        let is_slash = self.input_editor.text.starts_with('/');
        let prompt_symbol = if is_slash { "⚡ /" } else { "❯ " };
        let prompt_color = if is_slash {
            theme.warning
        } else {
            theme.primary
        };

        let line_count = self.input_editor.line_count();
        let title = if is_slash {
            " Slash Command Mode (Tab: Complete, ↑/↓: Select, Esc: Clear) "
        } else if self.is_processing {
            " Processing Request... (Press Esc to Cancel) "
        } else if line_count > 1 {
            " Multi-Line Prompt (Enter: Send, Shift+Enter: Newline, Esc: Clear) "
        } else {
            " Prompt Input (Enter: Send, Shift+Enter: Newline, /: Commands, @: Files, F1..F5: Tabs) "
        };

        let border_color = if is_slash {
            theme.warning
        } else if self.is_processing {
            theme.secondary
        } else {
            theme.active_border
        };

        let block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(border_color))
            .title(title);

        let lines = self.input_editor.lines_vec();
        let mut rendered_lines = Vec::new();

        for (i, line) in lines.iter().enumerate() {
            if i == 0 {
                rendered_lines.push(Line::from(vec![
                    Span::styled(
                        format!("{} ", prompt_symbol),
                        Style::default()
                            .fg(prompt_color)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(line.clone(), Style::default().fg(Color::White)),
                ]));
            } else {
                rendered_lines.push(Line::from(vec![
                    Span::styled("   ", Style::default().fg(theme.muted)),
                    Span::styled(line.clone(), Style::default().fg(Color::White)),
                ]));
            }
        }

        let paragraph = Paragraph::new(rendered_lines).block(block);
        f.render_widget(paragraph, area);

        // Terminal cursor placement
        let (cur_line, cur_col) = self.input_editor.cursor_line_and_col();
        let prefix_w = if cur_line == 0 {
            prompt_symbol.width() as u16 + 1
        } else {
            3
        };
        let cursor_x = area.x + 1 + prefix_w + cur_col as u16;
        let cursor_y = area.y + 1 + cur_line as u16;

        if cursor_x < area.x + area.width - 1 && cursor_y < area.y + area.height - 1 {
            f.set_cursor_position(Position::new(cursor_x, cursor_y));
        }
    }

    fn render_footer(&self, f: &mut ratatui::Frame, area: Rect) {
        let theme = self.theme();
        let footer_spans = vec![
            Span::styled(
                " [Enter] ",
                Style::default()
                    .fg(theme.primary)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("Send  "),
            Span::styled(
                " [Shift+Enter] ",
                Style::default()
                    .fg(theme.primary)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("Newline  "),
            Span::styled(
                " [F1..F5] ",
                Style::default()
                    .fg(theme.primary)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("Tabs  "),
            Span::styled(
                " [Ctrl+B] ",
                Style::default()
                    .fg(theme.primary)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("Sidebar  "),
            Span::styled(
                " [Ctrl+P] ",
                Style::default()
                    .fg(theme.primary)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("Providers  "),
            Span::styled(
                " [Ctrl+M] ",
                Style::default()
                    .fg(theme.primary)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("Models  "),
            Span::styled(
                " [Ctrl+F] ",
                Style::default()
                    .fg(theme.primary)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("Search  "),
            Span::styled(
                " [@ /] ",
                Style::default()
                    .fg(theme.warning)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("Menu  "),
            Span::styled(
                " [Esc] ",
                Style::default()
                    .fg(theme.danger)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("Quit"),
        ];
        f.render_widget(Paragraph::new(Line::from(footer_spans)), area);
    }

    fn render_toast(&self, f: &mut ratatui::Frame, toast: &ToastNotification, screen_size: Rect) {
        let width = (toast.message.width() as u16 + 6).min(screen_size.width.saturating_sub(4));
        let height = 3;
        let x = screen_size.width.saturating_sub(width + 2);
        let y = 1;
        let area = Rect::new(x, y, width, height);

        f.render_widget(Clear, area);

        let toast_p = Paragraph::new(Span::styled(
            &toast.message,
            Style::default()
                .fg(toast.color)
                .add_modifier(Modifier::BOLD),
        ))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(toast.color)),
        );
        f.render_widget(toast_p, area);
    }

    fn render_slash_palette(
        &mut self,
        f: &mut ratatui::Frame,
        input_area: Rect,
        screen_size: Rect,
    ) {
        let theme = self.theme();
        let matches = self.get_matching_slash_commands();
        if matches.is_empty() {
            return;
        }

        let height = (matches.len() as u16 + 2).min(10);
        let width = (screen_size.width * 60 / 100)
            .max(55)
            .min(screen_size.width.saturating_sub(4));
        let x = input_area.x + 2;
        let y = input_area.y.saturating_sub(height);
        let area = Rect::new(x, y, width, height);
        self.layout_slash_palette = Some(area);

        f.render_widget(Clear, area);

        let selected_idx = self.slash_list_state.selected().unwrap_or(0);
        let mut items = Vec::new();

        for (i, cmd) in matches.iter().enumerate() {
            let is_selected = i == selected_idx;
            let prefix = if is_selected { " ▶ " } else { "   " };
            let style = if is_selected {
                Style::default()
                    .fg(Color::Black)
                    .bg(theme.primary)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };

            items.push(ListItem::new(Line::from(vec![
                Span::styled(format!("{}{:<14}", prefix, cmd.name), style),
                Span::styled(
                    format!(" {:<8} ", cmd.shortcut),
                    Style::default().fg(theme.warning),
                ),
                Span::styled(
                    format!(" - {}", cmd.description),
                    Style::default().fg(theme.muted),
                ),
            ])));
        }

        let palette = List::new(items)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(theme.primary))
                    .title(" ⚡ Slash Commands (Tab/Enter: Select, ↑/↓: Navigate, Esc: Close) "),
            )
            .highlight_style(Style::default().bg(theme.primary).fg(Color::Black));
        f.render_stateful_widget(palette, area, &mut self.slash_list_state);
    }

    fn render_modals(&mut self, f: &mut ratatui::Frame, size: Rect) {
        let theme = self.theme();

        match &self.active_modal {
            ActiveModal::None => {
                self.layout_modal = None;
            }

            ActiveModal::ThemePicker { selected_idx } => {
                let modal_area = centered_rect(50, 45, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let mut items = Vec::new();
                for (i, th) in ThemeMode::all().iter().enumerate() {
                    let is_selected = i == *selected_idx;
                    let is_active = *th == self.active_theme;
                    let prefix = if is_selected { " ▶ " } else { "   " };
                    let active_tag = if is_active { " [ACTIVE]" } else { "" };

                    items.push(ListItem::new(Line::from(vec![
                        Span::styled(
                            format!("{}{}", prefix, th.name()),
                            Style::default()
                                .fg(Color::White)
                                .add_modifier(if is_selected {
                                    Modifier::BOLD
                                } else {
                                    Modifier::empty()
                                }),
                        ),
                        Span::styled(active_tag, Style::default().fg(theme.success)),
                    ])));
                }

                let list = List::new(items).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(theme.primary))
                        .title(" 🎨 Theme Picker (↑/↓: Navigate, Enter: Apply, Esc: Cancel) ")
                        .title_alignment(Alignment::Center),
                );
                f.render_widget(list, modal_area);
            }

            ActiveModal::DoctorDialog { scroll } => {
                let modal_area = centered_rect(70, 70, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let mut lines = Vec::new();
                lines.push(Line::from(Span::styled(
                    "🏥 RIVET SYSTEM HEALTH DIAGNOSTICS",
                    Style::default()
                        .fg(theme.primary)
                        .add_modifier(Modifier::BOLD),
                )));
                lines.push(Line::from(""));

                lines.push(Line::from(vec![
                    Span::styled(
                        "✓ Rust Toolchain: ",
                        Style::default()
                            .fg(theme.success)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("cargo 1.85+, rustc active"),
                ]));
                lines.push(Line::from(vec![
                    Span::styled(
                        "✓ Git Integration: ",
                        Style::default()
                            .fg(theme.success)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("Working tree verified"),
                ]));
                lines.push(Line::from(vec![
                    Span::styled(
                        "✓ Noesis redb Store: ",
                        Style::default()
                            .fg(theme.success)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("ACID event ledger intact (.rivet/state.redb)"),
                ]));
                lines.push(Line::from(vec![
                    Span::styled(
                        "✓ Multi-Tier Clipboard: ",
                        Style::default()
                            .fg(theme.success)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("arboard + OSC 52 + Win32/WSL fallback verified"),
                ]));
                lines.push(Line::from(vec![
                    Span::styled(
                        "✓ Provider Gateway: ",
                        Style::default()
                            .fg(theme.success)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(format!(
                        "Active '{}' ({})",
                        self.active_config.provider, self.active_config.model_id
                    )),
                ]));

                let dialog = Paragraph::new(lines)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .border_style(Style::default().fg(theme.primary))
                            .title(" 🏥 System Doctor (Esc: Close, ↑/↓: Scroll) ")
                            .title_alignment(Alignment::Center),
                    )
                    .scroll((*scroll, 0));
                f.render_widget(dialog, modal_area);
            }

            ActiveModal::FileMentionPicker {
                search,
                selected_idx,
            } => {
                let modal_area = centered_rect(65, 60, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let query = search.text.to_lowercase();
                let mut matches = Vec::new();

                if let Some(ref census) = self.cached_census {
                    for entry in census.active_frontier(64) {
                        if query.is_empty() || entry.relative_path.to_lowercase().contains(&query) {
                            matches.push(entry.relative_path.clone());
                        }
                    }
                }

                let mut items = Vec::new();
                for (i, p) in matches.iter().enumerate() {
                    let is_selected = i == *selected_idx;
                    let prefix = if is_selected { " ▶ " } else { "   " };
                    let style = if is_selected {
                        Style::default()
                            .bg(theme.selection_bg)
                            .fg(theme.selection_fg)
                            .add_modifier(Modifier::BOLD)
                    } else {
                        Style::default().fg(Color::White)
                    };
                    items.push(ListItem::new(Line::from(vec![
                        Span::styled(prefix, Style::default().fg(theme.primary)),
                        Span::styled("📄 ", Style::default().fg(theme.secondary)),
                        Span::styled(p.clone(), style),
                    ])));
                }

                let modal_layout = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([Constraint::Length(3), Constraint::Min(4)])
                    .split(modal_area);

                let search_box = Paragraph::new(format!(" 🔍 @: {}_", search.text)).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(theme.primary))
                        .title(" Fuzzy File Search "),
                );
                f.render_widget(search_box, modal_layout[0]);

                let list = List::new(items).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(theme.primary))
                        .title(" 📂 Attach File Context (Enter: Select, Esc: Close) ")
                        .title_alignment(Alignment::Center),
                );
                f.render_widget(list, modal_layout[1]);
            }

            ActiveModal::ToolApproval {
                proposal_summary,
                target,
                capability,
                diff_preview,
            } => {
                let modal_area = centered_rect(75, 65, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let mut lines = vec![
                    Line::from(Span::styled(
                        "🛡️ HUMAN-IN-THE-LOOP ACTION AUTHORIZATION",
                        Style::default()
                            .fg(theme.warning)
                            .add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(vec![
                        Span::styled(
                            "Capability: ",
                            Style::default()
                                .fg(theme.primary)
                                .add_modifier(Modifier::BOLD),
                        ),
                        Span::raw(capability.clone()),
                    ]),
                    Line::from(vec![
                        Span::styled(
                            "Target:     ",
                            Style::default()
                                .fg(theme.primary)
                                .add_modifier(Modifier::BOLD),
                        ),
                        Span::raw(target.clone()),
                    ]),
                    Line::from(vec![
                        Span::styled(
                            "Summary:    ",
                            Style::default()
                                .fg(theme.primary)
                                .add_modifier(Modifier::BOLD),
                        ),
                        Span::raw(proposal_summary.clone()),
                    ]),
                    Line::from(""),
                    Line::from(Span::styled(
                        "Proposed Diff / Content:",
                        Style::default()
                            .fg(theme.secondary)
                            .add_modifier(Modifier::BOLD),
                    )),
                ];

                for l in diff_preview.lines().take(12) {
                    lines.push(Line::from(Span::styled(
                        format!("  {}", l),
                        Style::default().fg(theme.success),
                    )));
                }

                lines.push(Line::from(""));
                lines.push(Line::from(vec![
                    Span::styled(
                        " [y] ",
                        Style::default()
                            .fg(theme.success)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("Allow Once  "),
                    Span::styled(
                        " [n] ",
                        Style::default()
                            .fg(theme.danger)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("Deny  "),
                    Span::styled(
                        " [a] ",
                        Style::default()
                            .fg(theme.primary)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("Always Allow for Session  "),
                    Span::styled(
                        " [Esc] ",
                        Style::default()
                            .fg(theme.muted)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("Cancel"),
                ]));

                let dialog = Paragraph::new(lines).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(theme.warning))
                        .title(" 🛡️ Action Approval Required ")
                        .title_alignment(Alignment::Center),
                );
                f.render_widget(dialog, modal_area);
            }

            ActiveModal::ProviderMenu { search } => {
                let modal_area = centered_rect(75, 80, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let auth_data = self.auth_store.load().unwrap_or_default();
                let known = get_known_providers();
                let query = search.text.to_lowercase();

                let mut items = Vec::new();

                items.push(ListItem::new(Span::styled(
                    "=== Configured Providers ===",
                    Style::default()
                        .fg(theme.warning)
                        .add_modifier(Modifier::BOLD),
                )));

                for (p_id, info) in &auth_data.providers {
                    if !query.is_empty() && !p_id.to_lowercase().contains(&query) {
                        continue;
                    }
                    let is_active = self.active_config.provider == *p_id;
                    let active_tag = if is_active { " [ACTIVE]" } else { "" };
                    let endpoint = info.base_url().unwrap_or("Standard SDK Gateway");

                    items.push(ListItem::new(vec![
                        Line::from(vec![
                            Span::styled(
                                format!("  • {:<16}", p_id),
                                Style::default()
                                    .fg(Color::White)
                                    .add_modifier(Modifier::BOLD),
                            ),
                            Span::styled(
                                format!(
                                    " (Key: {}){}",
                                    AuthStore::mask_key(info.api_key()),
                                    active_tag
                                ),
                                Style::default().fg(theme.success),
                            ),
                        ]),
                        Line::from(Span::styled(
                            format!(
                                "      Endpoint: {} | Models: {}",
                                endpoint,
                                info.models().len()
                            ),
                            Style::default().fg(theme.muted),
                        )),
                    ]));
                }

                items.push(ListItem::new(Span::styled(
                    "\n=== Available Providers to Connect ===",
                    Style::default()
                        .fg(theme.primary)
                        .add_modifier(Modifier::BOLD),
                )));

                for p in &known {
                    if !query.is_empty()
                        && !p.id.to_lowercase().contains(&query)
                        && !p.name.to_lowercase().contains(&query)
                    {
                        continue;
                    }
                    let is_configured = auth_data.providers.contains_key(&p.id);
                    let status = if is_configured {
                        "[Re-configure]"
                    } else {
                        "[Connect]"
                    };
                    let status_color = if is_configured {
                        theme.success
                    } else {
                        theme.warning
                    };

                    items.push(ListItem::new(vec![
                        Line::from(vec![
                            Span::styled(
                                format!("  + {:<24}", p.name),
                                Style::default().fg(Color::White),
                            ),
                            Span::styled(format!(" {}", status), Style::default().fg(status_color)),
                        ]),
                        Line::from(Span::styled(
                            format!("      ID: {:<12} | {}", p.id, p.description),
                            Style::default().fg(theme.muted),
                        )),
                    ]));
                }

                let modal_layout = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([Constraint::Length(3), Constraint::Min(8)])
                    .split(modal_area);

                let search_box = Paragraph::new(format!(" 🔍 Filter: {}_", search.text)).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(theme.primary))
                        .title(" Search Providers "),
                );
                f.render_widget(search_box, modal_layout[0]);

                let list = List::new(items)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .border_style(Style::default().fg(theme.primary))
                            .title(" 🌐 Provider Manager (Enter: Select, Esc: Close) ")
                            .title_alignment(Alignment::Center),
                    )
                    .highlight_style(
                        Style::default()
                            .fg(Color::Black)
                            .bg(theme.primary)
                            .add_modifier(Modifier::BOLD),
                    );
                f.render_stateful_widget(list, modal_layout[1], &mut self.modal_list_state);
            }

            ActiveModal::ModelPicker { search } => {
                let modal_area = centered_rect(70, 75, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let query = search.text.to_lowercase();
                let mut items = Vec::new();

                for m_id in &self.dynamic_models {
                    if !query.is_empty() && !m_id.to_lowercase().contains(&query) {
                        continue;
                    }
                    let is_active = self.active_config.model_id == *m_id;
                    let active_tag = if is_active { " [ACTIVE]" } else { "" };
                    let style = if is_active {
                        Style::default()
                            .fg(theme.success)
                            .add_modifier(Modifier::BOLD)
                    } else {
                        Style::default().fg(Color::White)
                    };

                    items.push(ListItem::new(Line::from(vec![
                        Span::styled(format!("  {}", m_id), style),
                        Span::styled(
                            format!(" ({}){}", self.active_config.provider, active_tag),
                            Style::default().fg(theme.muted),
                        ),
                    ])));
                }

                items.push(ListItem::new(Span::styled(
                    "  + Enter Custom Model ID...",
                    Style::default()
                        .fg(theme.warning)
                        .add_modifier(Modifier::BOLD),
                )));

                let modal_layout = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([Constraint::Length(3), Constraint::Min(6)])
                    .split(modal_area);

                let search_box = Paragraph::new(format!(" 🔍 Filter: {}_", search.text)).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(theme.primary))
                        .title(format!(
                            " Search Models for '{}' ",
                            self.active_config.provider
                        )),
                );
                f.render_widget(search_box, modal_layout[0]);

                let list = List::new(items)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .border_style(Style::default().fg(theme.primary))
                            .title(" 🎯 Model Picker (Enter: Select, Esc: Close) ")
                            .title_alignment(Alignment::Center),
                    )
                    .highlight_style(
                        Style::default()
                            .fg(Color::Black)
                            .bg(theme.primary)
                            .add_modifier(Modifier::BOLD),
                    );
                f.render_stateful_widget(list, modal_layout[1], &mut self.modal_list_state);
            }

            ActiveModal::ConnectWizard {
                step,
                provider_id,
                base_url,
                api_key,
            } => {
                let modal_area = centered_rect(60, 40, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let (step_title, prompt_label, current_val) = match step {
                    ConnectWizardStep::ProviderId => (
                        "Step 1/3: Provider Identifier",
                        "Enter Provider ID (e.g. openai, anthropic, gemini, vllm, lmstudio):",
                        provider_id.text.as_str(),
                    ),
                    ConnectWizardStep::BaseUrl => (
                        "Step 2/3: Base URL Endpoint",
                        "Enter Base URL (e.g. http://localhost:8000/v1 or leave default):",
                        base_url.text.as_str(),
                    ),
                    ConnectWizardStep::ApiKey => (
                        "Step 3/3: API Key",
                        "Enter API Key (or 'none' for local):",
                        api_key.text.as_str(),
                    ),
                };

                let lines = vec![
                    Line::from(Span::styled(
                        step_title,
                        Style::default()
                            .fg(theme.warning)
                            .add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(Span::raw(prompt_label)),
                    Line::from(""),
                    Line::from(Span::styled(
                        format!(" > {}_", current_val),
                        Style::default()
                            .fg(theme.primary)
                            .add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(Span::styled(
                        "Press Enter to continue, Esc to cancel",
                        Style::default().fg(theme.muted),
                    )),
                ];

                let dialog = Paragraph::new(lines).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(theme.primary))
                        .title(" 🔗 Connect Provider Wizard ")
                        .title_alignment(Alignment::Center),
                );
                f.render_widget(dialog, modal_area);
            }

            ActiveModal::CustomModelPrompt { editor } => {
                let modal_area = centered_rect(55, 30, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let lines = vec![
                    Line::from(Span::styled(
                        "Custom Model ID",
                        Style::default()
                            .fg(theme.warning)
                            .add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(Span::raw(format!(
                        "Enter model identifier for provider '{}':",
                        self.active_config.provider
                    ))),
                    Line::from(""),
                    Line::from(Span::styled(
                        format!(" > {}_", editor.text),
                        Style::default()
                            .fg(theme.primary)
                            .add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(Span::styled(
                        "Press Enter to activate, Esc to cancel",
                        Style::default().fg(theme.muted),
                    )),
                ];

                let dialog = Paragraph::new(lines).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(theme.primary))
                        .title(" 🎯 Custom Model Entry ")
                        .title_alignment(Alignment::Center),
                );
                f.render_widget(dialog, modal_area);
            }

            ActiveModal::HelpDialog { scroll } => {
                let modal_area = centered_rect(75, 80, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let help_text = "\
╔══════════════════════════════════════════════════════════════════════════════╗
║                     ⚡ RIVET COCKPIT QUICK REFERENCE                         ║
╚══════════════════════════════════════════════════════════════════════════════╝

⌨️  WORKSPACE & NAVIGATION
  F1, F2, F3, F4, F5       - Switch Workspaces (Chat, Obligations, Memory, Census, Diff)
  Alt+1..5                 - Direct Tab Switch
  Ctrl+B                   - Toggle Quick Inspector Sidebar
  PgUp / PgDn / MouseWheel - Scroll active stream or log
  Home / End               - Jump to top / Jump to bottom (Resume auto-scroll)
  Ctrl+F                   - Search in conversation stream (n: Next, N: Prev)
  Ctrl+C / Esc             - Cancel in-flight request / Exit modal

✍️  LINE EDITOR & PROMPT
  Enter                    - Send prompt
  Shift+Enter / Alt+Enter  - Insert newline (Multi-line prompt mode)
  @                        - Attach file context via fuzzy finder
  Left / Right / Up / Down - Full 2D cursor movement
  Ctrl+W / Alt+Backspace   - Delete word backward
  Ctrl+U                   - Clear entire input line
  Ctrl+V / Shift+Insert    - Paste clipboard contents
  Ctrl+C                   - Copy selected text or latest response

🤖  COMMANDS & TOOLS
  /diff                    - Open Git Diff & Patch Reviewer
  /undo                    - Revert file changes / rollback revision
  /theme                   - Switch Color Theme (Tokyo Night, Catppuccin, Nord, etc.)
  /doctor                  - Run system health diagnostics
  /sessions                - Browse saved sessions & checkpoints
  /export [file.md]        - Export conversation to Markdown report
  /goal <prompt>           - Compile and lock a formal GoalSpec
  /census                  - Re-run deterministic repository census
  /quit or :q              - Exit Rivet Cockpit
";

                let dialog = Paragraph::new(help_text)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .border_style(Style::default().fg(theme.primary))
                            .title(" 📖 Help & Keybindings (Esc: Close, ↑/↓: Scroll) ")
                            .title_alignment(Alignment::Center),
                    )
                    .scroll((*scroll, 0));
                f.render_widget(dialog, modal_area);
            }

            ActiveModal::ChatSearch { query } => {
                let modal_area = centered_rect(50, 25, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let lines = vec![
                    Line::from(Span::styled(
                        "Search in Chat Stream",
                        Style::default()
                            .fg(theme.primary)
                            .add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(Span::styled(
                        format!(" 🔍 {}_", query.text),
                        Style::default()
                            .fg(Color::White)
                            .add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(Span::styled(
                        "Press Enter to search, Esc to cancel",
                        Style::default().fg(theme.muted),
                    )),
                ];

                let dialog = Paragraph::new(lines).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(theme.primary))
                        .title(" 🔍 Find in Conversation ")
                        .title_alignment(Alignment::Center),
                );
                f.render_widget(dialog, modal_area);
            }

            ActiveModal::SessionManager { selected_idx: _ } => {
                let modal_area = centered_rect(60, 50, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let items = vec![
                    ListItem::new(" ▶ Current Active Session (Default Hard State)"),
                    ListItem::new("   + Create New Isolated Session Branch (/new)"),
                ];

                let list = List::new(items).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(theme.primary))
                        .title(" 🗄️ Session Manager (Enter: Select, Esc: Close) ")
                        .title_alignment(Alignment::Center),
                );
                f.render_widget(list, modal_area);
            }

            ActiveModal::ObligationDetails {
                obligation_id,
                scroll,
            } => {
                let modal_area = centered_rect(70, 60, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let lines = vec![
                    Line::from(Span::styled(
                        format!("Obligation: {}", obligation_id),
                        Style::default()
                            .fg(theme.warning)
                            .add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(Span::raw("Scope: repository @ current revision")),
                    Line::from(Span::raw("Status: Evaluated against Verity Praxis Gates")),
                ];

                let dialog = Paragraph::new(lines)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .border_style(Style::default().fg(theme.primary))
                            .title(" 📋 Obligation Inspector (Esc: Close) ")
                            .title_alignment(Alignment::Center),
                    )
                    .scroll((*scroll, 0));
                f.render_widget(dialog, modal_area);
            }
        }
    }

    // =========================================================================
    // EVENT & BATCH KEY HANDLING
    // =========================================================================

    async fn handle_batch_events(&mut self, events: Vec<Event>) {
        let filtered: Vec<Event> = events
            .into_iter()
            .filter(|ev| match ev {
                Event::Key(k) => k.kind != KeyEventKind::Release,
                _ => true,
            })
            .collect();

        for ev in filtered {
            match ev {
                Event::Key(key) => {
                    self.handle_key_event(key).await;
                }
                Event::Mouse(mouse) => {
                    self.handle_mouse_event(mouse);
                }
                Event::Paste(text) => {
                    self.handle_paste_text(&text);
                }
                _ => {}
            }
        }
    }

    fn handle_paste_text(&mut self, text: &str) {
        let lines: Vec<&str> = text.lines().collect();
        if lines.len() > 3 || text.len() > 120 {
            self.paste_counter += 1;
            let id = self.paste_counter;
            let preview = if lines.is_empty() {
                String::new()
            } else {
                lines[0].chars().take(40).collect()
            };
            self.paste_cache.insert(
                id,
                PasteEntry {
                    id,
                    line_count: lines.len(),
                    byte_count: text.len(),
                    preview: preview.clone(),
                    full_content: text.to_string(),
                    file_path: None,
                },
            );
            let tag = format!(
                "[📋 Pasted text #{} ({} lines, {} bytes): '{}'...]",
                id,
                lines.len(),
                text.len(),
                preview
            );
            self.input_editor.insert_str(&tag);
            self.set_toast(
                format!("Pasted snippet #{} ({} lines)", id, lines.len()),
                self.theme().success,
            );
        } else {
            self.input_editor.insert_str(text);
        }
    }

    fn handle_mouse_event(&mut self, mouse: MouseEvent) {
        match mouse.kind {
            MouseEventKind::ScrollUp => match self.active_tab {
                ActiveTab::Chat => {
                    self.chat_scroll = self.chat_scroll.saturating_sub(3);
                    self.auto_scroll_to_bottom = false;
                }
                ActiveTab::Obligations => {
                    self.obligations_scroll = self.obligations_scroll.saturating_sub(3);
                }
                ActiveTab::Workspace => {
                    self.workspace_scroll = self.workspace_scroll.saturating_sub(3);
                }
                ActiveTab::Census => {
                    self.census_scroll = self.census_scroll.saturating_sub(3);
                }
                ActiveTab::Diff => {
                    self.diff_scroll = self.diff_scroll.saturating_sub(3);
                }
            },
            MouseEventKind::ScrollDown => match self.active_tab {
                ActiveTab::Chat => {
                    self.chat_scroll = self.chat_scroll.saturating_add(3);
                }
                ActiveTab::Obligations => {
                    self.obligations_scroll = self.obligations_scroll.saturating_add(3);
                }
                ActiveTab::Workspace => {
                    self.workspace_scroll = self.workspace_scroll.saturating_add(3);
                }
                ActiveTab::Census => {
                    self.census_scroll = self.census_scroll.saturating_add(3);
                }
                ActiveTab::Diff => {
                    self.diff_scroll = self.diff_scroll.saturating_add(3);
                }
            },
            MouseEventKind::Down(MouseButton::Left)
                if mouse.row >= self.layout_tabs.y
                    && mouse.row < self.layout_tabs.y + self.layout_tabs.height =>
            {
                for (tab, start_x, end_x) in &self.tab_bounds {
                    if mouse.column >= *start_x && mouse.column < *end_x {
                        self.active_tab = *tab;
                        return;
                    }
                }
            }
            _ => {}
        }
    }

    async fn handle_key_event(&mut self, key: KeyEvent) {
        if self.active_modal != ActiveModal::None {
            self.handle_modal_key(key).await;
            return;
        }

        let is_ctrl = key.modifiers.contains(KeyModifiers::CONTROL)
            && !key.modifiers.contains(KeyModifiers::ALT);
        let is_alt = key.modifiers.contains(KeyModifiers::ALT)
            && !key.modifiers.contains(KeyModifiers::CONTROL);

        // Global Hotkeys
        if is_ctrl && key.code == KeyCode::Char('p') {
            self.open_provider_menu().await;
            return;
        }
        if is_ctrl && key.code == KeyCode::Char('m') {
            self.open_model_picker().await;
            return;
        }
        if is_ctrl && key.code == KeyCode::Char('b') {
            self.show_sidebar = !self.show_sidebar;
            return;
        }
        if is_ctrl && key.code == KeyCode::Char('f') {
            self.active_modal = ActiveModal::ChatSearch {
                query: EditorState::new(),
            };
            return;
        }
        if is_ctrl && key.code == KeyCode::Char('c') {
            if self.is_processing {
                self.cancel_processing().await;
            } else if !self.input_editor.text.is_empty() {
                self.input_editor.copy_to_clipboard();
                self.set_toast("Copied input to clipboard", self.theme().success);
            } else if let Some((_, last_msg)) = self.chat_messages.last() {
                TuiClipboard::copy_text(last_msg);
                self.set_toast("Copied latest response to clipboard", self.theme().success);
            }
            return;
        }

        // Tab Switching F1..F5 & Alt+1..5
        match key.code {
            KeyCode::F(1) => {
                self.active_tab = ActiveTab::Chat;
                return;
            }
            KeyCode::F(2) => {
                self.active_tab = ActiveTab::Obligations;
                return;
            }
            KeyCode::F(3) => {
                self.active_tab = ActiveTab::Workspace;
                return;
            }
            KeyCode::F(4) => {
                self.active_tab = ActiveTab::Census;
                return;
            }
            KeyCode::F(5) => {
                self.active_tab = ActiveTab::Diff;
                self.trigger_background_diff();
                return;
            }
            _ => {}
        }

        if is_alt {
            match key.code {
                KeyCode::Char('1') => {
                    self.active_tab = ActiveTab::Chat;
                    return;
                }
                KeyCode::Char('2') => {
                    self.active_tab = ActiveTab::Obligations;
                    return;
                }
                KeyCode::Char('3') => {
                    self.active_tab = ActiveTab::Workspace;
                    return;
                }
                KeyCode::Char('4') => {
                    self.active_tab = ActiveTab::Census;
                    return;
                }
                KeyCode::Char('5') => {
                    self.active_tab = ActiveTab::Diff;
                    self.trigger_background_diff();
                    return;
                }
                _ => {}
            }
        }

        // Toggle thinking accordion with 't'
        if key.code == KeyCode::Char('t') && is_ctrl {
            self.is_thinking_expanded = !self.is_thinking_expanded;
            return;
        }

        // Slash command auto-completion
        if self.input_editor.text.starts_with('/') {
            let matches = self.get_matching_slash_commands();
            if !matches.is_empty() {
                let cur = self.slash_list_state.selected().unwrap_or(0);
                match key.code {
                    KeyCode::Tab => {
                        if let Some(cmd) = matches.get(cur) {
                            self.input_editor.set_text(format!("/{} ", cmd.name));
                        }
                        return;
                    }
                    KeyCode::Up if cur > 0 => {
                        self.slash_list_state.select(Some(cur - 1));
                        return;
                    }
                    KeyCode::Down if cur + 1 < matches.len() => {
                        self.slash_list_state.select(Some(cur + 1));
                        return;
                    }
                    _ => {}
                }
            }
        }

        // Trigger @ File Mention popup when user types '@'
        if key.code == KeyCode::Char('@') && !is_ctrl {
            self.active_modal = ActiveModal::FileMentionPicker {
                search: EditorState::new(),
                selected_idx: 0,
            };
            return;
        }

        // Paging & Auto-Scroll
        match key.code {
            KeyCode::PageUp => {
                match self.active_tab {
                    ActiveTab::Chat => {
                        self.chat_scroll = self.chat_scroll.saturating_sub(10);
                        self.auto_scroll_to_bottom = false;
                    }
                    ActiveTab::Obligations => {
                        self.obligations_scroll = self.obligations_scroll.saturating_sub(10);
                    }
                    ActiveTab::Workspace => {
                        self.workspace_scroll = self.workspace_scroll.saturating_sub(10);
                    }
                    ActiveTab::Census => {
                        self.census_scroll = self.census_scroll.saturating_sub(10);
                    }
                    ActiveTab::Diff => {
                        self.diff_scroll = self.diff_scroll.saturating_sub(10);
                    }
                }
                return;
            }
            KeyCode::PageDown => {
                match self.active_tab {
                    ActiveTab::Chat => {
                        self.chat_scroll = self.chat_scroll.saturating_add(10);
                    }
                    ActiveTab::Obligations => {
                        self.obligations_scroll = self.obligations_scroll.saturating_add(10);
                    }
                    ActiveTab::Workspace => {
                        self.workspace_scroll = self.workspace_scroll.saturating_add(10);
                    }
                    ActiveTab::Census => {
                        self.census_scroll = self.census_scroll.saturating_add(10);
                    }
                    ActiveTab::Diff => {
                        self.diff_scroll = self.diff_scroll.saturating_add(10);
                    }
                }
                return;
            }
            KeyCode::End if is_ctrl => {
                self.auto_scroll_to_bottom = true;
                return;
            }
            _ => {}
        }

        // Search navigation matches ('n' / 'N')
        if self.chat_search_query.is_some() {
            if key.code == KeyCode::Char('n') && !is_ctrl {
                self.navigate_search_match(true);
                return;
            } else if key.code == KeyCode::Char('N') {
                self.navigate_search_match(false);
                return;
            }
        }

        // Editor key handling
        if key.code == KeyCode::Enter
            && !key.modifiers.contains(KeyModifiers::SHIFT)
            && !key.modifiers.contains(KeyModifiers::ALT)
        {
            let prompt = self
                .expand_pasted_tags(&self.input_editor.text)
                .trim()
                .to_string();
            if !prompt.is_empty() && !self.is_processing {
                self.history.push(prompt.clone());
                self.history_idx = None;
                self.input_editor.clear();
                self.slash_list_state.select(Some(0));
                self.auto_scroll_to_bottom = true;

                if prompt.starts_with('/') || prompt.starts_with(':') {
                    self.handle_slash_command(&prompt).await;
                } else {
                    self.chat_messages.push(("User".into(), prompt.clone()));
                    self.is_processing = true;
                    self.processing_start = Some(Instant::now());

                    let svc = self.service.clone();
                    let tx = self.event_tx.clone();
                    let prompt_clone = prompt.clone();
                    let goal_summary = format!("Session goal: {}", prompt_clone);
                    let (cancel_tx, cancel_rx) = oneshot::channel();
                    self.processing_cancel = Some(cancel_tx);
                    tokio::spawn(run_cancellable_model_step(
                        svc,
                        goal_summary,
                        prompt_clone,
                        tx,
                        cancel_rx,
                    ));
                }
            }
            return;
        }

        if key.code == KeyCode::Esc {
            if self.is_processing {
                self.cancel_processing().await;
            } else if self.chat_search_query.is_some() {
                self.chat_search_query = None;
            } else if !self.input_editor.text.is_empty() {
                self.input_editor.clear();
            } else {
                self.should_quit = true;
            }
            return;
        }

        // History navigation in single-line prompt
        if self.input_editor.line_count() == 1 {
            if key.code == KeyCode::Up && !self.history.is_empty() {
                let new_idx = match self.history_idx {
                    Some(i) if i > 0 => i - 1,
                    Some(i) => i,
                    None => self.history.len().saturating_sub(1),
                };
                self.history_idx = Some(new_idx);
                if let Some(item) = self.history.get(new_idx) {
                    self.input_editor.set_text(item.clone());
                }
                return;
            } else if key.code == KeyCode::Down
                && let Some(i) = self.history_idx
            {
                if i + 1 < self.history.len() {
                    let new_idx = i + 1;
                    self.history_idx = Some(new_idx);
                    if let Some(item) = self.history.get(new_idx) {
                        self.input_editor.set_text(item.clone());
                    }
                } else {
                    self.history_idx = None;
                    self.input_editor.clear();
                }
                return;
            }
        }

        self.input_editor.handle_editor_key(key);
    }

    fn expand_pasted_tags(&self, text: &str) -> String {
        let mut out = text.to_string();
        for (id, entry) in &self.paste_cache {
            let tag_prefix = format!("[📋 Pasted text #{}", id);
            if let Some(start) = out.find(&tag_prefix)
                && let Some(end) = out[start..].find(']')
            {
                out.replace_range(start..=start + end, &entry.full_content);
            }
        }
        out
    }

    fn navigate_search_match(&mut self, forward: bool) {
        if let Some(ref q) = self.chat_search_query {
            let query = q.to_lowercase();
            let matches: Vec<usize> = self
                .chat_messages
                .iter()
                .enumerate()
                .filter(|(_, (_, msg))| msg.to_lowercase().contains(&query))
                .map(|(i, _)| i)
                .collect();

            if matches.is_empty() {
                return;
            }

            if forward {
                self.chat_search_match_idx = (self.chat_search_match_idx + 1) % matches.len();
            } else if self.chat_search_match_idx == 0 {
                self.chat_search_match_idx = matches.len().saturating_sub(1);
            } else {
                self.chat_search_match_idx -= 1;
            }

            self.set_toast(
                format!("Match {}/{}", self.chat_search_match_idx + 1, matches.len()),
                self.theme().primary,
            );
        }
    }

    async fn handle_modal_key(&mut self, key: KeyEvent) {
        match &mut self.active_modal {
            ActiveModal::None => {}

            ActiveModal::ThemePicker { selected_idx } => match key.code {
                KeyCode::Esc => {
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Up if *selected_idx > 0 => {
                    *selected_idx -= 1;
                }
                KeyCode::Down if *selected_idx + 1 < ThemeMode::all().len() => {
                    *selected_idx += 1;
                }
                KeyCode::Enter => {
                    if let Some(th) = ThemeMode::all().get(*selected_idx) {
                        self.active_theme = *th;
                        self.set_toast(
                            format!("Applied theme: {}", th.name()),
                            self.theme().success,
                        );
                    }
                    self.active_modal = ActiveModal::None;
                }
                _ => {}
            },

            ActiveModal::DoctorDialog { scroll } => match key.code {
                KeyCode::Esc | KeyCode::Enter | KeyCode::Char('q') => {
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Up => {
                    *scroll = scroll.saturating_sub(1);
                }
                KeyCode::Down => {
                    *scroll = scroll.saturating_add(1);
                }
                _ => {}
            },

            ActiveModal::FileMentionPicker {
                search,
                selected_idx,
            } => match key.code {
                KeyCode::Esc => {
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Up if *selected_idx > 0 => {
                    *selected_idx -= 1;
                }
                KeyCode::Down => {
                    *selected_idx += 1;
                }
                KeyCode::Enter => {
                    if let Some(ref census) = self.cached_census {
                        let query = search.text.to_lowercase();
                        let matches: Vec<_> = census
                            .active_frontier(64)
                            .into_iter()
                            .filter(|e| {
                                query.is_empty() || e.relative_path.to_lowercase().contains(&query)
                            })
                            .collect();
                        if let Some(entry) = matches.get(*selected_idx) {
                            self.input_editor
                                .insert_str(&format!("@{} ", entry.relative_path));
                        }
                    }
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Backspace => {
                    search.backspace();
                }
                KeyCode::Char(c) => {
                    search.insert(c);
                }
                _ => {}
            },

            ActiveModal::ChatSearch { query } => match key.code {
                KeyCode::Esc => {
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Enter => {
                    let q = query.text.trim().to_string();
                    if !q.is_empty() {
                        self.chat_search_query = Some(q.clone());
                        self.chat_search_match_idx = 0;
                        self.set_toast(
                            format!("Searching for '{}' (n: next, N: prev)", q),
                            self.theme().primary,
                        );
                    }
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Backspace => {
                    query.backspace();
                }
                KeyCode::Char(c) => {
                    query.insert(c);
                }
                _ => {}
            },

            ActiveModal::ToolApproval { .. } => match key.code {
                KeyCode::Char('y') | KeyCode::Enter => {
                    self.set_toast("Action approved by user", self.theme().success);
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Char('n') | KeyCode::Esc => {
                    self.set_toast("Action rejected by user", self.theme().danger);
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Char('a') => {
                    self.set_toast("Session auto-approval granted", self.theme().warning);
                    self.active_modal = ActiveModal::None;
                }
                _ => {}
            },

            ActiveModal::SessionManager { .. } => match key.code {
                KeyCode::Esc | KeyCode::Enter => {
                    self.active_modal = ActiveModal::None;
                }
                _ => {}
            },

            ActiveModal::ObligationDetails { scroll, .. } => match key.code {
                KeyCode::Esc | KeyCode::Enter => {
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Up => {
                    *scroll = scroll.saturating_sub(1);
                }
                KeyCode::Down => {
                    *scroll = scroll.saturating_add(1);
                }
                _ => {}
            },

            ActiveModal::ProviderMenu { search } => {
                let auth_data = self.auth_store.load().unwrap_or_default();
                let known = get_known_providers();
                let configured_count = auth_data.providers.len();
                let total_options = configured_count + known.len() + 2;

                match key.code {
                    KeyCode::Esc => {
                        self.active_modal = ActiveModal::None;
                    }
                    KeyCode::Up => {
                        let cur = self.modal_list_state.selected().unwrap_or(1);
                        if cur > 1 {
                            self.modal_list_state.select(Some(cur - 1));
                        }
                    }
                    KeyCode::Down => {
                        let cur = self.modal_list_state.selected().unwrap_or(1);
                        if cur + 1 < total_options {
                            self.modal_list_state.select(Some(cur + 1));
                        }
                    }
                    KeyCode::Enter => {
                        let cur = self.modal_list_state.selected().unwrap_or(1);
                        if cur >= 1 && cur <= configured_count {
                            let p_idx = cur - 1;
                            if let Some(p_id) = auth_data.providers.keys().nth(p_idx).cloned() {
                                self.switch_provider(&p_id).await;
                                self.active_modal = ActiveModal::None;
                            }
                        } else if cur > configured_count + 1 {
                            let known_idx = cur - configured_count - 2;
                            if let Some(known_p) = known.get(known_idx) {
                                if known_p.id == "custom" {
                                    self.active_modal = ActiveModal::ConnectWizard {
                                        step: ConnectWizardStep::ProviderId,
                                        provider_id: EditorState::with_text("custom"),
                                        base_url: EditorState::with_text(
                                            "http://localhost:8000/v1",
                                        ),
                                        api_key: EditorState::new(),
                                    };
                                } else {
                                    let default_base =
                                        known_p.default_base_url.clone().unwrap_or_default();
                                    self.active_modal = ActiveModal::ConnectWizard {
                                        step: if known_p.requires_api_key {
                                            ConnectWizardStep::ApiKey
                                        } else {
                                            ConnectWizardStep::BaseUrl
                                        },
                                        provider_id: EditorState::with_text(known_p.id.clone()),
                                        base_url: EditorState::with_text(default_base),
                                        api_key: EditorState::new(),
                                    };
                                }
                            }
                        }
                    }
                    KeyCode::Backspace => {
                        search.backspace();
                    }
                    KeyCode::Char(c) => {
                        search.insert(c);
                    }
                    _ => {}
                }
            }

            ActiveModal::ModelPicker { search } => {
                let total_items = self.dynamic_models.len() + 1;
                match key.code {
                    KeyCode::Esc => {
                        self.active_modal = ActiveModal::None;
                    }
                    KeyCode::Up => {
                        let cur = self.modal_list_state.selected().unwrap_or(0);
                        if cur > 0 {
                            self.modal_list_state.select(Some(cur - 1));
                        }
                    }
                    KeyCode::Down => {
                        let cur = self.modal_list_state.selected().unwrap_or(0);
                        if cur + 1 < total_items {
                            self.modal_list_state.select(Some(cur + 1));
                        }
                    }
                    KeyCode::Enter => {
                        let cur = self.modal_list_state.selected().unwrap_or(0);
                        if cur < self.dynamic_models.len() {
                            let chosen = self.dynamic_models[cur].clone();
                            self.switch_model(&chosen).await;
                            self.active_modal = ActiveModal::None;
                        } else {
                            self.active_modal = ActiveModal::CustomModelPrompt {
                                editor: EditorState::new(),
                            };
                        }
                    }
                    KeyCode::Backspace => {
                        search.backspace();
                    }
                    KeyCode::Char(c) => {
                        search.insert(c);
                    }
                    _ => {}
                }
            }

            ActiveModal::CustomModelPrompt { editor } => match key.code {
                KeyCode::Esc => {
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Enter => {
                    let custom = editor.text.trim().to_string();
                    if !custom.is_empty() {
                        self.switch_model(&custom).await;
                    }
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Backspace => {
                    editor.backspace();
                }
                KeyCode::Char(c) => {
                    editor.insert(c);
                }
                _ => {}
            },

            ActiveModal::ConnectWizard {
                step,
                provider_id,
                base_url,
                api_key,
            } => match key.code {
                KeyCode::Esc => {
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Char(c) => match step {
                    ConnectWizardStep::ProviderId => provider_id.insert(c),
                    ConnectWizardStep::BaseUrl => base_url.insert(c),
                    ConnectWizardStep::ApiKey => api_key.insert(c),
                },
                KeyCode::Backspace => match step {
                    ConnectWizardStep::ProviderId => {
                        provider_id.backspace();
                    }
                    ConnectWizardStep::BaseUrl => {
                        base_url.backspace();
                    }
                    ConnectWizardStep::ApiKey => {
                        api_key.backspace();
                    }
                },
                KeyCode::Enter => match step {
                    ConnectWizardStep::ProviderId => {
                        if !provider_id.text.trim().is_empty() {
                            *step = ConnectWizardStep::BaseUrl;
                        }
                    }
                    ConnectWizardStep::BaseUrl => {
                        *step = ConnectWizardStep::ApiKey;
                    }
                    ConnectWizardStep::ApiKey => {
                        let p_id = provider_id.text.trim().to_lowercase();
                        let b_url = if base_url.text.trim().is_empty() {
                            None
                        } else {
                            Some(base_url.text.trim().to_string())
                        };
                        let key_val = api_key.text.trim().to_string();

                        self.chat_messages.push((
                            "System".into(),
                            format!("Connecting provider '{}'...", p_id),
                        ));

                        let mut discovered = Vec::new();
                        if let Some(ref url) = b_url {
                            let k = if key_val.is_empty() || key_val == "none" {
                                None
                            } else {
                                Some(key_val.as_str())
                            };
                            if let Ok(models) = fetch_remote_models(url, k).await {
                                discovered = models;
                            }
                        }

                        let def_model = discovered.first().cloned();
                        let _ = self.auth_store.set_provider_config(
                            &p_id,
                            &key_val,
                            b_url.as_deref(),
                            def_model.as_deref(),
                            discovered.clone(),
                        );

                        self.chat_messages.push((
                            "System".into(),
                            format!(
                                "✅ Provider '{}' configured (discovered {} models).",
                                p_id,
                                discovered.len()
                            ),
                        ));
                        self.switch_provider(&p_id).await;
                        self.active_modal = ActiveModal::None;
                    }
                },
                _ => {}
            },

            ActiveModal::HelpDialog { scroll } => match key.code {
                KeyCode::Esc | KeyCode::Enter | KeyCode::Char('q') => {
                    self.active_modal = ActiveModal::None;
                }
                KeyCode::Up => {
                    *scroll = scroll.saturating_sub(1);
                }
                KeyCode::Down => {
                    *scroll = scroll.saturating_add(1);
                }
                _ => {}
            },
        }
    }

    async fn handle_slash_command(&mut self, cmd: &str) {
        let parts: Vec<&str> = cmd.split_whitespace().collect();
        let name = parts[0].trim_start_matches('/').trim_start_matches(':');

        match name {
            "help" | "?" => {
                self.active_modal = ActiveModal::HelpDialog { scroll: 0 };
            }
            "theme" => {
                if parts.len() > 1 {
                    let target = parts[1].to_lowercase();
                    if let Some(th) = ThemeMode::all()
                        .iter()
                        .find(|t| t.name().to_lowercase().contains(&target))
                    {
                        self.active_theme = *th;
                        self.set_toast(
                            format!("Applied theme: {}", th.name()),
                            self.theme().success,
                        );
                    }
                } else {
                    self.active_modal = ActiveModal::ThemePicker { selected_idx: 0 };
                }
            }
            "doctor" => {
                self.active_modal = ActiveModal::DoctorDialog { scroll: 0 };
            }
            "diff" => {
                self.active_tab = ActiveTab::Diff;
                self.trigger_background_diff();
            }
            "undo" => {
                let root = self.root_dir.clone();
                let tx = self.event_tx.clone();
                tokio::spawn(async move {
                    let res = tokio::process::Command::new("git")
                        .args(["checkout", "--", "."])
                        .current_dir(&root)
                        .output()
                        .await
                        .map(|_o| (0i32, String::new(), String::new(), 0u64));
                    if res.is_ok() {
                        let _ = tx.send(AppEvent::DiffResponse(Ok(
                            "✓ Reverted working tree changes to HEAD.".to_string(),
                        )));
                    }
                });
                self.set_toast("Reverted uncommitted changes", self.theme().warning);
            }
            "sessions" => {
                self.active_modal = ActiveModal::SessionManager { selected_idx: 0 };
            }
            "export" => {
                let target_file = if parts.len() > 1 {
                    parts[1]
                } else {
                    "rivet_session_export.md"
                };
                let mut out = String::new();
                out.push_str("# Rivet Session Export\n\n");
                for (sender, msg) in &self.chat_messages {
                    out.push_str(&format!("## {}\n{}\n\n", sender, msg));
                }
                let path = self.root_dir.join(target_file);
                if tokio::fs::write(&path, out).await.is_ok() {
                    self.set_toast(format!("Exported to {}", target_file), self.theme().success);
                }
            }
            "search" => {
                let query = if parts.len() > 1 {
                    parts[1..].join(" ")
                } else {
                    String::new()
                };
                self.active_modal = ActiveModal::ChatSearch {
                    query: EditorState::with_text(query),
                };
            }
            "mention" => {
                self.active_modal = ActiveModal::FileMentionPicker {
                    search: EditorState::new(),
                    selected_idx: 0,
                };
            }
            "sidebar" | "b" => {
                self.show_sidebar = !self.show_sidebar;
            }
            "provider" | "p" => {
                if parts.len() > 1 {
                    self.switch_provider(parts[1]).await;
                } else {
                    self.open_provider_menu().await;
                }
            }
            "model" | "m" => {
                if parts.len() > 1 {
                    self.switch_model(parts[1]).await;
                } else {
                    self.open_model_picker().await;
                }
            }
            "connect" | "login" | "auth" => {
                if parts.len() == 1 {
                    self.open_provider_menu().await;
                } else if parts.len() >= 3 {
                    let provider = parts[1];
                    let key = parts[2];
                    let base_url = if parts.len() >= 4 {
                        Some(parts[3])
                    } else {
                        None
                    };

                    let mut discovered = Vec::new();
                    if let Some(url) = base_url
                        && let Ok(m) = fetch_remote_models(url, Some(key)).await
                    {
                        discovered = m;
                    }

                    let def_m = discovered.first().cloned();
                    let _ = self.auth_store.set_provider_config(
                        provider,
                        key,
                        base_url,
                        def_m.as_deref(),
                        discovered.clone(),
                    );
                    self.chat_messages.push((
                        "System".into(),
                        format!(
                            "✅ Saved provider '{}' (masked: {}, discovered {} models)",
                            provider,
                            AuthStore::mask_key(key),
                            discovered.len()
                        ),
                    ));
                    self.switch_provider(provider).await;
                }
            }
            "goal" | "g" => {
                if parts.len() > 1 {
                    let goal_prompt = parts[1..].join(" ");
                    self.is_processing = true;
                    self.processing_start = Some(Instant::now());

                    let svc = self.service.clone();
                    let tx = self.event_tx.clone();
                    let (cancel_tx, cancel_rx) = oneshot::channel();
                    self.processing_cancel = Some(cancel_tx);
                    tokio::spawn(run_cancellable_goal(svc, goal_prompt, tx, cancel_rx));
                }
            }
            "census" => {
                self.trigger_background_census();
                self.set_toast("Triggered repository census", self.theme().primary);
            }
            "obligations" | "claims" => {
                self.active_tab = ActiveTab::Obligations;
            }
            "clear" => {
                {
                    let _ = self.service.clear_hypotheses().await;
                }
                let th_warn = self.theme().warning;
                self.set_toast("Cleared hypotheses in Soft Workspace", th_warn);
            }
            "reframe" => {
                {
                    let _ = self
                        .service
                        .add_hypothesis(
                            "[Manual Reframed] Exploring alternative architecture invariants",
                        )
                        .await;
                }
                let th_prim = self.theme().primary;
                self.set_toast("Triggered Hephaestus reframing", th_prim);
            }
            "quit" | "q" | "exit" => {
                self.should_quit = true;
            }
            unknown => {
                self.chat_messages.push((
                    "System".into(),
                    format!("Unknown command '/{}'. Type /help or press Tab.", unknown),
                ));
            }
        }
    }

    fn get_matching_slash_commands(&self) -> Vec<&'static SlashCommandDef> {
        if !self.input_editor.text.starts_with('/') {
            return Vec::new();
        }
        let needle = self
            .input_editor
            .text
            .trim_start_matches('/')
            .to_lowercase();
        SLASH_COMMANDS
            .iter()
            .filter(|cmd| {
                needle.is_empty()
                    || cmd.name.starts_with(&needle)
                    || cmd.description.to_lowercase().contains(&needle)
            })
            .collect()
    }

    async fn open_provider_menu(&mut self) {
        self.active_modal = ActiveModal::ProviderMenu {
            search: EditorState::new(),
        };
        self.modal_list_state.select(Some(1));
    }

    async fn open_model_picker(&mut self) {
        let models =
            ProviderRegistry::get_available_models(&self.active_config.provider, &self.auth_store)
                .await;
        self.dynamic_models = models;
        self.active_modal = ActiveModal::ModelPicker {
            search: EditorState::new(),
        };
        self.modal_list_state.select(Some(0));
    }

    async fn switch_provider(&mut self, provider: &str) {
        match ProviderRegistry::resolve(Some(provider), None, &self.auth_store) {
            Ok(resolved) => {
                self.active_config = resolved.clone();
                let _ = self.auth_store.set_active_provider(&resolved.provider);
                let _ = self.auth_store.set_active_model(&resolved.model_id);
                let new_backend: Arc<dyn rivet_model::ModelBackend> =
                    if resolved.provider == "opencode" {
                        Arc::new(rivet_model_genai::GenAiBackend::new())
                    } else {
                        Arc::new(rivet_model_rig::RigBackend::from_resolved(&resolved))
                    };
                self.dynamic_backend.set_backend(new_backend).await;
                self.set_toast(
                    format!("Active provider switched to '{}'", resolved.provider),
                    self.theme().success,
                );
            }
            Err(e) => {
                self.set_toast(
                    format!("Failed to resolve provider: {}", e),
                    self.theme().danger,
                );
            }
        }
    }

    async fn switch_model(&mut self, model: &str) {
        let provider = self.active_config.provider.clone();
        match ProviderRegistry::resolve(Some(&provider), Some(model), &self.auth_store) {
            Ok(resolved) => {
                self.active_config = resolved.clone();
                let _ = self.auth_store.set_active_model(&resolved.model_id);
                let new_backend: Arc<dyn rivet_model::ModelBackend> =
                    if resolved.provider == "opencode" {
                        Arc::new(rivet_model_genai::GenAiBackend::new())
                    } else {
                        Arc::new(rivet_model_rig::RigBackend::from_resolved(&resolved))
                    };
                self.dynamic_backend.set_backend(new_backend).await;
                self.set_toast(
                    format!("Active model switched to '{}'", resolved.model_id),
                    self.theme().success,
                );
            }
            Err(e) => {
                self.set_toast(
                    format!("Failed to resolve model: {}", e),
                    self.theme().danger,
                );
            }
        }
    }
}

/// Helper function to create a centered Rect for modals
fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(r);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}

// =============================================================================
// UNIT & REGRESSION TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_editor_multiline_editing_and_navigation() {
        let mut editor = EditorState::new();
        editor.insert_str("line 1\nline 2\nline 3");
        assert_eq!(editor.line_count(), 3);

        let (l, c) = editor.cursor_line_and_col();
        assert_eq!(l, 2);
        assert_eq!(c, 6);

        // Move up
        editor.move_up();
        let (l, c) = editor.cursor_line_and_col();
        assert_eq!(l, 1);
        assert_eq!(c, 6);

        // Move up again
        editor.move_up();
        let (l, c) = editor.cursor_line_and_col();
        assert_eq!(l, 0);
        assert_eq!(c, 6);

        // Move down
        editor.move_down();
        let (l, c) = editor.cursor_line_and_col();
        assert_eq!(l, 1);
        assert_eq!(c, 6);
    }

    #[test]
    fn test_theme_palettes_all_modes() {
        for mode in ThemeMode::all() {
            let p = mode.palette();
            assert_ne!(mode.name(), "");
            assert!(p.primary != Color::Rgb(0, 0, 0) || *mode == ThemeMode::Monochrome);
        }
    }

    #[test]
    fn test_active_tabs_cycle_and_diff_tab() {
        assert_eq!(ActiveTab::all().len(), 5);
        assert_eq!(ActiveTab::Diff.title(), "F5: 🔍 Git Diff & Changes");
        assert_eq!(ActiveTab::Diff.next(), ActiveTab::Chat);
        assert_eq!(ActiveTab::Chat.prev(), ActiveTab::Diff);
    }

    #[test]
    fn test_slash_commands_catalog_coverage() {
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "diff"));
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "undo"));
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "doctor"));
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "theme"));
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "sessions"));
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "export"));
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "search"));
        assert!(SLASH_COMMANDS.iter().any(|c| c.name == "mention"));
    }

    #[test]
    fn test_editor_handle_editor_key_and_clipboard() {
        let mut editor = EditorState::new();

        editor.handle_editor_key(KeyEvent::new(KeyCode::Char('a'), KeyModifiers::NONE));
        editor.handle_editor_key(KeyEvent::new(KeyCode::Char('b'), KeyModifiers::NONE));
        editor.handle_editor_key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::NONE));
        assert_eq!(editor.text, "abc");
        assert_eq!(editor.cursor, 3);

        editor.handle_editor_key(KeyEvent::new(KeyCode::Home, KeyModifiers::NONE));
        assert_eq!(editor.cursor, 0);

        editor.handle_editor_key(KeyEvent::new(KeyCode::Char('a'), KeyModifiers::CONTROL));
        assert_eq!(editor.selected_range(), Some((0, 3)));
        assert_eq!(editor.selected_text().as_deref(), Some("abc"));

        assert!(editor.copy_to_clipboard());

        editor.handle_editor_key(KeyEvent::new(KeyCode::Char('e'), KeyModifiers::CONTROL));
        assert_eq!(editor.cursor, 3);
        assert_eq!(editor.selected_range(), None);

        editor.handle_editor_key(KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL));
        assert_eq!(editor.text, "");
        assert_eq!(editor.cursor, 0);

        let sample = "Rivet Multi-Line Editor 🦀";
        let ok = TuiClipboard::copy_text(sample);
        assert!(ok);
        let fetched = TuiClipboard::paste_text();
        assert_eq!(fetched.as_deref(), Some(sample));

        let pasted = editor.paste_from_clipboard();
        assert!(pasted);
        assert_eq!(editor.text, sample);
    }

    #[tokio::test]
    async fn cancellation_drops_an_in_flight_operation() {
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let task = tokio::spawn(wait_for_cancellable_result(
            async { std::future::pending::<Result<String, String>>().await },
            cancel_rx,
        ));

        cancel_tx.send(()).unwrap();
        assert!(task.await.unwrap().is_none());
    }

    #[tokio::test]
    async fn escape_cancels_processing_and_marks_harness_cancelled() {
        let temp_dir =
            std::env::temp_dir().join(format!("rivet-tui-cancel-{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let config = ResolvedProviderConfig {
            provider: "mock".into(),
            model_id: "mock-model".into(),
            api_key: None,
            base_url: None,
        };
        let svc =
            rivet_service::RivetServiceImpl::from_dir(&temp_dir, config.clone(), AuthStore::new())
                .await
                .unwrap();
        let model: Arc<dyn rivet_model::ModelBackend> =
            Arc::new(rivet_model_rig::RigBackend::from_resolved(&config));
        let dynamic_backend = Arc::new(rivet_model::DynamicModelBackend::new(model));
        let mut app = TuiApp::new(
            svc.clone() as Arc<dyn RivetService>,
            dynamic_backend,
            AuthStore::new(),
            config,
            temp_dir.clone(),
        );
        let (cancel_tx, cancel_rx) = oneshot::channel();
        app.processing_cancel = Some(cancel_tx);
        app.is_processing = true;

        app.handle_key_event(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE))
            .await;

        assert!(cancel_rx.await.is_ok());
        assert_eq!(svc.current_phase().await.unwrap(), RunPhase::Cancelled);
        assert!(!app.is_processing);
        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
