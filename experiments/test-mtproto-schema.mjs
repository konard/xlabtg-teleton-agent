/**
 * Sanity check: parse mtproto config with and without bot_api_proxy.
 * Run: node --experimental-strip-types experiments/test-mtproto-schema.mjs
 */
import { z } from "zod";

const _MtprotoProxyObject = z.object({
  server: z.string(),
  port: z.number().min(1).max(65535),
  secret: z.string(),
});

const _MtprotoObject = z.object({
  enabled: z.boolean().default(false),
  proxies: z.array(_MtprotoProxyObject).default([]),
  bot_api_proxy: z.string().url().optional(),
});

const cases = [
  {},
  { enabled: true, proxies: [{ server: "p.example.com", port: 443, secret: "a".repeat(32) }] },
  {
    enabled: true,
    proxies: [],
    bot_api_proxy: "socks5://127.0.0.1:1080",
  },
  {
    enabled: true,
    proxies: [],
    bot_api_proxy: "http://user:pass@proxy.example.com:8080",
  },
];

for (const c of cases) {
  console.log("OK:", _MtprotoObject.parse(c));
}

try {
  _MtprotoObject.parse({ bot_api_proxy: "not-a-url" });
  console.log("FAIL: should have thrown");
} catch (e) {
  console.log("OK invalid url rejected:", e.issues[0].message);
}
