import { SidebarLayout } from '@/layouts/sidebar-layout/sidebar-layout';

type Props = {
  children: React.ReactNode;
}

export default function OrganizationsLayout({ children }: Props) {
  return (
    <SidebarLayout>{children}</SidebarLayout>
  );
} 