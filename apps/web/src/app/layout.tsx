import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@/components/ui/fleet-live-ui/fleet-ui.css";
import { THEME_SCRIPT } from "@/lib/theme-setting";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Fleet Live — Fleet operations, without the noise",
    template: "%s · Fleet Live",
  },
  description:
    "A real-time fleet operations concept and engineering portfolio project. Explore the platform and try the simulated fleet demo.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script may set data-theme before React hydrates.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* The stored theme onto <html> before the first paint, so a reload never flashes the wrong colours. */}
      </head>
      <body className="min-h-full flex flex-col">
        <Script
          id="fleet-live-theme-setting"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
        {children}
      </body>
    </html>
  );
}
