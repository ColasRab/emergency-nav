import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Indoor Wayfinder",
  description: "Camera-based indoor emergency navigation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
