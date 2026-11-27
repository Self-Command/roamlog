#!/usr/bin/env node

const baseUrl = (process.argv[2] ?? process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3000").replace(
  /\/+$/u,
  "",
);
const internalAssets = process.argv.includes("--internal-assets");
const sampleArgument = process.argv.find((argument) => argument.startsWith("--sample="));
const sampleSize = sampleArgument ? Number(sampleArgument.slice("--sample=".length)) : undefined;
const prefix = (process.env.NEXT_PUBLIC_ADMIN_ASSET_PREFIX ?? "/admin-assets")
  .trim()
  .replace(/\/+$/u, "");

if (prefix && !prefix.startsWith("/")) {
  throw new Error(`NEXT_PUBLIC_ADMIN_ASSET_PREFIX must start with "/", received "${prefix}"`);
}

const response = await fetch(`${baseUrl}/admin`, {
  headers: { accept: "text/html" },
  redirect: "manual",
});
if (!response.ok) {
  throw new Error(`GET ${baseUrl}/admin returned ${String(response.status)}`);
}

const html = await response.text();
if (prefix) {
  const withoutPrefixedAssets = html.split(`${prefix}/_next/`).join("");
  const rootAssetUrls = [
    ...new Set(
      withoutPrefixedAssets.match(/(?:_next\/static\/|[^"'=]\/_next\/)[^"'\\\s]+/gu) ?? [],
    ),
  ];
  if (rootAssetUrls.length > 0) {
    throw new Error(
      `Admin HTML contains root /_next asset URLs instead of ${prefix}/_next: ${rootAssetUrls
        .slice(0, 5)
        .join(", ")}`,
    );
  }
}

const assetBase = prefix ? `${prefix}/_next/` : "/_next/";
const assetUrls = [
  ...new Set(
    [...html.matchAll(/(?:src|href)="([^"]+)"/gu)]
      .map((match) => match[1])
      .filter((url) => url.startsWith(assetBase))
      .filter((url) => /\.(?:js|css)$/u.test(url)),
  ),
];
if (assetUrls.length === 0) {
  throw new Error(`Admin HTML contains no ${assetBase} JavaScript or CSS assets`);
}

if (
  sampleSize !== undefined &&
  (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > assetUrls.length)
) {
  throw new Error(`--sample must be between 1 and ${String(assetUrls.length)}`);
}

const probes = sampleSize === undefined ? assetUrls : assetUrls.slice(0, sampleSize);
const probeResponses = await Promise.all(
  probes.map(async (assetUrl) => {
    const requestUrl =
      internalAssets && prefix ? `/_next/${assetUrl.slice(`${prefix}/_next/`.length)}` : assetUrl;
    const assetResponse = await fetch(new URL(requestUrl, baseUrl), {
      headers: { accept: "*/*" },
    });
    return { assetUrl, requestUrl, status: assetResponse.status };
  }),
);
const failed = probeResponses.filter(({ status }) => !status.toString().startsWith("2"));
if (failed.length > 0) {
  throw new Error(
    `Admin asset probes failed: ${failed
      .map(({ requestUrl, status }) => `${requestUrl} -> ${String(status)}`)
      .join(", ")}`,
  );
}

console.log(
  JSON.stringify({
    ok: true,
    page: `${baseUrl}/admin`,
    prefix: prefix || null,
    internalAssets,
    discoveredAssets: assetUrls.length,
    probedAssets: probeResponses.map(({ assetUrl, requestUrl, status }) => ({
      assetUrl,
      requestUrl,
      status,
    })),
  }),
);
