/** @type {import('next').NextConfig} */
const nextConfig = {
  // Configure environment variables that will be available on both server and client side
  env: {
    // You will need to set LLAMACLOUD_API_KEY in your deployment environment
    // or in a .env.local file that's not committed to version control
    LLAMACLOUD_API_KEY: process.env.LLAMACLOUD_API_KEY,
  },
  // Enable standalone output for Docker builds
  output: 'standalone',
  // Other Next.js config options
  reactStrictMode: true,
}

module.exports = nextConfig;
