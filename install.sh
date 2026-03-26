#!/bin/bash
# ─── opencode-claude-patch installer ─────────────────────────────────────────
#
# Patches OpenCode to use your Claude Pro/Max subscription via OAuth.
# Re-run this after OpenCode updates if Claude stops working.
#
# Usage:
#   bash install.sh            # Install the patch
#   bash install.sh --seed     # Install + copy tokens from Claude Code
# ──────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$HOME/.cache/opencode/node_modules/opencode-anthropic-auth"

echo ""
echo "  opencode-claude-patch installer"
echo "  ==============================="
echo ""

# Check target exists
if [ ! -d "$TARGET_DIR" ]; then
  echo "  ERROR: OpenCode plugin directory not found:"
  echo "    $TARGET_DIR"
  echo ""
  echo "  Make sure OpenCode is installed and has been run at least once."
  exit 1
fi

# Backup old plugin
if [ -f "$TARGET_DIR/index.mjs" ]; then
  echo "  [1/3] Backing up old plugin..."
  cp "$TARGET_DIR/index.mjs" "$TARGET_DIR/index.mjs.bak" 2>/dev/null || true
fi

# Copy our plugin
echo "  [2/3] Installing Claude patch..."
cp "$SCRIPT_DIR/index.mjs" "$TARGET_DIR/index.mjs"

# Update package.json
echo "  [3/3] Updating package.json..."
cat > "$TARGET_DIR/package.json" << 'PKGJSON'
{
  "name": "opencode-anthropic-auth",
  "version": "1.0.0-patch",
  "description": "Claude/Anthropic auth plugin for OpenCode (opencode-claude-patch)",
  "main": "./index.mjs",
  "type": "module",
  "devDependencies": {
    "@opencode-ai/plugin": "^0.4.45"
  }
}
PKGJSON

echo ""
echo "  Done! Claude patch installed."

# Optional: seed tokens from Claude Code
if [ "$1" = "--seed" ]; then
  echo ""
  echo "  Seeding tokens from Claude Code..."
  OPENCODE_AUTH="$HOME/.local/share/opencode/auth.json"

  if [ ! -f "$OPENCODE_AUTH" ]; then
    echo "  WARNING: OpenCode auth.json not found at $OPENCODE_AUTH"
    echo "  Run OpenCode at least once first, then re-run with --seed."
  else
    # Extract tokens from Claude Code and inject into OpenCode
    node -e "
      const fs = require('fs');
      const { execSync } = require('child_process');

      let oauth = null;

      // Try macOS keychain first (Claude Code 2.1.x+)
      try {
        const raw = execSync('security find-generic-password -s \"Claude Code-credentials\" -w', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        oauth = JSON.parse(raw).claudeAiOauth;
      } catch {}

      // Fallback: file-based credentials
      if (!oauth) {
        try {
          const cc = JSON.parse(fs.readFileSync('$HOME/.claude/.credentials.json', 'utf8'));
          oauth = cc.claudeAiOauth;
        } catch {}
      }

      if (!oauth || !oauth.accessToken) { console.error('  No Claude OAuth tokens found.'); process.exit(1); }
      const oc = JSON.parse(fs.readFileSync('$OPENCODE_AUTH', 'utf8'));
      oc.anthropic = {
        type: 'oauth',
        refresh: oauth.refreshToken,
        access: oauth.accessToken,
        expires: oauth.expiresAt
      };
      fs.writeFileSync('$OPENCODE_AUTH', JSON.stringify(oc, null, 2));
      console.log('  Tokens copied successfully!');
    " 2>/dev/null && echo "  OpenCode now has Claude Code's active tokens." || echo "  WARNING: Token seeding failed. You'll need to authenticate manually in OpenCode."
  fi
fi

echo ""
echo "  Next steps:"
echo "    1. Open OpenCode"
echo "    2. Connect provider: Anthropic > Claude Pro/Max (OAuth)"
echo "    3. Authorize and paste the code"
echo ""
echo "  Or if you have Claude Code authenticated, run:"
echo "    bash \"$SCRIPT_DIR/install.sh\" --seed"
echo "  to copy tokens directly (no OAuth flow needed)."
echo ""
echo "  If OpenCode updates and breaks this, just re-run:"
echo "    bash \"$SCRIPT_DIR/install.sh\""
echo ""
