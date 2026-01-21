'use client';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UserSection } from '@/components/user-section';

import {
  BookOpen,
  FileText,
  FolderOpen,
  HelpCircle,
  Home,
  MessageSquare,
  Briefcase,
  ScrollText,
  Search,
  Settings,
  Users,
  CalendarClock
} from 'lucide-react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { useOrganization } from '@/context/organization-context';
import { useProjectContext } from '@/context/project-context';
import { OrganizationBadge } from '@/components/organization-badge';

interface RouteInfo {
  orgId: string | null;
  projectId: string | null;
  isOrgRoute: boolean;
  isProjectRoute: boolean;
}

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
}

function getRouteIds(pathname: string): RouteInfo {
  const orgMatch = pathname.match(/^\/organizations\/([^/]+)/);
  const orgId = orgMatch?.[1] ?? null;

  const projectMatch = pathname.match(/^\/organizations\/[^/]+\/projects\/([^/]+)/);
  const projectId = projectMatch?.[1] ?? null;

  const isProjectRoute = !!orgId && !!projectId;
  const isOrgRoute = !!orgId;

  return { orgId, projectId, isOrgRoute, isProjectRoute };
}

function NavigationMenu({ items, isActive }: { items: NavItem[]; isActive: (url: string) => boolean }) {
  return (
    <SidebarMenuSub>
      {items.map((item) => {
        const active = isActive(item.url);
        return (
          <SidebarMenuSubItem key={item.title}>
            <SidebarMenuSubButton asChild isActive={active}>
              <Link href={item.url} aria-current={active ? 'page' : undefined}>
                <item.icon className="size-4" aria-hidden="true"/>
                <span>{item.title}</span>
                {item.badge && (
                  <span className="ml-auto text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                    {item.badge}
                  </span>
                )}
              </Link>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        );
      })}
    </SidebarMenuSub>
  );
}

function AppSidebar() {
  const pathname = usePathname();
  const { currentOrganization } = useOrganization();
  const { currentProject } = useProjectContext();

  const route = useMemo(() => getRouteIds(pathname), [pathname]);

  const orgId = route.orgId ?? currentOrganization?.id ?? null;
  const projectId = route.projectId ?? currentProject?.id ?? null;

  const orgNav: NavItem[] = useMemo(
    () =>
      orgId
        ? [
          { title: 'Projects', url: `/organizations/${orgId}/projects`, icon: FolderOpen },
          { title: 'Knowledge Base', url: `/organizations/${orgId}/knowledge-base`, icon: BookOpen },
          { title: 'Search Opportunities', url: `/organizations/${orgId}/opportunities`, icon: Search },
          { title: 'Deadlines', url: `/organizations/${orgId}/deadlines`, icon: CalendarClock },
          { title: 'Team', url: `/organizations/${orgId}/team`, icon: Users },
          { title: 'Settings', url: `/organizations/${orgId}/settings`, icon: Settings },
        ]
        : [],
    [orgId]
  );

  const projectNav: NavItem[] = useMemo(
    () =>
      orgId && projectId
        ? [
          { title: 'Dashboard', url: `/organizations/${orgId}/projects/${projectId}/dashboard`, icon: Home },
          { title: 'Opportunities', url: `/organizations/${orgId}/projects/${projectId}/opportunities`, icon: Briefcase },
          { title: 'Questions', url: `/organizations/${orgId}/projects/${projectId}/questions`, icon: MessageSquare },
          { title: 'RFP Documents', url: `/organizations/${orgId}/projects/${projectId}/documents`, icon: FileText },
          { title: 'Proposals', url: `/organizations/${orgId}/projects/${projectId}/proposals`, icon: ScrollText },
        ]
        : [],
    [orgId, projectId]
  );

  const items = route.isProjectRoute ? projectNav : route.isOrgRoute ? orgNav : [];

  const isItemActive = (url: string) => pathname === url || pathname.startsWith(`${url}/`);

  return (
    <Sidebar variant="inset" collapsible="icon" className="border-r h-full">
      <SidebarHeader>
        <OrganizationBadge/>
      </SidebarHeader>

      <SidebarContent className="overflow-y-auto">
        <SidebarMenu>
          <NavigationMenu items={items} isActive={isItemActive}/>
          <SidebarSeparator className="my-2"/>
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter>
        <UserSection/>
        <SidebarSeparator/>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/help">
                <HelpCircle className="size-4" aria-hidden="true"/>
                <span>Help &amp; Support</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail/>
    </Sidebar>
  );
}

export function SidebarLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar/>
        <SidebarInset className="flex-1 flex flex-col overflow-hidden">
          <header
            className="flex h-16 shrink-0 items-center border-b bg-background transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" aria-label="Toggle sidebar"/>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}