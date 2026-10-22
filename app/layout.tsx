import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: "Nutrient Earth — AI Metabolic & Caloric Intelligence",
  description:
    "Calculate your personalized BMR, TDEE, caloric targets, and macro breakdown with precision using the Mifflin-St Jeor metabolic calculation engine.",
  keywords: [
    "BMR calculator",
    "TDEE calculator",
    "nutrition bot",
    "macro breakdown",
    "Nutrient Earth",
    "Mifflin-St Jeor",
  ],
  authors: [{ name: "Syed Abdul Rehman" }],
  icons: {
    icon: "/favicon.ico",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
        {children}
      </body>
    </html>
  );
}

