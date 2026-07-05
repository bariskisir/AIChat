// Ensures frontend assets exist before Tauri packages the desktop application.
#![forbid(unsafe_code)]

use std::env;
use std::fs;
use std::path::Path;

/// Minimal page shown when the frontend index is missing.
const PLACEHOLDER_INDEX_HTML: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>AI Chat</title></head><body><p>Frontend not found. Check frontend/index.html.</p></body></html>";

fn main() {
    ensure_frontend_dist();
    tauri_build::build();
}

fn ensure_frontend_dist() {
    println!("cargo:rerun-if-changed=frontend/index.html");
    println!("cargo:rerun-if-changed=frontend/styles");
    println!("cargo:rerun-if-changed=frontend/src");

    let index = Path::new("frontend").join("index.html");
    if index.exists() {
        return;
    }

    if is_release_profile() {
        panic!("Missing frontend/index.html required for release packaging.");
    }

    fs::create_dir_all("frontend").expect("Could not create frontend");
    fs::write(&index, PLACEHOLDER_INDEX_HTML).expect("Could not create placeholder index.html");
}

fn is_release_profile() -> bool {
    env::var("PROFILE").is_ok_and(|profile| profile == "release")
}
