/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 'standalone' bundles the app for Docker; Vercel uses its own output format.
  ...(process.env.BUILD_STANDALONE === 'true' && { output: 'standalone' }),
};

module.exports = nextConfig;
