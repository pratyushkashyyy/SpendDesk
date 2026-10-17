import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.STOREDESK_BROWSER_TEST === "true" ? ".next-test" : ".next",
  poweredByHeader: false,
  devIndicators: false,
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          { type: "host", value: "dashboard-production-30d6.up.railway.app" },
        ],
        destination: "https://spenddesk.unicornkart.us/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
