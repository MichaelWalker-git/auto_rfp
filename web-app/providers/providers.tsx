'use client';

import { ThemeProvider } from 'next-themes';
import { ReactNode } from 'react';
import { OrganizationProvider } from '@/context/organization-context';
import { AuthProvider } from '@/components/AuthProvider';
import { ProjectProvider } from '@/context/project-context';

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
          <ProjectProvider>
            {children}
          </ProjectProvider>
        </OrganizationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
} 