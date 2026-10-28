import { Suspense, type ReactNode } from 'react';
import { Noto_Sans as FontSans } from "next/font/google";
import { cookies, headers } from 'next/headers';

import { Toaster as SonnerToaster } from "sonner";

import "@/app/globals.css";

import { CriticalErrorBoundary } from "@/components/common/error-boundary";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { PageMotion } from "@/components/layout/page-motion";
import { SkipLink } from "@/components/layout/skip-link";
import { PreviewNotice } from '@/components/layout/preview-notice';
import { Toaster } from "@/components/ui/toaster";
import { ContextProviders } from "@/contexts/providers";

import type { Metadata } from "next";

const fontSans = FontSans({ subsets: ["latin", "greek"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Needs",
  description: "Find what you need",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const nonce = (await headers()).get('x-nonce') || undefined;
  const initialLocale = (await cookies()).get('locale')?.value === 'el' ? 'el' : 'en';
  return (
    <html lang={initialLocale} suppressHydrationWarning>
      <body className={`${fontSans.className} ${fontSans.variable}`}>
        <CriticalErrorBoundary>
          <Suspense fallback={<div>Loading...</div>}>
            <ContextProviders nonce={nonce} initialLocale={initialLocale}>
              <SkipLink />
              <div className="flex min-h-screen flex-col">
                <Navbar />
                <PageMotion>{children}</PageMotion>
                <PreviewNotice />
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
