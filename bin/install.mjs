#!/usr/bin/env node

import { existsSync, copyFileSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_SOURCE = join(__dirname, "..", "index.mjs");
const CACHE_DIR = join(homedir(), ".cache", "opencode", "node_modules", "opencode-anthropic-auth");
const AUTH_PATH = join(homedir(), ".local", "share", "opencode", "auth.json");
const CC_CREDS_PATH = join(homedir(), ".claude", ".credentials.json");

// ─── Parse CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}
const hasFlag = (name) => args.includes(name);

const apiKey = getArg("--api-key") || process.env.ANTHROPIC_API_KEY;
const seedFrom = getArg("--seed-from");
const doSeed = hasFlag("--seed");

// ─── Install the patch ───────────────────────────────────────────────────────

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

if (existsSync(targetIndex)) {
  copyFileSync(targetIndex, join(CACHE_DIR, "index.mjs.bak"));
  console.log("  [1/3] Backed up old plugin");
}

copyFileSync(PLUGIN_SOURCE, targetIndex);
console.log("  [2/3] Installed Claude patch");

const pkg = {
  name: "opencode-anthropic-auth",
  version: "1.0.0-patch",
  description: "Claude/Anthropic auth plugin for OpenCode (opencode-claude-patch)",
  main: "./index.mjs",
  type: "module",
  devDependencies: { "@opencode-ai/plugin": "^0.4.45" },
};
writeFileSync(join(CACHE_DIR, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
console.log("  [3/3] Updated package.json");

// ─── Auth setup ──────────────────────────────────────────────────────────────

/**
 * Read or create auth.json, returning the parsed object.
 */
function loadAuth() {
  try {
    return JSON.parse(readFileSync(AUTH_PATH, "utf8"));
  } catch {
    // Ensure directory exists
    mkdirSync(dirname(AUTH_PATH), { recursive: true });
    return {};
  }
}

function saveAuth(auth) {
  mkdirSync(dirname(AUTH_PATH), { recursive: true });
  writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2) + "\n");
}

// Option 1: --api-key or ANTHROPIC_API_KEY env var
if (apiKey) {
  console.log("");
  console.log("  Setting up API key auth...");
  const auth = loadAuth();
  auth.anthropic = { type: "api", key: apiKey };
  saveAuth(auth);
  console.log("  API key configured! OpenCode will use it directly.");
  console.log("");
  console.log("  Done! Just open OpenCode and start using Claude.");
  console.log("");
  process.exit(0);
}

// Option 2: --seed (from Claude Code) or --seed-from <path>
if (doSeed || seedFrom) {
  console.log("");
  console.log("  Seeding OAuth tokens...");
  const credsPath = seedFrom || CC_CREDS_PATH;

  if (!existsSync(credsPath)) {
    console.error(`  ERROR: Credentials file not found: ${credsPath}`);
    if (!seedFrom) {
      console.error("  Make sure Claude Code is installed and authenticated.");
    }
    process.exit(1);
  }

  try {
    const creds = JSON.parse(readFileSync(credsPath, "utf8"));
    const oauth = creds.claudeAiOauth;
    if (!oauth || !oauth.accessToken) {
      console.error("  ERROR: No OAuth tokens found in credentials file.");
      process.exit(1);
    }

    const auth = loadAuth();
    auth.anthropic = {
      type: "oauth",
      refresh: oauth.refreshToken,
      access: oauth.accessToken,
      expires: oauth.expiresAt,
    };
    saveAuth(auth);
    console.log("  Tokens seeded successfully!");
    console.log("");
    console.log("  Done! Just open OpenCode and start using Claude.");
    console.log("");
  } catch (e) {
    console.error(`  ERROR: Failed to read credentials: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// No auth flags — show next steps
console.log("");
console.log("  Patch installed! Now set up authentication:");
console.log("");
console.log("  Option A — API key (best for VPS/headless, one command):");
console.log("    npx opencode-claude-patch --api-key sk-ant-xxxx");
console.log("    Or: ANTHROPIC_API_KEY=sk-ant-xxxx npx opencode-claude-patch");
console.log("");
console.log("  Option B — OAuth (uses your Claude Pro/Max subscription):");
console.log("    Open OpenCode → Connect Anthropic → Claude Pro/Max (OAuth)");
console.log("");
console.log("  Option C — Seed from Claude Code (if installed locally):");
console.log("    npx opencode-claude-patch --seed");
console.log("");
console.log("  If OpenCode updates, just re-run: npx opencode-claude-patch");
console.log("");
