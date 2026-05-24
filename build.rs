// Ensures frontend assets exist before Tauri packages the desktop application.
use std::env;
use std::fs;
use std::path::Path;

const PLACEHOLDER_APP_JS: &str = "console.warn('Run npm install && npm run build in frontend.');";

/// Ensures `cargo run` can compile even when the Tauri CLI did not run
/// `beforeBuildCommand` first.
fn main() {
    ensure_frontend_dist();
    tauri_build::build();
}

/// Verifies release assets and creates lightweight dev fallbacks when needed.
fn ensure_frontend_dist() {
    println!("cargo:rerun-if-changed=frontend/index.html");
    println!("cargo:rerun-if-changed=frontend/styles.css");
    println!("cargo:rerun-if-changed=frontend/scripts/prepare-dist.mjs");
    println!("cargo:rerun-if-changed=frontend/src");
    println!("cargo:rerun-if-changed=frontend/package-lock.json");
    println!("cargo:rerun-if-changed=icons/icon.png");

    let dist = Path::new("frontend").join("dist");
    let dist_app = dist.join("app.js");
    let dist_index = dist.join("index.html");
    let dist_styles = dist.join("styles.css");
    let dist_icon = dist.join("icon.png");
    if frontend_dist_is_complete(&dist) {
        return;
    }

    if is_release_profile() {
        panic!(
            "Frontend assets are not ready for release packaging: {}. Run `npm install` and `npm run build` in frontend.",
            frontend_dist_problem(&dist)
        );
    }

    fs::create_dir_all(&dist).expect("Could not create frontend/dist");
    copy_asset("frontend/index.html", &dist_index);
    copy_asset("frontend/styles.css", &dist_styles);
    copy_asset("icons/icon.png", &dist_icon);

    if !dist_app.exists() {
        fs::write(&dist_app, PLACEHOLDER_APP_JS)
            .expect("Could not create placeholder frontend/dist/app.js");
    }
}

/// Reports whether Cargo is building an optimized release artifact.
fn is_release_profile() -> bool {
    env::var("PROFILE").is_ok_and(|profile| profile == "release")
}

/// Checks whether all frontend files referenced by the app shell exist.
fn frontend_dist_is_complete(dist: &Path) -> bool {
    dist.join("app.js").exists()
        && dist.join("index.html").exists()
        && dist.join("styles.css").exists()
        && dist.join("icon.png").exists()
}

/// Describes why the frontend distribution cannot be packaged.
fn frontend_dist_problem(dist: &Path) -> String {
    let missing = ["app.js", "index.html", "styles.css", "icon.png"]
        .into_iter()
        .filter(|file| !dist.join(file).exists())
        .collect::<Vec<_>>();

    if missing.is_empty() {
        "unknown frontend build problem".to_owned()
    } else {
        format!("missing {}", missing.join(", "))
    }
}

/// Copies a required static asset into the frontend distribution directory.
fn copy_asset(source: impl AsRef<Path>, destination: &Path) {
    let source = source.as_ref();
    fs::copy(source, destination).unwrap_or_else(|error| {
        panic!(
            "Could not copy {} to {}: {}. Run `npm install` and `npm run build` in frontend.",
            source.display(),
            destination.display(),
            error
        )
    });
}
