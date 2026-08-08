# AI Chat -- Development Guide

## Project Overview

AI Chat is a local-first Electron desktop client with three provider families: OpenAI-compatible APIs, ChatGPT account login through the Codex backend, and Claude Web account sessions. Users configure or sign in to providers, fetch each provider's model catalog, explicitly select available models, mark favorites, and chat over provider-specific streaming protocols. Responses stream reasoning, citations, usage, web-search results, code blocks, and SVG artifacts into local conversations persisted as individual JSON files. The app also provides Google/Bing/DuckDuckGo page extraction with per-conversation engine fallback, image generation, image and office-document attachments, a rich Markdown renderer (Mermaid, Graphviz, PlantUML, KaTeX, SVG, shadow-DOM-styled model HTML), automatic title generation, a system tray, and GitHub-based auto-updates.

## Tech Stack

| Layer         | Technology                                                                   |
| ------------- | ---------------------------------------------------------------------------- |
| Desktop Shell | Electron 43.2, contextIsolation + sandboxed renderer, frameless window       |
| Frontend      | React 19.2, TypeScript 7.0, Antd 6.5, Redux Toolkit 2.12, lucide-react icons |
| Build         | Vite 8.2 (`vite.config.mts`) with vite-plugin-electron (unbundled main/preload) |
| Styling       | SCSS Modules                                                                 |
| Validation    | Zod 4.4 (all IPC boundaries and persistence)                                 |
| AI Providers  | OpenAI-compatible REST, ChatGPT Codex backend, Claude Web sessions           |
| Web Search    | Google/Bing/DuckDuckGo via hidden windows (Readability + Turndown), zero-result engine fallback |
| Attachments   | officeparser (PDF, Office docs), image paste                                 |
| Markdown      | react-markdown 10 + remark/rehype (GFM, math, KaTeX, raw, CJK-friendly, GitHub blockquote alerts), mermaid 11, @viz-js/viz, PlantUML via pako |
| Drag & Drop   | @hello-pangea/dnd                                                             |
| Logging       | electron-log 5.4 (main), custom bridge (renderer)                            |
| i18n          | i18next 26.3 + react-i18next 17 (10 locales)                                 |
| Testing       | Vitest 4.1                                                                   |
| Linting       | Biome 2.5                                                                    |
| Formatting    | Prettier 3.9 (no semicolons, single quotes)                                  |
| Packaging     | electron-builder 26.15 (NSIS on Windows, DMG on macOS, AppImage on Linux)    |

## Directory Structure

```
aichat/
├── src/
│   ├── contracts/                     # Cross-process contracts (aliased as @shared)
│   │   ├── index.ts                   # Barrel: single source of truth re-exports
│   │   ├── api/
│   │   │   ├── ipc.channel.ts         # IpcChannel enum -- every IPC channel name (41 members)
│   │   │   └── bridge.contract.ts     # BootstrapData + typed ApiBridge (preload contract)
│   │   ├── constants/app.info.ts      # App author, repo URL constants
│   │   ├── domain/                    # Domain models, one file per area:
│   │   │   ├── app-settings.ts        # AppSettings (revision 1), DEFAULT_SETTINGS, option sets
│   │   │   ├── attachments.ts         # ChatAttachment
│   │   │   ├── chat.ts                # ChatMessage, Citation, TokenUsage, ChatRequest,
│   │   │   │                          # ChatStreamEvent union, MAX_CHAT_ERROR_LENGTH
│   │   │   ├── conversations.ts       # Conversation, ConversationSummary, WebSearchMode
│   │   │   ├── providers.ts           # ProviderType, ProviderSnapshot, ModelReference,
│   │   │   │                          # ProviderModelDefinition, usage/auth state
│   │   │   ├── reasoning.ts           # ReasoningEffort vocabulary + REASONING_EFFORTS
│   │   │   ├── runtime.ts             # DesktopPlatform, LogRecord
│   │   │   └── updates.ts             # UpdateStateEvent
│   │   └── utils/token.estimation.ts  # CJK-aware token-count heuristics
│   ├── main/                          # Electron main process (feature folders, kebab-case)
│   │   ├── index.ts                   # Lifecycle, single-instance lock, service wiring
│   │   ├── window/window.service.ts   # Main BrowserWindow, nav policy, media permissions,
│   │   │                              # renderer diagnostics, persisted window bounds
│   │   ├── config/
│   │   │   ├── application.paths.ts   # appData/Data, Logs, Runtime, Session dirs
│   │   │   ├── settings.schema.ts     # Zod settings + patch schemas, DEFAULT_SETTINGS merge
│   │   │   └── window.state.ts        # Persisted window bounds parsing + display clamping
│   │   ├── ipc/
│   │   │   ├── ipc.service.ts         # All ipcMain.handle registrations + assertSender
│   │   │   └── schemas.ts             # Centralized Zod schemas for every IPC boundary
│   │   ├── security/navigation.policy.ts  # Navigation allowlist for the BrowserWindow
│   │   ├── persistence/storage.service.ts # JSON CRUD for settings + conversations, file locks
│   │   ├── logging/logger.service.ts  # Daily file logging, level-aware transports, pruning
│   │   ├── tray/tray.service.ts       # Optional tray icon + minimize-to-tray behavior
│   │   ├── attachments/attachment.service.ts # Picker, copy to app storage, text extraction
│   │   ├── chat/
│   │   │   ├── chat.service.ts        # 3-way streaming orchestration, image generation,
│   │   │   │                          # web search, title generation, abort control
│   │   │   ├── chat.errors.ts         # Provider error/body parsing, token/reasoning readers
│   │   │   └── title.generator.ts     # Deterministic + Quick-Model title helpers
│   │   ├── providers/
│   │   │   ├── index.ts               # Provider layer barrel
│   │   │   ├── provider.family.ts     # ProviderFamily contract (catalog/auth/usage)
│   │   │   ├── provider.registry.ts   # Provider CRUD, presets, favorites, snapshots
│   │   │   ├── model.qualification.ts # Capability flags, groups, reasoning efforts per model
│   │   │   ├── openai-compatible/
│   │   │   │   ├── openai-compatible.family.ts   # /models catalog + capability inference
│   │   │   │   └── openai-compatible.base-url.ts # Base-URL normalization (append /v1)
│   │   │   ├── chatgpt/
│   │   │   │   ├── chatgpt.types.ts   # Credential/persistence shapes
│   │   │   │   ├── chatgpt.protocol.ts # Codex catalogs, Responses SSE, usage windows
│   │   │   │   ├── chatgpt.auth.ts    # PKCE OAuth, token refresh, credentialed requests
│   │   │   │   └── chatgpt.family.ts  # ProviderFamily adapter
│   │   │   └── claude-web/
│   │   │       ├── claude-web.types.ts   # Protocol contracts + SSE deltas
│   │   │       ├── claude-web.protocol.ts # Bootstrap catalogs, prompts, SSE accumulation
│   │   │       ├── claude-web.auth.ts  # Login windows, cookie partitions, ephemeral chats
│   │   │       └── claude-web.family.ts # ProviderFamily adapter
│   │   ├── reasoning/                 # Provider/model reasoning capability layer
│   │   │   ├── index.ts               # Barrel
│   │   │   ├── reasoning.types.ts     # ReasoningModelLike, 24 provider kinds
│   │   │   ├── reasoning.shared.ts    # Effort ratios, detectProviderKind, REASONING_REGEX
│   │   │   ├── reasoning.detection.ts # Aggregated isReasoningModel predicates
│   │   │   ├── reasoning.efforts.ts   # Per-model-type effort options + thinking budgets
│   │   │   ├── reasoning.builder.ts   # Provider-specific reasoning payload building
│   │   │   ├── familyPatterns.ts      # 43 central family-name regexes
│   │   │   └── families/              # claude, openai, gemini, chinese, grok, misc predicates
│   │   ├── search/
│   │   │   ├── web.search.service.ts  # Google/Bing/DuckDuckGo queries + fallback order + Readability/Turndown
│   │   │   └── hidden.window.service.ts # Hidden sandboxed windows with Safari UA
│   │   └── updates/
│   │       ├── app.updater.ts         # GitHub release check, download + silent install
│   │       └── github.client.ts       # Zod-validated GitHub API, SHA-256 verification
│   ├── preload/
│   │   └── index.ts                   # contextBridge.exposeInMainWorld('app', ApiBridge)
│   └── renderer/
│       ├── index.html                 # HTML shell with #root mount point
│       └── src/
│           ├── entryPoint.tsx         # i18n init, Redux/Theme/Antd providers, React root
│           ├── App.tsx                # Titlebar + AppSidebar + HomePage/SettingsPage + updates
│           ├── types/global.d.ts      # window.app typed as ApiBridge
│           ├── store/
│           │   ├── index.ts           # configureStore, typed hooks
│           │   └── appSlice.ts        # Single Redux slice: settings, conversations, providers, updates
│           ├── hooks/
│           │   ├── useAppInit.ts      # Bootstrap + main-to-renderer IPC subscriptions
│           │   ├── useConversationActions.ts # open/create/rename/delete/delete-all conversations
│           │   ├── useSettingsActions.ts     # saveSettings (queued), provider/favorite/model actions
│           │   └── useDesktopActions.ts      # window controls, openExternal, updates
│           ├── services/
│           │   ├── LoggerService.ts           # RendererLogger bridging to main
│           │   └── SettingsPersistenceQueue.ts # Serialises rapid settings patches
│           ├── context/
│           │   ├── ThemeProvider.tsx  # System/light/dark theme, CSS variables + native chrome
│           │   └── AntdProvider.tsx   # Antd ConfigProvider theme tokens + locale
│           ├── pages/
│           │   ├── home/HomePage.tsx  # ConversationsSidebar + ChatWorkspace composition
│           │   └── settings/
│           │       ├── SettingsPage.tsx    # Settings layout: section tabs + content
│           │       ├── components/SettingLabel.tsx
│           │       └── sections/            # 8 sections: General, Providers, Catalog modal,
│           │                                # QuickModel, Display, Updates, Logging, About
│           ├── components/
│           │   ├── app/
│           │   │   ├── Titlebar.tsx, AppSidebar.tsx, WindowControls.tsx
│           │   │   ├── AppNavigationActions.tsx # Shared sidebar/titlebar window+settings actions
│           │   │   └── icons.tsx
│           │   ├── sidebar/ConversationsSidebar.tsx # Collapsible/resizable conversation list
│           │   └── chat/
│           │       ├── ChatWorkspace.tsx     # Topic header, stream timeline, inline composer
│           │       ├── MessageBubble.tsx     # Markdown, reasoning, citations, actions
│           │       ├── ModelSelect.tsx       # Searchable centered model picker (ModelAvatar)
│           │       ├── ModelAvatar.tsx       # Company logo or fallback letter
│           │       ├── WebSearchControl.tsx  # Off/Google/Bing/DuckDuckGo + fallback toggle per conversation
│           │       ├── ReasoningControl.tsx  # Thinking-effort picker
│           │       ├── ThinkingBlock.tsx     # Collapsible reasoning output
│           │       ├── SearchBlock.tsx       # Web-search status + references
│           │       ├── ChatToolControl.module.scss # Shared tool-button styles (no .tsx)
│           │       └── markdown/             # CodeBlock, ImageViewer, MarkdownSvg,
│           │           │                     # MarkdownTable, rehype plugins, shadow-DOM styling
│           │           └── CodeBlockView/    # index + Mermaid/Graphviz/PlantUML/SVG previews,
│           │                                 # useMermaid, useImageTools, useDebouncedRender
│           ├── i18n/
│           │   ├── index.ts            # i18next init with all 10 locale resources
│           │   └── locales/            # en, tr, de, fr, pt, zh, es, ru, ja, ko
│           ├── utils/
│           │   ├── formatters.ts       # formatDate, formatDuration, summary helpers
│           │   ├── citations.ts        # Citation tag numbering/sorting
│           │   ├── markdown.ts         # LaTeX/markdown preprocessing
│           │   ├── image.ts            # SVG render/size-adaptive helpers
│           │   └── modelLogos.ts       # Company-per-regex logo lookup (getModelLogoById)
│           └── assets/
│               ├── styles/             # index.scss, _tokens.scss, _scrollbar.scss
│               └── models/             # 27 company brand logos (64x64 PNG, excluded from lint)
├── tests/                             # Unit tests mirroring source structure (see Testing)
├── .github/workflows/release.yml       # Tag-triggered CI: check, package, publish releases
├── biome.json                         # Biome config; excludes src/renderer/src/assets/models/**
├── vite.config.mts                    # Vite config: main/preload (unbundled) + renderer builds
├── vitest.config.mts                  # Vitest config: node environment with path aliases
├── tsconfig.json                      # References tsconfig.node.json + tsconfig.web.json
├── tsconfig.node.json                 # Main/preload/tests TS: NodeNext, strict, aliases
├── tsconfig.web.json                  # Renderer TS: ESNext, react-jsx, @renderer/@shared paths
└── package.json                       # Scripts, deps, electron-builder config
```

## Commands

```bash
npm run dev             # Start Vite dev server + Electron (hot-reload for renderer)
npm start               # Preview the production build
npm run build           # Full typecheck + production Vite build
npm run typecheck       # Run both node and web TypeScript checks
npm run lint            # Biome lint on src, tests, and config files
npm run format          # Prettier write on all files
npm run format:check    # Prettier check only
npm run test            # Vitest single run (unit tests)
npm run test:watch      # Vitest in watch mode
npm run package         # Build + electron-builder --dir (unpacked for debugging)
npm run package:win     # NSIS installers for x64 and arm64
npm run package:win:x64 # NSIS installer for x64 only
npm run package:win:arm64 # NSIS installer for arm64 only
npm run package:linux   # AppImage builds for x64 and arm64
npm run package:linux:x64 # AppImage build for x64 only
npm run package:linux:arm64 # AppImage build for arm64 only
npm run release         # package:win + package:linux
```

## Architecture

### Three-Layer Separation

```
Renderer (sandboxed, contextIsolation: true)
    ↕  contextBridge.exposeInMainWorld('app', ApiBridge)
Preload (typed ApiBridge contract)
    ↕  ipcRenderer.invoke / ipcMain.handle + Zod validation
Main Process (Node.js, full system access)
```

- **Renderer**: React 19 + Redux, has zero direct access to Node or Electron APIs. All system interaction goes through `window.app.*` (the preload bridge).
- **Preload**: Exposes a typed `ApiBridge` object (defined in `src/contracts/api/bridge.contract.ts`) via `contextBridge`. Every method maps to a specific `IpcChannel` enum value; a `subscribe()` helper wraps the four push events and returns an unsubscribe closure.
- **Main process**: All `ipcMain.handle` registrations validate the sender (`assertSender` compares `webContents.id` on every handler), parse payloads with Zod schemas from `src/main/ipc/schemas.ts`, delegate to services, and return validated results.

### IPC Design

- Every IPC channel is enumerated in `src/contracts/api/ipc.channel.ts` as a string enum (41 members) so the renderer, preload, and main process share a single source of truth.
- Request-response channels use `ipcRenderer.invoke` / `ipcMain.handle` (promise-based).
- Push events from main to renderer use `webContents.send` (`ChatStream`, `UpdateState`, `WindowMaximizedChanged`, `SettingsOpenRequested`).
- The renderer writes logs via `ipcRenderer.send` (fire-and-forget `LogWrite` channel).
- All handler inputs are validated with Zod before touching any service (conversation documents, provider inputs, attachments, citations, usage, log entries, chat requests). Unknown input is rejected at the boundary.
- Every handler calls `assertSender(event.sender)` to prevent compromised renderers or webviews from invoking sensitive operations.

### State Flow

```
[Main Process Boot]
  → configureApplicationPaths redirects userData/sessionData/logs to appData dirs
  → StorageService loads settings; window state restored by WindowService
  → ChatGptAuth / ClaudeWebAuth prepare login-family auth/session access
  → ProviderRegistry loads ordered providers, plaintext API keys, selected models, catalogs
  → BootstrapPayload (settings + conversations + providers + platform) returned to renderer

[Renderer Boot]
  → useAppInit calls window.app.bootstrap()
  → Redux hydrate() action fills all initial state
  → IPC event listeners registered (ChatStream, UpdateState, WindowMaximizedChanged, SettingsOpenRequested)

[Chat Flow]
  → User picks a model and sends a message (optionally with attachments/web search)
  → Renderer calls window.app.startChat({ conversationId, message, model, ... })
  → ChatService plans search queries (if enabled), then routes by provider type:
      OpenAI-compatible → /chat/completions (SSE, with reasoning params;
                          400/422 retries strip reasoning parameters)
      ChatGPT → Codex Responses API with refreshed OAuth credentials
      Claude Web → ephemeral claude.ai conversation with persistent session cookies
      Image generation → /images/generations
  → Deltas pushed to renderer via ChatStream events (reasoning, content, citations, token usage)
  → Renderer appends deltas to the active conversation and debounce-saves it (500 ms)
  → On completion the final conversation is persisted; the sidebar summary refreshes
  → Title generation (via the Quick Model or deterministic fallback) renames default-titled chats
```

### Service Architecture

Main-process code is organized in feature folders with kebab-case filenames, each service a plain TypeScript class with explicit constructor injection:

- **WindowService** -- Owns the single frameless `BrowserWindow` (macOS uses a hidden titlebar with native overlay; Windows/Linux are fully frameless with custom controls). Configures sandbox, preload, `ai-chat-session` partition, navigation security via `navigation.policy`, and renderer diagnostics (failed loads, preload errors, crashes, console errors, empty-root detection). Persists window bounds to `window-state.json` (debounced, atomic write).
- **StorageService** -- File-based persistence under `%APPDATA%/AI Chat/Data/`. Settings in `settings.json`, conversations as individual `conversations/{uuid}.json` files, attachments in `attachments/`. Uses a per-file in-memory serialisation queue (`withFileLock`) and a `conversationWrites` set so a stale renderer save can never resurrect a just-deleted topic. Writes are atomic (temp file + rename). A delete always returns a replacement conversation (keep-at-least-one invariant enforced in the renderer).
- **ProviderRegistry + ProviderFamily** -- The old monolith is split into a registry (CRUD, built-in presets, plaintext API keys in `providers.json`, favorites/last-used/quick models, catalog fetch routing, `snapshot()` for the renderer) and per-type family adapters (`OpenAiCompatibleFamily`, `ChatGptFamily`, `ClaudeWebFamily`) that implement `fetchCatalog`, `startSignIn`/`signOut`, `authStatus`, `fetchUsage`. A clean install starts with OpenCode enabled (env-var key import, first-run catalog fetch, first free DeepSeek chat model as selected + Quick Model default), DeepSeek, ChatGPT, Claude Web, and NVIDIA, followed by the remaining built-in presets.
- **ChatGptAuth / ClaudeWebAuth** -- ChatGPT uses system-browser OAuth with PKCE, plaintext tokens in `Data/auth/chatgpt-auth.json`, proactive + forced-on-401 refresh. Claude Web uses one persistent Electron session partition per provider, an embedded login window, claude.ai cookies, organization discovery, image upload, model bootstrap, ephemeral conversations, and account metadata.
- **ChatService** -- Orchestrates the streaming transports (OpenAI-compatible `/chat/completions`, ChatGPT Codex Responses SSE, Claude Web completion SSE, image generation), preserves stream-significant whitespace, separates reasoning from answer content, accumulates Claude indexed blocks/tool artifacts, runs optional Google/Bing/DuckDuckGo search with zero-result engine fallback, handles stop/abort via an `AbortController` map, normalizes usage, and generates titles with the Quick Model. Failed HTTP responses retain a bounded copy of the provider body so the chat bubble and logs show the actual API diagnostic.
- **Reasoning layer** (`src/main/reasoning/`) -- Centralizes reasoning-model detection (`isReasoningModel` across family predicates), supported effort options per model type, thinking-token budgets, and provider-specific payload building (`reasoning_effort`, `thinking`, `enable_thinking`, `chat_template_kwargs`, flattened `extra_body`). One `ModelFamily` regex set (`familyPatterns.ts`) backs every predicate.
- **chatgptProtocol / claudeWebProtocol** -- Pure protocol helpers for Codex model catalogs, reasoning effort mapping, Responses request construction/SSE parsing, usage windows, and Claude bootstrap catalogs, account parsing, prompt/image flattening, thinking modes, and indexed reasoning/content/tool-artifact SSE accumulation.
- **AttachmentService** -- Opens the native file picker, validates size/extensions (max 10 files, 20 MB each, 50 MB total), copies files into per-conversation private app storage, extracts text (250k chars cap) from text/code files and PDF/Office documents via `officeparser`, and builds image data URLs.
- **WebSearchService / SearchWindowService** -- Runs up to three queries per search (Google, Bing, or DuckDuckGo) in parallel with bounded concurrency, extracts organic links, and converts article HTML to markdown with Readability + Turndown in hidden sandboxed windows (Safari user agent for engines, Chrome UA for articles). With the per-conversation `useWebSearchFallback` toggle (default on), a query that yields zero results tries DuckDuckGo first and then the remaining engines alphabetically. Content HTML is delivered as a base64 data URL capped under Chromium's 2 MB URL limit (`MAX_PAGE_BYTES = 1.4 MB`); every found result becomes a citation (`MAX_CITATIONS = 15`).
- **LoggerService** -- Creates two `electron-log` instances (general + error-only). Daily rotation, 10 MB max per file, automatic pruning (30 days general, 60 days error). Receives renderer log entries via the `LogWrite` IPC channel.
- **TrayService** -- Optional system tray icon (`process.resourcesPath/icon.png` when packaged, `build/icon.png` in dev, resized to 16 px on non-Windows), Open/Settings/Exit menu, click-to-show, and minimize-to-tray behavior driven by settings.
- **AppUpdater / GitHubReleaseClient** -- Polls the GitHub Releases API (5-minute cache, Zod-validated, semver comparison), downloads the architecture-specific NSIS installer (`ai-chat-<v>-windows-<arch>-setup.exe`), verifies SHA-256 and size, and launches it silently (`/S --updated --force-run`). Linux/unpacked builds report "available" without downloading.

## Coding Conventions

### TypeScript

- Strict mode enabled in both `tsconfig.node.json` and `tsconfig.web.json`.
- `noUncheckedIndexedAccess: true` -- all array/object index accesses must handle `undefined`.
- `exactOptionalPropertyTypes: true` -- `undefined` is distinct from missing.
- Path aliases: `@main/*` → `src/main`, `@shared/*` → `src/contracts`, `@renderer/*` → `src/renderer/src` configured in Vite, Vitest, and both tsconfigs.
- Use `type` imports for type-only references. Avoid default exports for utilities; prefer named exports.
- Zod schemas for every cross-process boundary: settings, conversation documents, messages, attachments, citations, token usage, IPC payloads, GitHub API responses, renderer log entries. IPC payload schemas are centralized in `src/main/ipc/schemas.ts`.

### Style

- Biome for linting, Prettier for formatting (no semicolons, single quotes, 100-char width). No ESLint.
- `biome.json` excludes `src/renderer/src/assets/models/**` from linting (shipped PNG assets).
- SCSS Modules for component styling (`.module.scss` files). Global styles in `assets/styles/index.scss`.
- TSX files do not contain inline `style` props or direct DOM style mutations; static presentation belongs in SCSS modules, while dynamic state uses classes or data attributes.
- CSS custom properties for theming; dark/light modes driven by the ThemeProvider context.

### React

- Functional components with hooks exclusively.
- Single Redux slice (`appSlice`) with typed `useAppDispatch` and `useAppSelector` hooks.
- Code-split settings page with `React.lazy` + `Suspense`.
- Custom hooks encapsulate all preload API calls (`useAppInit`, `useConversationActions`, `useSettingsActions`, `useDesktopActions`). Page components never call `window.app` directly.
- Antd's `App.useApp()` for message/notification APIs in hooks (avoid static `message.error` which breaks in StrictMode).
- Streaming chat state lives in the active `Conversation` document; ChatWorkspace appends deltas, then debounce-saves (500 ms) through the preload bridge.
- `i18n/index.ts` only registers locale resources and initializes i18next. All interface copy lives in the ten locale files, whose leaf-key sets must remain exact and contain no unused keys.

### Services

- Main-process services are plain classes with constructor injection -- no DI framework.
- Services that own mutable state expose getters that return copies.
- Renderer services are lightweight: `SettingsPersistenceQueue` serialises writes, `RendererLogger` bridges to main.
- File operations in StorageService are serialised per path via an in-memory promise chain (`withFileLock`).
- All file I/O is validated on write (Zod parse before write) and on read (Zod parse after read).

### JSDoc

- Every TypeScript/TSX code file starts with a brief English JSDoc comment describing its responsibility.
- Every exported class, function, and interface has an English JSDoc description.
- Every named function, method, constructor, and named callback has an English comment immediately above its declaration; internal helpers may use a concise single-line JSDoc description.

## Key Design Decisions

- **Single Redux slice**: The entire renderer state lives in one `appSlice` rather than multiple slices, because settings, conversations, and providers are tightly coupled (chat requires providers, conversation creation triggers updates).
- **Conversations, not sessions**: Persisted chats are `Conversation` documents (`conversations/{uuid}.json`); renderer state, IPC, and UI all use conversation terminology.
- **Contracts layer as a barrel**: `src/contracts/` splits shared types per domain and re-exports everything through `index.ts`, so renderer, preload, and main import the same `@shared` barrel.
- **Provider families behind a registry**: `ProviderRegistry` persists configuration while per-type `ProviderFamily` adapters implement protocol-specific catalog/auth/usage behavior -- one provider abstraction, three protocol implementations.
- **Centralized reasoning layer**: Detection predicates, effort options, thinking budgets, and payload building live in `src/main/reasoning/` with a single `familyPatterns.ts` regex set, so every provider family reasons about models through the same vocabulary (`default/off/minimal/low/medium/high/xhigh/auto`).
- **File-based conversation storage**: Each conversation is a separate `{uuid}.json` file. No SQLite dependency -- simple, debuggable, portable. Writes are atomic (temp + rename).
- **Per-file serialisation queue**: `StorageService.withFileLock` maintains a promise chain per file path, ensuring concurrent renderer operations never interleave writes without a global mutex.
- **Stale-save protection**: saving refuses to write a topic whose file no longer exists (`conversationWrites` set). A queued renderer save can never resurrect a deleted chat after delete/delete-all.
- **Plaintext local credentials**: Per the product's local-storage policy, OpenAI-compatible API keys and ChatGPT OAuth tokens are not encrypted. API keys live in `providers.json`; ChatGPT tokens live in `auth/chatgpt-auth.json`; Claude Web authentication remains in Electron's persistent cookie partition.
- **Refresh-token resilience**: ChatGPT access tokens refresh before expiry and once more after a 401. The settings panel exposes refresh-token availability and formats limit resets as `DD.MM HH:mm`.
- **Company-first logo mapping**: `modelLogos.ts` maps model ids to 27 company brand logos (64x64 PNGs in `assets/models/`) with one regex per vendor; first-match-wins ordering resolves cross-vendor collisions (`glm-o1` → Zhipu, `qwen-omni` → Alibaba, `baidu/text-embedding-v1` → Baidu before OpenAI's catch-all `gpt|o1|o3|o4|omni|...`).
- **Markdown/SVG stream fidelity**: Protocol parsers preserve leading whitespace and fenced blocks so code and SVG reach the Markdown pipeline intact. Model-generated `<style>` tags are scoped via shadow DOM, and SVG previews render through transparent shadow hosts on the active surface.
- **Web search via hidden sandboxed windows**: Engine results and article pages are rendered in hidden windows (Safari UA for engines, Chrome UA for articles) with Readability + Turndown extraction; HTML travels as base64 data URLs capped under Chromium's 2 MB URL limit. Per-conversation `useWebSearchFallback` falls back to DuckDuckGo (then the remaining engines alphabetically) when the selected engine returns zero results.
- **Local-first title generation**: Chat titles are generated by the Quick Model through the same streaming pipeline (with a deterministic 48-char fallback), keeping everything on-device and provider-neutral.
- **Keep-at-least-one invariant**: Deleting the last message or the last conversation always leaves one empty chat behind (renderer fallback creates a fresh conversation when none remains).
- **Optimistic provider reorder**: Provider drag-and-drop (`@hello-pangea/dnd`) applies the new order to Redux immediately and persists via IPC; on failure the previous snapshot is restored.
- **Frameless window with custom controls**: Windows/Linux run fully frameless with in-app window controls; macOS uses `titleBarStyle: 'hidden'` + `titleBarOverlay` for native traffic lights. Window bounds persist across restarts.
- **Deterministic tests via constructor injection**: `AppUpdater`, `GitHubReleaseClient`, `ProviderRegistry`, `StorageService`, and `TrayService` accept injectable dependencies (fetcher, runtime, environment, fs module) so tests can mock them without patching globals.

## Testing

- **Framework**: Vitest 4.1 with `environment: 'node'`.
- **Path aliases**: `@main/*`, `@shared/*`, `@renderer/*` resolved in `vitest.config.mts`.
- **Test files**: 20 test files in `tests/` covering:
  - `AppSlice.test.ts` -- Redux reducer state transitions
  - `ChatGptProtocol.test.ts` -- Codex request, model, usage, and SSE parsing
  - `ChatService.test.ts` -- Chat streaming service behavior and error parsing
  - `ClaudeWebProtocol.test.ts` -- Claude catalog, reasoning, prompt, and artifact parsing
  - `StorageService.test.ts` -- File CRUD, stale-save protection, delete replacement
  - `SettingsSchema.test.ts` -- Zod settings parsing and fallback behaviour
  - `SettingsPersistenceQueue.test.ts` -- Concurrent write serialisation
  - `RendererNavigationPolicy.test.ts` -- URL allowlist matching
  - `ProviderService.test.ts` -- Provider configuration and credential handling
  - `ProviderAuthService.test.ts` -- OAuth ordering, token refresh, and auth retry
  - `ReasoningParameters.test.ts` -- Reasoning detection, efforts, and payload building
  - `OpenAiCompatibility.test.ts` -- Base-URL normalization
  - `LoggerService.test.ts` -- Log level changes and error serialisation
  - `Localization.test.ts` -- Locale resource completeness
  - `IpcChannel.test.ts` -- Channel enum completeness
  - `Formatters.test.ts` -- Date and duration formatting
  - `Citations.test.ts` -- Citation numbering
  - `TokenEstimation.test.ts` -- Token-count heuristics
  - `TrayService.test.ts` -- Tray icon and menu configuration
  - `WindowState.test.ts` -- Persisted window bounds parsing and display clamping
- **Important**: after the services refactor, 18 of the 20 test files still import pre-refactor paths (`src/shared/*`, `src/main/services/*`, `@main/reasoningParameters`) and need their imports migrated (2 files reference classes that no longer exist). Fixing these is pending; do not rely on `npm test` passing until the suite is migrated.
- Services that depend on external I/O are designed with injectable constructors so unit tests can supply mocks without `vi.mock` on globals. Tests mocking Node built-ins (`fs/promises`, `crypto`) use `vi.mock` at the top of the test file.
- Run with `npm test` (single run) or `npm run test:watch` (watch mode).
- No E2E or integration tests currently exist.
