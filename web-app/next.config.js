const {withSentryConfig} = require("@sentry/nextjs");

const nextConfig = {
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = withSentryConfig(
  nextConfig,
  {
    org: "horus-technology",
    project: "auto-rfp",
    silent: !process.env.CI,
    widenClientFileUpload: true,
    disableLogger: true,
    automaticVercelMonitors: true,
  }
);
