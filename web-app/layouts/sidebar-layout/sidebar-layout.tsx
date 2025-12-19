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
import { OrganizationProjectSwitcher } from '@/components/organization-project-switcher';
import { useOrganization } from '@/context/organization-context';
import {
  FileText,
  HelpCircle,
  Home,
  MessageSquare,
  Settings,
  Users,
  Building2,
  FolderOpen,
  BookOpen,
  ScrollText
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

function AppSidebar() {
  const pathname = usePathname();
  const { currentProject, currentOrganization } = useOrganization();

  // Extract IDs from URL
  const projectMatch = pathname.match(/\/projects\/([^/]+)/);
  const orgMatch = pathname.match(/\/organizations\/([^/]+)/);

  const projectIdFromPath = projectMatch?.[1] ?? null;
  const orgIdFromPath = orgMatch?.[1] ?? null;

  // Determine current context
  const routeContext =
    projectIdFromPath && currentProject
      ? {
        type: 'project' as const,
        id: projectIdFromPath,
        name: currentProject.name,
      }
      : orgIdFromPath && currentOrganization
        ? {
          type: 'organization' as const,
          id: orgIdFromPath,
          name: currentOrganization.name,
        }
        : ({ type: 'global' } as const);

  // Organization-level navigation items
  const getOrganizationNavigationItems = (orgId: string) => [
    {
      title: 'Organization',
      items: [
        {
          title: 'Projects',
          url: `/organizations/${orgId}/projects`,
          icon: FolderOpen,
        },
        {
          title: 'Knowledge Base',
          url: `/organizations/${orgId}/knowledge-base`,
          icon: BookOpen,
        },
        {
          title: 'Team',
          url: `/organizations/${orgId}/team`,
          icon: Users,
        },
        {
          title: 'Settings',
          url: `/organizations/${orgId}/settings`,
          icon: Settings,
        },
      ],
    },
  ];

  // Project-scoped navigation items
  const getProjectNavigationItems = (projectId: string) => [
    {
      title: 'Project',
      items: [
        {
          title: 'Dashboard',
          url: `/projects/${projectId}/dashboard`,
          icon: Home,
        },
        {
          title: 'Questions',
          url: `/projects/${projectId}/questions`,
          icon: MessageSquare,
        },
        {
          title: 'Documents',
          url: `/projects/${projectId}/documents`,
          icon: FileText,
        },
        {
          title: 'Proposals',
          url: `/projects/${projectId}/proposals`,
          icon: ScrollText,
        },
      ],
    },
  ];

  // Decide which nav items to show
  const contextNavigationItems = (() => {
    if (routeContext.type === 'project' && projectIdFromPath) {
      return getProjectNavigationItems(projectIdFromPath);
    }
    if (routeContext.type === 'organization' && orgIdFromPath) {
      return getOrganizationNavigationItems(orgIdFromPath);
    }
    return [];
  })();

  // Simple "active" matcher: exact match or nested route
  const isItemActive = (itemUrl: string) => {
    return pathname.includes(itemUrl);
  };

  return (
    <Sidebar variant="inset" collapsible="icon" className="border-r h-full">
      <SidebarHeader>
        <OrganizationProjectSwitcher/>
      </SidebarHeader>

      <SidebarContent className="overflow-y-auto">
        <SidebarMenu>
          {/* Context-specific navigation (organization or project) */}
          {contextNavigationItems.map((group) => (
            <div key={group.title}>
              <SidebarMenuSub>
                {group.items.map((item) => (
                  <SidebarMenuSubItem key={item.title}>
                    <SidebarMenuSubButton
                      asChild
                      isActive={isItemActive(item.url)}
                    >
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
          ))}

          {/* Context indicator */}
          {routeContext.type === 'global' && (
            <div className="px-4 py-2">
              <div className="text-center text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                <Building2 className="mx-auto h-8 w-8 mb-2 opacity-50"/>
                <p className="font-medium mb-1">No Context Selected</p>
                <p className="text-xs">
                  Choose an organization or project to access specific tools
                </p>
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

interface SidebarLayoutProps {
  children: ReactNode;
}

export function SidebarLayout({ children }: SidebarLayoutProps) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar/>
        {/* Main content area with independent scrolling */}
        <SidebarInset className="flex-1 flex flex-col overflow-hidden">
          {/* Fixed header */}
          <header
            className="flex h-16 shrink-0 items-center border-b bg-background transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1"/>
            </div>
          </header>

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
