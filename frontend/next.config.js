const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true'
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
const profilePhotoPatterns = supabaseUrl && ['https:', 'http:'].includes(supabaseUrl.protocol) ? [{
  protocol: supabaseUrl.protocol === 'https:' ? 'https' : 'http',
  hostname: supabaseUrl.hostname,
  port: supabaseUrl.port,
  pathname: '/storage/v1/object/public/avatars/**',
  search: '',
}] : [];

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEEDS_E2E === '1' ? '.next-e2e' : '.next',
  outputFileTracingRoot: __dirname,
  reactStrictMode: true,
  images: {
    remotePatterns: [
      ...profilePhotoPatterns,
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
  typescript: {
    ignoreBuildErrors: false,
  },
  // Experimental features
  experimental: {
    // Disabled optimizePackageImports to avoid dev-time ChunkLoadError instability
    // See Next.js issue: dynamic client chunks can fail when packages are rewritten
    // optimizePackageImports: [],
    // Enable server actions for modern data fetching patterns
    serverActions: {
      allowedOrigins: ['localhost:3002', '127.0.0.1:3002']
    },
    // Improved memory usage
    cpus: 2
  },
  headers: async () => {
    return []
  },
  // Exclude certain pages from static optimization
  skipTrailingSlashRedirect: true,
  // Don't attempt to statically generate protected or auth-dependent pages
  staticPageGenerationTimeout: 120,
  pageExtensions: ['js', 'jsx', 'ts', 'tsx'],
  turbopack: {
    root: __dirname,
    resolveAlias: {
      'webworker-threads': './lib/mocks/webworker-threads.ts',
    },
  },
  env: {
    NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  },
};

module.exports = withBundleAnalyzer(nextConfig);
