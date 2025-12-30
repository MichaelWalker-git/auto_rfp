import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/layouts/sidebar-layout/app-sidebar';
import type { ReactNode } from 'react';

export function SidebarLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar/>

        <SidebarInset className="flex min-h-screen flex-col overflow-hidden bg-background">
          <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center border-b bg-background/80 backdrop-blur">
            <div className="flex w-full items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1"/>
              <div className="flex-1"/>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-6xl px-4 py-6">
              {children}
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}