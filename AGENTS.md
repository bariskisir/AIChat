# Repository Guidelines

## Project Structure & Module Organization

AI Chat is an Electron desktop client built with Vite, React, and TypeScript.
`src/main/` contains Electron-process services (IPC, providers, persistence, tray, and
security). `src/renderer/src/` contains the React UI, Redux store, styles, pages, and
locales. Shared IPC contracts and domain types live in `src/contracts/`. Place unit and
component tests in `tests/`; name each after its subject, for example
`tests/ProviderService.test.ts`. Packaging assets are in `build/`, and product images are
in `images/`.

## Build, Test, and Development Commands

- `npm ci` installs the locked dependency set (Node.js 24 or later).
- `npm run dev` starts the Vite/Electron development environment.
- `npm run typecheck` checks both main-process and renderer TypeScript projects.
- `npm run lint` runs Biome over source, tests, and Vite/Vitest configuration.
- `npm test` runs the Vitest suite once; use `npm run test:watch` while developing.
- `npm run build` type-checks and produces the application build.
- `npm run package:win` or `npm run package:linux:x64` creates distributable artifacts.

## Coding Style & Naming Conventions

Use TypeScript for application code and keep the main, renderer, and contract boundaries
explicit. Follow `.editorconfig`: UTF-8, LF endings, two-space indentation, and no
trailing whitespace. Prettier uses no semicolons, single quotes, trailing commas, and a
100-character print width; run `npm run format` before submitting formatting changes.
Use `PascalCase` for React components and their test files, `camelCase` for functions and
variables, and lowercase dotted filenames for main-process services (for example,
`chat.service.ts`). Keep component styles beside components as `*.module.scss`.

## Testing Guidelines

Write focused Vitest tests for changed behavior in `tests/`, including regression cases for
provider protocols, IPC, persistence, and renderer utilities. Use `.test.ts` or `.test.tsx`
suffixes. Run `npm test`, `npm run typecheck`, and `npm run lint` before opening a PR; CI
also runs `npm run format:check` for releases.

## Commit & Pull Request Guidelines

Use concise, imperative Conventional Commit-style subjects, such as `feat(chat): add
session header`, `fix(providers): trust OS certificates`, or `chore: update dependencies`.
Keep changes scoped. PRs should explain the user-visible effect, link related issues when
available, list validation commands, and include screenshots for renderer/UI changes.
Never commit API keys, account tokens, or local application data.
