import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Il service worker non va mai messo in cache, altrimenti gli aggiornamenti non arrivano.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Il file Excel esportato da Google Sheets pesa circa 1,2 MB; Vercel accetta fino a 4,5 MB.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
