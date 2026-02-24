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
} from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UserSection } from '@/components/user-section';

import {
  BookOpen,
  Briefcase,
  CalendarClock,
  FileText,
  FolderOpen,
  HelpCircle,
  Home,
  LayoutTemplate,
  MessageSquare,
  Search,
  Settings,
  ShieldCheck,
  Target,
  Users
} from 'lucide-react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { useCurrentOrganization } from '@/context/organization-context';
import { useProjectContext } from '@/context/project-context';
import { OrganizationBadge } from '@/components/organization-badge';
import { GlobalHeader } from '@/components/global/global-header';
import { usePermission } from '@/components/permission-wrapper';

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
  const { currentOrganization } = useCurrentOrganization();
  const { currentProject } = useProjectContext();
  const canViewAudit = usePermission('audit:read');

  const route = useMemo(() => getRouteIds(pathname), [pathname]);

  const orgId = route.orgId ?? currentOrganization?.id ?? null;
  const projectId = route.projectId ?? currentProject?.id ?? null;

  const orgNav: NavItem[] = useMemo(
    () =>
      orgId
        ? [
          { title: 'Projects', url: `/organizations/${orgId}/projects`, icon: FolderOpen },
          { title: 'Knowledge Base', url: `/organizations/${orgId}/knowledge-base`, icon: BookOpen },
          { title: 'Past Performance', url: `/organizations/${orgId}/past-performance`, icon: Briefcase },
          { title: 'Search Opportunities', url: `/organizations/${orgId}/opportunities`, icon: Search },
          { title: 'Deadlines', url: `/organizations/${orgId}/deadlines`, icon: CalendarClock },
          { title: 'Templates', url: `/organizations/${orgId}/templates`, icon: LayoutTemplate },
          { title: 'Team', url: `/organizations/${orgId}/team`, icon: Users },
          ...(canViewAudit ? [{ title: 'Audit Trail', url: `/organizations/${orgId}/audit`, icon: ShieldCheck }] : []),
          { title: 'Settings', url: `/organizations/${orgId}/settings`, icon: Settings },
        ]
        : [],
    [orgId, canViewAudit]
  );

  const projectNav: NavItem[] = useMemo(
    () =>
      orgId && projectId
        ? [
          { title: 'Dashboard', url: `/organizations/${orgId}/projects/${projectId}/dashboard`, icon: Home },
          { title: 'Executive Brief', url: `/organizations/${orgId}/projects/${projectId}/brief`, icon: Target },
          { title: 'Opportunities', url: `/organizations/${orgId}/projects/${projectId}/opportunities`, icon: Briefcase },
          { title: 'Questions', url: `/organizations/${orgId}/projects/${projectId}/questions`, icon: MessageSquare },
          { title: 'Solicitation Documents', url: `/organizations/${orgId}/projects/${projectId}/documents`, icon: FileText },
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
          <GlobalHeader/>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}