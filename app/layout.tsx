import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#edf3ee",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: "Nutrient Earth — Personal Food Fit Checks",
  description: "A fast, practical nutrition companion for everyday food decisions and personalized calorie baselines.",
  keywords: ["nutrition", "food fit", "healthy eating", "calorie baseline", "Nutrient Earth"],
  authors: [{ name: "Syed Abdul Rehman" }],
  icons: { icon: "/favicon.ico" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
