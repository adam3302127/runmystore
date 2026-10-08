import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TimeZoneProvider } from "@/components/TimeZone";

export const metadata: Metadata = {
  title: { default: "RMS Ops Console", template: "%s · RMS Ops Console" },
  description: "Every bot, every action, live. The RunMyStore operations console.",
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = { themeColor: "#1a1a1a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        <TimeZoneProvider>{children}</TimeZoneProvider>
      </body>
    </html>
  );
}
