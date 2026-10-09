import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // This app lives in the repository npm workspace. Pin tracing here so Next
  // does not treat an unrelated lockfile higher in the user profile as root.
  outputFileTracingRoot: path.join(__dirname, '..'),
  output: 'standalone',
};

export default nextConfig;
