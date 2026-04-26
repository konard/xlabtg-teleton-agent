/**
 * HTTP/HTTPS/SOCKS proxy agent for Telegram Bot API HTTPS calls.
 *
 * MTProto proxies cannot tunnel HTTPS to api.telegram.org. When the user
 * is in a region where Telegram is blocked at the IP level, the Bot API
 * path needs a separate HTTP or SOCKS proxy. This helper parses the
 * configured URL and returns the matching node-fetch / http.Agent compatible
 * agent.
 */

import type { Agent as HttpAgent } from "http";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

export type BotApiProxyAgent = HttpAgent;

const SUPPORTED_PROTOCOLS = new Set([
  "http:",
  "https:",
  "socks:",
  "socks4:",
  "socks4a:",
  "socks5:",
  "socks5h:",
]);

/**
 * Build an http.Agent that tunnels Bot API requests through the given proxy URL.
 *
 * @throws Error if the URL is not a parseable URL or uses an unsupported protocol.
 */
export function createBotApiProxyAgent(proxyUrl: string): BotApiProxyAgent {
  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new Error(`Invalid Bot API proxy URL: ${proxyUrl}`);
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `Unsupported Bot API proxy protocol "${parsed.protocol}" — use http://, https://, or socks5://`
    );
  }

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return new HttpsProxyAgent(parsed) as unknown as HttpAgent;
  }

  return new SocksProxyAgent(parsed) as unknown as HttpAgent;
}
