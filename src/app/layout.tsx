import type { Metadata, Viewport } from "next";
import { Hind, Literata } from "next/font/google";

import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/toaster";

import "./globals.css";

const hind = Hind({
  subsets: ["latin", "devanagari"],
  weight: ["400", "500", "600"],
  variable: "--font-hind",
  display: "swap",
});

const literata = Literata({
  subsets: ["latin"],
  variable: "--font-literata",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pattern Practice",
  description: "Practise natural English phrase patterns instead of translating word by word.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: { media: "(prefers-color-scheme: light)", color: "#F1F3F6" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${hind.variable} ${literata.variable}`}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5">
            <SiteHeader />
            <main className="flex-1 py-6 pb-10">{children}</main>
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}