'use client';

import { ThemeProvider } from 'next-themes';
import { ReactNode } from 'react';
import { OrganizationProvider } from '@/context/organization-context';
import { AuthProvider } from '@/components/AuthProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <AuthProvider>
        <OrganizationProvider>
          {children}
        </OrganizationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
} 