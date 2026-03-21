# opencode-claude-patch

Use your **Claude Pro/Max subscription** in [OpenCode](https://opencode.ai) via OAuth. Drop-in replacement for the discontinued `opencode-anthropic-auth` plugin.

## Quick Start

### Option 1: npx (recommended)

```bash
npx opencode-claude-patch
```

Then open OpenCode and connect the Anthropic provider.

### Option 2: If you have Claude Code authenticated

Skip the OAuth flow entirely by copying your existing Claude Code tokens:

```bash
npx opencode-claude-patch
bash node_modules/opencode-claude-patch/install.sh --seed
```

### Option 3: Clone and install manually

```bash
git clone https://github.com/GukDev/OpenCode-Claude-Auth-03-2026.git
cd opencode-claude-patch
bash install.sh          # Install the patch
bash install.sh --seed   # (Optional) Copy tokens from Claude Code
```

## What this does

OpenCode uses `opencode-anthropic-auth` to connect to Claude's API. That plugin is no longer maintained and uses outdated OAuth endpoints (`console.anthropic.com` instead of the current `platform.claude.com`).

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

The patch replaces the `index.mjs` inside `~/.cache/opencode/node_modules/opencode-anthropic-auth/` with our implementation. OpenCode loads it as if it were the original plugin — no config changes needed.

### For AI agents / Claude Code

If you're an AI agent helping a user set up this patch, here's what to do:

```bash
# 1. Install the patch
npx opencode-claude-patch

# 2. (Fastest) Seed tokens from Claude Code if already authenticated
#    This copies active OAuth tokens from ~/.claude/.credentials.json
#    into ~/.local/share/opencode/auth.json — no OAuth flow needed
bash install.sh --seed

# 3. (Alternative) If Claude Code isn't available, the user needs to
#    authenticate in OpenCode:
#    - Open OpenCode
#    - Go to provider settings → Anthropic → Connect
#    - Choose "Claude Pro/Max (OAuth)"
#    - Click the authorization link → Authorize on claude.ai
#    - Copy the code and paste it back into OpenCode
```

**Troubleshooting token refresh 429 errors:**
If the user gets rate-limited on the OAuth token endpoint, the fastest fix is to copy tokens from Claude Code rather than waiting for the rate limit to clear:

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
| `~/.cache/opencode/node_modules/opencode-anthropic-auth/index.mjs` | The patched plugin (installed here) |
| `~/.local/share/opencode/auth.json` | OpenCode's stored OAuth tokens |
| `~/.claude/.credentials.json` | Claude Code's OAuth tokens (used by `--seed`) |

## Auth methods

The plugin provides three authentication methods in OpenCode's provider setup:

1. **Claude Pro/Max (OAuth)** — Authorize via `claude.ai`, uses your subscription
2. **Create an API Key (via Console OAuth)** — Creates an API key through Anthropic's console
3. **Manually enter API Key** — Direct API key entry

## Requirements

- [OpenCode](https://opencode.ai) installed and run at least once
- A Claude Pro or Max subscription (for OAuth method)
- OR an Anthropic API key (for manual key method)

## License

MIT
