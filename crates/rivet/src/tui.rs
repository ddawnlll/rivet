//! # rivet::tui
//!
//! Advanced Terminal Cockpit for Rivet inspired by OpenCode.
//! Full stateful scrolling, mouse wheel support, interactive command palette,
//! dedicated provider manager & connection wizard, dynamic model picker,
//! multi-panel focus switcher, rich code formatting, and animated progress.

use crossterm::{
    event::{
        self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyModifiers,
        MouseEventKind,
    },
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, Borders, Clear, List, ListItem, ListState, Paragraph, Scrollbar,
        ScrollbarOrientation, ScrollbarState, Wrap,
    },
    Terminal,
};
use rivet_core::HarnessCore;
use rivet_model::auth::AuthStore;
use rivet_model::provider_hub::{
    fetch_remote_models, get_known_providers, ProviderRegistry, ResolvedProviderConfig,
};
use rivet_repository::CensusRunner;
use std::io;
use std::sync::Arc;
use std::time::{Duration, Instant};

const SPINNER_FRAMES: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusedPanel {
    Input,
    Chat,
    HardState,
    SoftWorkspace,
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
        name: "obligations",
        shortcut: "",
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
        shortcut: "?",
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

#[derive(Debug, Clone, PartialEq, Eq)]
enum ActiveModal {
    None,
    ProviderMenu,
    ModelPicker,
    ConnectWizard {
        step: ConnectWizardStep,
        provider_id: String,
        base_url: String,
        api_key: String,
    },
    CustomModelPrompt {
        buffer: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ConnectWizardStep {
    ProviderId,
    BaseUrl,
    ApiKey,
}

pub struct TuiApp {
    pub harness: Arc<HarnessCore>,
    pub auth_store: AuthStore,
    pub active_config: ResolvedProviderConfig,
    pub input_buffer: String,
    pub chat_messages: Vec<(String, String)>,
    pub history: Vec<String>,
    pub history_idx: Option<usize>,
    pub should_quit: bool,
    pub is_processing: bool,
    pub processing_start: Option<Instant>,
    pub spinner_frame: usize,

    // Panel focus
    pub focused_panel: FocusedPanel,

    // Stateful scrolling
    pub chat_scroll: u16,
    pub auto_scroll_to_bottom: bool,
    pub hard_state_list: ListState,
    pub soft_workspace_list: ListState,

    // Modals and dialogs
    active_modal: ActiveModal,
    modal_list_state: ListState,
    slash_list_state: ListState,

    // Dynamic model list for current model dialog
    dynamic_models: Vec<String>,
}

impl TuiApp {
    pub fn new(
        harness: Arc<HarnessCore>,
        auth_store: AuthStore,
        active_config: ResolvedProviderConfig,
    ) -> Self {
        let status_desc = ProviderRegistry::format_status(&active_config);
        let mut hard_state_list = ListState::default();
        hard_state_list.select(Some(0));
        let mut soft_workspace_list = ListState::default();
        soft_workspace_list.select(Some(0));

        Self {
            harness,
            auth_store,
            active_config,
            input_buffer: String::new(),
            chat_messages: vec![
                (
                    "System".into(),
                    "⚡ Welcome to the Rivet Epistemic Agent Cockpit.".into(),
                ),
                (
                    "System".into(),
                    format!(
                        "Active {}.\nType '/' for slash commands, Ctrl+P for Providers, Ctrl+M for Models, Tab to switch panels.",
                        status_desc
                    ),
                ),
            ],
            history: Vec::new(),
            history_idx: None,
            should_quit: false,
            is_processing: false,
            processing_start: None,
            spinner_frame: 0,
            focused_panel: FocusedPanel::Input,
            chat_scroll: 0,
            auto_scroll_to_bottom: true,
            hard_state_list,
            soft_workspace_list,
            active_modal: ActiveModal::None,
            modal_list_state: ListState::default(),
            slash_list_state: ListState::default(),
            dynamic_models: Vec::new(),
        }
    }

    pub async fn run(&mut self) -> anyhow::Result<()> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;

        while !self.should_quit {
            self.spinner_frame = (self.spinner_frame + 1) % SPINNER_FRAMES.len();
            let hard = self.harness.hard_state.lock().await.clone();
            let soft = self.harness.soft_workspace.lock().await.clone();
            let phase = self.harness.current_phase().await;

            terminal.draw(|f| {
                let size = f.area();

                // Top level vertical split: Header (3), Main Body (rest - 3), Input (3)
                let main_layout = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3),
                        Constraint::Min(10),
                        Constraint::Length(3),
                    ])
                    .split(size);

                // 1. Header
                let phase_color = match phase {
                    rivet_core::RunPhase::Completed => Color::Green,
                    rivet_core::RunPhase::Stagnated => Color::LightRed,
                    rivet_core::RunPhase::Failed => Color::Red,
                    rivet_core::RunPhase::Executing
                    | rivet_core::RunPhase::Verifying
                    | rivet_core::RunPhase::InvokingModel => Color::Yellow,
                    _ => Color::Cyan,
                };

                let spinner_or_timer = if self.is_processing {
                    let elapsed = self.processing_start.map(|t| t.elapsed().as_secs_f32()).unwrap_or(0.0);
                    format!(" [{}] {:.1}s ", SPINNER_FRAMES[self.spinner_frame], elapsed)
                } else {
                    " ".to_string()
                };

                let provider_status = format!(
                    "{}:{}",
                    self.active_config.provider, self.active_config.model_id
                );

                let header_text = vec![Line::from(vec![
                    Span::styled(
                        " ⚡ RIVET COCKPIT ",
                        Style::default()
                            .fg(Color::Black)
                            .bg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(" | "),
                    Span::styled(
                        format!("Phase: {:?}{}", phase, spinner_or_timer),
                        Style::default().fg(phase_color).add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(" | "),
                    Span::styled(
                        format!("Provider: {}", provider_status),
                        Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(" | "),
                    Span::styled(
                        format!("Revision: r{}", hard.revision.0),
                        Style::default().fg(Color::Magenta),
                    ),
                    Span::raw(" | "),
                    Span::styled(
                        format!("Focus: {:?}", self.focused_panel),
                        Style::default().fg(Color::Yellow),
                    ),
                ])];
                let header = Paragraph::new(header_text)
                    .block(Block::default().borders(Borders::ALL).title("Status (Tab: Switch Focus, Mouse Scroll Supported)"));
                f.render_widget(header, main_layout[0]);

                // 2. Horizontal split: Left (Hard State, 36%), Right (Soft Workspace & Chat, 64%)
                let body_layout = Layout::default()
                    .direction(Direction::Horizontal)
                    .constraints([Constraint::Percentage(36), Constraint::Percentage(64)])
                    .split(main_layout[1]);

                // Left Panel: Hard State & Obligations (Scrollable Stateful List)
                let is_hard_focused = self.focused_panel == FocusedPanel::HardState;
                let hard_border_color = if is_hard_focused { Color::Yellow } else { Color::DarkGray };

                let mut hard_items = Vec::new();
                hard_items.push(ListItem::new(Span::styled(
                    "--- Open Obligations ---",
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
                )));
                for (id, desc) in &hard.obligations {
                    hard_items.push(ListItem::new(vec![
                        Line::from(vec![
                            Span::styled(" [ ] ", Style::default().fg(Color::Yellow)),
                            Span::styled(format!("{}", id), Style::default().fg(Color::White).add_modifier(Modifier::BOLD)),
                        ]),
                        Line::from(vec![
                            Span::raw(format!("     {}", desc)),
                        ]),
                    ]));
                }
                if hard.obligations.is_empty() {
                    hard_items.push(ListItem::new(Span::styled(
                        " (No open obligations)",
                        Style::default().fg(Color::DarkGray),
                    )));
                }

                hard_items.push(ListItem::new(Span::styled(
                    "\n--- Closed Obligations & Receipts ---",
                    Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
                )));
                for (id, receipt_id) in &hard.closed_obligations {
                    hard_items.push(ListItem::new(Span::styled(
                        format!(" [✓] {} (Receipt: {})", id, receipt_id),
                        Style::default().fg(Color::Green),
                    )));
                }

                hard_items.push(ListItem::new(Span::styled(
                    "\n--- Verified Claims ---",
                    Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
                )));
                for (id, claim) in &hard.claims {
                    hard_items.push(ListItem::new(Span::styled(
                        format!(" • {}: {}", id, claim.proposition),
                        Style::default().fg(Color::Cyan),
                    )));
                }

                let left_title = if is_hard_focused {
                    "📋 Noesis Hard State [FOCUSED - ↑/↓ Scroll]"
                } else {
                    "📋 Noesis Hard State (ACID redb)"
                };

                let left_panel = List::new(hard_items)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_style(Style::default().fg(hard_border_color))
                            .title(left_title),
                    )
                    .highlight_style(Style::default().bg(Color::Rgb(40, 40, 60)));
                f.render_stateful_widget(left_panel, body_layout[0], &mut self.hard_state_list);

                // Right Panel Split: Soft Workspace (32%) + Chat Log (68%)
                let right_layout = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([Constraint::Percentage(32), Constraint::Percentage(68)])
                    .split(body_layout[1]);

                // Soft Workspace Panel (Scrollable Stateful List)
                let is_soft_focused = self.focused_panel == FocusedPanel::SoftWorkspace;
                let soft_border_color = if is_soft_focused { Color::Yellow } else { Color::DarkGray };

                let mut soft_items = Vec::new();
                soft_items.push(ListItem::new(Span::styled(
                    "Active Focus:",
                    Style::default().fg(Color::LightYellow),
                )));
                for f_path in &soft.active_focus {
                    soft_items.push(ListItem::new(Span::raw(format!("  🔍 {}", f_path))));
                }
                soft_items.push(ListItem::new(Span::styled(
                    "Working Hypotheses (Plastic RAM):",
                    Style::default().fg(Color::LightBlue),
                )));
                for hyp in &soft.hypotheses {
                    soft_items.push(ListItem::new(Span::styled(
                        format!("  💡 {}", hyp),
                        Style::default().fg(Color::LightCyan),
                    )));
                }
                if soft.hypotheses.is_empty() {
                    soft_items.push(ListItem::new(Span::styled(
                        "  (No active hypotheses)",
                        Style::default().fg(Color::DarkGray),
                    )));
                }

                let soft_title = if is_soft_focused {
                    "🧠 Soft Workspace [FOCUSED - ↑/↓ Scroll]"
                } else {
                    "🧠 Soft Workspace (Working Memory)"
                };

                let soft_panel = List::new(soft_items)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_style(Style::default().fg(soft_border_color))
                            .title(soft_title),
                    )
                    .highlight_style(Style::default().bg(Color::Rgb(40, 40, 60)));
                f.render_stateful_widget(soft_panel, right_layout[0], &mut self.soft_workspace_list);

                // Chat Log Panel (Formatted Rich Text & Stateful Auto-scroll)
                let is_chat_focused = self.focused_panel == FocusedPanel::Chat;
                let chat_border_color = if is_chat_focused { Color::Yellow } else { Color::Cyan };

                let mut formatted_chat_lines = Vec::new();
                for (sender, msg) in &self.chat_messages {
                    let header_color = match sender.as_str() {
                        "User" => Color::Yellow,
                        "System" => Color::DarkGray,
                        "Error" => Color::Red,
                        _ => Color::Green,
                    };

                    formatted_chat_lines.push(Line::from(vec![
                        Span::styled(format!("╭── {} ", sender), Style::default().fg(header_color).add_modifier(Modifier::BOLD)),
                        Span::styled("────────────────────────────────", Style::default().fg(Color::DarkGray)),
                    ]));

                    for line in msg.lines() {
                        if line.starts_with("```") {
                            formatted_chat_lines.push(Line::from(Span::styled(line, Style::default().fg(Color::Magenta))));
                        } else if line.starts_with("  [✓]") || line.starts_with("✅") {
                            formatted_chat_lines.push(Line::from(Span::styled(format!("│ {}", line), Style::default().fg(Color::Green))));
                        } else if line.starts_with("  [ ]") || line.starts_with("⚠️") {
                            formatted_chat_lines.push(Line::from(Span::styled(format!("│ {}", line), Style::default().fg(Color::Yellow))));
                        } else if line.starts_with("---") {
                            formatted_chat_lines.push(Line::from(Span::styled(format!("│ {}", line), Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))));
                        } else {
                            formatted_chat_lines.push(Line::from(Span::styled(format!("│ {}", line), Style::default().fg(Color::White))));
                        }
                    }

                    formatted_chat_lines.push(Line::from(Span::styled("╰──────────────────────────────────", Style::default().fg(Color::DarkGray))));
                    formatted_chat_lines.push(Line::from(""));
                }

                let total_chat_lines = formatted_chat_lines.len() as u16;
                let chat_view_height = right_layout[1].height.saturating_sub(2);

                if self.auto_scroll_to_bottom {
                    self.chat_scroll = total_chat_lines.saturating_sub(chat_view_height);
                }

                let chat_title = if is_chat_focused {
                    if !self.auto_scroll_to_bottom {
                        "💬 Cognitive Stream [FOCUSED - ↑/↓/PgUp/PgDn: Scroll | End: Auto-scroll]"
                    } else {
                        "💬 Cognitive Stream [FOCUSED - Autoscroll Active]"
                    }
                } else if !self.auto_scroll_to_bottom {
                    "💬 Cognitive Stream (Scroll paused - Press End or Tab to Chat)"
                } else {
                    "💬 Cognitive Stream (/ for commands, Tab to focus)"
                };

                let chat_panel = Paragraph::new(formatted_chat_lines)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_style(Style::default().fg(chat_border_color))
                            .title(chat_title),
                    )
                    .scroll((self.chat_scroll, 0))
                    .wrap(Wrap { trim: false });
                f.render_widget(chat_panel, right_layout[1]);

                // Render Chat Scrollbar
                let mut scrollbar_state = ScrollbarState::default()
                    .content_length(total_chat_lines as usize)
                    .position(self.chat_scroll as usize);
                let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
                    .begin_symbol(Some("▲"))
                    .end_symbol(Some("▼"))
                    .track_symbol(Some("│"))
                    .thumb_symbol("█");
                f.render_stateful_widget(
                    scrollbar,
                    right_layout[1].inner(ratatui::layout::Margin { vertical: 1, horizontal: 0 }),
                    &mut scrollbar_state,
                );

                // 3. Input Box
                let is_input_focused = self.focused_panel == FocusedPanel::Input;
                let input_border_color = if is_input_focused { Color::Cyan } else { Color::DarkGray };
                let input_title = if self.input_buffer.starts_with('/') {
                    "Slash Command Mode (Tab/Enter: Select, Esc: Clear)"
                } else if is_input_focused {
                    "Prompt Input [FOCUSED - Enter: Send, /: Slash Menu, Ctrl+P: Providers, Ctrl+M: Models]"
                } else {
                    "Prompt Input (Press Tab to Focus)"
                };

                let input = Paragraph::new(self.input_buffer.as_str())
                    .style(Style::default().fg(Color::White))
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_style(Style::default().fg(input_border_color))
                            .title(input_title),
                    );
                f.render_widget(input, main_layout[2]);

                // 4. Floating Slash Command Auto-completion Palette (If input starts with `/`)
                let matching_slash = self.get_matching_slash_commands();
                if self.active_modal == ActiveModal::None && self.input_buffer.starts_with('/') && !matching_slash.is_empty() {
                    let palette_height = (matching_slash.len() as u16 + 2).min(10);
                    let palette_width = (size.width * 60 / 100).max(50).min(size.width);
                    let palette_x = main_layout[2].x + 2;
                    let palette_y = main_layout[2].y.saturating_sub(palette_height);
                    let palette_area = Rect::new(palette_x, palette_y, palette_width, palette_height);

                    f.render_widget(Clear, palette_area);

                    let mut items = Vec::new();
                    let selected_idx = self.slash_list_state.selected().unwrap_or(0);
                    for (i, cmd) in matching_slash.iter().enumerate() {
                        let is_selected = i == selected_idx;
                        let prefix = if is_selected { "▶ " } else { "  " };
                        let style = if is_selected {
                            Style::default()
                                .fg(Color::Black)
                                .bg(Color::Cyan)
                                .add_modifier(Modifier::BOLD)
                        } else {
                            Style::default().fg(Color::White)
                        };

                        items.push(ListItem::new(Line::from(vec![
                            Span::styled(format!("{}{:<12}", prefix, cmd.name), style),
                            Span::styled(format!(" {:<8} ", cmd.shortcut), Style::default().fg(Color::Yellow)),
                            Span::styled(format!(" - {}", cmd.description), Style::default().fg(Color::DarkGray)),
                        ])));
                    }

                    let palette = List::new(items)
                        .block(
                            Block::default()
                                .borders(Borders::ALL)
                                .title(" ⚡ Slash Commands (Tab/Enter: Select, ↑/↓: Navigate, Esc: Close) ")
                                .style(Style::default().fg(Color::Cyan)),
                        )
                        .highlight_style(Style::default().bg(Color::Cyan).fg(Color::Black));
                    f.render_stateful_widget(palette, palette_area, &mut self.slash_list_state);
                }

                // 5. Render Active Modal Dialogs (Stateful Scrolling)
                match &self.active_modal {
                    ActiveModal::None => {}
                    ActiveModal::ProviderMenu => {
                        let modal_area = centered_rect(70, 80, size);
                        f.render_widget(Clear, modal_area);

                        let auth_data = self.auth_store.load().unwrap_or_default();
                        let known = get_known_providers();

                        let mut items = Vec::new();

                        // Section 1: Configured Providers
                        items.push(ListItem::new(Span::styled(
                            "=== Configured & Active Providers ===",
                            Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
                        )));

                        for (p_id, info) in &auth_data.providers {
                            let is_active = self.active_config.provider == *p_id;
                            let active_tag = if is_active { " [ACTIVE]" } else { "" };
                            let endpoint = info.base_url().unwrap_or("Standard SDK Gateway");

                            items.push(ListItem::new(vec![
                                Line::from(vec![
                                    Span::styled(format!("  • {:<15}", p_id), Style::default().fg(Color::White).add_modifier(Modifier::BOLD)),
                                    Span::styled(format!(" (Key: {}){}", AuthStore::mask_key(info.api_key()), active_tag), Style::default().fg(Color::Green)),
                                ]),
                                Line::from(vec![
                                    Span::styled(format!("      Endpoint: {} | Models: {}", endpoint, info.models().len()), Style::default().fg(Color::DarkGray)),
                                ]),
                            ]));
                        }

                        if auth_data.providers.is_empty() {
                            items.push(ListItem::new(Span::styled(
                                "  (No providers configured yet)",
                                Style::default().fg(Color::DarkGray),
                            )));
                        }

                        // Section 2: All 25+ OpenCode Predefined Providers
                        items.push(ListItem::new(Span::styled(
                            "\n=== Available Providers to Connect (OpenCode Catalog) ===",
                            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
                        )));

                        for p in &known {
                            let is_configured = auth_data.providers.contains_key(&p.id);
                            let status = if is_configured { "[Re-configure]" } else { "[Connect]" };
                            let status_color = if is_configured { Color::Green } else { Color::Yellow };

                            items.push(ListItem::new(vec![
                                Line::from(vec![
                                    Span::styled(format!("  + {:<22}", p.name), Style::default().fg(Color::White)),
                                    Span::styled(format!(" {}", status), Style::default().fg(status_color)),
                                ]),
                                Line::from(vec![
                                    Span::styled(format!("      ID: {:<12} | {}", p.id, p.description), Style::default().fg(Color::DarkGray)),
                                ]),
                            ]));
                        }

                        let modal_list = List::new(items)
                            .block(
                                Block::default()
                                    .borders(Borders::ALL)
                                    .title(" 🌐 Provider Manager (↑/↓: Scroll, Enter: Select/Connect, Esc: Close) ")
                                    .title_alignment(Alignment::Center)
                                    .style(Style::default().fg(Color::Cyan)),
                            )
                            .highlight_style(
                                Style::default()
                                    .fg(Color::Black)
                                    .bg(Color::Cyan)
                                    .add_modifier(Modifier::BOLD),
                            );
                        f.render_stateful_widget(modal_list, modal_area, &mut self.modal_list_state);
                    }

                    ActiveModal::ModelPicker => {
                        let modal_area = centered_rect(65, 75, size);
                        f.render_widget(Clear, modal_area);

                        let mut items = Vec::new();
                        for m_id in &self.dynamic_models {
                            let is_active = self.active_config.model_id == *m_id;
                            let active_tag = if is_active { " [ACTIVE]" } else { "" };
                            let style = if is_active {
                                Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)
                            } else {
                                Style::default().fg(Color::White)
                            };

                            items.push(ListItem::new(Line::from(vec![
                                Span::styled(format!("  {}", m_id), style),
                                Span::styled(format!(" ({}){}", self.active_config.provider, active_tag), Style::default().fg(Color::DarkGray)),
                            ])));
                        }

                        // Option to type a custom model ID
                        items.push(ListItem::new(Line::from(vec![
                            Span::styled("  + Enter Custom Model ID...", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                        ])));

                        let modal_list = List::new(items)
                            .block(
                                Block::default()
                                    .borders(Borders::ALL)
                                    .title(format!(" 🎯 Models for '{}' (↑/↓: Scroll, Enter: Select, Esc: Close) ", self.active_config.provider))
                                    .title_alignment(Alignment::Center)
                                    .style(Style::default().fg(Color::Cyan)),
                            )
                            .highlight_style(
                                Style::default()
                                    .fg(Color::Black)
                                    .bg(Color::Cyan)
                                    .add_modifier(Modifier::BOLD),
                            );
                        f.render_stateful_widget(modal_list, modal_area, &mut self.modal_list_state);
                    }

                    ActiveModal::ConnectWizard { step, provider_id, base_url, api_key } => {
                        let modal_area = centered_rect(55, 30, size);
                        f.render_widget(Clear, modal_area);

                        let (step_title, prompt_label, current_val) = match step {
                            ConnectWizardStep::ProviderId => (
                                "Step 1/3: Provider Identifier",
                                "Enter unique Provider ID (e.g. my-vllm, lmstudio, cerebras):",
                                provider_id.as_str(),
                            ),
                            ConnectWizardStep::BaseUrl => (
                                "Step 2/3: Base URL Endpoint",
                                "Enter Base URL (e.g. http://localhost:8000/v1 or leave default):",
                                base_url.as_str(),
                            ),
                            ConnectWizardStep::ApiKey => (
                                "Step 3/3: API Key",
                                "Enter API Key (or 'none' for local):",
                                api_key.as_str(),
                            ),
                        };

                        let lines = vec![
                            Line::from(Span::styled(step_title, Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))),
                            Line::from(""),
                            Line::from(Span::raw(prompt_label)),
                            Line::from(""),
                            Line::from(Span::styled(format!(" > {}_", current_val), Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))),
                            Line::from(""),
                            Line::from(Span::styled("Press Enter to continue, Esc to cancel", Style::default().fg(Color::DarkGray))),
                        ];

                        let dialog = Paragraph::new(lines).block(
                            Block::default()
                                .borders(Borders::ALL)
                                .title(" 🔗 Connect Provider Wizard ")
                                .title_alignment(Alignment::Center)
                                .style(Style::default().fg(Color::Cyan)),
                        );
                        f.render_widget(dialog, modal_area);
                    }

                    ActiveModal::CustomModelPrompt { buffer } => {
                        let modal_area = centered_rect(50, 25, size);
                        f.render_widget(Clear, modal_area);

                        let lines = vec![
                            Line::from(Span::styled("Custom Model ID", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))),
                            Line::from(""),
                            Line::from(Span::raw(format!("Enter model name for provider '{}':", self.active_config.provider))),
                            Line::from(""),
                            Line::from(Span::styled(format!(" > {}_", buffer), Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))),
                            Line::from(""),
                            Line::from(Span::styled("Press Enter to set, Esc to cancel", Style::default().fg(Color::DarkGray))),
                        ];

                        let dialog = Paragraph::new(lines).block(
                            Block::default()
                                .borders(Borders::ALL)
                                .title(" 🎯 Custom Model Entry ")
                                .title_alignment(Alignment::Center)
                                .style(Style::default().fg(Color::Cyan)),
                        );
                        f.render_widget(dialog, modal_area);
                    }
                }
            })?;

            if event::poll(Duration::from_millis(50))? {
                let event = event::read()?;

                // Mouse wheel scrolling
                if let Event::Mouse(mouse_event) = event {
                    match mouse_event.kind {
                        MouseEventKind::ScrollUp => {
                            match self.active_modal {
                                ActiveModal::ProviderMenu | ActiveModal::ModelPicker => {
                                    let cur = self.modal_list_state.selected().unwrap_or(0);
                                    if cur > 0 {
                                        self.modal_list_state.select(Some(cur - 1));
                                    }
                                }
                                ActiveModal::None if self.chat_scroll > 0 => {
                                    self.chat_scroll = self.chat_scroll.saturating_sub(3);
                                    self.auto_scroll_to_bottom = false;
                                }
                                _ => {}
                            }
                        }
                        MouseEventKind::ScrollDown => {
                            match self.active_modal {
                                ActiveModal::ProviderMenu => {
                                    let auth_data = self.auth_store.load().unwrap_or_default();
                                    let known = get_known_providers();
                                    let total = auth_data.providers.len() + known.len() + 2;
                                    let cur = self.modal_list_state.selected().unwrap_or(0);
                                    if cur + 1 < total {
                                        self.modal_list_state.select(Some(cur + 1));
                                    }
                                }
                                ActiveModal::ModelPicker => {
                                    let total = self.dynamic_models.len() + 1;
                                    let cur = self.modal_list_state.selected().unwrap_or(0);
                                    if cur + 1 < total {
                                        self.modal_list_state.select(Some(cur + 1));
                                    }
                                }
                                ActiveModal::None => {
                                    self.chat_scroll = self.chat_scroll.saturating_add(3);
                                }
                                _ => {}
                            }
                        }
                        _ => {}
                    }
                    continue;
                }

                if let Event::Key(key) = event {
                    // 1. Modal key handling
                    if self.active_modal != ActiveModal::None {
                        self.handle_modal_key(key).await;
                        continue;
                    }

                    // 2. Global Hotkeys
                    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('p') {
                        self.open_provider_menu().await;
                        continue;
                    }
                    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('m') {
                        self.open_model_picker().await;
                        continue;
                    }

                    // 3. Tab navigation to switch focus between panels
                    if key.code == KeyCode::Tab && !self.input_buffer.starts_with('/') {
                        self.focused_panel = match self.focused_panel {
                            FocusedPanel::Input => FocusedPanel::Chat,
                            FocusedPanel::Chat => FocusedPanel::HardState,
                            FocusedPanel::HardState => FocusedPanel::SoftWorkspace,
                            FocusedPanel::SoftWorkspace => FocusedPanel::Input,
                        };
                        continue;
                    }
                    if key.code == KeyCode::BackTab {
                        self.focused_panel = match self.focused_panel {
                            FocusedPanel::Input => FocusedPanel::SoftWorkspace,
                            FocusedPanel::SoftWorkspace => FocusedPanel::HardState,
                            FocusedPanel::HardState => FocusedPanel::Chat,
                            FocusedPanel::Chat => FocusedPanel::Input,
                        };
                        continue;
                    }

                    // 4. Panel-specific scrolling when Chat / HardState / SoftWorkspace is focused
                    match self.focused_panel {
                        FocusedPanel::Chat => {
                            match key.code {
                                KeyCode::Up | KeyCode::Char('k') => {
                                    self.chat_scroll = self.chat_scroll.saturating_sub(1);
                                    self.auto_scroll_to_bottom = false;
                                    continue;
                                }
                                KeyCode::Down | KeyCode::Char('j') => {
                                    self.chat_scroll = self.chat_scroll.saturating_add(1);
                                    continue;
                                }
                                KeyCode::PageUp => {
                                    self.chat_scroll = self.chat_scroll.saturating_sub(10);
                                    self.auto_scroll_to_bottom = false;
                                    continue;
                                }
                                KeyCode::PageDown => {
                                    self.chat_scroll = self.chat_scroll.saturating_add(10);
                                    continue;
                                }
                                KeyCode::Home => {
                                    self.chat_scroll = 0;
                                    self.auto_scroll_to_bottom = false;
                                    continue;
                                }
                                KeyCode::End => {
                                    self.auto_scroll_to_bottom = true;
                                    continue;
                                }
                                KeyCode::Char('i') | KeyCode::Enter | KeyCode::Esc => {
                                    self.focused_panel = FocusedPanel::Input;
                                    continue;
                                }
                                _ => {}
                            }
                        }
                        FocusedPanel::HardState => {
                            match key.code {
                                KeyCode::Up | KeyCode::Char('k') => {
                                    let cur = self.hard_state_list.selected().unwrap_or(0);
                                    if cur > 0 {
                                        self.hard_state_list.select(Some(cur - 1));
                                    }
                                    continue;
                                }
                                KeyCode::Down | KeyCode::Char('j') => {
                                    let cur = self.hard_state_list.selected().unwrap_or(0);
                                    self.hard_state_list.select(Some(cur + 1));
                                    continue;
                                }
                                KeyCode::Char('i') | KeyCode::Enter | KeyCode::Esc => {
                                    self.focused_panel = FocusedPanel::Input;
                                    continue;
                                }
                                _ => {}
                            }
                        }
                        FocusedPanel::SoftWorkspace => {
                            match key.code {
                                KeyCode::Up | KeyCode::Char('k') => {
                                    let cur = self.soft_workspace_list.selected().unwrap_or(0);
                                    if cur > 0 {
                                        self.soft_workspace_list.select(Some(cur - 1));
                                    }
                                    continue;
                                }
                                KeyCode::Down | KeyCode::Char('j') => {
                                    let cur = self.soft_workspace_list.selected().unwrap_or(0);
                                    self.soft_workspace_list.select(Some(cur + 1));
                                    continue;
                                }
                                KeyCode::Char('i') | KeyCode::Enter | KeyCode::Esc => {
                                    self.focused_panel = FocusedPanel::Input;
                                    continue;
                                }
                                _ => {}
                            }
                        }
                        FocusedPanel::Input => {}
                    }

                    // 5. Slash command palette navigation when typing `/`
                    if self.input_buffer.starts_with('/') {
                        let matches = self.get_matching_slash_commands();
                        if !matches.is_empty() {
                            let cur = self.slash_list_state.selected().unwrap_or(0);
                            match key.code {
                                KeyCode::Tab => {
                                    if let Some(cmd) = matches.get(cur) {
                                        self.input_buffer = format!("/{} ", cmd.name);
                                    }
                                    continue;
                                }
                                KeyCode::Up if cur > 0 => {
                                    self.slash_list_state.select(Some(cur - 1));
                                    continue;
                                }
                                KeyCode::Down if cur + 1 < matches.len() => {
                                    self.slash_list_state.select(Some(cur + 1));
                                    continue;
                                }
                                _ => {}
                            }
                        }
                    }

                    // 6. Normal Input Box Handling
                    match key.code {
                        KeyCode::Esc => {
                            if self.input_buffer.starts_with('/') {
                                self.input_buffer.clear();
                            } else {
                                self.should_quit = true;
                            }
                        }
                        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                            self.should_quit = true;
                        }
                        KeyCode::PageUp => {
                            self.chat_scroll = self.chat_scroll.saturating_sub(10);
                            self.auto_scroll_to_bottom = false;
                        }
                        KeyCode::PageDown => {
                            self.chat_scroll = self.chat_scroll.saturating_add(10);
                        }
                        KeyCode::Up if !self.history.is_empty() => {
                            let new_idx = match self.history_idx {
                                Some(i) if i > 0 => i - 1,
                                Some(i) => i,
                                None => self.history.len().saturating_sub(1),
                            };
                            self.history_idx = Some(new_idx);
                            if let Some(item) = self.history.get(new_idx) {
                                self.input_buffer = item.clone();
                            }
                        }
                        KeyCode::Down => {
                            if let Some(i) = self.history_idx {
                                if i + 1 < self.history.len() {
                                    let new_idx = i + 1;
                                    self.history_idx = Some(new_idx);
                                    if let Some(item) = self.history.get(new_idx) {
                                        self.input_buffer = item.clone();
                                    }
                                } else {
                                    self.history_idx = None;
                                    self.input_buffer.clear();
                                }
                            }
                        }
                        KeyCode::Enter if !self.input_buffer.trim().is_empty() && !self.is_processing => {
                            let raw_prompt = self.input_buffer.drain(..).collect::<String>();
                            let prompt = raw_prompt.trim().to_string();
                            self.history.push(prompt.clone());
                            self.history_idx = None;
                            self.slash_list_state.select(Some(0));
                            self.auto_scroll_to_bottom = true;

                            if prompt.starts_with('/') || prompt.starts_with(':') {
                                self.handle_slash_command(&prompt).await;
                            } else {
                                self.chat_messages.push(("User".into(), prompt.clone()));
                                self.is_processing = true;
                                self.processing_start = Some(Instant::now());

                                let harness = self.harness.clone();
                                let goal_summary = format!("Session goal: {}", prompt);
                                let resp_res = harness.step(&goal_summary, &prompt).await;
                                match resp_res {
                                    Ok(res) => {
                                        self.chat_messages.push(("Rivet".into(), res));
                                    }
                                    Err(e) => {
                                        self.chat_messages.push((
                                            "Error".into(),
                                            format!("Model/execution error: {}", e),
                                        ));
                                    }
                                }
                                self.is_processing = false;
                                self.processing_start = None;
                            }
                        }
                        KeyCode::Char(c) => {
                            self.input_buffer.push(c);
                            self.slash_list_state.select(Some(0));
                        }
                        KeyCode::Backspace => {
                            self.input_buffer.pop();
                            self.slash_list_state.select(Some(0));
                        }
                        _ => {}
                    }
                }
            }
        }

        disable_raw_mode()?;
        execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
        terminal.show_cursor()?;
        Ok(())
    }

    fn get_matching_slash_commands(&self) -> Vec<&'static SlashCommandDef> {
        if !self.input_buffer.starts_with('/') {
            return Vec::new();
        }
        let needle = self.input_buffer.trim_start_matches('/').to_lowercase();
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
        self.active_modal = ActiveModal::ProviderMenu;
        self.modal_list_state.select(Some(1)); // start on first item
    }

    async fn open_model_picker(&mut self) {
        let models = ProviderRegistry::get_available_models(&self.active_config.provider, &self.auth_store).await;
        self.dynamic_models = models;
        self.active_modal = ActiveModal::ModelPicker;
        self.modal_list_state.select(Some(0));
    }

    async fn handle_modal_key(&mut self, key: event::KeyEvent) {
        match &mut self.active_modal {
            ActiveModal::None => {}
            ActiveModal::ProviderMenu => {
                let auth_data = self.auth_store.load().unwrap_or_default();
                let known = get_known_providers();
                let configured_count = auth_data.providers.len();
                let total_options = configured_count + known.len() + 2; // includes headers

                let cur = self.modal_list_state.selected().unwrap_or(1);
                match key.code {
                    KeyCode::Esc => {
                        self.active_modal = ActiveModal::None;
                    }
                    KeyCode::Up if cur > 1 => {
                        self.modal_list_state.select(Some(cur - 1));
                    }
                    KeyCode::Down if cur + 1 < total_options => {
                        self.modal_list_state.select(Some(cur + 1));
                    }
                    KeyCode::PageUp => {
                        self.modal_list_state.select(Some(cur.saturating_sub(5).max(1)));
                    }
                    KeyCode::PageDown => {
                        self.modal_list_state.select(Some((cur + 5).min(total_options.saturating_sub(1))));
                    }
                    KeyCode::Enter => {
                        // Offset: index 0 is header, 1..=configured_count are configured providers
                        // index (configured_count + 1) is header 2, rest are known providers
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
                                        provider_id: String::new(),
                                        base_url: "http://localhost:8000/v1".into(),
                                        api_key: String::new(),
                                    };
                                } else {
                                    let default_base = known_p.default_base_url.clone().unwrap_or_default();
                                    self.active_modal = ActiveModal::ConnectWizard {
                                        step: if known_p.requires_api_key {
                                            ConnectWizardStep::ApiKey
                                        } else {
                                            ConnectWizardStep::BaseUrl
                                        },
                                        provider_id: known_p.id.clone(),
                                        base_url: default_base,
                                        api_key: String::new(),
                                    };
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }

            ActiveModal::ModelPicker => {
                let total_items = self.dynamic_models.len() + 1; // +1 for custom model entry
                let cur = self.modal_list_state.selected().unwrap_or(0);
                match key.code {
                    KeyCode::Esc => {
                        self.active_modal = ActiveModal::None;
                    }
                    KeyCode::Up if cur > 0 => {
                        self.modal_list_state.select(Some(cur - 1));
                    }
                    KeyCode::Down if cur + 1 < total_items => {
                        self.modal_list_state.select(Some(cur + 1));
                    }
                    KeyCode::PageUp => {
                        self.modal_list_state.select(Some(cur.saturating_sub(6)));
                    }
                    KeyCode::PageDown => {
                        self.modal_list_state.select(Some((cur + 6).min(total_items.saturating_sub(1))));
                    }
                    KeyCode::Enter => {
                        if cur < self.dynamic_models.len() {
                            let chosen = self.dynamic_models[cur].clone();
                            self.switch_model(&chosen).await;
                            self.active_modal = ActiveModal::None;
                        } else {
                            // Custom model entry option
                            self.active_modal = ActiveModal::CustomModelPrompt {
                                buffer: String::new(),
                            };
                        }
                    }
                    _ => {}
                }
            }

            ActiveModal::CustomModelPrompt { buffer } => {
                match key.code {
                    KeyCode::Esc => {
                        self.active_modal = ActiveModal::None;
                    }
                    KeyCode::Enter => {
                        let custom_name = buffer.trim().to_string();
                        if !custom_name.is_empty() {
                            self.switch_model(&custom_name).await;
                        }
                        self.active_modal = ActiveModal::None;
                    }
                    KeyCode::Char(c) => {
                        buffer.push(c);
                    }
                    KeyCode::Backspace => {
                        buffer.pop();
                    }
                    _ => {}
                }
            }

            ActiveModal::ConnectWizard { step, provider_id, base_url, api_key } => {
                match key.code {
                    KeyCode::Esc => {
                        self.active_modal = ActiveModal::None;
                    }
                    KeyCode::Char(c) => match step {
                        ConnectWizardStep::ProviderId => provider_id.push(c),
                        ConnectWizardStep::BaseUrl => base_url.push(c),
                        ConnectWizardStep::ApiKey => api_key.push(c),
                    },
                    KeyCode::Backspace => match step {
                        ConnectWizardStep::ProviderId => { provider_id.pop(); }
                        ConnectWizardStep::BaseUrl => { base_url.pop(); }
                        ConnectWizardStep::ApiKey => { api_key.pop(); }
                    },
                    KeyCode::Enter => {
                        match step {
                            ConnectWizardStep::ProviderId => {
                                if !provider_id.trim().is_empty() {
                                    *step = ConnectWizardStep::BaseUrl;
                                }
                            }
                            ConnectWizardStep::BaseUrl => {
                                *step = ConnectWizardStep::ApiKey;
                            }
                            ConnectWizardStep::ApiKey => {
                                let p_id = provider_id.trim().to_lowercase();
                                let b_url = if base_url.trim().is_empty() { None } else { Some(base_url.trim()) };
                                let key_val = api_key.trim();

                                self.chat_messages.push((
                                    "System".into(),
                                    format!("Connecting provider '{}'...", p_id),
                                ));

                                // Dynamically discover remote models
                                let mut discovered_models = Vec::new();
                                if let Some(url) = b_url {
                                    let k = if key_val.is_empty() || key_val == "none" { None } else { Some(key_val) };
                                    if let Ok(models) = fetch_remote_models(url, k).await {
                                        discovered_models = models;
                                    }
                                }

                                let def_model = discovered_models.first().cloned();
                                let _ = self.auth_store.set_provider_config(
                                    &p_id,
                                    key_val,
                                    b_url,
                                    def_model.as_deref(),
                                    discovered_models.clone(),
                                );

                                self.chat_messages.push((
                                    "System".into(),
                                    format!(
                                        "✅ Provider '{}' connected (discovered {} models).",
                                        p_id, discovered_models.len()
                                    ),
                                ));

                                self.switch_provider(&p_id).await;
                                self.active_modal = ActiveModal::None;
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    async fn handle_slash_command(&mut self, cmd: &str) {
        let parts: Vec<&str> = cmd.split_whitespace().collect();
        let name = parts[0].trim_start_matches('/').trim_start_matches(':');

        match name {
            "help" | "?" => {
                let help_text = "\
--- RIVET COCKPIT KEYBINDINGS & COMMANDS ---
  Tab / Shift+Tab          - Switch active focus (Input -> Chat -> Hard State -> Soft Workspace)
  PgUp / PgDn / MouseWheel - Scroll active panel or Chat log
  Home / End               - Jump to top / Jump to bottom (resume auto-scroll)
  Ctrl+P                   - Open Provider Manager & Connection Dialog
  Ctrl+M                   - Open Model Picker & Dynamic Endpoint Catalog
  /provider [name]         - Switch active provider
  /model [model_id]        - Switch active model
  /connect [p] [key] [url] - Connect new provider / custom endpoint
  /goal <prompt>           - Compile and lock a formal GoalSpec & Obligation DAG
  /census                  - Run deterministic census on current project
  /obligations             - List open and closed obligations in Noesis
  /claims                  - List verified hard claims & receipts
  /reframe                 - Force Hephaestus cold-path stagnation reframing
  /clear                   - Clear soft workspace hypotheses
  /quit or :q              - Exit the Cockpit";
                self.chat_messages.push(("System".into(), help_text.into()));
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
                    let base_url = if parts.len() >= 4 { Some(parts[3]) } else { None };

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
                    match self.harness.initialize_goal(&goal_prompt).await {
                        Ok(spec) => {
                            self.chat_messages.push((
                                "System".into(),
                                format!(
                                    "🎯 Compiled GoalSpec '{}' with {} obligations.",
                                    spec.summary,
                                    spec.graph.nodes.len()
                                ),
                            ));
                        }
                        Err(e) => {
                            self.chat_messages.push((
                                "Error".into(),
                                format!("Goal compilation failed: {}", e),
                            ));
                        }
                    }
                } else {
                    self.chat_messages.push((
                        "System".into(),
                        "Usage: /goal <task description>".into(),
                    ));
                }
            }
            "census" => {
                let target = std::path::Path::new(".");
                match CensusRunner::run_census(target).await {
                    Ok(census) => {
                        self.chat_messages.push((
                            "System".into(),
                            format!(
                                "📊 Census: {} total files, {:.2} MB, {} deferred trees.",
                                census.total_files,
                                census.total_bytes as f64 / 1_048_576.0,
                                census.deferred_count
                            ),
                        ));
                    }
                    Err(e) => {
                        self.chat_messages.push((
                            "Error".into(),
                            format!("Census failed: {}", e),
                        ));
                    }
                }
            }
            "obligations" => {
                let hard = self.harness.hard_state.lock().await;
                let mut report = format!("--- Open Obligations ({}) ---\n", hard.obligations.len());
                for (id, desc) in &hard.obligations {
                    report.push_str(&format!("  [ ] {}: {}\n", id, desc));
                }
                report.push_str(&format!(
                    "\n--- Closed Obligations ({}) ---\n",
                    hard.closed_obligations.len()
                ));
                for (id, receipt) in &hard.closed_obligations {
                    report.push_str(&format!("  [✓] {} (Receipt: {})\n", id, receipt));
                }
                self.chat_messages.push(("System".into(), report));
            }
            "claims" => {
                let hard = self.harness.hard_state.lock().await;
                let mut report = format!("--- Verified Hard Claims ({}) ---\n", hard.claims.len());
                for (id, claim) in &hard.claims {
                    report.push_str(&format!("  • [{}] {}: {}\n", claim.status, id, claim.proposition));
                }
                self.chat_messages.push(("System".into(), report));
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
                soft.add_hypothesis("[Manual Reframed] Exploring alternative architecture invariants");
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
                    format!("🔄 Active provider switched to '{}' ({})", resolved.provider, resolved.model_id),
                ));
            }
            Err(e) => {
                self.chat_messages.push(("Error".into(), format!("Failed to resolve provider: {}", e)));
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
                    format!("🔄 Active model switched to '{}' ({})", resolved.model_id, resolved.provider),
                ));
            }
            Err(e) => {
                self.chat_messages.push(("Error".into(), format!("Failed to resolve model: {}", e)));
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
