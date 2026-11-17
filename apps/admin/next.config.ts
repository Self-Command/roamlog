import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@roamlog/contracts", "@roamlog/ui"],
};

export default nextConfig;
