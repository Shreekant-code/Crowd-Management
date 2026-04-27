/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  typedRoutes: false,
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }

    return config;
  },
};

module.exports = nextConfig;
