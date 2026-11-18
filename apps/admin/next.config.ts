import type { NextConfig } from "next";

function resolveAssetPrefix(value: string | undefined): string | undefined {
  const prefix = value?.trim();
  if (!prefix) {
    return undefined;
  }
  return prefix.length > 1 ? prefix.replace(/\/+$/, "") : prefix;
}

const nextConfig: NextConfig = {
  assetPrefix: resolveAssetPrefix(process.env.NEXT_PUBLIC_ADMIN_ASSET_PREFIX),
  transpilePackages: ["@roamlog/contracts", "@roamlog/ui"],
};

export default nextConfig;
