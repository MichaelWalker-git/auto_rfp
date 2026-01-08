"use client";

import React, { useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";

interface ProjectPageProviderProps {
  projectId: string;
  children: React.ReactNode;
}

export function ProjectPageProvider({ projectId, children }: ProjectPageProviderProps) {
  // Control sidebar state at this level to avoid re-renders causing toggle issues
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  return (
    <SidebarProvider 
      defaultOpen={true}
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
    >
      {children}
    </SidebarProvider>
  );
} 