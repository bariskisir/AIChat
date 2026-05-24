//! Frontend events emitted by the Rust backend.

use super::view::AppSnapshot;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UiEvent {
    Snapshot {
        snapshot: Box<AppSnapshot>,
    },
    AssistantDelta {
        session_id: String,
        message_id: String,
        text: String,
    },
    SessionTitleUpdated {
        session_id: String,
        title: String,
    },
    Error {
        message: String,
    },
}
