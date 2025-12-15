import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { GlobalHeader } from "@/components/global/global-header";
import { Providers } from "@/providers/providers";
import * as Sentry from '@sentry/nextjs';



export const metadata: Metadata = {
  title: "AutoRFP - AI-Powered RFP Response Solution",
  description: "Automatically answer RFP questions with AI document agents powered by LlamaIndex",
  other: {
    ...Sentry.getTraceData()
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
    <body suppressHydrationWarning>
    <Providers>
      <div className="flex flex-col">
        <GlobalHeader />
        {children}
      </div>
      <Toaster />
    </Providers>
    </body>
    </html>
  );
}
