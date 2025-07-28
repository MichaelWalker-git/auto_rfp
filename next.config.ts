import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Remove static export - we're using hybrid deployment with API Gateway
  // output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  
  // API routes will be handled by Lambda through API Gateway
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_GATEWAY_URL || 'https://woyk8wa639.execute-api.us-east-1.amazonaws.com/prod'}/api/:path*`,
      },
    ];
  },
  
  // Optimize for production
  experimental: {
    optimizePackageImports: ['@headlessui/react'],
  },
};

export default nextConfig;
