//! Antigravity credential storage in Windows Credential Manager.
//!
//! Reads and writes OAuth tokens from/to the Windows Credential Manager
//! under the target name "gemini:antigravity". The Gemini CLI keeps the
//! credential store current; after a token refresh we write updated
//! tokens back so the Gemini CLI stays in sync.

#![allow(unsafe_code)]

use anyhow::{Context, Result, anyhow};
use serde_json::Value;
use std::ffi::c_void;
use std::path::PathBuf;

const CREDENTIAL_TARGET: &str = "gemini:antigravity";
const CRED_TYPE_GENERIC: u32 = 1;
const CRED_PERSIST_ENTERPRISE: u32 = 3;
const ERROR_NOT_FOUND: i32 = 1168;

/// Antigravity OAuth material read from Windows Credential Manager.
#[derive(Clone, Debug, Default)]
pub struct AntigravityAuth {
    pub access_token: String,
    pub refresh_token: String,
    pub expiry: Option<chrono::DateTime<chrono::Utc>>,
    pub id_token: String,
    pub email: String,
}

/// Credential struct matching the Windows CREDENTIALW layout.
#[repr(C)]
struct Credential {
    flags: u32,
    cred_type: u32,
    target_name: *mut u16,
    comment: *mut u16,
    last_written: FileTime,
    credential_blob_size: u32,
    credential_blob: *mut u8,
    persist: u32,
    attribute_count: u32,
    attributes: *mut c_void,
    target_alias: *mut u16,
    user_name: *mut u16,
}

#[repr(C)]
struct FileTime {
    dw_low_date_time: u32,
    dw_high_date_time: u32,
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn CredReadW(
        target_name: *const u16,
        cred_type: u32,
        flags: u32,
        credential: *mut *mut Credential,
    ) -> i32;

    fn CredWriteW(credential: *const Credential, flags: u32) -> i32;

    fn CredFree(buffer: *const c_void);
}

/// Reports whether antigravity credentials exist in Windows Credential Manager.
pub fn credentials_available() -> bool {
    read_raw().is_some()
}

/// Returns the credential file path for fallback credentials.
fn credentials_file_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".antigravity").join(".credentials.json"))
}

/// Reads antigravity OAuth tokens from Windows Credential Manager or file fallback.
pub fn read_credentials() -> Result<AntigravityAuth> {
    if let Some(json) = read_raw() {
        return parse_credential_json(&json)
            .ok_or_else(|| anyhow!("Failed to parse antigravity credential JSON."));
    }
    if let Some(path) = credentials_file_path() {
        if path.exists() {
            let text = std::fs::read_to_string(&path)
                .with_context(|| format!("Could not read {}", path.display()))?;
            let text = text.trim_start_matches('\u{feff}');
            if let Some(auth) = parse_credential_json(text) {
                return Ok(auth);
            }
        }
    }
    Err(anyhow!(
        "Antigravity credentials not found in Windows Credential Manager or ~/.antigravity/.credentials.json."
    ))
}

/// Writes updated tokens back to Windows Credential Manager.
pub fn write_credentials(auth: &AntigravityAuth) -> Result<()> {
    let existing = read_raw()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());

    let mut token_obj = serde_json::Map::new();
    if let Some(ref existing_val) = existing {
        if let Some(token) = existing_val.get("token").and_then(|v| v.as_object()) {
            for (k, v) in token {
                token_obj.insert(k.clone(), v.clone());
            }
        }
    }

    token_obj.insert(
        "access_token".to_owned(),
        Value::String(auth.access_token.clone()),
    );
    token_obj.insert(
        "token_type".to_owned(),
        Value::String("Bearer".to_owned()),
    );

    if !auth.refresh_token.is_empty() {
        token_obj.insert(
            "refresh_token".to_owned(),
            Value::String(auth.refresh_token.clone()),
        );
    }

    if let Some(expiry) = auth.expiry {
        token_obj.insert(
            "expiry".to_owned(),
            Value::String(expiry.to_rfc3339()),
        );
    }

    if !auth.id_token.is_empty() {
        token_obj.insert(
            "id_token".to_owned(),
            Value::String(auth.id_token.clone()),
        );
    }

    let mut root = serde_json::Map::new();
    root.insert("token".to_owned(), Value::Object(token_obj));

    let auth_method = existing
        .as_ref()
        .and_then(|v| v.get("auth_method"))
        .and_then(|v| v.as_str())
        .unwrap_or("consumer")
        .to_owned();
    root.insert("auth_method".to_owned(), Value::String(auth_method));

    let json = Value::Object(root);
    let blob = serde_json::to_string(&json)?;
    write_raw(&blob)
}

/// Reads the raw credential blob from Windows Credential Manager.
fn read_raw() -> Option<String> {
    if !cfg!(target_os = "windows") {
        return None;
    }
    let target: Vec<u16> = CREDENTIAL_TARGET
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut credential_ptr: *mut Credential = std::ptr::null_mut();
    let ok = unsafe {
        CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential_ptr)
    };

    let error = if ok == 0 {
        Some(std::io::Error::last_os_error().raw_os_error().unwrap_or(0))
    } else {
        None
    };

    if credential_ptr.is_null() {
        if let Some(code) = error {
            if code == ERROR_NOT_FOUND {
                return None;
            }
        }
        return None;
    }

    let result = unsafe {
        let cred = &*credential_ptr;
        if cred.credential_blob_size == 0 || cred.credential_blob.is_null() {
            None
        } else {
            let blob = std::slice::from_raw_parts(
                cred.credential_blob,
                cred.credential_blob_size as usize,
            );
            let s = String::from_utf8(blob.to_vec()).ok()?;
            Some(s.trim_end_matches('\0').to_owned())
        }
    };

    unsafe { CredFree(credential_ptr as *const c_void) };
    result
}

/// Writes a raw value to Windows Credential Manager.
fn write_raw(value: &str) -> Result<()> {
    if !cfg!(target_os = "windows") {
        return Err(anyhow!("Windows Credential Manager is only available on Windows."));
    }
    let blob = value.as_bytes();
    let target: Vec<u16> = CREDENTIAL_TARGET
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let user_name: Vec<u16> = Vec::from("".encode_utf16().chain(std::iter::once(0)).collect::<Vec<_>>());

    let credential = Credential {
        flags: 0,
        cred_type: CRED_TYPE_GENERIC,
        target_name: target.as_ptr() as *mut u16,
        comment: std::ptr::null_mut(),
        last_written: FileTime {
            dw_low_date_time: 0,
            dw_high_date_time: 0,
        },
        credential_blob_size: blob.len() as u32,
        credential_blob: blob.as_ptr() as *mut u8,
        persist: CRED_PERSIST_ENTERPRISE,
        attribute_count: 0,
        attributes: std::ptr::null_mut(),
        target_alias: std::ptr::null_mut(),
        user_name: user_name.as_ptr() as *mut u16,
    };

    let ok = unsafe { CredWriteW(&credential, 0) };
    if ok == 0 {
        let error = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
        return Err(anyhow!("CredWriteW failed with error code {error}"));
    }
    Ok(())
}

/// Parses the credential manager JSON blob into an AntigravityAuth.
fn parse_credential_json(json: &str) -> Option<AntigravityAuth> {
    let value: Value = serde_json::from_str(json).ok()?;
    let token = value.get("token")?.as_object()?;
    let access_token = token.get("access_token")?.as_str()?;
    if access_token.is_empty() {
        return None;
    }
    let id_token = token
        .get("id_token")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_owned();
    let email = if !id_token.is_empty() {
        crate::infra::chatgpt::read_jwt_claim(&id_token, &["email"])
            .unwrap_or_default()
    } else {
        String::new()
    };
    Some(AntigravityAuth {
        access_token: access_token.to_owned(),
        refresh_token: token
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_owned(),
        expiry: token
            .get("expiry")
            .and_then(|v| v.as_str())
            .and_then(|s| {
                chrono::DateTime::parse_from_rfc3339(s)
                    .ok()
                    .map(|d| d.with_timezone(&chrono::Utc))
            }),
        id_token,
        email,
    })
}
