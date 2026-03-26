import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

// ─── Constants ──────────────────────────────────────────────────────────────────

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_ENDPOINT = "https://platform.claude.com/v1/oauth/token";
const REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const OAUTH_SCOPES = "org:create_api_key user:profile user:inference";
const SYSTEM_PREFIX =
  "You are Claude Code, Anthropic's official CLI for Claude.";
const USER_AGENT = "claude-cli/2.1.2 (external, cli)";
const TOOL_PREFIX = "mcp_";
const REQUIRED_BETAS = [
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
];

// ─── PKCE (zero dependencies) ───────────────────────────────────────────────────

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generatePKCE() {
  const crypto = globalThis.crypto ?? webcrypto;
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  const verifier = Array.from(arr, (b) => chars[b % chars.length]).join("");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(digest) };
}

// ─── OAuth helpers ──────────────────────────────────────────────────────────────

async function authorize(mode) {
  const pkce = await generatePKCE();
  const host = mode === "console" ? "platform.claude.com" : "claude.ai";
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

async function exchange(code, verifier) {
  const splits = code.split("#");
  const result = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: splits[0],
      state: splits[1],
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!result.ok) return { type: "failed" };
  const json = await result.json();
  return {
    type: "success",
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

// ─── Request rewriting ──────────────────────────────────────────────────────────

function sanitizeSystem(system) {
  if (!Array.isArray(system)) return system;
  return system.map((item) =>
    item.type === "text" && item.text
      ? {
          ...item,
          text: item.text
            .replace(/OpenCode/g, "Claude Code")
            .replace(/opencode/gi, "Claude"),
        }
      : item,
  );
}

function prefixTools(parsed) {
  if (parsed.tools && Array.isArray(parsed.tools)) {
    parsed.tools = parsed.tools.map((t) => ({
      ...t,
      name: t.name ? `${TOOL_PREFIX}${t.name}` : t.name,
    }));
  }
  if (parsed.messages && Array.isArray(parsed.messages)) {
    parsed.messages = parsed.messages.map((msg) => {
      if (msg.content && Array.isArray(msg.content)) {
        msg.content = msg.content.map((block) =>
          block.type === "tool_use" && block.name
            ? { ...block, name: `${TOOL_PREFIX}${block.name}` }
            : block,
        );
      }
      return msg;
    });
  }
  return parsed;
}

function stripToolPrefix(response) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      let text = decoder.decode(value, { stream: true });
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

// ─── Token refresh ──────────────────────────────────────────────────────────────

let _refreshPromise = null;

function readClaudeCodeTokens() {
  // Try macOS keychain first (Claude Code 2.1.x+)
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
    ).trim();
    const oauth = JSON.parse(raw).claudeAiOauth;
    if (oauth?.accessToken && oauth.expiresAt > Date.now() + 60000) {
      return {
        access: oauth.accessToken,
        refresh: oauth.refreshToken,
        expires: oauth.expiresAt,
      };
    }
  } catch {}

  // Fallback: file-based credentials
  try {
    const raw = readFileSync(
      join(homedir(), ".claude", ".credentials.json"),
      "utf8",
    );
    const oauth = JSON.parse(raw).claudeAiOauth;
    if (oauth?.accessToken && oauth.expiresAt > Date.now() + 60000) {
      return {
        access: oauth.accessToken,
        refresh: oauth.refreshToken,
        expires: oauth.expiresAt,
      };
    }
  } catch {}
  return null;
}

async function refreshToken(currentAuth, client) {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    // Try API refresh (single attempt — no retry loops)
    try {
      const res = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: currentAuth.refresh,
          client_id: CLIENT_ID,
        }),
      });
      if (res.ok) {
        const json = await res.json();
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
    } catch {}

    // Fallback: read from Claude Code if installed
    const cc = readClaudeCodeTokens();
    if (cc) {
      await client.auth.set({
        path: { id: "anthropic" },
        body: { type: "oauth", ...cc },
      });
      return cc.access;
    }

    throw new Error(
      "Token refresh failed. Disconnect & reconnect Anthropic in OpenCode.",
    );
  })();
  try {
    return await _refreshPromise;
  } finally {
    _refreshPromise = null;
  }
}

// ─── Plugin ─────────────────────────────────────────────────────────────────────

/** @type {import('@opencode-ai/plugin').Plugin} */
export async function AnthropicAuthPlugin({ client }) {
  return {
    "experimental.chat.system.transform": (_input, output) => {
      if (_input.model?.providerID === "anthropic") {
        output.system.unshift(SYSTEM_PREFIX);
        if (output.system[1])
          output.system[1] = SYSTEM_PREFIX + "\n\n" + output.system[1];
      }
    },

    auth: {
      provider: "anthropic",

      async loader(getAuth, provider) {
        const auth = await getAuth();
        if (auth.type !== "oauth") return {};

        // Zero out cost for subscription users
        for (const m of Object.values(provider.models)) {
          m.cost = { input: 0, output: 0, cache: { read: 0, write: 0 } };
        }

        return {
          apiKey: "",
          async fetch(input, init) {
            let currentAuth = await getAuth();
            if (currentAuth.type !== "oauth") return fetch(input, init);

            // Refresh 5 min before expiry
            if (
              !currentAuth.access ||
              currentAuth.expires < Date.now() + 300000
            ) {
              currentAuth.access = await refreshToken(currentAuth, client);
            }

            // Build headers
            const ri = init ?? {};
            const h = new Headers();
            if (input instanceof Request)
              input.headers.forEach((v, k) => h.set(k, v));
            if (ri.headers) {
              const src =
                ri.headers instanceof Headers
                  ? ri.headers
                  : new Headers(ri.headers);
              src.forEach((v, k) => h.set(k, v));
            }

            const existingBeta = h.get("anthropic-beta") || "";
            const betas = [
              ...new Set([
                ...REQUIRED_BETAS,
                ...existingBeta.split(",").map((s) => s.trim()).filter(Boolean),
              ]),
            ].join(",");

            h.set("authorization", `Bearer ${currentAuth.access}`);
            h.set("anthropic-beta", betas);
            h.set("user-agent", USER_AGENT);
            h.delete("x-api-key");

            // Rewrite body
            let body = ri.body;
            if (body && typeof body === "string") {
              try {
                let p = JSON.parse(body);
                p.system = sanitizeSystem(p.system);
                p = prefixTools(p);
                body = JSON.stringify(p);
              } catch {}
            }

            // Add ?beta=true to /v1/messages
            let reqInput = input;
            try {
              const u = new URL(
                typeof input === "string"
                  ? input
                  : input instanceof Request
                    ? input.url
                    : input.toString(),
              );
              if (u.pathname === "/v1/messages" && !u.searchParams.has("beta")) {
                u.searchParams.set("beta", "true");
                reqInput =
                  input instanceof Request
                    ? new Request(u.toString(), input)
                    : u;
              }
            } catch {}

            const res = await fetch(reqInput, { ...ri, body, headers: h });
            return stripToolPrefix(res);
          },
        };
      },

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
          label: "Create an API Key",
          type: "oauth",
          authorize: async () => {
            const { url, verifier } = await authorize("console");
            return {
              url,
              instructions: "Paste the authorization code here: ",
              method: "code",
              callback: async (code) => {
                const creds = await exchange(code, verifier);
                if (creds.type === "failed") return creds;
                const r = await fetch(
                  "https://api.anthropic.com/api/oauth/claude_cli/create_api_key",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      authorization: `Bearer ${creds.access}`,
                    },
                  },
                ).then((r) => r.json());
                return { type: "success", key: r.raw_key };
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
