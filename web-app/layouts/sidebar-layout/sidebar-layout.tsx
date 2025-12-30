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
  Building2,
  FileText,
  FolderOpen,
  HelpCircle,
  Home,
  MessageSquare,
  ScrollText,
  Search,
  Settings,
  Users
} from 'lucide-react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { useOrganization } from '@/context/organization-context';
import { useProjectContext } from '@/context/project-context';
import { OrganizationBadge } from '@/components/organization-badge';

function getRouteIds(pathname: string) {
  // org routes: /organizations/:orgId/...
  const orgMatch = pathname.match(/^\/organizations\/([^/]+)/);
  const orgId = orgMatch?.[1] ?? null;

  // project routes inside org: /organizations/:orgId/projects/:projectId/...
  const projectMatch = pathname.match(/^\/organizations\/[^/]+\/projects\/([^/]+)/);
  const projectId = projectMatch?.[1] ?? null;

  // are we inside project context? (must be /organizations/:orgId/projects/:projectId)
  const isProjectRoute = !!orgId && !!projectId;

  // are we inside org context? (must be /organizations/:orgId)
  const isOrgRoute = !!orgId;

  return { orgId, projectId, isOrgRoute, isProjectRoute };
}

function AppSidebar() {
  const pathname = usePathname();

  const { currentOrganization } = useOrganization();
  const { currentProject } = useProjectContext();

  const route = getRouteIds(pathname);

  // Prefer ids from URL, fallback to context (helps on pages like /organizations (no id yet))
  const orgId = route.orgId ?? currentOrganization?.id ?? null;
  const projectId = route.projectId ?? currentProject?.id ?? null;

  const orgNav =
    orgId
      ? [
        { title: 'Projects', url: `/organizations/${orgId}/projects`, icon: FolderOpen },
        { title: 'Knowledge Base', url: `/organizations/${orgId}/knowledge-base`, icon: BookOpen },
        { title: 'Opportunities', url: `/organizations/${orgId}/opportunities`, icon: Search },
        { title: 'Team', url: `/organizations/${orgId}/team`, icon: Users },
        { title: 'Settings', url: `/organizations/${orgId}/settings`, icon: Settings },
      ]
      : [];

  const projectNav =
    orgId && projectId
      ? [
        { title: 'Dashboard', url: `/organizations/${orgId}/projects/${projectId}/dashboard`, icon: Home },
        { title: 'Questions', url: `/organizations/${orgId}/projects/${projectId}/questions`, icon: MessageSquare },
        { title: 'Documents', url: `/organizations/${orgId}/projects/${projectId}/documents`, icon: FileText },
        { title: 'Proposals', url: `/organizations/${orgId}/projects/${projectId}/proposals`, icon: ScrollText },
      ]
      : [];

  const items = route.isProjectRoute ? projectNav : route.isOrgRoute ? orgNav : [];

  const isItemActive = (url: string) => pathname === url || pathname.startsWith(url + '/');

  return (
    <Sidebar variant="inset" collapsible="icon" className="border-r h-full">
      <SidebarHeader>
        <OrganizationBadge/>
      </SidebarHeader>

      <SidebarContent className="overflow-y-auto">
        <SidebarMenu>
          {items.length > 0 ? (
            <div>
              <SidebarMenuSub>
                {items.map((item) => (
                  <SidebarMenuSubItem key={item.title}>
                    <SidebarMenuSubButton asChild isActive={isItemActive(item.url)}>
                      <Link href={item.url}>
                        <item.icon className="size-4"/>
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
              <SidebarSeparator className="my-2"/>
            </div>
          ) : (
            <div className="px-4 py-2">
              <div className="text-center text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                <Building2 className="mx-auto h-8 w-8 mb-2 opacity-50"/>
                <p className="font-medium mb-1">No context selected</p>
                <p className="text-xs">Pick an organization to continue.</p>
              </div>
            </div>
          )}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter>
        <UserSection/>
        <SidebarSeparator/>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/help">
                <HelpCircle className="size-4"/>
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
              <SidebarTrigger className="-ml-1"/>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}