# ChatGPT Codex

ChatGPT Codex is a compact Tauri desktop chat client for using ChatGPT through the Codex backend with selectable models and reasoning variants.

The goal of this app is to use ChatGPT with different high-capability models through the Codex backend and Codex account limits.

![ChatGPT Codex interface](images/interface.png)

## Install

1. Download the latest release for Windows from [Releases](https://github.com/bariskisir/ChatGPTCodex/releases/latest).
2. Install or extract the package.
3. Run **ChatGPT Codex**.

## Development

### Prerequisites

- [Rust](https://rustup.rs/) stable
- Node.js 22 or newer
- Visual Studio Build Tools on Windows

```bash
git clone https://github.com/bariskisir/ChatGPTCodex
cd ChatGPTCodex

cd frontend
npm install
npm run build
cd ..

cargo run
```

## License

MIT
