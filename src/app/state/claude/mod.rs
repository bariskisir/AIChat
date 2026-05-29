//! Claude-specific state integrations for auth, chat, and model refresh.

mod auth;
mod chat;
mod providers;

pub(in crate::app::state) use providers::is_claude_provider;
