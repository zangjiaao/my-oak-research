import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
      // 可以根据需要添加更多外部图片域名
      // {
      //   protocol: "https",
      //   hostname: "**.example.com",
      // },
    ],
    // 允许加载 SVG 图片（用于占位图服务等）
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
