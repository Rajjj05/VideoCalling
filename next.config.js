/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone', // Ensure this is correct for deployment
    experimental: {
      appDir: true, // Required if using App Router
    },
  };
  
  module.exports = nextConfig;
  