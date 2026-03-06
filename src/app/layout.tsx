import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ALAN_GARDEN",
  description: "Alan's Garden — particle creature vault",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="garden-body">
        {children}
      </body>
    </html>
  );
}
