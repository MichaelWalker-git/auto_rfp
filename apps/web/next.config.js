const {withSentryConfig} = require("@sentry/nextjs");

const nextConfig = {
  // Note: 'standalone' output causes issues on Windows due to special characters in filenames
  // The CI/CD pipeline on Linux handles production builds correctly
  output: process.env.CI ? 'standalone' : undefined,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: ['@auto-rfp/shared'],

  // ── Short URL aliases ──────────────────────────────────────────────────────
  // /org/:orgId/... → /organizations/:orgId/...
  // /org/:orgId/prs/:projectId/... → /organizations/:orgId/projects/:projectId/...
  async redirects() {
    return [
      // /org/:orgId/prs/:projectId/:rest* → /organizations/:orgId/projects/:projectId/:rest*
      {
        source: '/org/:orgId/prs/:projectId/:path*',
        destination: '/organizations/:orgId/projects/:projectId/:path*',
        permanent: false,
      },
      // /org/:orgId/:rest* → /organizations/:orgId/:rest*
      {
        source: '/org/:orgId/:path*',
        destination: '/organizations/:orgId/:path*',
        permanent: false,
      },
      // /org → /organizations
      {
        source: '/org',
        destination: '/organizations',
        permanent: false,
      },
    ];
  },
};

module.exports = withSentryConfig(
  nextConfig,
  {
    org: "horus-technology",
    project: "auto-rfp",
    silent: !process.env.CI,
    widenClientFileUpload: true,
  }
);
