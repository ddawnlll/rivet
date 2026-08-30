//! # rivet::tui
//!
//! Interactive Terminal Developer Cockpit for Rivet powered by Ratatui and Crossterm.

use std::io;
use std::sync::Arc;
use std::time::Duration;
use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Terminal,
};
use rivet_core::HarnessCore;

pub struct TuiApp {
    pub harness: Arc<HarnessCore>,
    pub input_buffer: String,
    pub chat_messages: Vec<(String, String)>, // (sender, text)
    pub should_quit: bool,
    pub is_processing: bool,
}

impl TuiApp {
    pub fn new(harness: Arc<HarnessCore>) -> Self {
        Self {
            harness,
            input_buffer: String::new(),
            chat_messages: vec![
                ("System".into(), "Welcome to the Rivet Epistemic Agent Cockpit.".into()),
                ("System".into(), "Type a goal or command below and press Enter. Press Esc or Ctrl+C to exit.".into()),
            ],
            should_quit: false,
            is_processing: false,
        }
    }

    pub async fn run(&mut self) -> anyhow::Result<()> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen)?;
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;

        while !self.should_quit {
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
                    rivet_core::RunPhase::Executing | rivet_core::RunPhase::Verifying => Color::Yellow,
                    _ => Color::Cyan,
                };

                let header_text = vec![
                    Line::from(vec![
                        Span::styled(" ⚡ RIVET AGENT COCKPIT ", Style::default().fg(Color::Black).bg(Color::Cyan).add_modifier(Modifier::BOLD)),
                        Span::raw(" | "),
                        Span::styled(format!("Phase: {:?}", phase), Style::default().fg(phase_color).add_modifier(Modifier::BOLD)),
                        Span::raw(" | "),
                        Span::styled(format!("Hard Revision: r{}", hard.revision.0), Style::default().fg(Color::Magenta)),
                    ]),
                ];
                let header = Paragraph::new(header_text).block(Block::default().borders(Borders::ALL).title("Status"));
                f.render_widget(header, main_layout[0]);

                // 2. Horizontal split: Left (Hard State & Obligations, 40%), Right (Soft Workspace & Chat, 60%)
                let body_layout = Layout::default()
                    .direction(Direction::Horizontal)
                    .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
                    .split(main_layout[1]);

                // Left Panel: Hard State & Obligations
                let mut hard_items = Vec::new();
                hard_items.push(ListItem::new(Span::styled("--- Open Obligations ---", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))));
                for (id, desc) in &hard.obligations {
                    hard_items.push(ListItem::new(Span::styled(format!(" [ ] {}: {}", id, desc), Style::default().fg(Color::White))));
                }
                if hard.obligations.is_empty() {
                    hard_items.push(ListItem::new(Span::styled(" (No open obligations)", Style::default().fg(Color::DarkGray))));
                }

                hard_items.push(ListItem::new(Span::styled("\n--- Closed Obligations & Receipts ---", Style::default().fg(Color::Green).add_modifier(Modifier::BOLD))));
                for (id, receipt_id) in &hard.closed_obligations {
                    hard_items.push(ListItem::new(Span::styled(format!(" [✓] {} (Receipt: {})", id, receipt_id), Style::default().fg(Color::Green))));
                }

                hard_items.push(ListItem::new(Span::styled("\n--- Verified Claims ---", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))));
                for (id, claim) in &hard.claims {
                    hard_items.push(ListItem::new(Span::styled(format!(" • {}: {}", id, claim.proposition), Style::default().fg(Color::Cyan))));
                }

                let left_panel = List::new(hard_items).block(Block::default().borders(Borders::ALL).title("📋 Noesis Hard State"));
                f.render_widget(left_panel, body_layout[0]);

                // Right Panel Split: Soft Workspace (40%) + Chat Log (60%)
                let right_layout = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([Constraint::Percentage(35), Constraint::Percentage(65)])
                    .split(body_layout[1]);

                // Soft Workspace
                let mut soft_items = Vec::new();
                soft_items.push(ListItem::new(Span::styled("Active Focus:", Style::default().fg(Color::LightYellow))));
                for f_path in &soft.active_focus {
                    soft_items.push(ListItem::new(Span::raw(format!("  🔍 {}", f_path))));
                }
                soft_items.push(ListItem::new(Span::styled("Working Hypotheses:", Style::default().fg(Color::LightBlue))));
                for hyp in &soft.hypotheses {
                    soft_items.push(ListItem::new(Span::styled(format!("  💡 {}", hyp), Style::default().fg(Color::LightCyan))));
                }
                let soft_panel = List::new(soft_items).block(Block::default().borders(Borders::ALL).title("🧠 Soft Workspace (Working Memory)"));
                f.render_widget(soft_panel, right_layout[0]);

                // Chat Log
                let mut chat_lines = Vec::new();
                for (sender, msg) in &self.chat_messages {
                    let color = if sender == "User" {
                        Color::Yellow
                    } else if sender == "System" {
                        Color::DarkGray
                    } else {
                        Color::Green
                    };
                    chat_lines.push(Line::from(vec![
                        Span::styled(format!("{}: ", sender), Style::default().fg(color).add_modifier(Modifier::BOLD)),
                        Span::raw(msg.clone()),
                    ]));
                }
                let chat_panel = Paragraph::new(chat_lines)
                    .block(Block::default().borders(Borders::ALL).title("💬 Cognitive Stream"))
                    .wrap(Wrap { trim: true });
                f.render_widget(chat_panel, right_layout[1]);

                // 3. Input Box
                let input = Paragraph::new(self.input_buffer.as_str())
                    .style(Style::default().fg(Color::White))
                    .block(Block::default().borders(Borders::ALL).title("Prompt Input (Press Enter to send)"));
                f.render_widget(input, main_layout[2]);
            })?;

            if event::poll(Duration::from_millis(50))? {
                if let Event::Key(key) = event::read()? {
                    match key.code {
                        KeyCode::Esc => {
                            self.should_quit = true;
                        }
                        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                            self.should_quit = true;
                        }
                        KeyCode::Enter => {
                            if !self.input_buffer.trim().is_empty() && !self.is_processing {
                                let prompt = self.input_buffer.drain(..).collect::<String>();
                                self.chat_messages.push(("User".into(), prompt.clone()));
                                self.is_processing = true;

                                // Run step
                                let harness = self.harness.clone();
                                let resp_res = harness.step("Interactive Cockpit Goal", &prompt).await;
                                match resp_res {
                                    Ok(res) => {
                                        self.chat_messages.push(("Rivet".into(), res));
                                    }
                                    Err(e) => {
                                        self.chat_messages.push(("Error".into(), format!("{}", e)));
                                    }
                                }
                                self.is_processing = false;
                            }
                        }
                        KeyCode::Char(c) => {
                            self.input_buffer.push(c);
                        }
                        KeyCode::Backspace => {
                            self.input_buffer.pop();
                        }
                        _ => {}
                    }
                }
            }
        }

        disable_raw_mode()?;
        execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
        terminal.show_cursor()?;
        Ok(())
    }
}
