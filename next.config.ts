import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /** Fewer routes preloaded at startup → lower RSS in dev on small machines. */
    preloadEntriesOnStart: false,
    /** Webpack builds only; lowers peak memory vs default cache behavior in some setups. */
    webpackMemoryOptimizations: true,
  },
};

export default nextConfig;
