/**
 * Minimal MCP Streamable-HTTP client (zero deps, Node 20+ global fetch).
 * Enough to call the HUB MCP server's tools from CI with a bearer token.
 *
 * NOTE: This is a scaffold. It implements the standard MCP Streamable-HTTP
 * handshake (initialize → notifications/initialized → tools/call) and parses
 * both JSON and SSE responses. It has NOT been run against the live HUB endpoint
 * — verify the auth scheme/scopes with a real token on first run (see RUNBOOK.md).
 */

const PROTOCOL_VERSION = "2025-06-18";

function parseBody(text, contentType) {
  if (contentType && contentType.includes("text/event-stream")) {
    // take the last `data:` line's JSON
    let last = null;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^data:\s*(.*)$/);
      if (m && m[1].trim()) { try { last = JSON.parse(m[1]); } catch (_) {} }
    }
    return last;
  }
  try { return JSON.parse(text); } catch (_) { return null; }
}

export class McpHttpClient {
  constructor(url, token, opts = {}) {
    this.url = url;
    this.token = token;
    this.sessionId = null;
    this.id = 0;
    this.headers = opts.headers || {};
  }

  async _rpc(method, params, isNotification = false) {
    const body = { jsonrpc: "2.0", method, params };
    if (!isNotification) body.id = ++this.id;
    const headers = {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      ...this.headers,
    };
    if (this.token) headers["authorization"] = "Bearer " + this.token;
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    const res = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(body) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (isNotification) { if (!res.ok && res.status !== 202) throw new Error(method + " → " + res.status); return null; }
    const text = await res.text();
    if (!res.ok) throw new Error(method + " → " + res.status + " " + text.slice(0, 300));
    const json = parseBody(text, res.headers.get("content-type") || "");
    if (!json) throw new Error(method + " → unparseable response");
    if (json.error) throw new Error(method + " → " + JSON.stringify(json.error));
    return json.result;
  }

  async init() {
    await this._rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "chapter-pm-refresh", version: "1.0.0" },
    });
    await this._rpc("notifications/initialized", {}, true);
    return this;
  }

  /** Call a tool; returns the parsed JSON payload (structuredContent, or text content JSON-parsed). */
  async call(name, args = {}) {
    const result = await this._rpc("tools/call", { name, arguments: args });
    if (result && result.structuredContent) return result.structuredContent;
    const content = result && result.content;
    if (Array.isArray(content)) {
      const textPart = content.find((c) => c.type === "text");
      if (textPart) { try { return JSON.parse(textPart.text); } catch (_) { return textPart.text; } }
    }
    return result;
  }
}

export async function connectHub() {
  const url = process.env.HUB_MCP_URL;
  const token = process.env.HUB_TOKEN;
  if (!url || !token) return null; // no secrets → caller skips HUB
  const c = new McpHttpClient(url, token);
  await c.init();
  return c;
}
