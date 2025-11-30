import { SidebarLayout } from "@/layouts/sidebar-layout/sidebar-layout";

export default function OrganizationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
  
      <SidebarLayout>{children}</SidebarLayout>
  
  );
} 