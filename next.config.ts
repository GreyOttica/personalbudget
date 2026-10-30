import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Il file Excel esportato da Google Sheets pesa circa 1,2 MB; Vercel accetta fino a 4,5 MB.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
