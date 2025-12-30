import { Suspense, type ReactNode } from 'react';
import { Inter as FontSans } from "next/font/google";

import { Toaster as SonnerToaster } from "sonner";

import "@/app/globals.css";

import { CriticalErrorBoundary } from "@/components/common/error-boundary";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { Toaster } from "@/components/ui/toaster";
import { ContextProviders } from "@/contexts/providers";

import type { Metadata } from "next";

const inter = FontSans({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Needs",
  description: "Find what you need",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <CriticalErrorBoundary>
          <Suspense fallback={<div>Loading...</div>}>
            <ContextProviders>
              <div className="flex min-h-screen flex-col">
                <Navbar />
                <main className="relative flex-grow">{children}</main>
                <Footer />
                <Toaster />
                <SonnerToaster />
              </div>
            </ContextProviders>
          </Suspense>
        </CriticalErrorBoundary>
      </body>
    </html>
  );
}
