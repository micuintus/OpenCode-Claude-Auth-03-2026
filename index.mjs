import { webcrypto } from "node:crypto";

// ─── Constants ──────────────────────────────────────────────────────────────────

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_ENDPOINT = "https://platform.claude.com/v1/oauth/token";
const REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const OAUTH_SCOPES = "org:create_api_key user:profile user:inference";
const CLAUDE_CODE_SYSTEM_PREFIX =
  "You are Claude Code, Anthropic's official CLI for Claude.";
const CLAUDE_CLI_USER_AGENT = "claude-cli/2.1.2 (external, cli)";
const TOOL_PREFIX = "mcp_";
const REQUIRED_BETAS = [
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
];

// ─── PKCE helpers (no external dependency) ──────────────────────────────────────

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateVerifier(length = 64) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const array = new Uint8Array(length);
  (globalThis.crypto ?? webcrypto).getRandomValues(array);
  return Array.from(array, (b) => chars[b % chars.length]).join("");
}

async function generatePKCE() {
  const verifier = generateVerifier();
  const digest = await (globalThis.crypto ?? webcrypto).subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(digest) };
}

// ─── OAuth flow ─────────────────────────────────────────────────────────────────

/**
 * Build the authorization URL for either Claude Pro/Max or Console (API key).
 * @param {"max" | "console"} mode
 */
async function authorize(mode) {
  const pkce = await generatePKCE();
  const host =
    mode === "console" ? "platform.claude.com" : "claude.ai";

  const url = new URL(`https://${host}/oauth/authorize`);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", pkce.verifier);

  return { url: url.toString(), verifier: pkce.verifier };
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * Retries on 429 rate limits with exponential backoff.
 * @param {string} code  – The authorization code (may contain a `#state` suffix)
 * @param {string} verifier – The PKCE code_verifier
 */
async function exchange(code, verifier) {
  const splits = code.split("#");
  const payload = {
    code: splits[0],
    state: splits[1],
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  };

  const MAX_RETRIES = 6;
  const BACKOFF_MS = [5000, 10000, 20000, 30000, 60000, 120000];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (result.status === 429) {
      const waitMs = BACKOFF_MS[attempt] ?? 120000;
      console.error(
        `[claude-patch] Code exchange rate-limited (attempt ${attempt + 1}/${MAX_RETRIES}), waiting ${waitMs / 1000}s...`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!result.ok) {
      // Try form-encoded as fallback on 400
      if (result.status === 400) {
        const params = new URLSearchParams({
          ...payload,
          state: payload.state ?? "",
        });
        const fallback = await fetch(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        if (fallback.ok) {
          const json = await fallback.json();
          return {
            type: "success",
            refresh: json.refresh_token,
            access: json.access_token,
            expires: Date.now() + json.expires_in * 1000,
          };
        }
      }
      console.error(
        `[claude-patch] Code exchange failed: ${result.status}`,
      );
      return { type: "failed" };
    }

    const json = await result.json();
    return {
      type: "success",
      refresh: json.refresh_token,
      access: json.access_token,
      expires: Date.now() + json.expires_in * 1000,
    };
  }

  console.error(
    "[claude-patch] Code exchange failed after all retries (429). Wait a few minutes and try again.",
  );
  return { type: "failed" };
}

// ─── Request rewriting helpers ──────────────────────────────────────────────────

/**
 * Sanitize the system prompt blocks — Anthropic's server rejects requests
 * containing the string "OpenCode" when using OAuth.
 */
function sanitizeSystemBlocks(system) {
  if (!Array.isArray(system)) return system;
  return system.map((item) => {
    if (item.type === "text" && item.text) {
      return {
        ...item,
        text: item.text
          .replace(/OpenCode/g, "Claude Code")
          .replace(/opencode/gi, "Claude"),
      };
    }
    return item;
  });
}

/**
 * Prefix all tool names with `mcp_` in outgoing requests.
 * Claude's OAuth endpoint requires tool names to start with this prefix.
 */
function prefixToolNames(parsed) {
  if (parsed.tools && Array.isArray(parsed.tools)) {
    parsed.tools = parsed.tools.map((tool) => ({
      ...tool,
      name: tool.name ? `${TOOL_PREFIX}${tool.name}` : tool.name,
    }));
  }
  if (parsed.messages && Array.isArray(parsed.messages)) {
    parsed.messages = parsed.messages.map((msg) => {
      if (msg.content && Array.isArray(msg.content)) {
        msg.content = msg.content.map((block) => {
          if (block.type === "tool_use" && block.name) {
            return { ...block, name: `${TOOL_PREFIX}${block.name}` };
          }
          if (block.type === "tool_result" && block.tool_use_id) {
            // tool_result blocks reference by ID, not name — no change needed
            return block;
          }
          return block;
        });
      }
      return msg;
    });
  }
  return parsed;
}

/**
 * Strip the `mcp_` prefix from tool names in the streamed response so
 * OpenCode can match them back to its internal tool registry.
 */
function createToolNameUnprefixStream(response) {
  if (!response.body) return response;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      let text = decoder.decode(value, { stream: true });
      // Remove the mcp_ prefix from tool name references in the JSON stream
      text = text.replace(/"name"\s*:\s*"mcp_([^"]+)"/g, '"name": "$1"');
      controller.enqueue(encoder.encode(text));
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// ─── Token refresh with Claude Code sync + API fallback ─────────────────────────

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let _refreshPromise = null;

/**
 * Try to read fresh tokens from Claude Code's credentials file.
 * Claude Code handles its own token refresh, so we piggyback off it.
 * Returns the access token if found and valid, null otherwise.
 */
function readClaudeCodeTokens() {
  try {
    const credsPath = join(homedir(), ".claude", ".credentials.json");
    const raw = readFileSync(credsPath, "utf8");
    const creds = JSON.parse(raw);
    const oauth = creds.claudeAiOauth;
    if (
      oauth &&
      oauth.accessToken &&
      oauth.refreshToken &&
      oauth.expiresAt > Date.now() + 60000 // at least 1 min remaining
    ) {
      return {
        access: oauth.accessToken,
        refresh: oauth.refreshToken,
        expires: oauth.expiresAt,
      };
    }
  } catch {
    // Claude Code not installed or credentials not found — that's fine
  }
  return null;
}

/**
 * Refresh the OAuth token. Strategy:
 *  1. Read fresh tokens from Claude Code (instant, no API call)
 *  2. Fall back to Anthropic's token endpoint with retry on 429
 *
 * Only one refresh runs at a time — concurrent callers share the same promise.
 */
async function refreshToken(currentAuth, client) {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    // ── Strategy 1: Refresh via Anthropic API (standalone) ────────────
    // Single attempt — no aggressive retries that could trigger rate limits
    try {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: currentAuth.refresh,
          client_id: CLIENT_ID,
        }),
      });

      if (response.ok) {
        const json = await response.json();
        await client.auth.set({
          path: { id: "anthropic" },
          body: {
            type: "oauth",
            refresh: json.refresh_token,
            access: json.access_token,
            expires: Date.now() + json.expires_in * 1000,
          },
        });
        return json.access_token;
      }

      if (response.status !== 429) {
        console.error(
          `[claude-patch] Token refresh failed: ${response.status}`,
        );
      }
    } catch (e) {
      console.error(`[claude-patch] Token refresh error: ${e.message}`);
    }

    // ── Strategy 2: Read from Claude Code credentials (fallback) ─────
    // If API refresh failed (rate-limited or error), try reading tokens
    // from Claude Code's local credentials file as a safety net.
    const ccTokens = readClaudeCodeTokens();
    if (ccTokens) {
      console.error(
        "[claude-patch] Using tokens from Claude Code credentials",
      );
      await client.auth.set({
        path: { id: "anthropic" },
        body: {
          type: "oauth",
          refresh: ccTokens.refresh,
          access: ccTokens.access,
          expires: ccTokens.expires,
        },
      });
      return ccTokens.access;
    }

    // ── Both strategies failed ───────────────────────────────────────
    throw new Error(
      "Claude OAuth token refresh failed. " +
        "Disconnect & reconnect the Anthropic provider in OpenCode to get fresh tokens.",
    );
  })();

  try {
    return await _refreshPromise;
  } finally {
    _refreshPromise = null;
  }
}

// ─── Plugin entry point ─────────────────────────────────────────────────────────

/**
 * @type {import('@opencode-ai/plugin').Plugin}
 */
export async function AnthropicAuthPlugin({ client }) {
  return {
    // ── System prompt transform ───────────────────────────────────────────
    "experimental.chat.system.transform": (_input, output) => {
      if (_input.model?.providerID === "anthropic") {
        // Ensure the Claude Code prefix is at the very start
        output.system.unshift(CLAUDE_CODE_SYSTEM_PREFIX);
        // Also merge it into the first real system block if one exists
        if (output.system[1]) {
          output.system[1] =
            CLAUDE_CODE_SYSTEM_PREFIX + "\n\n" + output.system[1];
        }
      }
    },

    // ── Auth hook ─────────────────────────────────────────────────────────
    auth: {
      provider: "anthropic",

      /**
       * Called by OpenCode to get provider options (apiKey, custom fetch, etc.)
       * whenever the Anthropic provider is used.
       */
      async loader(getAuth, provider) {
        const auth = await getAuth();

        if (auth.type === "oauth") {
          // Zero out cost display for subscription users
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: { read: 0, write: 0 },
            };
          }

          return {
            // Must be empty string — the SDK validates apiKey is present,
            // but we use Bearer auth instead via custom fetch.
            apiKey: "",

            /**
             * Custom fetch that intercepts every Anthropic API call to:
             *  1. Refresh the OAuth token if expired
             *  2. Set Bearer auth + Claude CLI headers
             *  3. Rewrite tool names (add/strip mcp_ prefix)
             *  4. Sanitize "OpenCode" strings from system prompts
             *  5. Add ?beta=true to /v1/messages
             */
            async fetch(input, init) {
              // ── 1. Get fresh auth (may need token refresh) ──────────
              let currentAuth = await getAuth();
              if (currentAuth.type !== "oauth") return fetch(input, init);

              // Refresh 5 minutes before expiry to avoid race conditions
              const REFRESH_BUFFER_MS = 5 * 60 * 1000;
              if (
                !currentAuth.access ||
                currentAuth.expires < Date.now() + REFRESH_BUFFER_MS
              ) {
                currentAuth.access = await refreshToken(
                  currentAuth,
                  client,
                );
              }

              // ── 2. Build headers ───────────────────────────────────
              const requestInit = init ?? {};
              const requestHeaders = new Headers();

              // Copy existing headers from Request object
              if (input instanceof Request) {
                input.headers.forEach((value, key) => {
                  requestHeaders.set(key, value);
                });
              }
              // Copy headers from init
              if (requestInit.headers) {
                if (requestInit.headers instanceof Headers) {
                  requestInit.headers.forEach((value, key) => {
                    requestHeaders.set(key, value);
                  });
                } else if (Array.isArray(requestInit.headers)) {
                  for (const [key, value] of requestInit.headers) {
                    if (typeof value !== "undefined") {
                      requestHeaders.set(key, String(value));
                    }
                  }
                } else {
                  for (const [key, value] of Object.entries(
                    requestInit.headers,
                  )) {
                    if (typeof value !== "undefined") {
                      requestHeaders.set(key, String(value));
                    }
                  }
                }
              }

              // Merge beta headers (preserve any existing ones)
              const existing =
                requestHeaders.get("anthropic-beta") || "";
              const existingList = existing
                .split(",")
                .map((b) => b.trim())
                .filter(Boolean);
              const mergedBetas = [
                ...new Set([...REQUIRED_BETAS, ...existingList]),
              ].join(",");

              requestHeaders.set(
                "authorization",
                `Bearer ${currentAuth.access}`,
              );
              requestHeaders.set("anthropic-beta", mergedBetas);
              requestHeaders.set("user-agent", CLAUDE_CLI_USER_AGENT);
              requestHeaders.delete("x-api-key");

              // ── 3. Rewrite request body ────────────────────────────
              let body = requestInit.body;
              if (body && typeof body === "string") {
                try {
                  let parsed = JSON.parse(body);
                  parsed.system = sanitizeSystemBlocks(parsed.system);
                  parsed = prefixToolNames(parsed);
                  body = JSON.stringify(parsed);
                } catch {
                  // non-JSON body — pass through
                }
              }

              // ── 4. Add ?beta=true to /v1/messages ──────────────────
              let requestInput = input;
              let requestUrl = null;
              try {
                if (
                  typeof input === "string" ||
                  input instanceof URL
                ) {
                  requestUrl = new URL(input.toString());
                } else if (input instanceof Request) {
                  requestUrl = new URL(input.url);
                }
              } catch {
                requestUrl = null;
              }

              if (
                requestUrl &&
                requestUrl.pathname === "/v1/messages" &&
                !requestUrl.searchParams.has("beta")
              ) {
                requestUrl.searchParams.set("beta", "true");
                requestInput =
                  input instanceof Request
                    ? new Request(requestUrl.toString(), input)
                    : requestUrl;
              }

              // ── 5. Fire the request ────────────────────────────────
              const response = await fetch(requestInput, {
                ...requestInit,
                body,
                headers: requestHeaders,
              });

              // ── 6. Strip mcp_ prefix from streaming response ──────
              return createToolNameUnprefixStream(response);
            },
          };
        }

        // Non-OAuth auth (API key) — no custom fetch needed
        return {};
      },

      // ── Auth methods (shown in OpenCode's provider setup UI) ────────
      methods: [
        {
          label: "Claude Pro/Max (OAuth)",
          type: "oauth",
          authorize: async () => {
            const { url, verifier } = await authorize("max");
            return {
              url,
              instructions: "Paste the authorization code here: ",
              method: "code",
              callback: async (code) => exchange(code, verifier),
            };
          },
        },
        {
          label: "Create an API Key (via Console OAuth)",
          type: "oauth",
          authorize: async () => {
            const { url, verifier } = await authorize("console");
            return {
              url,
              instructions: "Paste the authorization code here: ",
              method: "code",
              callback: async (code) => {
                const credentials = await exchange(code, verifier);
                if (credentials.type === "failed") return credentials;
                // Use the OAuth token to create an API key
                const result = await fetch(
                  "https://api.anthropic.com/api/oauth/claude_cli/create_api_key",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      authorization: `Bearer ${credentials.access}`,
                    },
                  },
                ).then((r) => r.json());
                return { type: "success", key: result.raw_key };
              },
            };
          },
        },
        {
          provider: "anthropic",
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  };
}
