//! System clipboard integration.

use anyhow::{Context, Result};

/// Writes text through arboard's safe cross-platform clipboard API.
pub fn write_text(text: &str) -> Result<()> {
    let mut clipboard = arboard::Clipboard::new().context("Could not open system clipboard")?;
    clipboard
        .set_text(text.to_owned())
        .context("Could not set clipboard text")
}
