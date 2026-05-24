# AGENTS.md

## Project Overview

ChatGPT Codex is a Windows-focused Tauri 2 desktop chat app. The Rust backend manages shared app state, local JSON storage, OAuth login, ChatGPT Codex model/usage calls, response streaming, clipboard integration, logging, and Tauri commands. The TypeScript frontend is a namespace-based UI that renders sessions, markdown-capable assistant messages, account/catalog status, model controls, pasted images, resize controls, and typed Tauri command calls.

## Repository Layout

- `src/main.rs`: Tauri startup, command registration, and window setup.
- `src/app`: application state modules, frontend snapshots, Tauri command handlers, and UI events.
- `src/app/state`: focused state behavior modules for auth, catalog refresh, chat streaming, sessions, and settings.
- `src/app/view.rs`: frontend-facing `AppSnapshot`, account/catalog snapshots, settings input, and chat send request types.
- `src/domain`: serializable settings, auth/catalog storage models, chat sessions/messages, defaults, and domain helpers.
- `src/infra`: persistence, paths, logging, shell helpers, clipboard, and ChatGPT HTTP helpers.
- `frontend/src`: browser-side TypeScript namespaces compiled by `tsc`.
- `frontend/src/api.ts`: typed wrappers for all Tauri commands; frontend code should call commands through this namespace.
- `frontend/src/render.ts`: DOM rendering for snapshots, sessions, messages, controls, and streaming updates.
- `frontend/src/markdown.ts`: safe DOM-based Markdown rendering for assistant messages; do not render raw HTML.
- `frontend/src/composer.ts`, `resize.ts`, `clipboard.ts`, and `message-utils.ts`: focused UI behavior helpers.
- `frontend/index.html` and `frontend/styles.css`: desktop UI shell and styling.
- `frontend/scripts/prepare-dist.mjs`: copies frontend assets into `frontend/dist`.
- `capabilities/default.json`: packaged capability metadata.
- `vendor/typeid`: local crate patch; do not edit unless the dependency patch itself is the task.

## Build Commands

- Frontend build: `cd frontend && npm.cmd run build`
- Rust/Tauri build check: `cargo build`
- Run in development: `cargo run`

The Rust build script also tries to ensure `frontend/dist` exists. If TypeScript or frontend assets changed, run the frontend build before `cargo build`.

## Coding Conventions

- Keep every source file topped with a short file-purpose comment.
- Keep a short behavior comment directly above each Rust `fn` and TypeScript `function`.
- Prefer existing module boundaries:
  - user-facing state changes belong in the matching `src/app/state/*` module;
  - shared state structure and snapshot assembly belong in `src/app/state/mod.rs`;
  - frontend-facing DTOs belong in `src/app/view.rs`;
  - Tauri command wrappers belong under `src/app/commands`;
  - serializable models, defaults, and pure domain helpers belong in `src/domain`;
  - OS, storage, network, and ChatGPT integration details belong in `src/infra`.
- Rust errors should use `anyhow::Result` internally and convert to `String` only at Tauri command boundaries.
- Frontend code uses global namespaces and triple-slash references, not ES module imports.
- Keep frontend state in `AppContext.model`; render snapshot and streaming changes through `Renderer`.
- Call backend commands through the typed `Api` namespace, not raw command strings outside `frontend/src/api.ts`.
- Assistant message rendering should use `MarkdownRenderer`; avoid `innerHTML` and do not execute raw HTML from model output.
- Persisted chat messages use `imageDataUrls` / `image_data_urls` only; do not reintroduce the legacy single-image field.
- Persist settings, auth, catalog, sessions, and logs under the `ChatGPTCodex` app data folder.

## Verification

After code changes, run the narrowest useful checks:

- `cd frontend && npm.cmd run build` for TypeScript/frontend changes.
- `cargo build` for Rust/backend or Tauri command changes.

There is no dedicated automated test suite in this repository at the time of writing.
