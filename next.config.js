/** @type {import('next').NextConfig} */
const nextConfig = {
  // 输出为独立模式，适合服务器部署
  output: 'standalone',
  // 启用严格模式
  reactStrictMode: true,
  // 允许异步外部包
  experimental: {
    esmExternals: 'loose'
  },
  // 环境变量
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
  // 启用 CORS
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ]
  },
}

export default nextConfig
