const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    reactStrictMode: true,
    basePath: basePath || undefined,
    assetPrefix: basePath || undefined,
    images: {
        unoptimized: true,
    },
    devIndicators: false,
}

export default nextConfig
