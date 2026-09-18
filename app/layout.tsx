import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SpendDesk · Your daily overview",
  description:
    "Your Google Ads accounts and Shopify stores, in one private workspace.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
