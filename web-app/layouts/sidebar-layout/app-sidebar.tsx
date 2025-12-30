'use client';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar';

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
  Users,
} from 'lucide-react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useOrganization } from '@/context/organization-context';
import { useProjectContext } from '@/context/project-context';
import { OrganizationBadge } from '@/components/organization-badge';
import { UserSection } from '@/components/user-section';
import { cn } from '@/lib/utils';

function getRouteIds(pathname: string) {
  const orgMatch = pathname.match(/^\/organizations\/([^/]+)/);
  const orgId = orgMatch?.[1] ?? null;

  const projectMatch = pathname.match(/^\/organizations\/[^/]+\/projects\/([^/]+)/);
  const projectId = projectMatch?.[1] ?? null;

  return {
    orgId,
    projectId,
    isOrgRoute: !!orgId,
    isProjectRoute: !!orgId && !!projectId,
  };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

export function AppSidebar() {
  const pathname = usePathname();

  const { currentOrganization } = useOrganization();
  const { currentProject } = useProjectContext();

  const route = getRouteIds(pathname);

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

  const isItemActive = (url: string) => pathname === url || pathname.startsWith(url + '/');

  const showOrgSection = route.isOrgRoute;
  const showProjectSection = route.isProjectRoute;

  return (
    <Sidebar
      variant="inset"
      collapsible="icon"
      className="h-full border-r bg-muted/10"
    >
      <SidebarHeader
        className="sticky top-0 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <OrganizationBadge/>
        <SidebarSeparator className="mt-3"/>
      </SidebarHeader>

      <SidebarContent className="overflow-y-auto px-1 pb-2">
        <SidebarMenu className="px-1">
          {showProjectSection ? (
            <>
              <SectionLabel>Project</SectionLabel>
              <SidebarMenuSub className="mx-1">
                {projectNav.map((item) => (
                  <SidebarMenuSubItem key={item.title}>
                    <SidebarMenuSubButton
                      asChild
                      isActive={isItemActive(item.url)}
                      className={cn(
                        'rounded-xl px-3 py-2',
                        'hover:bg-muted/60',
                        'data-[active=true]:bg-primary/10 data-[active=true]:text-primary',
                        'data-[active=true]:border data-[active=true]:border-primary/20'
                      )}
                    >
                      <Link href={item.url}>
                        <item.icon className="size-4"/>
                        <span className="font-medium">{item.title}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>

              <SidebarSeparator className="my-3"/>

              <SectionLabel>Organization</SectionLabel>
              <SidebarMenuSub className="mx-1">
                {orgNav.slice(0, 3).map((item) => (
                  <SidebarMenuSubItem key={item.title}>
                    <SidebarMenuSubButton
                      asChild
                      isActive={isItemActive(item.url)}
                      className={cn(
                        'rounded-xl px-3 py-2',
                        'hover:bg-muted/60',
                        'data-[active=true]:bg-primary/10 data-[active=true]:text-primary',
                        'data-[active=true]:border data-[active=true]:border-primary/20'
                      )}
                    >
                      <Link href={item.url}>
                        <item.icon className="size-4"/>
                        <span className="font-medium">{item.title}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </>
          ) : showOrgSection ? (
            <>
              <SectionLabel>Organization</SectionLabel>
              <SidebarMenuSub className="mx-1">
                {orgNav.map((item) => (
                  <SidebarMenuSubItem key={item.title}>
                    <SidebarMenuSubButton
                      asChild
                      isActive={isItemActive(item.url)}
                      className={cn(
                        'rounded-xl px-3 py-2',
                        'hover:bg-muted/60',
                        'data-[active=true]:bg-primary/10 data-[active=true]:text-primary',
                        'data-[active=true]:border data-[active=true]:border-primary/20'
                      )}
                    >
                      <Link href={item.url}>
                        <item.icon className="size-4"/>
                        <span className="font-medium">{item.title}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </>
          ) : (
            <div className="px-3 py-3">
              <div className="rounded-2xl border border-dashed bg-muted/20 p-4 text-center">
                <Building2 className="mx-auto h-9 w-9 text-muted-foreground/70"/>
                <div className="mt-2 text-sm font-medium">Choose a workspace</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Select an organization to see navigation.
                </div>
                <div className="mt-3">
                  <Link
                    href="/organizations"
                    className="inline-flex h-9 items-center justify-center rounded-xl border bg-background px-3 text-sm font-medium hover:bg-muted/40"
                  >
                    Go to organizations
                  </Link>
                </div>
              </div>
            </div>
          )}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter
        className="sticky bottom-0 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <SidebarSeparator/>
        <div className="px-2 py-2">
          <UserSection/>
        </div>
        <SidebarSeparator/>
        <SidebarMenu className="px-2 pb-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="rounded-xl hover:bg-muted/60"
            >
              <Link href="/help">
                <HelpCircle className="size-4"/>
                <span className="font-medium">Help &amp; Support</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail/>
    </Sidebar>
  );
}