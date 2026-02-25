import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  outputFileTracingRoot: path.join(__dirname, '../../..'),
  turbopack: {
    root: path.join(__dirname, '../../..'),
  },
};

export default nextConfig;
