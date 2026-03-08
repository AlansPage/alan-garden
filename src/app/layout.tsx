import type { Metadata } from "next";
import "./globals.css";
import { TransitionProvider } from "@/components/TransitionLayer";

export const metadata: Metadata = {
  title: "ALAN_GARDEN",
  description: "Alan's Garden — pixel creature vault",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="garden-body" style={{ fontFamily: "'Press Start 2P', 'IBM Plex Mono', monospace" }}>
        <TransitionProvider>{children}</TransitionProvider>
      </body>
    </html>
  );
}
