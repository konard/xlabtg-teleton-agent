/**
 * Smoke test: createBotApiProxyAgent returns the right class for each scheme.
 * Run: npx tsx experiments/test-bot-api-proxy.mjs
 */
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { createBotApiProxyAgent } from "../src/telegram/bot-api-proxy.ts";

const cases = [
  ["http://proxy.example.com:8080", HttpsProxyAgent],
  ["https://proxy.example.com:8443", HttpsProxyAgent],
  ["socks5://proxy.example.com:1080", SocksProxyAgent],
  ["socks5h://proxy.example.com:1080", SocksProxyAgent],
  ["socks4://proxy.example.com:1080", SocksProxyAgent],
];

for (const [url, expected] of cases) {
  const agent = createBotApiProxyAgent(url);
  const ok = agent instanceof expected;
  console.log(ok ? "✓" : "✗", url, "->", agent.constructor.name);
}

try {
  createBotApiProxyAgent("not-a-url");
  console.log("✗ invalid URL did not throw");
} catch (e) {
  console.log("✓ invalid URL rejected:", e.message);
}

try {
  createBotApiProxyAgent("ftp://x");
  console.log("✗ ftp:// did not throw");
} catch (e) {
  console.log("✓ ftp:// rejected:", e.message);
}
