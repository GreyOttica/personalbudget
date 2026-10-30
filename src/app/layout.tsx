import type { Metadata, Viewport } from "next";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Personal Budget", template: "%s · Personal Budget" },
  description: "Spese, budget e analisi personali",
  robots: { index: false, follow: false },
  applicationName: "Personal Budget",
  appleWebApp: { capable: true, title: "Budget", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
