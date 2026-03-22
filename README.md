# OpenCode Claude Patch

Use your **Claude Pro/Max subscription** in [OpenCode](https://opencode.ai) via OAuth. Drop-in replacement for the discontinued `opencode-anthropic-auth` plugin.

> **Important:** This is a _patch_, not a standalone plugin. Do **not** add `opencode-claude-patch` to your `opencode.json` plugin list — it won't work that way. OpenCode hardcodes `opencode-anthropic-auth` as the Anthropic provider. This package patches that existing plugin in-place with a working implementation. See [How it works](#how-it-works) for details.

## Quick Start

### Desktop (has browser)

```bash
npx opencode-claude-patch
```

Then open OpenCode → Connect Anthropic → "Claude Pro/Max (OAuth)" → authorize in browser.

### VPS / Headless (no browser)

Authenticate on your local machine first, then copy your credentials to the VPS:

```bash
# On your LOCAL machine — copy credentials to VPS:
scp ~/.claude/.credentials.json user@your-vps:~/.claude/.credentials.json

# On the VPS — install patch + seed tokens in one command:
npx opencode-claude-patch --seed
```

This uses your Claude Pro/Max subscription — no API key needed.

### Alternative: API key (if you have one)

```bash
npx opencode-claude-patch --api-key sk-ant-xxxx
# Or via env var:
ANTHROPIC_API_KEY=sk-ant-xxxx npx opencode-claude-patch
```

### Clone and install manually

```bash
git clone https://github.com/GukDev/OpenCode-Claude-Auth-03-2026.git
cd OpenCode-Claude-Auth-03-2026
bash install.sh          # Install the patch
bash install.sh --seed   # Seed tokens from Claude Code credentials
```

## What this does

OpenCode uses a plugin called `opencode-anthropic-auth` to connect to Claude's API. That plugin is no longer maintained and uses outdated OAuth endpoints (`console.anthropic.com` instead of the current `platform.claude.com`), which causes authentication to fail.

This patch replaces it with a working implementation that:

- **OAuth via Claude Pro/Max** — Uses your existing Claude subscription, no API key needed
- **Automatic token refresh** — Refreshes tokens 5 minutes before expiry with deduplication (prevents rate-limit storms)
- **Rate limit resilience** — Retries with exponential backoff on 429 errors instead of failing silently
- **Request rewriting** — Handles all the quirks required for OAuth API calls:
  - Sets `Bearer` auth with OAuth tokens
  - Spoofs `user-agent` as `claude-cli/2.1.2` (required by Anthropic)
  - Adds required beta headers (`oauth-2025-04-20`, `interleaved-thinking-2025-05-14`)
  - Appends `?beta=true` to `/v1/messages` endpoint
  - Prefixes tool names with `mcp_` outbound, strips them from streaming responses
  - Sanitizes "OpenCode" references to "Claude Code" in system prompts
- **Zero dependencies** — PKCE implemented with Node.js crypto, no `@openauthjs/openauth` needed

## How it works

OpenCode hardcodes `opencode-anthropic-auth` as its Anthropic provider plugin. It always loads it from:

```
~/.cache/opencode/node_modules/opencode-anthropic-auth/index.mjs
```

**This package patches that file in-place.** When you run `npx opencode-claude-patch`, it copies our updated `index.mjs` over the old one. OpenCode then loads our code as if it were the original plugin — no config changes needed.

**This means:**
- You do NOT add this to your `opencode.json` plugin list
- You do NOT need to change any OpenCode configuration
- You just run `npx opencode-claude-patch` and it works
- After OpenCode updates, re-run `npx opencode-claude-patch` to re-apply

### For AI agents / Claude Code

If you're an AI agent (Claude Code, Cursor, etc.) helping a user get Claude working in OpenCode, here's the full procedure:

```bash
# 1. Install the patch (replaces the broken opencode-anthropic-auth plugin)
npx opencode-claude-patch

# 2. (Fastest) If the user has Claude Code already authenticated,
#    seed tokens directly — no OAuth browser flow needed:
#    This copies active OAuth tokens from ~/.claude/.credentials.json
#    into ~/.local/share/opencode/auth.json
bash install.sh --seed

# 3. (Alternative) If Claude Code isn't available, the user needs to
#    authenticate manually in OpenCode:
#    - Open OpenCode
#    - Go to provider settings → Anthropic → Connect
#    - Choose "Claude Pro/Max (OAuth)"
#    - Click the authorization link → Authorize on claude.ai
#    - Copy the code and paste it back into OpenCode
```

**Troubleshooting token refresh 429 errors:**

If the user gets rate-limited on the OAuth token endpoint (often from repeated failed auth attempts), the fastest fix is to copy tokens from Claude Code rather than waiting for the rate limit to clear:

```bash
bash install.sh --seed
```

This reads `~/.claude/.credentials.json` (Claude Code's active tokens) and writes them into `~/.local/share/opencode/auth.json`.

## After OpenCode updates

OpenCode may overwrite the patched plugin when it updates. Just re-run:

```bash
npx opencode-claude-patch
```

Or if you cloned the repo:

```bash
bash install.sh
```

## File locations

| File | Purpose |
|------|---------|
| `~/.cache/opencode/node_modules/opencode-anthropic-auth/index.mjs` | Where the patch is installed (replaces original) |
| `~/.local/share/opencode/auth.json` | OpenCode's stored OAuth tokens |
| `~/.claude/.credentials.json` | Claude Code's OAuth tokens (used by `--seed`) |
| `~/.config/opencode/opencode.json` | OpenCode config (you do NOT need to edit this) |

## Auth methods

Once patched, the Anthropic provider in OpenCode offers three authentication methods:

1. **Claude Pro/Max (OAuth)** — Authorize via `claude.ai`, uses your subscription
2. **Create an API Key (via Console OAuth)** — Creates an API key through Anthropic's console
3. **Manually enter API Key** — Direct API key entry

## Requirements

- [OpenCode](https://opencode.ai) installed and run at least once
- A Claude Pro or Max subscription (for OAuth method)
- OR an Anthropic API key (for manual key method)

## License

MIT
