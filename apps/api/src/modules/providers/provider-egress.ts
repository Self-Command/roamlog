import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service.js";
import { providerProblem } from "./provider-errors.js";

export type ProviderEgressResolver = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<readonly { address: string; family: number }[]>;

export interface ProviderEgressOptions {
  allowPrivate?: boolean;
  resolve?: ProviderEgressResolver;
}

const METADATA_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "100.100.100.200",
]);

function hostnameOf(url: URL): string {
  return url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "");
}

function blocked(message: string): never {
  throw providerProblem("PROVIDER_EGRESS_BLOCKED", message);
}

function ipv4Parts(address: string): readonly number[] | null {
  if (isIP(address) !== 4) {
    return null;
  }
  const parts = address.split(".").map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part)) ? parts : null;
}

function isMetadataIp(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "169.254.169.254" ||
    normalized === "100.100.100.200" ||
    normalized === "fd00:ec2::254" ||
    normalized === "::ffff:169.254.169.254"
  );
}

function blockedIpv4(parts: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function blockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0] ?? "";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized)?.[1];
  if (mapped) {
    const parts = ipv4Parts(mapped);
    return parts ? blockedIpv4(parts) : true;
  }

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  const first = Number.parseInt(normalized.split(":", 1)[0] ?? "", 16);
  if (!Number.isFinite(first)) {
    return true;
  }

  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    normalized === "fd00:ec2::254"
  );
}

function isPrivateOrReservedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = ipv4Parts(address);
    return parts ? blockedIpv4(parts) : true;
  }
  if (family === 6) {
    return blockedIpv6(address);
  }
  return true;
}

@Injectable()
export class ProviderEgressGuard {
  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  async assertAllowed(url: URL, options: ProviderEgressOptions = {}): Promise<void> {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      blocked("Only HTTP(S) provider endpoints are allowed.");
    }
    if (url.username || url.password) {
      blocked("Provider endpoints must not contain credentials.");
    }
    if (url.search || url.hash) {
      blocked("Provider endpoints must not contain a query string or fragment.");
    }

    const hostname = hostnameOf(url);
    if (!hostname || METADATA_HOSTS.has(hostname) || hostname.endsWith(".localhost")) {
      blocked("That provider endpoint is not allowed from this deployment.");
    }
    if (hostname === "localhost") {
      blocked("Localhost provider endpoints are not allowed.");
    }

    const allowPrivate = this.privateEndpointsAllowed(options.allowPrivate);
    if (METADATA_HOSTS.has(hostname) || isMetadataIp(hostname)) {
      blocked("Cloud metadata endpoints are not allowed.");
    }

    if (isIP(hostname)) {
      if (isMetadataIp(hostname) || (!allowPrivate && isPrivateOrReservedIp(hostname))) {
        blocked("Private and reserved provider endpoints are not allowed.");
      }
      return;
    }

    const resolve = options.resolve ?? (dnsLookup as ProviderEgressResolver);
    let addresses: readonly { address: string; family: number }[];
    try {
      addresses = await resolve(hostname, { all: true, verbatim: true });
    } catch {
      // Let fetch report DNS/network failure; unresolved hosts cannot be
      // classified as an SSRF target and must not leak DNS details to the UI.
      return;
    }

    for (const entry of addresses) {
      if (isMetadataIp(entry.address) || (!allowPrivate && isPrivateOrReservedIp(entry.address))) {
        blocked("Private and reserved provider endpoints are not allowed.");
      }
    }
  }

  private privateEndpointsAllowed(requested?: boolean): boolean {
    if (this.config.nodeEnv === "production" || this.config.appEnv === "production") {
      return false;
    }
    if (requested === true) {
      return true;
    }
    return process.env.PROVIDER_EGRESS_ALLOW_PRIVATE === "true";
  }
}
