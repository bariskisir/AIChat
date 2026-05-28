# Claude Chat

Claude Chat is a compact Windows-focused Tauri desktop client for using Claude.ai with the models available to the signed-in account.

![Claude Chat interface](images/interface.png)

## Install

1. Download the latest release for Windows from [Releases](https://github.com/bariskisir/ClaudeChat/releases/latest).
2. Install or extract the package.
3. Run **Claude Chat**.

## Development

### Prerequisites

- [Rust](https://rustup.rs/) stable
- Node.js 22 or newer
- Visual Studio Build Tools on Windows
- Google Chrome, Microsoft Edge, or Brave for the Claude login flow

```bash
git clone https://github.com/bariskisir/ClaudeChat
cd ClaudeChat

cd frontend
npm install
npm run build
cd ..

cargo run
```

## License

MIT
