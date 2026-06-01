/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained server bundle under .next/standalone/
  // Required for the multi-stage Docker image.
  output: 'standalone',
};

module.exports = nextConfig;
