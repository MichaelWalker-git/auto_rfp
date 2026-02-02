import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { Providers } from '@/providers/providers';
import * as Sentry from '@sentry/nextjs';

export const metadata: Metadata = {
  title: 'AutoRFP - AI-Powered RFP Response Solution',
  description: 'Automatically answer RFP questions with AI document agents powered by LlamaIndex',
  other: {
    ...Sentry.getTraceData(),
  },
};

type Props = {
  children: React.ReactNode
}

export default function RootLayout({ children }: Props) {
  return (
    <html lang="en" suppressHydrationWarning>
    <body suppressHydrationWarning>
    <Providers>
      <div className="flex flex-col">
        {children}
      </div>
      <Toaster/>
    </Providers>
    </body>
    </html>
  );
}