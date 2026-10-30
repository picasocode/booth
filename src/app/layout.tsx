import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/booth/theme-provider";

// Self-hosted variable fonts (works offline, on Vercel, and avoids the
// next/font/google + Turbopack pipeline entirely).
const display = localFont({
  src: "../fonts/bricolage-var.woff2",
  variable: "--font-display",
  weight: "200 800",
  display: "swap",
});

const body = localFont({
  src: "../fonts/public-sans-var.woff2",
  variable: "--font-body",
  weight: "100 900",
  display: "swap",
});

const deva = localFont({
  src: "../fonts/noto-deva-var.woff2",
  variable: "--font-deva",
  weight: "100 900",
  display: "swap",
});

const tamil = localFont({
  src: "../fonts/noto-tamil-var.woff2",
  variable: "--font-tamil",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Booth — live interpretation for meetings",
  description:
    "Give your meeting a live interpretation channel: translated voice and captions in up to four languages, a few seconds behind the speaker, the way a human booth works.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${display.variable} ${body.variable} ${deva.variable} ${tamil.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
