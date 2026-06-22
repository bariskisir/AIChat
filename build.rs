// Ensures frontend assets exist before Tauri packages the desktop application.
#![forbid(unsafe_code)]

use std::env;
use std::fs;
use std::path::Path;

/// Minimal page shown when `cargo run` is used before the Vite build has run.
const PLACEHOLDER_INDEX_HTML: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>AI Chat</title></head><body><p>Frontend not built. Run <code>npm install &amp;&amp; npm run build</code> in <code>frontend</code>.</p></body></html>";

/// Ensures `cargo run` can compile even when the Tauri CLI did not run
/// `beforeBuildCommand` first.
fn main() {
    ensure_frontend_dist();
    tauri_build::build();
}

/// Verifies the Vite build output exists and creates a dev fallback when needed.
fn ensure_frontend_dist() {
    println!("cargo:rerun-if-changed=frontend/index.html");
    println!("cargo:rerun-if-changed=frontend/styles");
    println!("cargo:rerun-if-changed=frontend/src");
    println!("cargo:rerun-if-changed=frontend/vite.config.mjs");
    println!("cargo:rerun-if-changed=frontend/package-lock.json");

    let dist = Path::new("frontend").join("dist");
    let dist_index = dist.join("index.html");
    if dist_index.exists() {
        return;
    }

    if is_release_profile() {
        panic!(
            "Frontend assets are not ready for release packaging: missing frontend/dist/index.html. Run `npm install` and `npm run build` in frontend."
        );
    }

    // Dev fallback: let the desktop window load a notice instead of failing.
    fs::create_dir_all(&dist).expect("Could not create frontend/dist");
    fs::write(&dist_index, PLACEHOLDER_INDEX_HTML)
        .expect("Could not create placeholder frontend/dist/index.html");
}

/// Reports whether Cargo is building an optimized release artifact.
fn is_release_profile() -> bool {
    env::var("PROFILE").is_ok_and(|profile| profile == "release")
}
