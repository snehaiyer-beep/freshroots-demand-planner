import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/Nav";
import { currentUserEmail } from "@/lib/auth";
import { authBypassed } from "@/lib/authMode";
import { zohoMockMode } from "@/lib/zoho";

const inter = Inter({ subsets: ["latin"], display: "swap" });

// Every page depends on the signed-in user (sidebar email), so nothing is prerendered.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Freshroots Demand Planner",
  description: "Twice-weekly reorder recommendations with approval before any Zoho PO.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const email = await currentUserEmail();
  return (
    <html lang="en">
      <body className={inter.className}>
        <Shell email={email} localMode={authBypassed()} zohoLive={!zohoMockMode()}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
