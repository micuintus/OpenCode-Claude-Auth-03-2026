#!/usr/bin/env node

import { existsSync, copyFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(__dirname, "..", "index.mjs");
const TARGET = join(homedir(), ".cache", "opencode", "node_modules", "opencode-anthropic-auth");

console.log("");
console.log("  opencode-claude-patch");
console.log("  =====================");
console.log("");

if (!existsSync(TARGET)) {
  console.error("  OpenCode not found. Install OpenCode and run it once first.");
  process.exit(1);
}

const idx = join(TARGET, "index.mjs");
if (existsSync(idx)) copyFileSync(idx, join(TARGET, "index.mjs.bak"));

copyFileSync(SOURCE, idx);
writeFileSync(
  join(TARGET, "package.json"),
  JSON.stringify({
    name: "opencode-anthropic-auth",
    version: "1.0.0-patch",
    main: "./index.mjs",
    type: "module",
    devDependencies: { "@opencode-ai/plugin": "^0.4.45" },
  }, null, 2) + "\n",
);

console.log("  Patched! Now open OpenCode and connect Anthropic:");
console.log("");
console.log("    1. Open OpenCode");
console.log("    2. Connect provider → Anthropic → Claude Pro/Max (OAuth)");
console.log("    3. Click the link, authorize, paste the code");
console.log("    4. Done — works automatically from here");
console.log("");
console.log("  Re-run after OpenCode updates: npx opencode-claude-patch");
console.log("");
