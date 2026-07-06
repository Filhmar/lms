import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Containerized deploys (Azure Container Apps / any OCI runtime) per docs/TECHSTACK.md
  output: "standalone",
  transpilePackages: ["@rl/ui"],
};

export default nextConfig;
