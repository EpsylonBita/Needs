const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true'
});
const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: process.env.NEXT_PUBLIC_API_DOMAIN || 'localhost',
      }
    ],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    minimumCacheTTL: 60, // Cache images for at least 60 seconds
  },
  rewrites: async () => {
    return []
  },
  eslint: {
    ignoreDuringBuilds: process.env.CI_STRICT === 'true' ? false : true,
  },
  typescript: {
    ignoreBuildErrors: process.env.CI_STRICT === 'true' ? false : true,
  },
  // Experimental features
  experimental: {
    optimizeCss: true,
    // Disabled optimizePackageImports to avoid dev-time ChunkLoadError instability
    // See Next.js issue: dynamic client chunks can fail when packages are rewritten
    // optimizePackageImports: [],
    // Enable server actions for modern data fetching patterns
    serverActions: {
      allowedOrigins: ['localhost:3000']
    },
    // Improved memory usage
    memoryBasedWorkersCount: true
  },
  headers: async () => {
    return []
  },
  // Exclude certain pages from static optimization
  skipTrailingSlashRedirect: true,
  // Don't attempt to statically generate protected or auth-dependent pages
  staticPageGenerationTimeout: 120,
  pageExtensions: ['js', 'jsx', 'ts', 'tsx'],
  // Configure webpack if needed
  webpack: (config, { isServer }) => {
    // Resolve webworker-threads to our mock implementation
    config.resolve.alias['webworker-threads'] = path.resolve(__dirname, './lib/mocks/webworker-threads.ts');

    return config;
  },
  env: {
    NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  },
};

module.exports = withBundleAnalyzer(nextConfig);