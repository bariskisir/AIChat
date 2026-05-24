//! System clipboard integration.

use anyhow::Result;

#[cfg(target_os = "windows")]
use {
    anyhow::{Context, anyhow},
    std::{mem::size_of, ptr},
    windows::Win32::{
        Foundation::{HANDLE, HWND},
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock},
        },
    },
};

#[cfg(target_os = "windows")]
const CF_UNICODETEXT: u32 = 13;

/// Writes text to the system clipboard.
#[cfg(target_os = "windows")]
pub fn write_text(text: &str, hwnd: HWND) -> Result<()> {
    let mut utf16: Vec<u16> = text.encode_utf16().collect();
    utf16.push(0);

    unsafe {
        let handle = GlobalAlloc(GMEM_MOVEABLE, utf16.len() * size_of::<u16>())
            .context("Could not allocate clipboard memory")?;
        let locked = GlobalLock(handle);
        if locked.is_null() {
            return Err(anyhow!("Could not lock clipboard memory"));
        }

        ptr::copy_nonoverlapping(utf16.as_ptr(), locked.cast::<u16>(), utf16.len());
        let _ = GlobalUnlock(handle);

        OpenClipboard(Some(hwnd)).context("Could not open clipboard")?;
        let _guard = ClipboardGuard;
        EmptyClipboard().context("Could not empty clipboard")?;
        SetClipboardData(CF_UNICODETEXT, Some(HANDLE(handle.0)))
            .context("Could not set clipboard text")?;
    }

    Ok(())
}

/// Writes text to the system clipboard.
#[cfg(not(target_os = "windows"))]
pub fn write_text(_text: &str) -> Result<()> {
    anyhow::bail!("System clipboard copy is not implemented on this platform")
}

#[cfg(target_os = "windows")]
struct ClipboardGuard;

#[cfg(target_os = "windows")]
impl Drop for ClipboardGuard {
    /// Closes the Windows clipboard handle when the guard leaves scope.
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}
