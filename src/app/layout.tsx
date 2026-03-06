import type { Metadata } from "next";
import "./globals.css";
import { TransitionProvider } from "@/components/TransitionLayer";

export const metadata: Metadata = {
  title: "ALAN_GARDEN",
  description: "Alan's Garden — particle creature vault",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="garden-body" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
        <TransitionProvider>{children}</TransitionProvider>
      </body>
    </html>
  );
}
