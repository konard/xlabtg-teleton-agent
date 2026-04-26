/**
 * Tests for createBotApiProxyAgent helper.
 * Verifies that HTTP/HTTPS/SOCKS proxy URLs produce the correct agent class
 * and that invalid URLs / unsupported protocols throw.
 */
import { describe, it, expect } from "vitest";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { createBotApiProxyAgent } from "../bot-api-proxy.js";

describe("createBotApiProxyAgent", () => {
  it("returns an HttpsProxyAgent for http:// URLs", () => {
    const agent = createBotApiProxyAgent("http://proxy.example.com:8080");
    expect(agent).toBeInstanceOf(HttpsProxyAgent);
  });

  it("returns an HttpsProxyAgent for https:// URLs", () => {
    const agent = createBotApiProxyAgent("https://proxy.example.com:8443");
    expect(agent).toBeInstanceOf(HttpsProxyAgent);
  });

  it("supports basic auth credentials in the URL", () => {
    const agent = createBotApiProxyAgent("http://user:pass@proxy.example.com:8080");
    expect(agent).toBeInstanceOf(HttpsProxyAgent);
  });

  it("returns a SocksProxyAgent for socks5:// URLs", () => {
    const agent = createBotApiProxyAgent("socks5://proxy.example.com:1080");
    expect(agent).toBeInstanceOf(SocksProxyAgent);
  });

  it("returns a SocksProxyAgent for socks5h:// URLs (remote DNS)", () => {
    const agent = createBotApiProxyAgent("socks5h://proxy.example.com:1080");
    expect(agent).toBeInstanceOf(SocksProxyAgent);
  });

  it("returns a SocksProxyAgent for socks4:// URLs", () => {
    const agent = createBotApiProxyAgent("socks4://proxy.example.com:1080");
    expect(agent).toBeInstanceOf(SocksProxyAgent);
  });

  it("throws on a malformed URL", () => {
    expect(() => createBotApiProxyAgent("not-a-url")).toThrow(/Invalid Bot API proxy URL/);
  });

  it("throws on an unsupported protocol", () => {
    expect(() => createBotApiProxyAgent("ftp://proxy.example.com")).toThrow(
      /Unsupported Bot API proxy protocol/
    );
  });
});
