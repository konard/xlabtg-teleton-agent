import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

type LookupAddress = { address: string; family: number };
type LookupFn = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<LookupAddress[]>;

export interface OutboundUrlGuardOptions {
  allowedProtocols: readonly string[];
  label: string;
  lookup?: LookupFn;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "local", "metadata", "metadata.google.internal"]);
const defaultLookup = dnsLookup as LookupFn;

const blockedIpRanges = new BlockList();
blockedIpRanges.addSubnet("0.0.0.0", 8, "ipv4");
blockedIpRanges.addSubnet("10.0.0.0", 8, "ipv4");
blockedIpRanges.addSubnet("100.64.0.0", 10, "ipv4");
blockedIpRanges.addSubnet("127.0.0.0", 8, "ipv4");
blockedIpRanges.addSubnet("169.254.0.0", 16, "ipv4");
blockedIpRanges.addSubnet("172.16.0.0", 12, "ipv4");
blockedIpRanges.addSubnet("192.168.0.0", 16, "ipv4");
blockedIpRanges.addSubnet("198.18.0.0", 15, "ipv4");
blockedIpRanges.addSubnet("224.0.0.0", 4, "ipv4");
blockedIpRanges.addSubnet("240.0.0.0", 4, "ipv4");
blockedIpRanges.addAddress("255.255.255.255", "ipv4");

blockedIpRanges.addAddress("::", "ipv6");
blockedIpRanges.addAddress("::1", "ipv6");
blockedIpRanges.addSubnet("fc00::", 7, "ipv6");
blockedIpRanges.addSubnet("fe80::", 10, "ipv6");
blockedIpRanges.addSubnet("ff00::", 8, "ipv6");

export function validateOutboundUrl(raw: string, options: OutboundUrlGuardOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid ${options.label}: ${raw}`);
  }

  if (!options.allowedProtocols.includes(url.protocol)) {
    throw new Error(
      `${options.label} must use ${formatProtocols(options.allowedProtocols)} - got "${url.protocol}"`
    );
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    throw new Error(`${options.label} must include a host`);
  }

  validateHostname(hostname, options.label);
  validateIpAddress(hostname, options.label, "targets");

  return url;
}

export async function validateResolvedOutboundUrl(
  raw: string,
  options: OutboundUrlGuardOptions
): Promise<URL> {
  const url = validateOutboundUrl(raw, options);
  const hostname = normalizeHostname(url.hostname);
  if (isIP(hostname) !== 0) return url;

  const resolver = options.lookup ?? defaultLookup;
  const addresses = await resolver(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error(`${options.label} hostname could not be resolved: ${hostname}`);
  }

  for (const { address } of addresses) {
    validateIpAddress(normalizeHostname(address), options.label, "resolves to");
  }

  return url;
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "");
}

function validateHostname(hostname: string, label: string): void {
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "local") {
    throw new Error(`${label} targets loopback hostname: ${hostname}`);
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`${label} targets metadata hostname: ${hostname}`);
  }
}

function validateIpAddress(hostname: string, label: string, verb: "targets" | "resolves to"): void {
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    if (blockedIpRanges.check(hostname, "ipv4")) {
      throw new Error(`${label} ${verb} a private/loopback/metadata address: ${hostname}`);
    }
    return;
  }

  if (ipVersion === 6) {
    const mappedIpv4 = getMappedIpv4(hostname);
    if (mappedIpv4 && blockedIpRanges.check(mappedIpv4, "ipv4")) {
      throw new Error(`${label} ${verb} a private/loopback/metadata address: ${hostname}`);
    }
    if (blockedIpRanges.check(hostname, "ipv6")) {
      throw new Error(`${label} ${verb} a private/loopback/metadata address: ${hostname}`);
    }
  }
}

function getMappedIpv4(hostname: string): string | undefined {
  const dotted = hostname.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];

  const hex = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return undefined;

  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function formatProtocols(protocols: readonly string[]): string {
  if (protocols.length === 1) return protocols[0];
  return `${protocols.slice(0, -1).join(", ")} or ${protocols[protocols.length - 1]}`;
}
