const {withSentryConfig} = require("@sentry/nextjs");

const nextConfig = {
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: ['@auto-rfp/shared'],
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
