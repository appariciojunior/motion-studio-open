/** @type {import('next').NextConfig} */

// STATIC_EXPORT=1 → GitHub Pages build: static export served under the
// project subpath, with the server-only /api/export route removed by the
// workflow. Unset (default) → normal dev/build with native-ffmpeg export.
const isStatic = process.env.STATIC_EXPORT === '1';
const basePath = isStatic ? '/motion-studio-open' : '';

const nextConfig = {
  reactStrictMode: false, // avoid double Pixi mount in dev
  devIndicators: false,   // hide the dev overlay badge (it covers the play button)
  turbopack: { root: process.cwd() },
  ...(isStatic && {
    output: 'export',
    basePath,
    images: { unoptimized: true }, // no next/image today; keeps future use export-safe
  }),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_STATIC_EXPORT: isStatic ? '1' : '',
  },
};

export default nextConfig;
