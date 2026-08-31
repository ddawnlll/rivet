//! # rivet::tui
//!
//! Ultra-responsive, modern Epistemic Agent Cockpit for Rivet.
//! Features:
//! - Exact visual column & cursor positioning using `unicode-width` for multi-terminal fidelity.
//! - Dynamic tab bounding-box calculation for pixel-perfect mouse hit-testing.
//! - Non-blocking asynchronous event loop with background tokio tasks.
//! - Visual mouse drag text selection in chat stream with automatic and shortcut clipboard copy.
//! - Full system clipboard integration via `arboard` (`Ctrl+C`, `Ctrl+V`, `Ctrl+X`, `Shift+Insert`, `Event::Paste`, `/copy`).
//! - Interactive mouse clicks on Tab headers, Modals, Slash Palette, and Input box.
//! - Multi-tab workspace ([F1/Alt+1] Chat, [F2/Alt+2] Obligations, [F3/Alt+3] Memory, [F4/Alt+4] Census).
//! - Floating status toasts for immediate feedback on copy, paste, and navigation events.
//! - Collapsible quick-inspector sidebar (`Ctrl+B`).
//! - Advanced line editor with full cursor movement (Left/Right/Home/End/Delete/Ctrl+W/Ctrl+U/Ctrl+Left/Ctrl+Right).
//! - Full Windows / Crossterm compatibility with KeyEventKind::Release filtering and AltGr safety.
//! - Instant search/filtering in Provider Manager & Model Picker (`Ctrl+P`, `Ctrl+M`).
//! - Polished Tokyo Night / Catppuccin inspired aesthetics with rounded borders.

use crossterm::{
    event::{
        self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
        Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent,
        MouseEventKind,
    },
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Margin, Position, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, BorderType, Borders, Clear, List, ListItem, ListState, Paragraph, Scrollbar,
        ScrollbarOrientation, ScrollbarState, Tabs, Wrap,
    },
    Terminal,
};
use rivet_core::{HarnessCore, RunPhase};
use rivet_model::auth::AuthStore;
use rivet_model::provider_hub::{
    fetch_remote_models, get_known_providers, ProviderRegistry, ResolvedProviderConfig,
};
use rivet_repository::{CensusRunner, RepositoryCensus};
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

const SPINNER_FRAMES: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Theme Colors (Tokyo Night inspired)
const COLOR_PRIMARY: Color = Color::Rgb(122, 162, 247); // #7aa2f7 Soft Blue
const COLOR_SECONDARY: Color = Color::Rgb(187, 154, 247); // #bb9af7 Lavender/Purple
const COLOR_SUCCESS: Color = Color::Rgb(158, 206, 106); // #9ece6a Soft Green
const COLOR_WARNING: Color = Color::Rgb(224, 175, 104); // #e0af68 Warm Amber
const COLOR_DANGER: Color = Color::Rgb(247, 118, 142); // #f7768e Coral Red
const COLOR_MUTED: Color = Color::Rgb(86, 95, 137); // #565f89 Slate Gray
const COLOR_BORDER: Color = Color::Rgb(65, 72, 104); // #414868 Muted Border
const COLOR_ACTIVE_BORDER: Color = Color::Rgb(122, 162, 247); // #7aa2f7 Focused Border
const COLOR_SELECTION_BG: Color = Color::Rgb(65, 80, 130); // #415082 Selection Highlight
const COLOR_SELECTION_FG: Color = Color::Rgb(255, 255, 255); // Selection Text

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

/// Helper struct for cross-platform clipboard interactions via `arboard`.
pub struct ClipboardHelper;

impl ClipboardHelper {
    pub fn get() -> Option<String> {
        arboard::Clipboard::new()
            .ok()
            .and_then(|mut cb| cb.get_text().ok())
    }

    pub fn set(text: &str) -> bool {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            cb.set_text(text.to_string()).is_ok()
        } else {
            false
        }
    }
}

/// Ephemeral toast notification displayed at the top of the interface.
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveTab {
    Chat = 0,
    Obligations = 1,
    Workspace = 2,
    Census = 3,
}

impl ActiveTab {
    pub fn all() -> &'static [ActiveTab] {
        &[
            ActiveTab::Chat,
            ActiveTab::Obligations,
            ActiveTab::Workspace,
            ActiveTab::Census,
        ]
    }

    pub fn title(&self) -> &'static str {
        match self {
            ActiveTab::Chat => "F1: 💬 Chat Stream",
            ActiveTab::Obligations => "F2: 📋 Obligations & Claims",
            ActiveTab::Workspace => "F3: 🧠 Soft Workspace",
            ActiveTab::Census => "F4: 📊 Census & Frontier",
        }
    }

    pub fn next(&self) -> Self {
        match self {
            ActiveTab::Chat => ActiveTab::Obligations,
            ActiveTab::Obligations => ActiveTab::Workspace,
            ActiveTab::Workspace => ActiveTab::Census,
            ActiveTab::Census => ActiveTab::Chat,
        }
    }

    pub fn prev(&self) -> Self {
        match self {
            ActiveTab::Chat => ActiveTab::Census,
            ActiveTab::Obligations => ActiveTab::Chat,
            ActiveTab::Workspace => ActiveTab::Obligations,
            ActiveTab::Census => ActiveTab::Workspace,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SlashCommandDef {
    pub name: &'static str,
    pub shortcut: &'static str,
    pub description: &'static str,
    pub usage: &'static str,
}

const SLASH_COMMANDS: &[SlashCommandDef] = &[
    SlashCommandDef {
        name: "copy",
        shortcut: "Ctrl+C",
        description: "Copy last assistant response to system clipboard",
        usage: "/copy",
    },
    SlashCommandDef {
        name: "copy-all",
        shortcut: "",
        description: "Copy entire chat transcript to system clipboard",
        usage: "/copy-all",
    },
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
        usage: "/help",
    },
    SlashCommandDef {
        name: "quit",
        shortcut: "Esc",
        description: "Exit the Rivet Cockpit",
        usage: "/quit or :q",
    },
];

/// Interactive line editor state supporting cursor movements, backspace, delete, word jumps, and paste.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EditorState {
    pub text: String,
    pub cursor: usize, // Character index (0..=char_count)
}

impl EditorState {
    pub fn new() -> Self {
        Self {
            text: String::new(),
            cursor: 0,
        }
    }

    pub fn with_text(text: impl Into<String>) -> Self {
        let t = text.into();
        let cursor = t.chars().count();
        Self { text: t, cursor }
    }

    pub fn char_count(&self) -> usize {
        self.text.chars().count()
    }

    pub fn insert(&mut self, c: char) {
        let byte_idx = self.char_to_byte(self.cursor);
        self.text.insert(byte_idx, c);
        self.cursor += 1;
    }

    pub fn insert_str(&mut self, s: &str) {
        let clean = s.replace("\r\n", " ").replace('\n', " ").replace('\r', " ");
        for c in clean.chars() {
            self.insert(c);
        }
    }

    pub fn backspace(&mut self) -> bool {
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
        let count = self.char_count();
        if self.cursor >= count {
            return;
        }
        let chars: Vec<char> = self.text.chars().collect();
        let mut new_cursor = self.cursor;
        while new_cursor < count && !chars[new_cursor].is_whitespace() {
            new_cursor += 1;
        }
        while new_cursor < count && chars[new_cursor].is_whitespace() {
            new_cursor += 1;
        }
        self.cursor = new_cursor;
    }

    pub fn clear(&mut self) {
        self.text.clear();
        self.cursor = 0;
    }

    pub fn set_text(&mut self, t: String) {
        self.cursor = t.chars().count();
        self.text = t;
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

    pub fn move_home(&mut self) {
        self.cursor = 0;
    }

    pub fn move_end(&mut self) {
        self.cursor = self.char_count();
    }

    fn char_to_byte(&self, char_idx: usize) -> usize {
        self.text
            .char_indices()
            .nth(char_idx)
            .map(|(i, _)| i)
            .unwrap_or(self.text.len())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ConnectWizardStep {
    ProviderId,
    BaseUrl,
    ApiKey,
}

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
    HelpDialog {
        scroll: u16,
    },
}

pub enum AppEvent {
    ModelResponse(Result<String, String>),
    GoalResponse(Result<String, String>),
    CensusResponse(Result<RepositoryCensus, String>),
}

pub struct TuiApp {
    pub harness: Arc<HarnessCore>,
    pub auth_store: AuthStore,
    pub active_config: ResolvedProviderConfig,
    pub root_dir: PathBuf,

    // Input & Editor State
    pub input_editor: EditorState,
    pub history: Vec<String>,
    pub history_idx: Option<usize>,

    // Chat log
    pub chat_messages: Vec<(String, String)>,
    pub chat_scroll: u16,
    pub auto_scroll_to_bottom: bool,

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

    // Ephemeral Toast Status Feedback
    pub toast: Option<ToastNotification>,

    // Tab lists & scrolls
    pub obligations_scroll: u16,
    pub workspace_scroll: u16,
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

impl TuiApp {
    pub fn new(
        harness: Arc<HarnessCore>,
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
            harness,
            auth_store,
            active_config,
            root_dir,
            input_editor: EditorState::new(),
            history: Vec::new(),
            history_idx: None,
            chat_messages: vec![
                (
                    "System".into(),
                    "⚡ Welcome to Rivet Epistemic Software Engineering Cockpit.".into(),
                ),
                (
                    "System".into(),
                    format!(
                        "Active {}\n💡 Mouse selection & copy/paste enabled! Type '/' for Slash Menu, Ctrl+P for Providers, Ctrl+M for Models, F1-F4 for Tabs.",
                        status_desc
                    ),
                ),
            ],
            chat_scroll: 0,
            auto_scroll_to_bottom: true,
            selection_anchor: None,
            selection_cursor: None,
            is_mouse_selecting: false,
            active_tab: ActiveTab::Chat,
            show_sidebar: true,
            should_quit: false,
            is_processing: false,
            processing_start: None,
            spinner_frame: 0,
            toast: None,
            obligations_scroll: 0,
            workspace_scroll: 0,
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

    pub fn set_toast(&mut self, message: impl Into<String>, color: Color) {
        self.toast = Some(ToastNotification::new(message, color));
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

        // Trigger initial background census
        self.trigger_background_census();

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
            if let Some(ref t) = self.toast {
                if t.is_expired() {
                    self.toast = None;
                }
            }

            // 4. Fetch current system state snapshots
            let hard = self.harness.hard_state.lock().await.clone();
            let soft = self.harness.soft_workspace.lock().await.clone();
            let phase = self.harness.current_phase().await;

            // 5. Render UI
            terminal.draw(|f| {
                let size = f.area();

                // Main Layout: Header (3), Tab Bar (3), Tab Content (Min 8), Input Area (3), Footer (1)
                let main_layout = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3), // Top Header Bar
                        Constraint::Length(3), // Tab Selection Bar
                        Constraint::Min(8),    // Active Tab Workspace
                        Constraint::Length(3), // Input Prompt Box
                        Constraint::Length(1), // Footer Shortcut Hints
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
                }

                // --- 4. Input Prompt Box ---
                self.render_input_box(f, main_layout[3]);

                // --- 5. Footer Shortcut Hints ---
                self.render_footer(f, main_layout[4]);

                // --- 6. Floating Slash Command Palette (if input starts with '/') ---
                if self.active_modal == ActiveModal::None && self.input_editor.text.starts_with('/') {
                    self.render_slash_palette(f, main_layout[3], size);
                } else {
                    self.layout_slash_palette = None;
                }

                // --- 7. Floating Modals & Dialogs ---
                self.render_modals(f, size);
            })?;

            // 6. Poll user input events with a responsive timeout
            if event::poll(Duration::from_millis(30))? {
                let ev = event::read()?;

                match ev {
                    Event::Paste(pasted_text) => {
                        self.handle_paste_event(pasted_text);
                    }
                    Event::Mouse(mouse_event) => {
                        self.handle_mouse_event(mouse_event);
                    }
                    Event::Key(key) => {
                        // Filter out KeyRelease events on Windows/Crossterm
                        if key.kind == KeyEventKind::Release {
                            continue;
                        }
                        self.handle_key_event(key).await;
                    }
                    _ => {}
                }
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

    fn handle_paste_event(&mut self, text: String) {
        if text.is_empty() {
            return;
        }
        let char_len = text.chars().count();
        match &mut self.active_modal {
            ActiveModal::ProviderMenu { search } | ActiveModal::ModelPicker { search } => {
                search.insert_str(&text);
            }
            ActiveModal::CustomModelPrompt { editor } => {
                editor.insert_str(&text);
            }
            ActiveModal::ConnectWizard {
                step,
                provider_id,
                base_url,
                api_key,
            } => match step {
                ConnectWizardStep::ProviderId => provider_id.insert_str(&text),
                ConnectWizardStep::BaseUrl => base_url.insert_str(&text),
                ConnectWizardStep::ApiKey => api_key.insert_str(&text),
            },
            _ => {
                self.input_editor.insert_str(&text);
            }
        }
        self.set_toast(format!("📋 Pasted {} characters", char_len), COLOR_SUCCESS);
    }

    fn handle_app_event(&mut self, event: AppEvent) {
        match event {
            AppEvent::ModelResponse(res) => {
                self.is_processing = false;
                self.processing_start = None;
                self.auto_scroll_to_bottom = true;
                match res {
                    Ok(text) => {
                        self.chat_messages.push(("Rivet".into(), text));
                    }
                    Err(err) => {
                        self.chat_messages
                            .push(("Error".into(), format!("Model/execution error: {}", err)));
                    }
                }
            }
            AppEvent::GoalResponse(res) => {
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
            AppEvent::CensusResponse(res) => match res {
                Ok(census) => {
                    self.cached_census = Some(census);
                }
                Err(err) => {
                    self.chat_messages
                        .push(("Error".into(), format!("Census error: {}", err)));
                }
            },
        }
    }

    fn trigger_background_census(&self) {
        let root = self.root_dir.clone();
        let tx = self.event_tx.clone();
        tokio::spawn(async move {
            let res = CensusRunner::run_census(&root).await;
            let _ = tx.send(AppEvent::CensusResponse(res.map_err(|e| e.to_string())));
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
        let phase_color = match phase {
            RunPhase::Completed => COLOR_SUCCESS,
            RunPhase::Stagnated => COLOR_WARNING,
            RunPhase::Failed => COLOR_DANGER,
            RunPhase::Executing | RunPhase::Verifying | RunPhase::InvokingModel => COLOR_WARNING,
            _ => COLOR_PRIMARY,
        };

        let spinner_or_time = if self.is_processing {
            let elapsed = self
                .processing_start
                .map(|t| t.elapsed().as_secs_f32())
                .unwrap_or(0.0);
            format!(
                " [{}] {:.1}s",
                SPINNER_FRAMES[self.spinner_frame],
                elapsed
            )
        } else {
            String::new()
        };

        let repo_name = self
            .root_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("rivet");

        let mut header_spans = vec![
            Span::styled(
                " ⚡ RIVET v0.3 ",
                Style::default()
                    .fg(Color::Black)
                    .bg(COLOR_PRIMARY)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!(" 🤖 {}:{} ", self.active_config.provider, self.active_config.model_id),
                Style::default().fg(COLOR_SUCCESS).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("│ Phase: {:?}{} ", phase, spinner_or_time),
                Style::default().fg(phase_color).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("│ Rev: r{} ", hard.revision.0),
                Style::default().fg(COLOR_SECONDARY),
            ),
            Span::styled(
                format!("│ 📁 {} ", repo_name),
                Style::default().fg(COLOR_MUTED),
            ),
        ];

        // Render Active Toast in Header if present!
        if let Some(ref toast) = self.toast {
            header_spans.push(Span::styled(
                format!(" │ {} ", toast.message),
                Style::default()
                    .bg(toast.color)
                    .fg(Color::Black)
                    .add_modifier(Modifier::BOLD),
            ));
        }

        let header = Paragraph::new(Line::from(header_spans)).block(
            Block::default()
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(COLOR_BORDER)),
        );
        f.render_widget(header, area);
    }

    fn render_tab_bar(&mut self, f: &mut ratatui::Frame, area: Rect) {
        let mut titles = Vec::new();
        let mut tab_bounds = Vec::new();

        // Exact start coordinate inside the left rounded border
        let mut cur_x = area.x + 1;

        for tab in ActiveTab::all() {
            let is_active = *tab == self.active_tab;
            let title_text = if is_active {
                format!(" ▶ {} ", tab.title())
            } else {
                format!("   {} ", tab.title())
            };

            let style = if is_active {
                Style::default()
                    .fg(Color::Black)
                    .bg(COLOR_PRIMARY)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };

            let visual_w = UnicodeWidthStr::width(title_text.as_str()) as u16;
            let start_x = cur_x;
            let end_x = cur_x + visual_w;
            tab_bounds.push((*tab, start_x, end_x));
            cur_x = end_x + 1; // 1 space divider spacing between tabs in Ratatui Tabs

            titles.push(Line::from(vec![Span::styled(title_text, style)]));
        }

        self.tab_bounds = tab_bounds;

        let tabs = Tabs::new(titles)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(COLOR_BORDER))
                    .title(" Workspaces (Click or F1..F4 / Alt+1..4) "),
            )
            .select(self.active_tab as usize)
            .style(Style::default().fg(Color::White))
            .highlight_style(Style::default().fg(COLOR_PRIMARY));

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

    /// Computes all flattened plain text lines corresponding to the chat messages.
    pub fn get_chat_plain_lines(&self) -> Vec<String> {
        let mut lines = Vec::new();
        for (sender, msg) in &self.chat_messages {
            let badge = match sender.as_str() {
                "User" => "👤 You",
                "Rivet" => "⚡ Rivet",
                "System" => "ℹ️  System",
                "Error" => "✖ Error",
                _ => "◆ Agent",
            };

            lines.push(format!("╭─ {} ─────────────────────────────────────────────────────────", badge));

            for l in msg.lines() {
                lines.push(format!("│  {}", l));
            }

            lines.push("╰────────────────────────────────────────────────────────────".to_string());
            lines.push(String::new());
        }
        lines
    }

    fn render_chat_stream(&self, f: &mut ratatui::Frame, area: Rect) {
        let plain_lines = self.get_chat_plain_lines();
        let total_lines = plain_lines.len() as u16;
        let view_height = area.height.saturating_sub(2);

        let scroll_offset = if self.auto_scroll_to_bottom {
            total_lines.saturating_sub(view_height)
        } else {
            self.chat_scroll.min(total_lines.saturating_sub(view_height))
        };

        // Determine selection boundaries if active
        let selection_range = match (self.selection_anchor, self.selection_cursor) {
            (Some(a), Some(c)) => {
                let (start, end) = if a.1 < c.1 || (a.1 == c.1 && a.0 <= c.0) {
                    (a, c)
                } else {
                    (c, a)
                };
                Some((start, end))
            }
            _ => None,
        };

        let mut rendered_lines = Vec::new();

        for (line_idx, plain_text) in plain_lines.iter().enumerate() {
            let is_selected_line = if let Some((start, end)) = selection_range {
                line_idx >= start.1 && line_idx <= end.1
            } else {
                false
            };

            if is_selected_line {
                let (start, end) = selection_range.unwrap();
                let char_len = plain_text.chars().count();

                let sel_start_col = if line_idx == start.1 {
                    visual_col_to_char_index(plain_text, start.0 as usize).min(char_len)
                } else {
                    0
                };

                let sel_end_col = if line_idx == end.1 {
                    visual_col_to_char_index(plain_text, end.0 as usize).min(char_len)
                } else {
                    char_len
                };

                let prefix: String = plain_text.chars().take(sel_start_col).collect();
                let selected: String = plain_text
                    .chars()
                    .skip(sel_start_col)
                    .take(sel_end_col.saturating_sub(sel_start_col))
                    .collect();
                let suffix: String = plain_text.chars().skip(sel_end_col).collect();

                let mut spans = Vec::new();
                if !prefix.is_empty() {
                    spans.push(Span::styled(prefix, Style::default().fg(Color::White)));
                }
                if !selected.is_empty() {
                    spans.push(Span::styled(
                        selected,
                        Style::default()
                            .bg(COLOR_SELECTION_BG)
                            .fg(COLOR_SELECTION_FG)
                            .add_modifier(Modifier::BOLD),
                    ));
                }
                if !suffix.is_empty() {
                    spans.push(Span::styled(suffix, Style::default().fg(Color::White)));
                }

                rendered_lines.push(Line::from(spans));
            } else {
                // Syntax and structural coloring for default view
                if plain_text.starts_with("╭─") {
                    let badge_color = if plain_text.contains("You") {
                        COLOR_WARNING
                    } else if plain_text.contains("Rivet") {
                        COLOR_SUCCESS
                    } else if plain_text.contains("System") {
                        COLOR_PRIMARY
                    } else if plain_text.contains("Error") {
                        COLOR_DANGER
                    } else {
                        COLOR_SECONDARY
                    };
                    rendered_lines.push(Line::from(vec![
                        Span::styled(
                            plain_text.chars().take(12).collect::<String>(),
                            Style::default().fg(badge_color).add_modifier(Modifier::BOLD),
                        ),
                        Span::styled(
                            plain_text.chars().skip(12).collect::<String>(),
                            Style::default().fg(COLOR_BORDER),
                        ),
                    ]));
                } else if plain_text.starts_with("╰─") {
                    rendered_lines.push(Line::from(Span::styled(
                        plain_text,
                        Style::default().fg(COLOR_BORDER),
                    )));
                } else if plain_text.starts_with("│  ```") {
                    rendered_lines.push(Line::from(Span::styled(
                        plain_text,
                        Style::default().fg(COLOR_SECONDARY).add_modifier(Modifier::BOLD),
                    )));
                } else if plain_text.contains("[✓]") || plain_text.contains("✅") {
                    rendered_lines.push(Line::from(Span::styled(
                        plain_text,
                        Style::default().fg(COLOR_SUCCESS),
                    )));
                } else if plain_text.contains("[ ]") || plain_text.contains("⚠️") {
                    rendered_lines.push(Line::from(Span::styled(
                        plain_text,
                        Style::default().fg(COLOR_WARNING),
                    )));
                } else {
                    rendered_lines.push(Line::from(Span::styled(
                        plain_text,
                        Style::default().fg(Color::White),
                    )));
                }
            }
        }

        let title = if selection_range.is_some() {
            " 💬 Cognitive Stream [🖱️ Selection Active • Release / Ctrl+C to Copy] "
        } else if self.auto_scroll_to_bottom {
            " 💬 Cognitive Stream [Live Auto-Scroll • Drag Mouse to Select Text] "
        } else {
            " 💬 Cognitive Stream [Scroll Paused - Press 'End' to Resume] "
        };

        let block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(COLOR_ACTIVE_BORDER))
            .title(title);

        let paragraph = Paragraph::new(rendered_lines)
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

    fn render_quick_sidebar(
        &self,
        f: &mut ratatui::Frame,
        area: Rect,
        hard: &noesis::HardState,
        soft: &noesis::SoftWorkspace,
        _phase: RunPhase,
    ) {
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
                Style::default().fg(COLOR_MUTED),
            )));
        } else {
            for (id, desc) in &hard.obligations {
                obl_items.push(ListItem::new(vec![
                    Line::from(vec![
                        Span::styled(" [ ] ", Style::default().fg(COLOR_WARNING)),
                        Span::styled(
                            format!("{}", id),
                            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                        ),
                    ]),
                    Line::from(Span::styled(
                        format!("     {}", desc),
                        Style::default().fg(COLOR_MUTED),
                    )),
                ]));
            }
        }

        let obl_block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(COLOR_BORDER))
            .title(format!(" 📋 Open Obligations ({}) ", hard.obligations.len()));
        f.render_widget(List::new(obl_items).block(obl_block), sidebar_layout[0]);

        // 2. Working Memory & Focus
        let mut mem_items = Vec::new();
        mem_items.push(ListItem::new(Span::styled(
            "Active Focus:",
            Style::default().fg(COLOR_WARNING).add_modifier(Modifier::BOLD),
        )));
        if soft.active_focus.is_empty() {
            mem_items.push(ListItem::new(Span::styled(
                "  • (Root Scope)",
                Style::default().fg(COLOR_MUTED),
            )));
        } else {
            for f_path in &soft.active_focus {
                mem_items.push(ListItem::new(Span::styled(
                    format!("  🔍 {}", f_path),
                    Style::default().fg(COLOR_PRIMARY),
                )));
            }
        }

        mem_items.push(ListItem::new(Span::styled(
            "\nHypotheses (Plastic Memory):",
            Style::default().fg(COLOR_SECONDARY).add_modifier(Modifier::BOLD),
        )));
        if soft.hypotheses.is_empty() {
            mem_items.push(ListItem::new(Span::styled(
                "  • (No active hypotheses)",
                Style::default().fg(COLOR_MUTED),
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
            .border_style(Style::default().fg(COLOR_BORDER))
            .title(" 🧠 Working Memory (Ctrl+B: Toggle) ");
        f.render_widget(List::new(mem_items).block(mem_block), sidebar_layout[1]);
    }

    fn render_obligations_tab(&self, f: &mut ratatui::Frame, area: Rect, hard: &noesis::HardState) {
        let split = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(area);

        // Left Panel: Open & Closed Obligations
        let mut obl_lines = Vec::new();
        obl_lines.push(Line::from(Span::styled(
            "=== OPEN OBLIGATIONS (UNVERIFIED) ===",
            Style::default().fg(COLOR_WARNING).add_modifier(Modifier::BOLD),
        )));
        obl_lines.push(Line::from(""));

        if hard.obligations.is_empty() {
            obl_lines.push(Line::from(Span::styled(
                "  (No open obligations in current task revision)",
                Style::default().fg(COLOR_MUTED),
            )));
        } else {
            for (id, desc) in &hard.obligations {
                obl_lines.push(Line::from(vec![
                    Span::styled(
                        " [ ] ",
                        Style::default().fg(COLOR_WARNING).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!("{}", id),
                        Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                    ),
                ]));
                obl_lines.push(Line::from(Span::styled(
                    format!("     Description: {}", desc),
                    Style::default().fg(Color::Rgb(200, 200, 220)),
                )));
                if let Some(scope) = hard.obligation_scopes.get(id) {
                    obl_lines.push(Line::from(Span::styled(
                        format!("     Scope: {} @ r{}", scope.repository, scope.revision.0),
                        Style::default().fg(COLOR_MUTED),
                    )));
                }
                obl_lines.push(Line::from(""));
            }
        }

        obl_lines.push(Line::from(Span::styled(
            "\n=== CLOSED OBLIGATIONS & RECEIPTS ===",
            Style::default().fg(COLOR_SUCCESS).add_modifier(Modifier::BOLD),
        )));
        obl_lines.push(Line::from(""));

        if hard.closed_obligations.is_empty() {
            obl_lines.push(Line::from(Span::styled(
                "  (No closed obligations yet)",
                Style::default().fg(COLOR_MUTED),
            )));
        } else {
            for (id, receipt_id) in &hard.closed_obligations {
                obl_lines.push(Line::from(vec![
                    Span::styled(
                        " [✓] ",
                        Style::default().fg(COLOR_SUCCESS).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!("{}", id),
                        Style::default().fg(COLOR_SUCCESS).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!(" (Receipt: {})", receipt_id),
                        Style::default().fg(COLOR_MUTED),
                    ),
                ]));
            }
        }

        let left_panel = Paragraph::new(obl_lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(COLOR_ACTIVE_BORDER))
                    .title(" 📋 Epistemic Obligations (ACID redb) "),
            )
            .scroll((self.obligations_scroll, 0))
            .wrap(Wrap { trim: false });
        f.render_widget(left_panel, split[0]);

        // Right Panel: Verified Claims & Verity Receipts
        let mut claim_lines = Vec::new();
        claim_lines.push(Line::from(Span::styled(
            "=== VERIFIED HARD CLAIMS ===",
            Style::default().fg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
        )));
        claim_lines.push(Line::from(""));

        if hard.claims.is_empty() {
            claim_lines.push(Line::from(Span::styled(
                "  (No verified claims recorded)",
                Style::default().fg(COLOR_MUTED),
            )));
        } else {
            for (id, claim) in &hard.claims {
                let status_color = match claim.status {
                    rivet_types::EpistemicStatus::Verified => COLOR_SUCCESS,
                    rivet_types::EpistemicStatus::Rejected => COLOR_DANGER,
                    _ => COLOR_WARNING,
                };

                claim_lines.push(Line::from(vec![
                    Span::styled(
                        format!(" • [{:?}] ", claim.status),
                        Style::default().fg(status_color),
                    ),
                    Span::styled(
                        format!("{}: ", id),
                        Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(&claim.proposition, Style::default().fg(COLOR_PRIMARY)),
                ]));
                claim_lines.push(Line::from(""));
            }
        }

        claim_lines.push(Line::from(Span::styled(
            "\n=== RECORDED EVIDENCE & RECEIPTS ===",
            Style::default().fg(COLOR_SECONDARY).add_modifier(Modifier::BOLD),
        )));
        claim_lines.push(Line::from(""));

        for (id, ev) in &hard.evidence {
            claim_lines.push(Line::from(vec![
                Span::styled(
                    format!(" 📦 {}: ", id),
                    Style::default().fg(COLOR_SECONDARY),
                ),
                Span::styled(ev, Style::default().fg(Color::White)),
            ]));
        }

        let right_panel = Paragraph::new(claim_lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(COLOR_BORDER))
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
        let split = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(area);

        // Left: Working Hypotheses & Unknown Clusters
        let mut left_lines = Vec::new();
        left_lines.push(Line::from(Span::styled(
            "=== PLASTIC WORKING MEMORY & HYPOTHESES ===",
            Style::default().fg(COLOR_SECONDARY).add_modifier(Modifier::BOLD),
        )));
        left_lines.push(Line::from(""));

        if soft.hypotheses.is_empty() {
            left_lines.push(Line::from(Span::styled(
                "  (No active hypotheses. Model operates with clear priors)",
                Style::default().fg(COLOR_MUTED),
            )));
        } else {
            for (i, hyp) in soft.hypotheses.iter().enumerate() {
                left_lines.push(Line::from(vec![
                    Span::styled(
                        format!("  {}. 💡 ", i + 1),
                        Style::default().fg(COLOR_WARNING),
                    ),
                    Span::styled(hyp, Style::default().fg(Color::White)),
                ]));
                left_lines.push(Line::from(""));
            }
        }

        left_lines.push(Line::from(Span::styled(
            "\n=== EPISTEMIC UNKNOWNS ===",
            Style::default().fg(COLOR_WARNING).add_modifier(Modifier::BOLD),
        )));
        left_lines.push(Line::from(""));

        if soft.unknowns.is_empty() {
            left_lines.push(Line::from(Span::styled(
                "  (No unresolved unknowns)",
                Style::default().fg(COLOR_MUTED),
            )));
        } else {
            for (i, u) in soft.unknowns.iter().enumerate() {
                left_lines.push(Line::from(vec![
                    Span::styled(format!("  {}. ❓ ", i + 1), Style::default().fg(COLOR_DANGER)),
                    Span::styled(u, Style::default().fg(Color::White)),
                ]));
            }
        }

        let left_panel = Paragraph::new(left_lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(COLOR_ACTIVE_BORDER))
                    .title(" 🧠 Soft Workspace (Plastic Epistemic RAM) "),
            )
            .scroll((self.workspace_scroll, 0))
            .wrap(Wrap { trim: false });
        f.render_widget(left_panel, split[0]);

        // Right: Model Invocations Log & Active Focus
        let mut right_lines = Vec::new();
        right_lines.push(Line::from(Span::styled(
            "=== ACTIVE REASONING FOCUS ===",
            Style::default().fg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
        )));
        right_lines.push(Line::from(""));

        for f_path in &soft.active_focus {
            right_lines.push(Line::from(Span::styled(
                format!("  🔍 {}", f_path),
                Style::default().fg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
            )));
        }

        right_lines.push(Line::from(Span::styled(
            "\n=== RECENT MODEL INVOCATIONS & AUDIT ===",
            Style::default().fg(COLOR_SUCCESS).add_modifier(Modifier::BOLD),
        )));
        right_lines.push(Line::from(""));

        if hard.model_invocations.is_empty() {
            right_lines.push(Line::from(Span::styled(
                "  (No model invocations logged in session)",
                Style::default().fg(COLOR_MUTED),
            )));
        } else {
            for inv in hard.model_invocations.iter().rev().take(10) {
                right_lines.push(Line::from(vec![
                    Span::styled(" 🤖 ", Style::default().fg(COLOR_SUCCESS)),
                    Span::styled(
                        format!("{} ", inv.model_id),
                        Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!(
                            "({}ms, in: {}, out: {})",
                            inv.latency_ms, inv.input_tokens, inv.output_tokens
                        ),
                        Style::default().fg(COLOR_MUTED),
                    ),
                ]));
                right_lines.push(Line::from(Span::styled(
                    format!("    Reason: {:?}", inv.reason),
                    Style::default().fg(COLOR_SECONDARY),
                )));
                right_lines.push(Line::from(""));
            }
        }

        let right_panel = Paragraph::new(right_lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(COLOR_BORDER))
                    .title(" 📊 Cognitive Audit & Latency Metrics "),
            )
            .scroll((self.workspace_scroll, 0))
            .wrap(Wrap { trim: false });
        f.render_widget(right_panel, split[1]);
    }

    fn render_census_tab(&self, f: &mut ratatui::Frame, area: Rect) {
        let mut lines = Vec::new();

        if let Some(ref census) = self.cached_census {
            lines.push(Line::from(vec![
                Span::styled(
                    "📊 Total Indexed Files: ",
                    Style::default().fg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("{} ", census.total_files),
                    Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                ),
                Span::styled("│ Total Size: ", Style::default().fg(COLOR_PRIMARY)),
                Span::styled(
                    format!("{:.2} MB ", census.total_bytes as f64 / 1_048_576.0),
                    Style::default().fg(COLOR_SUCCESS),
                ),
                Span::styled(
                    "│ Deferred Subtrees: ",
                    Style::default().fg(COLOR_PRIMARY),
                ),
                Span::styled(
                    format!("{}", census.deferred_count),
                    Style::default().fg(COLOR_WARNING),
                ),
            ]));
            lines.push(Line::from(""));

            lines.push(Line::from(Span::styled(
                "=== ACTIVE REPOSITORY FRONTIER (TOP RELEVANT FILES) ===",
                Style::default().fg(COLOR_SUCCESS).add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(""));

            for (i, entry) in census.active_frontier(32).iter().enumerate() {
                lines.push(Line::from(vec![
                    Span::styled(format!("  {:>2}. ", i + 1), Style::default().fg(COLOR_MUTED)),
                    Span::styled(
                        format!("{:<60}", entry.relative_path),
                        Style::default().fg(Color::White),
                    ),
                    Span::styled(
                        format!(" ({:.1} KB)", entry.size_bytes as f64 / 1024.0),
                        Style::default().fg(COLOR_MUTED),
                    ),
                ]));
            }

            lines.push(Line::from(Span::styled(
                "\n=== DIRECTORY RELEVANCE SIGNALS ===",
                Style::default().fg(COLOR_SECONDARY).add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(""));

            for dir in census.active_directory_frontier(16) {
                lines.push(Line::from(vec![
                    Span::styled("  📁 ", Style::default().fg(COLOR_PRIMARY)),
                    Span::styled(
                        format!("{:<40}", dir.relative_path),
                        Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!(
                            " files: {:<4} | size: {:<6} KB | signals: {:?}",
                            dir.file_count,
                            dir.total_bytes / 1024,
                            dir.signals
                        ),
                        Style::default().fg(COLOR_MUTED),
                    ),
                ]));
            }
        } else {
            lines.push(Line::from(Span::styled(
                "⏳ Running background deterministic census on repository...",
                Style::default().fg(COLOR_WARNING),
            )));
        }

        let panel = Paragraph::new(lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(COLOR_ACTIVE_BORDER))
                    .title(" 📊 Repository Census & Frontier (Press 'r' to Re-run) "),
            )
            .scroll((self.census_scroll, 0))
            .wrap(Wrap { trim: false });
        f.render_widget(panel, area);
    }

    fn render_input_box(&self, f: &mut ratatui::Frame, area: Rect) {
        let is_slash = self.input_editor.text.starts_with('/');
        let prompt_symbol = if is_slash { "⚡ / " } else { "❯ " };
        let prompt_color = if is_slash { COLOR_WARNING } else { COLOR_PRIMARY };

        let title = if is_slash {
            " Slash Command Mode (Tab/Enter: Select, ↑/↓: Navigate, Esc: Clear) "
        } else if self.is_processing {
            " Processing Request... (Press Ctrl+C to Cancel) "
        } else {
            " Prompt Input (Enter: Send, Ctrl+V: Paste, Ctrl+C: Copy/Cancel, /: Slash Menu, Ctrl+P: Providers, Ctrl+M: Models) "
        };

        let border_color = if is_slash {
            COLOR_WARNING
        } else if self.is_processing {
            COLOR_SECONDARY
        } else {
            COLOR_ACTIVE_BORDER
        };

        let block = Block::default()
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(border_color))
            .title(title);

        let prompt_width = UnicodeWidthStr::width(prompt_symbol) as u16;
        let inner_width = (area.width.saturating_sub(prompt_width + 2)) as usize;

        let char_count = self.input_editor.char_count();
        let scroll_char_offset = if char_count > inner_width {
            if self.input_editor.cursor >= inner_width {
                self.input_editor.cursor - inner_width + 1
            } else {
                0
            }
        } else {
            0
        };

        let visible_text: String = self
            .input_editor
            .text
            .chars()
            .skip(scroll_char_offset)
            .take(inner_width)
            .collect();

        let input_line = Line::from(vec![
            Span::styled(
                prompt_symbol,
                Style::default().fg(prompt_color).add_modifier(Modifier::BOLD),
            ),
            Span::styled(&visible_text, Style::default().fg(Color::White)),
        ]);

        let paragraph = Paragraph::new(input_line).block(block);
        f.render_widget(paragraph, area);

        // Precise Unicode cursor column offset calculation!
        let cursor_in_visible = self.input_editor.cursor.saturating_sub(scroll_char_offset);
        let visible_cursor_offset = char_index_to_visual_col(&visible_text, cursor_in_visible) as u16;
        let cursor_x = area.x + 1 + prompt_width + visible_cursor_offset;
        let cursor_y = area.y + 1;
        if cursor_x < area.x + area.width - 1 {
            f.set_cursor_position(Position::new(cursor_x, cursor_y));
        }
    }

    fn render_footer(&self, f: &mut ratatui::Frame, area: Rect) {
        let footer_spans = vec![
            Span::styled(
                " [Enter] ",
                Style::default().fg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
            ),
            Span::raw("Send  "),
            Span::styled(
                " [Ctrl+V] ",
                Style::default().fg(COLOR_SUCCESS).add_modifier(Modifier::BOLD),
            ),
            Span::raw("Paste  "),
            Span::styled(
                " [Ctrl+C] ",
                Style::default().fg(COLOR_SUCCESS).add_modifier(Modifier::BOLD),
            ),
            Span::raw("Copy  "),
            Span::styled(
                " [F1..F4] ",
                Style::default().fg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
            ),
            Span::raw("Tabs  "),
            Span::styled(
                " [Ctrl+B] ",
                Style::default().fg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
            ),
            Span::raw("Sidebar  "),
            Span::styled(
                " [Ctrl+P] ",
                Style::default().fg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
            ),
            Span::raw("Providers  "),
            Span::styled(
                " [Ctrl+M] ",
                Style::default().fg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
            ),
            Span::raw("Models  "),
            Span::styled(
                " [/] ",
                Style::default().fg(COLOR_WARNING).add_modifier(Modifier::BOLD),
            ),
            Span::raw("Commands  "),
            Span::styled(
                " [Esc] ",
                Style::default().fg(COLOR_DANGER).add_modifier(Modifier::BOLD),
            ),
            Span::raw("Quit"),
        ];
        f.render_widget(Paragraph::new(Line::from(footer_spans)), area);
    }

    fn render_slash_palette(&mut self, f: &mut ratatui::Frame, input_area: Rect, screen_size: Rect) {
        let matches = self.get_matching_slash_commands();
        if matches.is_empty() {
            self.layout_slash_palette = None;
            return;
        }

        let height = (matches.len() as u16 + 2).min(10);
        let width = (screen_size.width * 60 / 100).max(55).min(screen_size.width.saturating_sub(4));
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
                Style::default().fg(Color::Black).bg(COLOR_PRIMARY).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };

            items.push(ListItem::new(Line::from(vec![
                Span::styled(format!("{}{:<14}", prefix, cmd.name), style),
                Span::styled(format!(" {:<8} ", cmd.shortcut), Style::default().fg(COLOR_WARNING)),
                Span::styled(format!(" - {}", cmd.description), Style::default().fg(COLOR_MUTED)),
            ])));
        }

        let palette = List::new(items)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(COLOR_PRIMARY))
                    .title(" ⚡ Slash Commands (Tab/Enter/Click: Select, Esc: Close) "),
            )
            .highlight_style(Style::default().bg(COLOR_PRIMARY).fg(Color::Black));
        f.render_stateful_widget(palette, area, &mut self.slash_list_state);
    }

    fn render_modals(&mut self, f: &mut ratatui::Frame, size: Rect) {
        match &self.active_modal {
            ActiveModal::None => {
                self.layout_modal = None;
            }

            ActiveModal::ProviderMenu { search } => {
                let modal_area = centered_rect(75, 80, size);
                self.layout_modal = Some(modal_area);
                f.render_widget(Clear, modal_area);

                let auth_data = self.auth_store.load().unwrap_or_default();
                let known = get_known_providers();
                let query = search.text.to_lowercase();

                let mut items = Vec::new();

                // Section 1: Configured Providers
                items.push(ListItem::new(Span::styled(
                    "=== Configured Providers ===",
                    Style::default().fg(COLOR_WARNING).add_modifier(Modifier::BOLD),
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
                                Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                            ),
                            Span::styled(
                                format!(" (Key: {}){}", AuthStore::mask_key(info.api_key()), active_tag),
                                Style::default().fg(COLOR_SUCCESS),
                            ),
                        ]),
                        Line::from(Span::styled(
                            format!("      Endpoint: {} | Models: {}", endpoint, info.models().len()),
                            Style::default().fg(COLOR_MUTED),
                        )),
                    ]));
                }

                // Section 2: Catalog Providers
                items.push(ListItem::new(Span::styled(
                    "\n=== Available Providers to Connect ===",
                    Style::default().fg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
                )));

                for p in &known {
                    if !query.is_empty()
                        && !p.id.to_lowercase().contains(&query)
                        && !p.name.to_lowercase().contains(&query)
                    {
                        continue;
                    }
                    let is_configured = auth_data.providers.contains_key(&p.id);
                    let status = if is_configured { "[Re-configure]" } else { "[Connect]" };
                    let status_color = if is_configured { COLOR_SUCCESS } else { COLOR_WARNING };

                    items.push(ListItem::new(vec![
                        Line::from(vec![
                            Span::styled(format!("  + {:<24}", p.name), Style::default().fg(Color::White)),
                            Span::styled(format!(" {}", status), Style::default().fg(status_color)),
                        ]),
                        Line::from(Span::styled(
                            format!("      ID: {:<12} | {}", p.id, p.description),
                            Style::default().fg(COLOR_MUTED),
                        )),
                    ]));
                }

                let modal_layout = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([Constraint::Length(3), Constraint::Min(8)])
                    .split(modal_area);

                // Search Bar in Modal
                let search_box = Paragraph::new(format!(" 🔍 Filter: {}_", search.text)).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(COLOR_PRIMARY))
                        .title(" Search Providers (Ctrl+V: Paste) "),
                );
                f.render_widget(search_box, modal_layout[0]);

                let list = List::new(items)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .border_style(Style::default().fg(COLOR_PRIMARY))
                            .title(" 🌐 Provider Manager (Type to filter, ↑/↓: Scroll, Enter/Click: Select, Esc: Close) ")
                            .title_alignment(Alignment::Center),
                    )
                    .highlight_style(
                        Style::default().fg(Color::Black).bg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
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
                        Style::default().fg(COLOR_SUCCESS).add_modifier(Modifier::BOLD)
                    } else {
                        Style::default().fg(Color::White)
                    };

                    items.push(ListItem::new(Line::from(vec![
                        Span::styled(format!("  {}", m_id), style),
                        Span::styled(
                            format!(" ({}){}", self.active_config.provider, active_tag),
                            Style::default().fg(COLOR_MUTED),
                        ),
                    ])));
                }

                // Custom model option
                items.push(ListItem::new(Span::styled(
                    "  + Enter Custom Model ID...",
                    Style::default().fg(COLOR_WARNING).add_modifier(Modifier::BOLD),
                )));

                let modal_layout = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([Constraint::Length(3), Constraint::Min(6)])
                    .split(modal_area);

                let search_box = Paragraph::new(format!(" 🔍 Filter: {}_", search.text)).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(COLOR_PRIMARY))
                        .title(format!(" Search Models for '{}' (Ctrl+V: Paste) ", self.active_config.provider)),
                );
                f.render_widget(search_box, modal_layout[0]);

                let list = List::new(items)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .border_style(Style::default().fg(COLOR_PRIMARY))
                            .title(" 🎯 Model Picker (Type to filter, ↑/↓: Scroll, Enter/Click: Select, Esc: Close) ")
                            .title_alignment(Alignment::Center),
                    )
                    .highlight_style(
                        Style::default().fg(Color::Black).bg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
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
                        Style::default().fg(COLOR_WARNING).add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(Span::raw(prompt_label)),
                    Line::from(""),
                    Line::from(Span::styled(
                        format!(" > {}_", current_val),
                        Style::default().fg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(Span::styled(
                        "Press Enter to continue, Ctrl+V to paste, Esc to cancel",
                        Style::default().fg(COLOR_MUTED),
                    )),
                ];

                let dialog = Paragraph::new(lines).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(COLOR_PRIMARY))
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
                        Style::default().fg(COLOR_WARNING).add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(Span::raw(format!(
                        "Enter model identifier for provider '{}':",
                        self.active_config.provider
                    ))),
                    Line::from(""),
                    Line::from(Span::styled(
                        format!(" > {}_", editor.text),
                        Style::default().fg(COLOR_PRIMARY).add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(Span::styled(
                        "Press Enter to activate, Ctrl+V to paste, Esc to cancel",
                        Style::default().fg(COLOR_MUTED),
                    )),
                ];

                let dialog = Paragraph::new(lines).block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(COLOR_PRIMARY))
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

🖱️  MOUSE SELECTION & INTERACTIONS
  Left Click + Drag        - Select text in Cognitive Stream (Auto-copies on mouse release!)
  Right Click in Chat      - Quick copy selected text or latest assistant response
  Right Click in Input     - Paste clipboard directly into prompt box
  Click on Tab Bar         - Switch instantly to clicked workspace tab (Chat, Obligations, etc.)
  Click on Modals/Palette  - Select and execute provider, model, or slash command
  Click on Input Box       - Place cursor at clicked character column (Unicode width calculated)

📋  CLIPBOARD & COPY/PASTE
  Ctrl+C / Ctrl+Shift+C    - Copy selected chat text (or last assistant message) to clipboard
  Ctrl+V / Shift+Insert    - Paste clipboard text into active input or search box
  Ctrl+X                   - Cut current input text to clipboard
  /copy                    - Command to copy last response to system clipboard
  /copy-all                - Command to copy full chat transcript to system clipboard

⌨️  WORKSPACE & NAVIGATION
  F1, F2, F3, F4           - Switch between Workspaces (Chat, Obligations, Memory, Census)
  Alt+1, Alt+2, Alt+3, Alt+4 - Switch between Workspaces directly
  Ctrl+B                   - Toggle Quick Inspector Sidebar in Chat view
  PgUp / PgDn / MouseWheel - Scroll active stream or log
  Home / End               - Jump to top / Jump to bottom (Resume auto-scroll)
  Esc                      - Clear input or Exit dialogs

✍️  LINE EDITOR & PROMPT
  Left / Right             - Move cursor character by character
  Ctrl+Left / Ctrl+Right   - Jump word left / right
  Home / End               - Jump to beginning / end of line
  Delete / Backspace       - Delete forward / backward
  Ctrl+W / Alt+Backspace   - Delete word backward
  Ctrl+U                   - Clear entire input line
  Up / Down                - Navigate command & prompt history

🤖  MODELS & PROVIDERS
  Ctrl+P                   - Open Provider Manager with live search filter
  Ctrl+M                   - Open Model Picker with live search filter
  /connect [p] [key] [url] - Connect custom or local endpoint
  /goal <prompt>           - Compile and lock a formal GoalSpec & Obligation DAG
  /census                  - Re-run deterministic repository census
  /quit or :q              - Exit Rivet Cockpit
";

                let dialog = Paragraph::new(help_text)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .border_style(Style::default().fg(COLOR_PRIMARY))
                            .title(" 📖 Help & Keybindings (Esc/Click: Close, ↑/↓: Scroll) ")
                            .title_alignment(Alignment::Center),
                    )
                    .scroll((*scroll, 0));
                f.render_widget(dialog, modal_area);
            }
        }
    }

    // =========================================================================
    // EVENT & KEY HANDLING
    // =========================================================================

    fn handle_mouse_event(&mut self, mouse_event: MouseEvent) {
        let col = mouse_event.column;
        let row = mouse_event.row;

        match mouse_event.kind {
            MouseEventKind::Down(MouseButton::Left) => {
                // 1. Exact Hit-Testing for Tab Navigation Bar using precomputed tab boundaries
                if self.is_inside_rect(col, row, self.layout_tabs) {
                    for (tab, start_x, end_x) in &self.tab_bounds {
                        if col >= *start_x && col < *end_x {
                            self.active_tab = *tab;
                            self.set_toast(format!("⚡ Tab: {:?}", self.active_tab), COLOR_PRIMARY);
                            return;
                        }
                    }
                    return;
                }

                // 2. Check if clicking inside Slash Command Palette
                if let Some(slash_area) = self.layout_slash_palette {
                    if self.is_inside_rect(col, row, slash_area) {
                        let inner_y = row.saturating_sub(slash_area.y + 1) as usize;
                        let matches = self.get_matching_slash_commands();
                        if let Some(cmd) = matches.get(inner_y) {
                            self.input_editor.set_text(format!("/{} ", cmd.name));
                        }
                        return;
                    }
                }

                // 3. Check if clicking inside Active Modal
                if let Some(modal_area) = self.layout_modal {
                    if self.is_inside_rect(col, row, modal_area) {
                        // Let modal click navigate selections
                        let inner_y = row.saturating_sub(modal_area.y + 3) as usize;
                        self.modal_list_state.select(Some(inner_y));
                        return;
                    } else if self.active_modal != ActiveModal::None {
                        // Click outside modal closes it!
                        self.active_modal = ActiveModal::None;
                        return;
                    }
                }

                // 4. Check if clicking inside Input Box (exact Unicode visual column mapping)
                if self.is_inside_rect(col, row, self.layout_input) {
                    let is_slash = self.input_editor.text.starts_with('/');
                    let prompt_symbol = if is_slash { "⚡ / " } else { "❯ " };
                    let prompt_width = UnicodeWidthStr::width(prompt_symbol) as u16;
                    let inner_x = col.saturating_sub(self.layout_input.x + 1 + prompt_width) as usize;

                    let inner_width = (self.layout_input.width.saturating_sub(prompt_width + 2)) as usize;
                    let char_count = self.input_editor.char_count();
                    let scroll_char_offset = if char_count > inner_width {
                        if self.input_editor.cursor >= inner_width {
                            self.input_editor.cursor - inner_width + 1
                        } else {
                            0
                        }
                    } else {
                        0
                    };

                    let visible_text: String = self
                        .input_editor
                        .text
                        .chars()
                        .skip(scroll_char_offset)
                        .take(inner_width)
                        .collect();

                    let clicked_char_in_visible = visual_col_to_char_index(&visible_text, inner_x);
                    self.input_editor.cursor = (scroll_char_offset + clicked_char_in_visible).min(char_count);
                    return;
                }

                // 5. Check if clicking inside Footer
                if self.is_inside_rect(col, row, self.layout_footer) {
                    let rel_x = col.saturating_sub(self.layout_footer.x);
                    if rel_x < 15 {
                        // Send / Enter
                    } else if rel_x < 30 {
                        // Paste
                        self.paste_from_clipboard();
                    } else if rel_x < 45 {
                        // Copy
                        self.copy_selection_or_last();
                    }
                    return;
                }

                // 6. Check if clicking inside Chat Stream to start selection
                if self.active_tab == ActiveTab::Chat && self.is_inside_rect(col, row, self.layout_chat) {
                    let plain_lines = self.get_chat_plain_lines();
                    let total_lines = plain_lines.len() as u16;
                    let view_height = self.layout_chat.height.saturating_sub(2);
                    let scroll_offset = if self.auto_scroll_to_bottom {
                        total_lines.saturating_sub(view_height)
                    } else {
                        self.chat_scroll.min(total_lines.saturating_sub(view_height))
                    };

                    let inner_y = row.saturating_sub(self.layout_chat.y + 1);
                    let line_idx = (scroll_offset + inner_y) as usize;
                    let inner_x = col.saturating_sub(self.layout_chat.x + 1);

                    self.selection_anchor = Some((inner_x, line_idx));
                    self.selection_cursor = Some((inner_x, line_idx));
                    self.is_mouse_selecting = true;
                }
            }

            MouseEventKind::Drag(MouseButton::Left) => {
                if self.is_mouse_selecting && self.active_tab == ActiveTab::Chat {
                    let plain_lines = self.get_chat_plain_lines();
                    let total_lines = plain_lines.len() as u16;
                    let view_height = self.layout_chat.height.saturating_sub(2);
                    let scroll_offset = if self.auto_scroll_to_bottom {
                        total_lines.saturating_sub(view_height)
                    } else {
                        self.chat_scroll.min(total_lines.saturating_sub(view_height))
                    };

                    let inner_y = row.saturating_sub(self.layout_chat.y + 1);
                    let line_idx = (scroll_offset + inner_y) as usize;
                    let inner_x = col.saturating_sub(self.layout_chat.x + 1);

                    self.selection_cursor = Some((inner_x, line_idx));
                }
            }

            MouseEventKind::Up(MouseButton::Left) => {
                if self.is_mouse_selecting {
                    self.is_mouse_selecting = false;
                    // If a valid range was selected, auto-copy to clipboard!
                    if let (Some(a), Some(c)) = (self.selection_anchor, self.selection_cursor) {
                        if a != c {
                            if let Some(text) = self.extract_selected_text(a, c) {
                                if !text.trim().is_empty() {
                                    let char_count = text.chars().count();
                                    ClipboardHelper::set(&text);
                                    self.set_toast(
                                        format!("📋 Auto-copied {} characters to clipboard!", char_count),
                                        COLOR_SUCCESS,
                                    );
                                }
                            }
                        }
                    }
                }
            }

            MouseEventKind::Down(MouseButton::Right) => {
                // Right Click in Chat -> Copy selection or latest response
                if self.active_tab == ActiveTab::Chat && self.is_inside_rect(col, row, self.layout_chat) {
                    self.copy_selection_or_last();
                } else if self.is_inside_rect(col, row, self.layout_input) {
                    // Right Click in Input -> Paste clipboard
                    self.paste_from_clipboard();
                }
            }

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
            },

            _ => {}
        }
    }

    fn is_inside_rect(&self, col: u16, row: u16, rect: Rect) -> bool {
        col >= rect.x && col < rect.x + rect.width && row >= rect.y && row < rect.y + rect.height
    }

    fn extract_selected_text(&self, a: (u16, usize), c: (u16, usize)) -> Option<String> {
        let (start, end) = if a.1 < c.1 || (a.1 == c.1 && a.0 <= c.0) {
            (a, c)
        } else {
            (c, a)
        };

        let plain_lines = self.get_chat_plain_lines();
        let mut extracted_lines = Vec::new();

        for (line_idx, line) in plain_lines.iter().enumerate() {
            if line_idx >= start.1 && line_idx <= end.1 {
                let char_len = line.chars().count();
                let sel_start_col = if line_idx == start.1 {
                    visual_col_to_char_index(line, start.0 as usize).min(char_len)
                } else {
                    0
                };
                let sel_end_col = if line_idx == end.1 {
                    visual_col_to_char_index(line, end.0 as usize).min(char_len)
                } else {
                    char_len
                };

                let slice: String = line
                    .chars()
                    .skip(sel_start_col)
                    .take(sel_end_col.saturating_sub(sel_start_col))
                    .collect();

                // Clean decorative box characters when copying
                let cleaned = slice
                    .trim_start_matches("│  ")
                    .trim_start_matches("│ ")
                    .trim_start_matches("│");

                extracted_lines.push(cleaned.to_string());
            }
        }

        if extracted_lines.is_empty() {
            None
        } else {
            Some(extracted_lines.join("\n"))
        }
    }

    pub fn copy_selection_or_last(&mut self) {
        if let (Some(a), Some(c)) = (self.selection_anchor, self.selection_cursor) {
            if a != c {
                if let Some(text) = self.extract_selected_text(a, c) {
                    let char_count = text.chars().count();
                    ClipboardHelper::set(&text);
                    self.set_toast(
                        format!("📋 Copied selection ({} chars) to clipboard!", char_count),
                        COLOR_SUCCESS,
                    );
                    return;
                }
            }
        }

        // If no selection, copy the last assistant response
        if let Some((_, msg)) = self
            .chat_messages
            .iter()
            .rev()
            .find(|(s, _)| s == "Rivet" || s == "System")
        {
            let char_count = msg.chars().count();
            ClipboardHelper::set(msg);
            self.set_toast(
                format!("📋 Copied last response ({} chars) to clipboard!", char_count),
                COLOR_SUCCESS,
            );
        } else {
            self.set_toast("⚠️ No message available to copy", COLOR_WARNING);
        }
    }

    pub fn paste_from_clipboard(&mut self) {
        if let Some(text) = ClipboardHelper::get() {
            let char_count = text.chars().count();
            self.handle_paste_event(text);
            self.set_toast(
                format!("📋 Pasted {} characters from clipboard!", char_count),
                COLOR_SUCCESS,
            );
        } else {
            self.set_toast("⚠️ Clipboard is empty", COLOR_WARNING);
        }
    }

    async fn handle_key_event(&mut self, key: KeyEvent) {
        // 1. Modals Key Handling
        if self.active_modal != ActiveModal::None {
            self.handle_modal_key(key).await;
            return;
        }

        let is_ctrl = key.modifiers.contains(KeyModifiers::CONTROL) && !key.modifiers.contains(KeyModifiers::ALT);
        let is_alt = key.modifiers.contains(KeyModifiers::ALT) && !key.modifiers.contains(KeyModifiers::CONTROL);

        // 2. Global Hotkeys
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

        // 3. Clipboard Hotkeys: Ctrl+V (Paste), Ctrl+C (Copy/Cancel), Ctrl+X (Cut)
        if is_ctrl && key.code == KeyCode::Char('v') {
            self.paste_from_clipboard();
            return;
        }
        if key.modifiers.contains(KeyModifiers::SHIFT) && key.code == KeyCode::Insert {
            self.paste_from_clipboard();
            return;
        }

        if is_ctrl && key.code == KeyCode::Char('c') {
            if self.is_processing {
                self.is_processing = false;
                self.chat_messages
                    .push(("System".into(), "⚠️ Operation cancelled by user.".into()));
                self.set_toast("⚠️ Request cancelled", COLOR_WARNING);
            } else if self.selection_anchor.is_some() && self.selection_anchor != self.selection_cursor {
                self.copy_selection_or_last();
            } else if !self.input_editor.text.is_empty() {
                ClipboardHelper::set(&self.input_editor.text);
                self.set_toast("📋 Copied input text to clipboard", COLOR_SUCCESS);
            } else {
                self.copy_selection_or_last();
            }
            return;
        }

        if is_ctrl && key.code == KeyCode::Char('x') {
            if !self.input_editor.text.is_empty() {
                ClipboardHelper::set(&self.input_editor.text);
                self.input_editor.clear();
                self.set_toast("✂️ Cut input text to clipboard", COLOR_SUCCESS);
            }
            return;
        }

        if is_ctrl && key.code == KeyCode::Char('y') {
            self.copy_selection_or_last();
            return;
        }

        // 4. Tab Switching Hotkeys (F1..F4 or Alt+1..4)
        match key.code {
            KeyCode::F(1) => {
                self.active_tab = ActiveTab::Chat;
                self.set_toast("⚡ Workspace: Chat Stream", COLOR_PRIMARY);
                return;
            }
            KeyCode::F(2) => {
                self.active_tab = ActiveTab::Obligations;
                self.set_toast("⚡ Workspace: Obligations", COLOR_PRIMARY);
                return;
            }
            KeyCode::F(3) => {
                self.active_tab = ActiveTab::Workspace;
                self.set_toast("⚡ Workspace: Soft Memory", COLOR_PRIMARY);
                return;
            }
            KeyCode::F(4) => {
                self.active_tab = ActiveTab::Census;
                self.set_toast("⚡ Workspace: Repository Census", COLOR_PRIMARY);
                return;
            }
            _ => {}
        }

        if is_alt {
            match key.code {
                KeyCode::Char('1') => {
                    self.active_tab = ActiveTab::Chat;
                    self.set_toast("⚡ Workspace: Chat Stream", COLOR_PRIMARY);
                    return;
                }
                KeyCode::Char('2') => {
                    self.active_tab = ActiveTab::Obligations;
                    self.set_toast("⚡ Workspace: Obligations", COLOR_PRIMARY);
                    return;
                }
                KeyCode::Char('3') => {
                    self.active_tab = ActiveTab::Workspace;
                    self.set_toast("⚡ Workspace: Soft Memory", COLOR_PRIMARY);
                    return;
                }
                KeyCode::Char('4') => {
                    self.active_tab = ActiveTab::Census;
                    self.set_toast("⚡ Workspace: Repository Census", COLOR_PRIMARY);
                    return;
                }
                _ => {}
            }
        }

        // 5. Slash Command Palette Key Handling
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

        // 6. Scroll Keys (PageUp, PageDown, Home, End)
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
                }
                return;
            }
            KeyCode::End if is_ctrl => {
                self.auto_scroll_to_bottom = true;
                self.set_toast("⏬ Auto-scroll resumed", COLOR_PRIMARY);
                return;
            }
            _ => {}
        }

        // 7. Interactive Line Editor Handling
        match key.code {
            KeyCode::Esc => {
                if self.is_processing {
                    self.is_processing = false;
                    self.chat_messages
                        .push(("System".into(), "⚠️ In-flight action interrupted.".into()));
                } else if self.selection_anchor.is_some() {
                    self.selection_anchor = None;
                    self.selection_cursor = None;
                } else if !self.input_editor.text.is_empty() {
                    self.input_editor.clear();
                } else {
                    self.should_quit = true;
                }
            }
            KeyCode::Left if is_ctrl => {
                self.input_editor.move_word_left();
            }
            KeyCode::Right if is_ctrl => {
                self.input_editor.move_word_right();
            }
            KeyCode::Left => {
                self.input_editor.move_left();
            }
            KeyCode::Right => {
                self.input_editor.move_right();
            }
            KeyCode::Home => {
                self.input_editor.move_home();
            }
            KeyCode::End => {
                self.input_editor.move_end();
            }
            KeyCode::Backspace => {
                if is_ctrl || is_alt {
                    self.input_editor.delete_word_backward();
                } else {
                    self.input_editor.backspace();
                }
                self.slash_list_state.select(Some(0));
            }
            KeyCode::Delete => {
                self.input_editor.delete();
                self.slash_list_state.select(Some(0));
            }
            KeyCode::Char('w') if is_ctrl => {
                self.input_editor.delete_word_backward();
                self.slash_list_state.select(Some(0));
            }
            KeyCode::Char('u') if is_ctrl => {
                self.input_editor.clear();
                self.slash_list_state.select(Some(0));
            }
            KeyCode::Char('a') if is_ctrl => {
                self.input_editor.move_home();
            }
            KeyCode::Char('e') if is_ctrl => {
                self.input_editor.move_end();
            }
            KeyCode::Up if !self.history.is_empty() => {
                let new_idx = match self.history_idx {
                    Some(i) if i > 0 => i - 1,
                    Some(i) => i,
                    None => self.history.len().saturating_sub(1),
                };
                self.history_idx = Some(new_idx);
                if let Some(item) = self.history.get(new_idx) {
                    self.input_editor.set_text(item.clone());
                }
            }
            KeyCode::Down => {
                if let Some(i) = self.history_idx {
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
                }
            }
            KeyCode::Enter if !self.input_editor.text.trim().is_empty() && !self.is_processing => {
                let prompt = self.input_editor.text.trim().to_string();
                self.history.push(prompt.clone());
                self.history_idx = None;
                self.input_editor.clear();
                self.slash_list_state.select(Some(0));
                self.auto_scroll_to_bottom = true;
                self.selection_anchor = None;
                self.selection_cursor = None;

                if prompt.starts_with('/') || prompt.starts_with(':') {
                    self.handle_slash_command(&prompt).await;
                } else {
                    self.chat_messages.push(("User".into(), prompt.clone()));
                    self.is_processing = true;
                    self.processing_start = Some(Instant::now());

                    let harness = self.harness.clone();
                    let tx = self.event_tx.clone();
                    let prompt_clone = prompt.clone();
                    let goal_summary = format!("Session goal: {}", prompt_clone);

                    tokio::spawn(async move {
                        let res = harness.step(&goal_summary, &prompt_clone).await;
                        let mapped = res.map_err(|e| e.to_string());
                        let _ = tx.send(AppEvent::ModelResponse(mapped));
                    });
                }
            }
            KeyCode::Char(c) => {
                // Ignore raw control keystrokes unless it is AltGr (Ctrl+Alt)
                if !is_ctrl {
                    self.input_editor.insert(c);
                    self.slash_list_state.select(Some(0));
                }
            }
            _ => {}
        }
    }

    fn get_matching_slash_commands(&self) -> Vec<&'static SlashCommandDef> {
        if !self.input_editor.text.starts_with('/') {
            return Vec::new();
        }
        let needle = self.input_editor.text.trim_start_matches('/').to_lowercase();
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
        let models = ProviderRegistry::get_available_models(
            &self.active_config.provider,
            &self.auth_store,
        )
        .await;
        self.dynamic_models = models;
        self.active_modal = ActiveModal::ModelPicker {
            search: EditorState::new(),
        };
        self.modal_list_state.select(Some(0));
    }

    async fn handle_modal_key(&mut self, key: KeyEvent) {
        let is_ctrl = key.modifiers.contains(KeyModifiers::CONTROL) && !key.modifiers.contains(KeyModifiers::ALT);

        match &mut self.active_modal {
            ActiveModal::None => {}

            ActiveModal::ProviderMenu { search } => {
                let auth_data = self.auth_store.load().unwrap_or_default();
                let known = get_known_providers();
                let configured_count = auth_data.providers.len();
                let total_options = configured_count + known.len() + 2;

                if is_ctrl && key.code == KeyCode::Char('v') {
                    if let Some(text) = ClipboardHelper::get() {
                        search.insert_str(&text);
                    }
                    return;
                }

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
                                        base_url: EditorState::with_text("http://localhost:8000/v1"),
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
                    KeyCode::Char(c) if !is_ctrl => {
                        search.insert(c);
                    }
                    _ => {}
                }
            }

            ActiveModal::ModelPicker { search } => {
                let total_items = self.dynamic_models.len() + 1;

                if is_ctrl && key.code == KeyCode::Char('v') {
                    if let Some(text) = ClipboardHelper::get() {
                        search.insert_str(&text);
                    }
                    return;
                }

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
                    KeyCode::Char(c) if !is_ctrl => {
                        search.insert(c);
                    }
                    _ => {}
                }
            }

            ActiveModal::CustomModelPrompt { editor } => {
                if is_ctrl && key.code == KeyCode::Char('v') {
                    if let Some(text) = ClipboardHelper::get() {
                        editor.insert_str(&text);
                    }
                    return;
                }

                match key.code {
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
                    KeyCode::Char(c) if !is_ctrl => {
                        editor.insert(c);
                    }
                    _ => {}
                }
            }

            ActiveModal::ConnectWizard {
                step,
                provider_id,
                base_url,
                api_key,
            } => {
                if is_ctrl && key.code == KeyCode::Char('v') {
                    if let Some(text) = ClipboardHelper::get() {
                        match step {
                            ConnectWizardStep::ProviderId => provider_id.insert_str(&text),
                            ConnectWizardStep::BaseUrl => base_url.insert_str(&text),
                            ConnectWizardStep::ApiKey => api_key.insert_str(&text),
                        }
                    }
                    return;
                }

                match key.code {
                    KeyCode::Esc => {
                        self.active_modal = ActiveModal::None;
                    }
                    KeyCode::Char(c) if !is_ctrl => match step {
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
                }
            }

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
            "copy" | "cp" => {
                self.copy_selection_or_last();
            }
            "copy-all" => {
                let plain_lines = self.get_chat_plain_lines();
                let full_text = plain_lines.join("\n");
                let count = full_text.chars().count();
                ClipboardHelper::set(&full_text);
                self.set_toast(
                    format!("📋 Copied entire transcript ({} chars) to clipboard!", count),
                    COLOR_SUCCESS,
                );
            }
            "help" | "?" => {
                self.active_modal = ActiveModal::HelpDialog { scroll: 0 };
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
                } else {
                    self.chat_messages.push((
                        "System".into(),
                        "Usage: /connect <provider> <api_key> [base_url]".into(),
                    ));
                }
            }
            "goal" | "g" => {
                if parts.len() > 1 {
                    let goal_prompt = parts[1..].join(" ");
                    self.is_processing = true;
                    self.processing_start = Some(Instant::now());

                    let harness = self.harness.clone();
                    let tx = self.event_tx.clone();

                    tokio::spawn(async move {
                        let res = harness.initialize_goal(&goal_prompt).await;
                        let mapped = res
                            .map(|spec| {
                                format!(
                                    "🎯 Compiled GoalSpec '{}' with {} obligations.",
                                    spec.summary,
                                    spec.graph.nodes.len()
                                )
                            })
                            .map_err(|e| e.to_string());
                        let _ = tx.send(AppEvent::GoalResponse(mapped));
                    });
                } else {
                    self.chat_messages.push((
                        "System".into(),
                        "Usage: /goal <task description>".into(),
                    ));
                }
            }
            "census" => {
                self.trigger_background_census();
                self.chat_messages.push((
                    "System".into(),
                    "📊 Triggered background deterministic census. Check Tab 4 (Census).".into(),
                ));
            }
            "obligations" => {
                self.active_tab = ActiveTab::Obligations;
            }
            "claims" => {
                self.active_tab = ActiveTab::Obligations;
            }
            "clear" => {
                self.harness.soft_workspace.lock().await.hypotheses.clear();
                self.chat_messages.push((
                    "System".into(),
                    "🧹 Cleared working hypotheses in Soft Workspace.".into(),
                ));
            }
            "reframe" => {
                let mut soft = self.harness.soft_workspace.lock().await;
                soft.add_hypothesis(
                    "[Manual Reframed] Exploring alternative architecture invariants",
                );
                self.chat_messages.push((
                    "System".into(),
                    "🔄 Forced Hephaestus soft workspace reframing.".into(),
                ));
            }
            "quit" | "q" | "exit" => {
                self.should_quit = true;
            }
            unknown => {
                self.chat_messages.push((
                    "System".into(),
                    format!("Unknown command '/{}'. Type /help or press Tab for palette.", unknown),
                ));
            }
        }
    }

    async fn switch_provider(&mut self, provider: &str) {
        match ProviderRegistry::resolve(Some(provider), None, &self.auth_store) {
            Ok(resolved) => {
                self.active_config = resolved.clone();
                let _ = self.auth_store.set_active_provider(&resolved.provider);
                let _ = self.auth_store.set_active_model(&resolved.model_id);
                self.chat_messages.push((
                    "System".into(),
                    format!(
                        "🔄 Active provider switched to '{}' ({})",
                        resolved.provider, resolved.model_id
                    ),
                ));
                self.set_toast(
                    format!("🔄 Switched Provider: {}", resolved.provider),
                    COLOR_SUCCESS,
                );
            }
            Err(e) => {
                self.chat_messages
                    .push(("Error".into(), format!("Failed to resolve provider: {}", e)));
            }
        }
    }

    async fn switch_model(&mut self, model: &str) {
        let provider = self.active_config.provider.clone();
        match ProviderRegistry::resolve(Some(&provider), Some(model), &self.auth_store) {
            Ok(resolved) => {
                self.active_config = resolved.clone();
                let _ = self.auth_store.set_active_model(&resolved.model_id);
                self.chat_messages.push((
                    "System".into(),
                    format!(
                        "🔄 Active model switched to '{}' ({})",
                        resolved.model_id, resolved.provider
                    ),
                ));
                self.set_toast(
                    format!("🔄 Switched Model: {}", resolved.model_id),
                    COLOR_SUCCESS,
                );
            }
            Err(e) => {
                self.chat_messages
                    .push(("Error".into(), format!("Failed to resolve model: {}", e)));
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
