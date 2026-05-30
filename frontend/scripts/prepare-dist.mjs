// Prepares frontend distribution assets for the Tauri build.
import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

mkdirSync(dist, { recursive: true });
copyFileSync(join(root, "index.html"), join(dist, "index.html"));
cpSync(join(root, "styles"), join(dist, "styles"), { recursive: true });
copyFileSync(join(root, "..", "icons", "icon.png"), join(dist, "icon.png"));
