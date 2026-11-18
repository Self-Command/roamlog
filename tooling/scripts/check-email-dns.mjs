#!/usr/bin/env node
/**
 * Roamlog production email DNS preflight.
 *
 * Read-only: this script only resolves DNS records. It never sends mail and
 * never talks to Resend, SMTP, or any HTTP API.
 *
 * Checks, for --domain:
 *   SPF    TXT at the apex containing v=spf1 (exactly one is allowed)
 *   DKIM   TXT at <selector>._domainkey.<domain> with a non-empty p=
 *   DMARC  TXT at _dmarc.<domain> containing v=DMARC1
 *   MX     MX records for the apex (or the provider return-path subdomain)
 *
 * Usage:
 *   node tooling/scripts/check-email-dns.mjs --domain example.com
 *   node tooling/scripts/check-email-dns.mjs --domain example.com --dkim-selector resend
 *   node tooling/scripts/check-email-dns.mjs --domain example.com --json
 *   node tooling/scripts/check-email-dns.mjs --domain example.com --nameserver 10.0.0.53
 *
 * Exit codes: 0 all checks pass, 1 a record is missing/invalid,
 *             2 DNS lookup failed (offline/resolver error), 64 bad usage.
 */

import { Resolver } from "node:dns/promises";

const USAGE = `Usage: check-email-dns.mjs --domain <domain> [--dkim-selector <selector>] [--json] [--timeout <ms>]
                                [--nameserver <ip[:port]>]

Exit codes:
  0  every record is present and usable
  1  a record is missing or invalid
  2  DNS lookup failed (no network / resolver unreachable)
  64 bad usage
`;

const DEFAULT_SELECTOR = "resend";
const DEFAULT_TIMEOUT_MS = 5_000;

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_DNS_ERROR = 2;
const EXIT_USAGE = 64;

function fail(message, code = EXIT_USAGE) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArguments(argv) {
  const options = {
    domain: undefined,
    dkimSelector: DEFAULT_SELECTOR,
    json: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    nameserver: undefined,
  };

  const next = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`${flag} requires a value\n\n${USAGE}`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--domain":
        options.domain = next(index, argument);
        index += 1;
        break;
      case "--dkim-selector":
        options.dkimSelector = next(index, argument);
        index += 1;
        break;
      case "--timeout": {
        const raw = Number(next(index, argument));
        if (!Number.isInteger(raw) || raw < 500 || raw > 60_000) {
          fail("--timeout must be an integer between 500 and 60000 milliseconds");
        }
        options.timeoutMs = raw;
        index += 1;
        break;
      }
      case "--json":
        options.json = true;
        break;
      case "--nameserver": {
        const raw = next(index, argument).trim();
        // Node accepts an IPv4/IPv6 address with an optional [ip]:port form.
        if (
          !/^([0-9]{1,3}(\.[0-9]{1,3}){3}|\[[0-9a-fA-F:]+\])?(:[0-9]{1,5})?$/u.test(raw) ||
          raw === ""
        ) {
          fail(`--nameserver must be an IP address, optionally with :port (got: ${raw})`);
        }
        options.nameserver = raw;
        index += 1;
        break;
      }
      case "--help":
      case "-h":
        process.stdout.write(USAGE);
        process.exit(EXIT_PASS);
        break;
      default:
        fail(`Unknown argument: ${argument}\n\n${USAGE}`);
    }
  }

  if (!options.domain) {
    fail(`--domain is required\n\n${USAGE}`);
  }
  return options;
}

function normalizeDomain(domain) {
  const normalized = domain.trim().toLowerCase().replace(/\.$/u, "");
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/u.test(normalized)) {
    fail(`--domain is not a valid registrable domain: ${domain}`);
  }
  return normalized;
}

function normalizeSelector(selector) {
  const normalized = selector.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,63}(\._domainkey)?$/u.test(normalized)) {
    fail(`--dkim-selector is invalid: ${selector}`);
  }
  return normalized.replace(/\._domainkey$/u, "");
}

function isDnsFailureCode(code) {
  return [
    "ENOTFOUND",
    "ENODATA",
    "ETIMEOUT",
    "EAI_AGAIN",
    "ESERVFAIL",
    "ECONNREFUSED",
    "ECANCELLED",
  ].includes(code);
}

function describeError(error) {
  const code =
    error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
  const message = error instanceof Error ? error.message : String(error);
  return `${code}: ${message}`;
}

function flattenTxt(chunks) {
  return Array.isArray(chunks) ? chunks.join("") : String(chunks);
}

async function checkSpf(resolver, domain) {
  const name = domain;
  const result = await lookupWith(resolver, "resolveTxt", name);
  const check = {
    id: "spf",
    name,
    record: "TXT",
    status: "FAIL",
    detail: "",
    values: [],
  };

  if (!result.ok) {
    check.detail = result.missing
      ? `no TXT record at ${name}`
      : `lookup failed for ${name} (${result.detail})`;
    if (!result.missing) {
      check.lookupFailed = true;
    }
    return { check, transient: result.transient };
  }

  const txtRecords = result.records.map(flattenTxt);
  const spfRecords = txtRecords.filter((record) => /^v=spf1(\s|$)/iu.test(record.trim()));

  check.values = spfRecords;
  if (spfRecords.length === 0) {
    check.detail = "no v=spf1 TXT record at the apex";
  } else if (spfRecords.length > 1) {
    check.detail = `${spfRecords.length} v=spf1 records found; publish exactly one (multiple records break SPF)`;
  } else {
    const record = spfRecords[0].trim();
    check.status = "PASS";
    check.detail = record;
    if (/(^|\s)\+all(\s|$)/iu.test(record)) {
      check.warning = "SPF ends with +all, which authorises every sender";
    } else if (/(^|\s)\?all(\s|$)/iu.test(record)) {
      check.warning = "SPF uses ?all (neutral); use ~all or -all for a real policy";
    }
  }

  return { check, transient: result.transient };
}

async function checkDkim(resolver, selector, domain) {
  const name = `${selector}._domainkey.${domain}`;
  const result = await lookupWith(resolver, "resolveTxt", name);
  const check = {
    id: "dkim",
    name,
    record: "TXT",
    status: "FAIL",
    detail: "",
    values: [],
  };

  if (!result.ok) {
    check.detail = result.missing
      ? `no TXT record at ${name} (selector "${selector}")`
      : `lookup failed for ${name} (${result.detail})`;
    if (!result.missing) {
      check.lookupFailed = true;
    }
    return { check, transient: result.transient };
  }

  const records = result.records.map(flattenTxt).filter((record) => /(^|;)\s*p=/iu.test(record));
  check.values = records;

  if (records.length === 0) {
    check.detail = `no DKIM public key at ${name}`;
    return { check, transient: result.transient };
  }

  const record = records[0].trim();
  const key = /;\s*p=([^;]*)/iu.exec(record)?.[1]?.trim() ?? "";
  if (!key) {
    check.detail = "DKIM record has an empty p= value (key revoked)";
  } else {
    check.status = "PASS";
    check.detail = `${key.slice(0, 24)}... (${key.length} chars)`;
    if (/;\s*k=rsa\b/iu.test(record) === false && !/;\s*k=/iu.test(record)) {
      check.warning = "DKIM record has no k= tag; RSA is assumed";
    }
  }

  return { check, transient: result.transient };
}

async function checkDmarc(resolver, domain) {
  const name = `_dmarc.${domain}`;
  const result = await lookupWith(resolver, "resolveTxt", name);
  const check = {
    id: "dmarc",
    name,
    record: "TXT",
    status: "FAIL",
    detail: "",
    values: [],
  };

  if (!result.ok) {
    check.detail = result.missing
      ? `no TXT record at ${name}`
      : `lookup failed for ${name} (${result.detail})`;
    if (!result.missing) {
      check.lookupFailed = true;
    }
    return { check, transient: result.transient };
  }

  const records = result.records
    .map(flattenTxt)
    .filter((record) => /^v=DMARC1\s*;/iu.test(record.trim()));
  check.values = records;

  if (records.length === 0) {
    check.detail = `${name} has no v=DMARC1 record`;
    return { check, transient: result.transient };
  }

  const record = records[0].trim();
  check.status = "PASS";
  check.detail = record;

  const policy = /(^|;)\s*p\s*=\s*([a-z]+)/iu.exec(record)?.[2]?.toLowerCase();
  if (policy === "none") {
    check.warning = "DMARC policy is p=none (monitor only); tighten to quarantine/reject";
  }
  if (!/(^|;)\s*rua\s*=/iu.test(record)) {
    check.warning = "DMARC has no rua= report address";
  }

  return { check, transient: result.transient };
}

async function checkMx(resolver, domain) {
  const result = await lookupWith(resolver, "resolveMx", domain);
  const check = {
    id: "mx",
    name: domain,
    record: "MX",
    status: "FAIL",
    detail: "",
    values: [],
  };

  if (!result.ok) {
    check.detail = result.missing
      ? `no MX record at ${domain}`
      : `lookup failed for ${domain} (${result.detail})`;
    if (!result.missing) {
      check.lookupFailed = true;
    }
    // A sending-only domain often publishes its return-path MX on a
    // provider subdomain instead of the apex, so try that before failing.
    const fallbackName = `send.${domain}`;
    const fallback = await lookupWith(resolver, "resolveMx", fallbackName);
    if (fallback.ok && fallback.records.length > 0) {
      check.status = "PASS";
      check.name = fallbackName;
      check.values = fallback.records.map((entry) => `${entry.priority} ${entry.exchange}`);
      check.detail = `no apex MX; using return-path MX at ${fallbackName}`;
      delete check.lookupFailed;
      check.warning = "apex has no MX, so bounce handling depends on the provider subdomain";
    }
    return { check, transient: result.transient || fallback.transient };
  }

  const usable = result.records.filter(
    (entry) => entry.exchange && entry.exchange !== "." && entry.exchange !== "",
  );
  const records = [...usable]
    .sort((left, right) => left.priority - right.priority)
    .map((entry) => `${entry.priority} ${entry.exchange}`);
  check.values = records;

  if (records.length === 0) {
    check.detail = `null MX at ${domain} (RFC 7505): the domain accepts no mail`;
    check.warning = "publish an MX (or a send.<domain> return-path MX) if bounces must be received";
  } else {
    check.status = "PASS";
    check.detail = records.join(", ");
  }

  return { check, transient: result.transient };
}

/**
 * Wrap a resolver call so a missing record and a resolver outage are
 * distinguishable, and so a transient outage is tracked separately.
 */
async function lookupWith(resolver, method, name) {
  try {
    const records = await resolver[method](name);
    return { ok: true, records, transient: false };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { ok: false, missing: true, code, detail: `${code}: ${name}` };
    }
    return {
      ok: false,
      missing: false,
      transient: isDnsFailureCode(code),
      code,
      detail: describeError(error),
    };
  }
}

function formatReport(report) {
  const lines = [];
  lines.push("Roamlog email DNS preflight (read-only, no mail is sent)");
  lines.push(`domain:   ${report.domain}`);
  lines.push(`selector: ${report.dkimSelector}`);
  lines.push("");

  for (const check of report.checks) {
    const status = check.status.padEnd(4);
    lines.push(`${check.id.toUpperCase().padEnd(6)} ${status} ${check.name} (${check.record})`);
    lines.push(`         ${check.detail}`);
    if (check.warning) {
      lines.push(`         warning: ${check.warning}`);
    }
  }

  const missing = report.checks.filter((check) => check.status !== "PASS").map((check) => check.id);
  lines.push("");
  lines.push(
    `overall: ${report.status}${missing.length ? ` (missing/invalid: ${missing.join(", ")})` : ""}`,
  );
  if (report.warnings.length > 0) {
    lines.push(`warnings: ${report.warnings.length}`);
  }
  return lines.join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const domain = normalizeDomain(options.domain);
  const dkimSelector = normalizeSelector(options.dkimSelector);
  const resolver = new Resolver({ timeout: options.timeoutMs, tries: 2 });
  if (options.nameserver) {
    try {
      resolver.setServers([options.nameserver]);
    } catch (error) {
      fail(`--nameserver is not usable: ${describeError(error)}`);
    }
  }

  const results = [
    await checkSpf(resolver, domain),
    await checkDkim(resolver, dkimSelector, domain),
    await checkDmarc(resolver, domain),
    await checkMx(resolver, domain),
  ];

  const checks = results.map((result) => result.check);
  const transient = results.some((result) => result.transient);
  const failed = checks.filter((check) => check.status !== "PASS");
  const warnings = checks.filter((check) => check.warning).map((check) => check.id);

  // Every lookup errored and at least one did so transiently: treat this as an
  // environment problem (offline, wrong resolver) rather than a DNS grade.
  const everyCheckErrored = checks.every((check) => check.lookupFailed === true);
  if (everyCheckErrored && transient) {
    process.stderr.write(
      `DNS lookup failed for ${domain}: ${checks[0]?.detail ?? "unknown error"}\n` +
        "No network or the configured resolver is unreachable. Nothing was graded.\n",
    );
    process.exit(EXIT_DNS_ERROR);
  }

  const report = {
    domain,
    dkimSelector,
    status: failed.length === 0 ? "PASS" : "FAIL",
    checks,
    warnings,
    checkedAt: new Date().toISOString(),
  };

  if (options.nameserver) {
    report.nameserver = options.nameserver;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(report)}\n`);
  }

  process.exit(failed.length === 0 ? EXIT_PASS : EXIT_FAIL);
}

main().catch((error) => {
  process.stderr.write(`check-email-dns failed: ${describeError(error)}\n`);
  process.exit(EXIT_DNS_ERROR);
});
