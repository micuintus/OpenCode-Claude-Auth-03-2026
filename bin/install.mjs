#!/usr/bin/env node

import { existsSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_SOURCE = join(__dirname, "..", "index.mjs");
const CACHE_DIR = join(homedir(), ".cache", "opencode", "node_modules", "opencode-anthropic-auth");

console.log("");
console.log("  opencode-claude-patch installer");
console.log("  ===============================");
console.log("");

if (!existsSync(CACHE_DIR)) {
  console.error("  ERROR: OpenCode plugin directory not found:");
  console.error(`    ${CACHE_DIR}`);
  console.error("");
  console.error("  Make sure OpenCode is installed and has been run at least once.");
  process.exit(1);
}

const targetIndex = join(CACHE_DIR, "index.mjs");

// Backup old plugin
if (existsSync(targetIndex)) {
  const backup = join(CACHE_DIR, "index.mjs.bak");
  copyFileSync(targetIndex, backup);
  console.log("  [1/3] Backed up old plugin");
}

// Copy our plugin
copyFileSync(PLUGIN_SOURCE, targetIndex);
console.log("  [2/3] Installed Claude patch");

// Update package.json
const pkg = {
  name: "opencode-anthropic-auth",
  version: "1.0.0-patch",
  description: "Claude/Anthropic auth plugin for OpenCode (opencode-claude-patch)",
  main: "./index.mjs",
  type: "module",
  devDependencies: {
    "@opencode-ai/plugin": "^0.4.45",
  },
};
writeFileSync(join(CACHE_DIR, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
console.log("  [3/3] Updated package.json");

console.log("");
console.log("  Done! Claude is now patched for OpenCode.");
console.log("");
console.log("  Next steps:");
console.log("    1. Open OpenCode");
console.log("    2. Connect provider: Anthropic → Claude Pro/Max (OAuth)");
console.log("    3. Authorize and paste the code");
console.log("");
console.log("  If OpenCode updates and breaks this, just run again:");
console.log("    npx opencode-claude-patch");
console.log("");
