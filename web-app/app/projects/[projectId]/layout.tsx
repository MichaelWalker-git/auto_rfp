import { SidebarLayout } from "@/layouts/sidebar-layout/sidebar-layout";
import type { ReactNode } from "react";

export default function ProjectLayout({ children }: { children: ReactNode }) {
  return <SidebarLayout>{children}</SidebarLayout>;
} 