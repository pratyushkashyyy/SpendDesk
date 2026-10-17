import type { Metadata } from "next";
import { PublicSite } from "@/components/public-site";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicSite>{children}</PublicSite>;
}
